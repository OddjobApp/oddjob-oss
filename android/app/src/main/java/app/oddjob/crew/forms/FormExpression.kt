package app.oddjob.crew.forms

import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Port of the STRICT path of shared/form-expression.ts (`tryEvaluateExpression`),
 * which is what the web's StudioForm runs for every chat form. A formula must give
 * the same answer on a phone as in the browser, or a calculator the crew built
 * would submit a different number depending on where it was used.
 *
 * Values follow the JS model the original works in: numbers are Double, plus
 * String, Boolean, List and Map, with JS truthiness, `+` that adds only when both
 * sides look numeric, and a [Missing] marker that carries unanswered inputs
 * through a calculation. Keep this in step with the TypeScript: the parity tests
 * in FormExpressionTest are taken from its behaviour.
 */
sealed interface ExpressionOutcome {
    data class Value(val value: Any?) : ExpressionOutcome
    data class Missing(val names: List<String>) : ExpressionOutcome
    data class Error(val message: String) : ExpressionOutcome
}

private class Missing(val names: List<String>)

private fun mergeMissing(vararg values: Any?): Missing =
    Missing(values.filterIsInstance<Missing>().flatMap { it.names }.distinct())

// V8's Math.pow/log/atan2 are fdlibm ports, as StrictMath is; the JVM's Math
// intrinsics can differ in the last digit, which then shows in a submitted value.
private fun Double.pow(x: Double): Double = StrictMath.pow(this, x)
private fun ln(x: Double): Double = StrictMath.log(x)
private fun atan2(y: Double, x: Double): Double = StrictMath.atan2(y, x)

private class FormulaException(message: String) : Exception(message)

private data class Token(val type: Type, val value: String) {
    enum class Type { NUM, STR, ID, OP, PUNC }
}

object FormExpression {

    fun evaluate(expr: String, scope: Map<String, Any?>): ExpressionOutcome {
        if (expr.isBlank()) return ExpressionOutcome.Error("An expression is required.")
        return try {
            val strictScope = HashMap<String, Any?>(scope)
            strictScope["true"] = true
            strictScope["false"] = false
            for (ref in references(expr)) {
                val v = scope[ref]
                if (!scope.containsKey(ref) || v == "" || v == null) strictScope[ref] = Missing(listOf(ref))
            }
            when (val result = Parser(tokenize(expr), strictScope).parse()) {
                is Missing -> ExpressionOutcome.Missing(result.names)
                is Double -> if (result.isFinite()) ExpressionOutcome.Value(result)
                    else ExpressionOutcome.Error("Calculation is not finite (check divisors and domains).")
                else -> ExpressionOutcome.Value(result)
            }
        } catch (e: FormulaException) {
            ExpressionOutcome.Error(e.message ?: "Invalid formula")
        }
    }

    /** Field references in [expr]; throws on an unknown function, as expressionReferences does. */
    fun references(expr: String): List<String> {
        val tokens = tokenize(expr)
        tokens.forEachIndexed { i, t ->
            if (t.type == Token.Type.ID && tokens.getOrNull(i + 1)?.value == "(" && t.value.lowercase() !in FUNCTIONS) {
                throw FormulaException("Unknown function: ${t.value}")
            }
        }
        return tokens.filterIndexed { i, t ->
            t.type == Token.Type.ID && tokens.getOrNull(i + 1)?.value != "(" && t.value != "true" && t.value != "false"
        }.map { it.value }.distinct()
    }

    /** True unless the expression is present and evaluates falsy, as isVisible does. */
    fun isVisible(expr: String?, values: Map<String, Any?>): Boolean {
        if (expr.isNullOrEmpty()) return true
        val outcome = evaluate(expr, values)
        return outcome is ExpressionOutcome.Value && JsValues.truthy(outcome.value)
    }

    // ---- Tokenizer --------------------------------------------------------

    private fun tokenize(src: String): List<Token> {
        val toks = mutableListOf<Token>()
        var i = 0
        fun isDigit(c: Char) = c in '0'..'9'
        fun isIdStart(c: Char) = c.isAsciiLetter() || c == '_' || c == '$'
        fun isIdChar(c: Char) = isIdStart(c) || isDigit(c) || c == '.'
        while (i < src.length) {
            val c = src[i]
            if (c == ' ' || c == '\t' || c == '\n' || c == '\r') { i++; continue }
            if (isDigit(c) || (c == '.' && i + 1 < src.length && isDigit(src[i + 1]))) {
                var j = i + 1
                while (j < src.length && (isDigit(src[j]) || src[j] == '.')) j++
                toks += Token(Token.Type.NUM, src.substring(i, j)); i = j; continue
            }
            if (c == '\'' || c == '"') {
                var j = i + 1
                val s = StringBuilder()
                while (j < src.length && src[j] != c) { s.append(src[j]); j++ }
                toks += Token(Token.Type.STR, s.toString()); i = j + 1; continue
            }
            if (isIdStart(c)) {
                var j = i + 1
                while (j < src.length && isIdChar(src[j])) j++
                toks += Token(Token.Type.ID, src.substring(i, j)); i = j; continue
            }
            val two = if (i + 2 <= src.length) src.substring(i, i + 2) else ""
            if (two in setOf("==", "!=", ">=", "<=", "&&", "||")) { toks += Token(Token.Type.OP, two); i += 2; continue }
            if (c in "+-*/%^><!") { toks += Token(Token.Type.OP, c.toString()); i++; continue }
            if (c in "(),?:") { toks += Token(Token.Type.PUNC, c.toString()); i++; continue }
            // Reject what the grammar does not know rather than skipping it: a
            // skipped `?` once turned a ternary into a confident wrong value.
            throw FormulaException("Unsupported character in formula: $c")
        }
        return toks
    }

    private fun Char.isAsciiLetter() = this in 'a'..'z' || this in 'A'..'Z'

    // ---- Parser (strict) --------------------------------------------------

    private class Parser(private val toks: List<Token>, private val scope: Map<String, Any?>) {
        private var pos = 0
        private fun peek() = toks.getOrNull(pos)
        private fun next() = toks.getOrNull(pos++)

        fun parse(): Any? {
            val v = ternary()
            if (pos < toks.size) throw FormulaException("Unexpected trailing input in formula near \"${peek()?.value}\"")
            return v
        }

        private fun ternary(): Any? {
            val cond = or()
            val t = peek()
            if (t != null && t.type == Token.Type.PUNC && t.value == "?") {
                next()
                val whenTrue = ternary()
                if (peek()?.value == ":") next() else throw FormulaException("Ternary is missing its ':' branch")
                val whenFalse = ternary()
                if (cond is Missing) return cond
                return if (JsValues.truthy(cond)) whenTrue else whenFalse
            }
            return cond
        }

        private fun or(): Any? {
            var v = and()
            while (peek()?.value == "||") {
                next()
                val r = and()
                v = if (v is Missing || r is Missing) {
                    if ((v !is Missing && JsValues.truthy(v)) || (r !is Missing && JsValues.truthy(r))) true else mergeMissing(v, r)
                } else JsValues.truthy(v) || JsValues.truthy(r)
            }
            return v
        }

        private fun and(): Any? {
            var v = cmp()
            while (peek()?.value == "&&") {
                next()
                val r = cmp()
                v = if (v is Missing || r is Missing) {
                    if ((v !is Missing && !JsValues.truthy(v)) || (r !is Missing && !JsValues.truthy(r))) false else mergeMissing(v, r)
                } else JsValues.truthy(v) && JsValues.truthy(r)
            }
            return v
        }

        private fun cmp(): Any? {
            val v = add()
            val t = peek()
            if (t != null && t.type == Token.Type.OP && t.value in setOf("==", "!=", ">", "<", ">=", "<=")) {
                val op = next()!!.value
                val r = add()
                if (v is Missing || r is Missing) return mergeMissing(v, r)
                val c: Int
                val equal: Boolean
                if (JsValues.isNumeric(v) && JsValues.isNumeric(r)) {
                    val a = JsValues.toNum(v); val b = JsValues.toNum(r)
                    equal = a == b
                    c = a.compareTo(b)
                    // NaN cannot arise from toNum, so compareTo matches JS ordering here.
                } else {
                    val a = JsValues.toStr(v); val b = JsValues.toStr(r)
                    equal = a == b
                    c = a.compareTo(b)
                }
                return when (op) {
                    "==" -> equal
                    "!=" -> !equal
                    ">" -> c > 0
                    "<" -> c < 0
                    ">=" -> c >= 0
                    else -> c <= 0
                }
            }
            return v
        }

        private fun add(): Any? {
            var v = mul()
            while (peek()?.let { it.type == Token.Type.OP && (it.value == "+" || it.value == "-") } == true) {
                val op = next()!!.value
                val r = mul()
                if (v is Missing || r is Missing) { v = mergeMissing(v, r); continue }
                // Form inputs arrive as strings; '80' + 12 must be 92, not '8012'.
                v = if (op == "+") {
                    if (JsValues.isNumeric(v) && JsValues.isNumeric(r)) JsValues.toNum(v) + JsValues.toNum(r)
                    else JsValues.toStr(v) + JsValues.toStr(r)
                } else JsValues.toNum(v) - JsValues.toNum(r)
            }
            return v
        }

        private fun mul(): Any? {
            var v = factor()
            while (peek()?.let { it.type == Token.Type.OP && it.value in setOf("*", "/", "%") } == true) {
                val op = next()!!.value
                val f = factor()
                if (v is Missing || f is Missing) { v = mergeMissing(v, f); continue }
                val l = JsValues.toNum(v)
                val r = JsValues.toNum(f)
                v = when {
                    op == "*" -> l * r
                    r == 0.0 -> throw FormulaException("Division by zero")
                    op == "/" -> l / r
                    else -> l % r
                }
            }
            return v
        }

        private fun factor(): Any? {
            val t = peek()
            if (t != null && t.type == Token.Type.OP && t.value == "-") {
                next(); val f = factor(); return if (f is Missing) f else -JsValues.toNum(f)
            }
            if (t != null && t.type == Token.Type.OP && t.value == "!") {
                next(); val f = factor(); return if (f is Missing) f else !JsValues.truthy(f)
            }
            return power()
        }

        /** Right-associative and tighter than unary minus: -2 ^ 2 is -4. */
        private fun power(): Any? {
            val base = primary()
            if (peek()?.let { it.type == Token.Type.OP && it.value == "^" } != true) return base
            next()
            val exponent = factor()
            if (base is Missing || exponent is Missing) return mergeMissing(base, exponent)
            return JsValues.toNum(base).pow(JsValues.toNum(exponent))
        }

        private fun primary(): Any? {
            val t = next() ?: throw FormulaException("The formula ends before it is complete.")
            when (t.type) {
                Token.Type.NUM -> return JsValues.parseFloat(t.value)
                Token.Type.STR -> return t.value
                Token.Type.PUNC -> if (t.value == "(") {
                    val v = ternary()
                    if (peek()?.value == ")") next() else throw FormulaException("Unbalanced parentheses in formula")
                    return v
                }
                Token.Type.ID -> {
                    if (peek()?.let { it.type == Token.Type.PUNC && it.value == "(" } == true) {
                        next()
                        val args = mutableListOf<Any?>()
                        if (peek()?.value != ")") {
                            args += ternary()
                            while (peek()?.value == ",") { next(); args += ternary() }
                        }
                        if (peek()?.value == ")") next() else throw FormulaException("Unclosed argument list for ${t.value}()")
                        val name = t.value.lowercase()
                        val fn = FUNCTIONS[name] ?: throw FormulaException("Unknown function in formula: ${t.value}")
                        if (args.any { it is Missing }) {
                            if (name == "coalesce") {
                                val found = args.firstOrNull { it !is Missing && it != null && it != "" }
                                return found ?: mergeMissing(*args.toTypedArray())
                            }
                            if (name == "if") {
                                val cond = args.getOrNull(0)
                                return if (cond is Missing) cond else if (JsValues.truthy(cond)) args.getOrNull(1) else args.getOrNull(2)
                            }
                            return mergeMissing(*args.toTypedArray())
                        }
                        return fn(args)
                    }
                    // Strict scopes are keyed by the whole reference, dotted or not.
                    if (scope.containsKey(t.value)) return scope[t.value] ?: 0.0
                    var v: Any? = scope
                    for (k in t.value.split('.')) v = (v as? Map<*, *>)?.get(k)
                    return v ?: 0.0
                }
                else -> Unit
            }
            throw FormulaException("Unexpected \"${t.value}\" in formula")
        }
    }

    // ---- Functions --------------------------------------------------------

    private fun List<Any?>.num(i: Int, default: Double = 0.0): Double =
        if (i < size) JsValues.toNum(this[i]) else default

    private fun List<Any?>.str(i: Int): String = JsValues.toStr(getOrNull(i))

    /** JS String.prototype.slice semantics. */
    private fun jsSlice(s: String, start: Double, end: Double? = null): String {
        val len = s.length
        fun norm(x: Double): Int {
            val n = if (x.isNaN()) 0 else x.toLong().coerceIn(-len.toLong() * 2, len.toLong() * 2).toInt()
            return if (n < 0) max(len + n, 0) else min(n, len)
        }
        val from = norm(start)
        val to = if (end == null) len else norm(end)
        return if (from < to) s.substring(from, to) else ""
    }

    private val FUNCTIONS: Map<String, (List<Any?>) -> Any?> = mapOf(
        "atan2" to { a -> atan2(a.num(0), a.num(1)) },
        "round" to { a -> val p = 10.0.pow(a.num(1)); floor(a.num(0) * p + 0.5) / p },
        "floor" to { a -> floor(a.num(0)) },
        "ceil" to { a -> ceil(a.num(0)) },
        "abs" to { a -> abs(a.num(0)) },
        "min" to { a -> a.map(JsValues::toNum).fold(Double.POSITIVE_INFINITY) { x, y -> min(x, y) } },
        "max" to { a -> a.map(JsValues::toNum).fold(Double.NEGATIVE_INFINITY) { x, y -> max(x, y) } },
        "sqrt" to { a -> sqrt(a.num(0)) },
        "pow" to { a -> a.num(0).pow(a.num(1)) },
        "clamp" to { a -> min(max(a.num(0), a.num(1)), a.num(2)) },
        "sum" to { a -> a.sumOf(JsValues::toNum) },
        "avg" to { a -> if (a.isEmpty()) 0.0 else a.sumOf(JsValues::toNum) / a.size },
        "pv" to { a ->
            val r = a.num(0); val n = a.num(1); val p = a.num(2); val f = a.num(3); val t = a.num(4)
            if (r == 0.0) -p * n - f
            else { val factor = (1 + r).pow(n); -(p * (1 + r * t) * ((factor - 1) / r) + f) / factor }
        },
        "fv" to { a ->
            val r = a.num(0); val n = a.num(1); val p = a.num(2); val pv = a.num(3); val t = a.num(4)
            if (r == 0.0) -pv - p * n
            else { val factor = (1 + r).pow(n); -(pv * factor + p * (1 + r * t) * ((factor - 1) / r)) }
        },
        "pmt" to { a ->
            val r = a.num(0); val n = a.num(1); val pv = a.num(2); val f = a.num(3); val t = a.num(4)
            if (r == 0.0) -(pv + f) / n
            else { val factor = (1 + r).pow(n); -(pv * factor + f) * r / ((1 + r * t) * (factor - 1)) }
        },
        "rate" to { a ->
            val n = a.num(0); val p = a.num(1); val pv = a.num(2); val f = a.num(3); val t = a.num(4); val g = a.num(5, 0.1)
            var rate = g
            var result: Double? = null
            for (i in 0 until 100) {
                val factor = (1 + rate).pow(n)
                val y = pv * factor + p * (1 + rate * t) * ((factor - 1) / rate) + f
                if (abs(y) < 0.000001) { result = rate; break }
                val derivative = pv * n * (1 + rate).pow(n - 1) +
                    p * ((factor - 1) / rate - n * (1 + rate).pow(n - 1) / rate +
                        (1 + rate * t) * (n * (1 + rate).pow(n - 1) / rate - (factor - 1) / (rate * rate)))
                val newRate = rate - y / derivative
                if (abs(newRate - rate) < 0.000001) { result = newRate; break }
                rate = newRate
            }
            result ?: rate
        },
        "nper" to { a ->
            val r = a.num(0); val p = a.num(1); val pv = a.num(2); val f = a.num(3); val t = a.num(4)
            if (r == 0.0) -(pv + f) / p
            else ln((p * (1 + r * t) - f * r) / (p * (1 + r * t) + pv * r)) / ln(1 + r)
        },
        "upper" to { a -> a.str(0).uppercase() },
        "lower" to { a -> a.str(0).lowercase() },
        "title" to { a ->
            Regex("\\w\\S*").replace(a.str(0)) { m -> m.value.take(1).uppercase() + m.value.drop(1).lowercase() }
        },
        "trim" to { a -> a.str(0).trim() },
        "len" to { a -> a.str(0).length.toDouble() },
        "concat" to { a -> a.joinToString("") { JsValues.toStr(it) } },
        "left" to { a -> jsSlice(a.str(0), 0.0, a.num(1)) },
        // JS slice(-0) is slice(0): right(s, 0) is the whole string, as in the original.
        "right" to { a -> jsSlice(a.str(0), -a.num(1)) },
        "substr" to { a ->
            val s = a.str(0)
            var start = a.num(1).let { if (it.isNaN()) 0.0 else it }.toLong()
            if (start < 0) start = max(s.length + start, 0)
            val from = min(start, s.length.toLong()).toInt()
            val length = if (a.size > 2) a.num(2).toLong() else Long.MAX_VALUE
            if (length <= 0) "" else s.substring(from, min(s.length.toLong(), from + length).toInt())
        },
        "replace" to { a -> a.str(0).split(a.str(1)).joinToString(a.str(2)) },
        "contains" to { a -> a.str(0).lowercase().contains(a.str(1).lowercase()) },
        "if" to { a -> if (JsValues.truthy(a.getOrNull(0))) a.getOrNull(1) else a.getOrNull(2) },
        "coalesce" to { a -> a.firstOrNull { it != null && it != "" } ?: "" },
        "and" to { a -> a.all(JsValues::truthy) },
        "or" to { a -> a.any(JsValues::truthy) },
        "not" to { a -> !JsValues.truthy(a.getOrNull(0)) },
    )
}

/** The JS value semantics the expression language and the form engine are defined in. */
object JsValues {
    private val strip = Regex("[$,%\\s]")
    private val floatPrefix = Regex("^[+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?")
    private val wholeNumber = Regex("^[+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?$")

    /** JS parseFloat: the longest numeric prefix, NaN when there is none. */
    fun parseFloat(s: String): Double {
        val t = s.trimStart()
        if (t.startsWith("Infinity") || t.startsWith("+Infinity")) return Double.POSITIVE_INFINITY
        if (t.startsWith("-Infinity")) return Double.NEGATIVE_INFINITY
        return floatPrefix.find(t)?.value?.toDouble() ?: Double.NaN
    }

    /** JS Number(x) for the values a form holds. */
    fun number(v: Any?): Double = when (v) {
        null -> 0.0
        is Double -> v
        is Number -> v.toDouble()
        is Boolean -> if (v) 1.0 else 0.0
        is String -> {
            val t = v.trim()
            when {
                t.isEmpty() -> 0.0
                t == "Infinity" || t == "+Infinity" -> Double.POSITIVE_INFINITY
                t == "-Infinity" -> Double.NEGATIVE_INFINITY
                t.startsWith("0x") || t.startsWith("0X") -> t.drop(2).toLongOrNull(16)?.toDouble() ?: Double.NaN
                wholeNumber.matches(t) -> t.toDouble()
                else -> Double.NaN
            }
        }
        is List<*> -> when (v.size) { 0 -> 0.0; 1 -> number(v[0]?.let { toStr(it) }); else -> Double.NaN }
        else -> Double.NaN
    }

    fun toNum(v: Any?): Double = when (v) {
        is Double -> if (v.isFinite()) v else 0.0
        is Number -> v.toDouble().let { if (it.isFinite()) it else 0.0 }
        is Boolean -> if (v) 1.0 else 0.0
        else -> parseFloat(strip.replace(toStr(v), "")).let { if (it.isFinite()) it else 0.0 }
    }

    fun isNumeric(v: Any?): Boolean {
        if (v is Number || v is Boolean) return true
        val s = strip.replace(toStr(v), "")
        return s.isNotEmpty() && !number(s).isNaN()
    }

    fun truthy(v: Any?): Boolean = when (v) {
        null -> false
        is Boolean -> v
        is Double -> v != 0.0 && !v.isNaN()
        is Number -> v.toDouble() != 0.0
        is String -> v.isNotEmpty() && v != "0" && v != "false"
        else -> true
    }

    /** JS String(x). */
    fun toStr(v: Any?): String = when (v) {
        null -> ""
        is Double -> numberToString(v)
        is Number -> numberToString(v.toDouble())
        is Boolean -> v.toString()
        is List<*> -> v.joinToString(",") { toStr(it) }
        is Map<*, *> -> "[object Object]"
        else -> v.toString()
    }

    /**
     * JS Number.prototype.toString: the shortest digits that read back as the same
     * double. Computed here rather than via Double.toString, whose digits are not
     * guaranteed shortest on every Android release.
     */
    fun numberToString(d: Double): String {
        if (d.isNaN()) return "NaN"
        if (d.isInfinite()) return if (d > 0) "Infinity" else "-Infinity"
        if (d == 0.0) return "0"
        val exact = java.math.BigDecimal(d)
        var shortest = exact
        for (precision in 1..17) {
            val candidate = exact.round(java.math.MathContext(precision, java.math.RoundingMode.HALF_EVEN))
            if (candidate.toDouble() == d) { shortest = candidate; break }
        }
        shortest = shortest.stripTrailingZeros()
        val digits = shortest.unscaledValue().abs().toString()
        // Decimal exponent of the leading digit, as in JS's algorithm (n - 1).
        val exponent = digits.length - 1 - shortest.scale()
        val sign = if (d < 0) "-" else ""
        return if (exponent >= 21 || exponent < -6) {
            val mantissa = if (digits.length > 1) digits[0] + "." + digits.substring(1) else digits
            sign + mantissa + "e" + (if (exponent >= 0) "+" else "") + exponent
        } else {
            sign + shortest.abs().toPlainString()
        }
    }
}
