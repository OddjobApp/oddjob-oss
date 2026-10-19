package app.oddjob.crew.ui.markdown

/**
 * The subset of Markdown agents actually write in a room: headings, bullet and
 * numbered lists, fenced code, block quotes, and inline bold, italic, code and
 * links, including raw `<a href>` markup and bare URLs (turn-linkify.ts). Anything else is shown as the literal text, which is a safe failure
 * for prose. Kept free of Compose types so it can be unit-tested on the JVM.
 */
sealed interface MdBlock {
    data class Heading(val level: Int, val spans: List<MdSpan>) : MdBlock
    data class Paragraph(val spans: List<MdSpan>) : MdBlock
    data class ListItem(val marker: String, val depth: Int, val spans: List<MdSpan>) : MdBlock
    data class Quote(val spans: List<MdSpan>) : MdBlock
    data class Code(val language: String?, val text: String) : MdBlock
}

data class MdSpan(
    val text: String,
    val bold: Boolean = false,
    val italic: Boolean = false,
    val code: Boolean = false,
    val url: String? = null,
)

object Markdown {
    private val heading = Regex("^(#{1,6})\\s+(.*)$")
    private val bullet = Regex("^(\\s*)([-*+])\\s+(.*)$")
    private val numbered = Regex("^(\\s*)(\\d+)[.)]\\s+(.*)$")
    private val fence = Regex("^\\s*```\\s*([\\w+-]*)\\s*$")

    fun parse(source: String): List<MdBlock> {
        val blocks = mutableListOf<MdBlock>()
        val paragraph = StringBuilder()
        val lines = source.replace("\r\n", "\n").split('\n')

        fun flush() {
            if (paragraph.isNotBlank()) blocks += MdBlock.Paragraph(inline(paragraph.toString().trim()))
            paragraph.clear()
        }

        var i = 0
        while (i < lines.size) {
            val line = lines[i]
            val fenceMatch = fence.matchEntire(line)
            if (fenceMatch != null) {
                flush()
                val language = fenceMatch.groupValues[1].ifBlank { null }
                val body = StringBuilder()
                i++
                // An unclosed fence runs to the end, as in CommonMark.
                while (i < lines.size && fence.matchEntire(lines[i]) == null) {
                    if (body.isNotEmpty()) body.append('\n')
                    body.append(lines[i])
                    i++
                }
                blocks += MdBlock.Code(language, body.toString())
                i++
                continue
            }

            heading.matchEntire(line)?.let {
                flush()
                blocks += MdBlock.Heading(it.groupValues[1].length, inline(it.groupValues[2].trim()))
                i++
                continue
            }
            bullet.matchEntire(line)?.let {
                flush()
                blocks += MdBlock.ListItem("•", it.groupValues[1].length / 2, inline(it.groupValues[3]))
                i++
                continue
            }
            numbered.matchEntire(line)?.let {
                flush()
                blocks += MdBlock.ListItem("${it.groupValues[2]}.", it.groupValues[1].length / 2, inline(it.groupValues[3]))
                i++
                continue
            }
            if (line.trimStart().startsWith(">")) {
                flush()
                blocks += MdBlock.Quote(inline(line.trimStart().removePrefix(">").trim()))
                i++
                continue
            }
            if (line.isBlank()) {
                flush()
            } else {
                if (paragraph.isNotEmpty()) paragraph.append('\n')
                paragraph.append(line.trimEnd())
            }
            i++
        }
        flush()
        return blocks
    }

    /**
     * Bare URLs and domains in plain text, split into text and link parts. A
     * bare domain needs a path, query or fragment, so `src/index.ts` and
     * `vitest.config.ts` stay text. Same expression as the web's linkifyText.
     */
    private val bareUrl = Regex(
        """\b(?:https?://[^\s<>"'`]+|www\.[^\s<>"'`]+|(?:[a-z0-9][a-z0-9-]*\.)+[a-z]{2,}(?:[/?#][^\s<>"'`)\]]*)+)""",
        RegexOption.IGNORE_CASE,
    )
    private val trailing = Regex("""[.,;:!?'")\]}]+$""")
    private val anchor = Regex(
        """<a\s[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>(.*?)</a>""",
        setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL),
    )

    fun linkify(text: String): List<MdSpan> {
        val out = mutableListOf<MdSpan>()
        var last = 0
        for (match in bareUrl.findAll(text)) {
            var raw = match.value.replace(trailing, "")
            if (raw.isEmpty()) continue
            // Keep a balanced ')' and drop one that closes an English parenthesis.
            while (raw.endsWith(')') && raw.count { it == '(' } < raw.count { it == ')' }) raw = raw.dropLast(1)
            if (match.range.first > last) out += MdSpan(text.substring(last, match.range.first))
            val url = if (raw.startsWith("http://", true) || raw.startsWith("https://", true)) raw else "https://$raw"
            out += MdSpan(raw.replace(Regex("^https?://", RegexOption.IGNORE_CASE), ""), url = url)
            last = match.range.first + raw.length
        }
        if (out.isEmpty()) return listOf(MdSpan(text))
        if (last < text.length) out += MdSpan(text.substring(last))
        return out
    }

    /** Inline spans, with bare URLs linked. Unmatched markers are kept as literal text. */
    fun inline(text: String): List<MdSpan> = spans(text).flatMap { span ->
        if (span.code || span.url != null) listOf(span)
        else linkify(span.text).map { it.copy(bold = span.bold, italic = span.italic) }
    }

    private fun spans(text: String): List<MdSpan> {
        val spans = mutableListOf<MdSpan>()
        val plain = StringBuilder()
        fun emitPlain() {
            if (plain.isNotEmpty()) spans += MdSpan(plain.toString())
            plain.clear()
        }

        var i = 0
        while (i < text.length) {
            val c = text[i]
            when {
                c == '`' -> {
                    val end = text.indexOf('`', i + 1)
                    if (end > i) {
                        emitPlain()
                        spans += MdSpan(text.substring(i + 1, end), code = true)
                        i = end + 1
                        continue
                    }
                }
                text.startsWith("**", i) || text.startsWith("__", i) -> {
                    val marker = text.substring(i, i + 2)
                    val end = text.indexOf(marker, i + 2)
                    if (end > i + 2) {
                        emitPlain()
                        inline(text.substring(i + 2, end)).forEach { spans += it.copy(bold = true) }
                        i = end + 2
                        continue
                    }
                }
                (c == '*' || c == '_') && i + 1 < text.length && !text[i + 1].isWhitespace() -> {
                    val end = text.indexOf(c, i + 1)
                    // `_` inside a word (snake_case) is not emphasis.
                    val wordInterior = c == '_' && i > 0 && text[i - 1].isLetterOrDigit()
                    if (end > i + 1 && !wordInterior && !text[end - 1].isWhitespace()) {
                        emitPlain()
                        inline(text.substring(i + 1, end)).forEach { spans += it.copy(italic = true) }
                        i = end + 1
                        continue
                    }
                }
                c == '<' && text.startsWith("<a", i, ignoreCase = true) -> {
                    val match = anchor.matchAt(text, i)
                    val url = match?.groupValues?.get(1)?.trim()
                    if (match != null && url != null && (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("/"))) {
                        emitPlain()
                        spans += MdSpan(match.groupValues[2].replace(Regex("<[^>]+>"), "").ifBlank { url }, url = url)
                        i = match.range.last + 1
                        continue
                    }
                }
                c == '[' -> {
                    val close = text.indexOf("](", i + 1)
                    val paren = if (close > 0) text.indexOf(')', close + 2) else -1
                    if (close > i && paren > close) {
                        val url = text.substring(close + 2, paren).trim()
                        if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("/")) {
                            emitPlain()
                            spans += MdSpan(text.substring(i + 1, close), url = url)
                            i = paren + 1
                            continue
                        }
                    }
                }
            }
            plain.append(c)
            i++
        }
        emitPlain()
        return spans
    }
}
