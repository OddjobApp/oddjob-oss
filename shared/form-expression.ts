/**
 * Safe expression evaluator for form computed / chained fields.
 *
 * Supports math (+ - * / %, unary minus, parentheses), string concatenation via
 * `+`, comparisons, `cond ? a : b` ternaries, field references by key (dotted
 * paths allowed), and a whitelist of math + string functions. It is a
 * hand-written recursive-descent parser over a fixed grammar — NO eval /
 * Function — so a formula authored by a user or the LLM can never execute
 * arbitrary code. Unknown identifiers resolve to 0/"" and any parse error yields
 * "" rather than throwing, so a bad formula degrades gracefully.
 *
 * Example: evalFormula("round(bill * tipPercent / 100, 2)", { bill: 80, tipPercent: 15 }) -> 12
 */

type Token = { type: "num" | "str" | "id" | "op" | "punc"; value: string };

const OPS = new Set(["+", "-", "*", "/", "%", "^"]);

function toNum(v: any): number {
    if (typeof v === "number") return Number.isFinite(v) ? v : 0;
    if (typeof v === "boolean") return v ? 1 : 0;
    const n = parseFloat(String(v ?? "").replace(/[$,%\s]/g, ""));
    return Number.isFinite(n) ? n : 0;
}
function toStr(v: any): string {
    return v === null || v === undefined ? "" : String(v);
}
function isNumeric(v: any): boolean {
    if (typeof v === "number" || typeof v === "boolean") return true;
    const s = String(v ?? "").replace(/[$,%\s]/g, "");
    return s !== "" && !isNaN(Number(s));
}
function truthy(v: any): boolean {
    return !!v && v !== "0" && v !== "false" && v !== 0;
}

/**
 * An input the strict evaluator has no answer for yet.
 *
 * Refusing any expression that names an unanswered input made rules like
 * `line == 'lending' && apr > 36` wait forever on an APR that a non-lending line
 * never asks for. Instead the gap travels through the calculation, and only a
 * result that actually depends on it is reported missing: `false && x` is false,
 * `true || x` is true, and a ternary's other branch is never needed.
 */
class Missing {
    constructor(readonly names: string[]) {}
}
const isMissing = (v: any): v is Missing => v instanceof Missing;
function mergeMissing(...values: any[]): Missing {
    return new Missing([...new Set(values.filter(isMissing).flatMap((m) => m.names))]);
}

const FUNCS: Record<string, (...a: any[]) => any> = {
    atan2: (y, x) => Math.atan2(toNum(y), toNum(x)),
    // math
    round: (x, n = 0) => { const p = Math.pow(10, toNum(n)); return Math.round(toNum(x) * p) / p; },
    floor: (x) => Math.floor(toNum(x)),
    ceil: (x) => Math.ceil(toNum(x)),
    abs: (x) => Math.abs(toNum(x)),
    min: (...a) => Math.min(...a.map(toNum)),
    max: (...a) => Math.max(...a.map(toNum)),
    sqrt: (x) => Math.sqrt(toNum(x)),
    pow: (a, b) => Math.pow(toNum(a), toNum(b)),
    clamp: (x, lo, hi) => Math.min(Math.max(toNum(x), toNum(lo)), toNum(hi)),
    sum: (...a) => a.reduce((s, x) => s + toNum(x), 0),
    avg: (...a) => (a.length ? a.reduce((s, x) => s + toNum(x), 0) / a.length : 0),
    // financial
    pv: (rate, nper, pmt, fv = 0, type = 0) => {
        const r = toNum(rate);
        const n = toNum(nper);
        const p = toNum(pmt);
        const f = toNum(fv);
        const t = toNum(type);
        if (r === 0) return -p * n - f;
        const factor = Math.pow(1 + r, n);
        return -(p * (1 + r * t) * ((factor - 1) / r) + f) / factor;
    },
    fv: (rate, nper, pmt, pv = 0, type = 0) => {
        const r = toNum(rate);
        const n = toNum(nper);
        const p = toNum(pmt);
        const p_val = toNum(pv);
        const t = toNum(type);
        if (r === 0) return -p_val - p * n;
        const factor = Math.pow(1 + r, n);
        return -(p_val * factor + p * (1 + r * t) * ((factor - 1) / r));
    },
    pmt: (rate, nper, pv, fv = 0, type = 0) => {
        const r = toNum(rate);
        const n = toNum(nper);
        const p_val = toNum(pv);
        const f = toNum(fv);
        const t = toNum(type);
        if (r === 0) return -(p_val + f) / n;
        const factor = Math.pow(1 + r, n);
        return -(p_val * factor + f) * r / ((1 + r * t) * (factor - 1));
    },
    rate: (nper, pmt, pv, fv = 0, type = 0, guess = 0.1) => {
        const n = toNum(nper);
        const p = toNum(pmt);
        const p_val = toNum(pv);
        const f = toNum(fv);
        const t = toNum(type);
        const g = toNum(guess);

        // Newton-Raphson iteration
        let rate = g;
        for (let i = 0; i < 100; i++) {
            const factor = Math.pow(1 + rate, n);
            const y = p_val * factor + p * (1 + rate * t) * ((factor - 1) / rate) + f;
            if (Math.abs(y) < 0.000001) return rate;
            const derivative = p_val * n * Math.pow(1 + rate, n - 1) +
                p * ((factor - 1) / rate - n * Math.pow(1 + rate, n - 1) / rate +
                (1 + rate * t) * (n * Math.pow(1 + rate, n - 1) / rate - (factor - 1) / (rate * rate)));
            const newRate = rate - y / derivative;
            if (Math.abs(newRate - rate) < 0.000001) return newRate;
            rate = newRate;
        }
        return rate;
    },
    nper: (rate, pmt, pv, fv = 0, type = 0) => {
        const r = toNum(rate);
        const p = toNum(pmt);
        const p_val = toNum(pv);
        const f = toNum(fv);
        const t = toNum(type);
        if (r === 0) return -(p_val + f) / p;
        const logTerm = (p * (1 + r * t) - f * r) / (p * (1 + r * t) + p_val * r);
        return Math.log(logTerm) / Math.log(1 + r);
    },
    // string
    upper: (s) => toStr(s).toUpperCase(),
    lower: (s) => toStr(s).toLowerCase(),
    title: (s) => toStr(s).replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()),
    trim: (s) => toStr(s).trim(),
    len: (s) => toStr(s).length,
    concat: (...a) => a.map(toStr).join(""),
    left: (s, n) => toStr(s).slice(0, toNum(n)),
    right: (s, n) => toStr(s).slice(-toNum(n)),
    substr: (s, start, length) => toStr(s).substr(toNum(start), length === undefined ? undefined : toNum(length)),
    replace: (s, find, repl) => toStr(s).split(toStr(find)).join(toStr(repl)),
    contains: (s, sub) => toStr(s).toLowerCase().includes(toStr(sub).toLowerCase()),
    // logic / null-handling
    if: (cond, a, b) => (truthy(cond) ? a : b),
    coalesce: (...a) => a.find((v) => v !== null && v !== undefined && v !== "") ?? "",
    and: (...a) => a.every(truthy),
    or: (...a) => a.some(truthy),
    not: (a) => !truthy(a),
};

function tokenize(src: string): Token[] {
    const toks: Token[] = [];
    let i = 0;
    const isDigit = (c: string) => c >= "0" && c <= "9";
    const isIdStart = (c: string) => /[A-Za-z_$]/.test(c);
    const isIdChar = (c: string) => /[A-Za-z0-9_$.]/.test(c);
    while (i < src.length) {
        const c = src[i];
        if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
        if (isDigit(c) || (c === "." && isDigit(src[i + 1]))) {
            let j = i + 1;
            while (j < src.length && (isDigit(src[j]) || src[j] === ".")) j++;
            toks.push({ type: "num", value: src.slice(i, j) }); i = j; continue;
        }
        if (c === "'" || c === '"') {
            let j = i + 1, s = "";
            while (j < src.length && src[j] !== c) { s += src[j]; j++; }
            toks.push({ type: "str", value: s }); i = j + 1; continue;
        }
        if (isIdStart(c)) {
            let j = i + 1;
            while (j < src.length && isIdChar(src[j])) j++;
            toks.push({ type: "id", value: src.slice(i, j) }); i = j; continue;
        }
        const two = src.slice(i, i + 2);
        if (["==", "!=", ">=", "<=", "&&", "||"].includes(two)) { toks.push({ type: "op", value: two }); i += 2; continue; }
        if (OPS.has(c) || c === ">" || c === "<" || c === "!") { toks.push({ type: "op", value: c }); i++; continue; }
        if (c === "(" || c === ")" || c === "," || c === "?" || c === ":") { toks.push({ type: "punc", value: c }); i++; continue; }
        /*
          Reject anything the grammar doesn't know instead of skipping it.
          Skipping was far more dangerous than it looked: an LLM-authored ternary
          `rate == 0 ? a : b` lost its `?` and `:`, and the remains still parsed
          — as the comparison alone — so a mortgage payment computed as the
          boolean `false` and was submitted that way. A formula that can't be
          represented must degrade to blank (evalFormula catches this), never to
          a confident wrong number.
        */
        throw new Error(`Unsupported character in formula: ${c}`);
    }
    return toks;
}

class Parser {
    private pos = 0;
    /**
     * `strict` is the Studio path. A zero divisor has no answer, so strict parsing
     * refuses it instead of producing 0: with 0, a pilot with no survey responses
     * scored R_pmf = 0 and was confidently classed "pivot or deprecate". The
     * forgiving chat evaluator keeps its historical 0 until it moves to strict.
     */
    constructor(private toks: Token[], private scope: Record<string, any>, private strict = false) {}
    private peek() { return this.toks[this.pos]; }
    private next() { return this.toks[this.pos++]; }

    parse(): any {
        const v = this.ternary();
        // Leftover tokens mean the expression was only PARTIALLY understood, and a
        // partial parse yields a plausible-looking wrong value rather than an
        // obvious failure. Treat it as a parse error.
        if (this.pos < this.toks.length) {
            throw new Error(`Unexpected trailing input in formula near "${this.peek()?.value}"`);
        }
        return v;
    }

    // Precedence (low → high): ?: , || , && , comparison , + - , * / % , unary , primary
    // `cond ? a : b` — right-associative, and only the taken branch's value is
    // returned (both are parsed, but the grammar is side-effect free so that is
    // equivalent to lazy evaluation).
    private ternary(): any {
        const cond = this.or();
        if (this.peek() && this.peek().type === "punc" && this.peek().value === "?") {
            this.next();
            const whenTrue = this.ternary();
            if (this.peek() && this.peek().value === ":") this.next();
            else throw new Error("Ternary is missing its ':' branch");
            const whenFalse = this.ternary();
            if (isMissing(cond)) return cond;
            return truthy(cond) ? whenTrue : whenFalse;
        }
        return cond;
    }

    private or(): any {
        let v = this.and();
        while (this.peek() && this.peek().value === "||") {
            this.next();
            const r = this.and();
            if (isMissing(v) || isMissing(r)) {
                // Either side being true settles it, whichever side is unanswered.
                v = (!isMissing(v) && truthy(v)) || (!isMissing(r) && truthy(r)) ? true : mergeMissing(v, r);
            } else v = truthy(v) || truthy(r);
        }
        return v;
    }
    private and(): any {
        let v = this.cmp();
        while (this.peek() && this.peek().value === "&&") {
            this.next();
            const r = this.cmp();
            if (isMissing(v) || isMissing(r)) {
                // Either side being false settles it, whichever side is unanswered.
                v = (!isMissing(v) && !truthy(v)) || (!isMissing(r) && !truthy(r)) ? false : mergeMissing(v, r);
            } else v = truthy(v) && truthy(r);
        }
        return v;
    }
    private cmp(): any {
        let v = this.add();
        const t = this.peek();
        if (t && t.type === "op" && ["==", "!=", ">", "<", ">=", "<="].includes(t.value)) {
            const op = this.next().value;
            const r = this.add();
            if (isMissing(v) || isMissing(r)) return mergeMissing(v, r);
            // Compare numerically when both sides look numeric, else as strings.
            const bothNum = isNumeric(v) && isNumeric(r);
            const [a, b] = bothNum ? [toNum(v), toNum(r)] : [toStr(v), toStr(r)];
            switch (op) {
                case "==": return a === b;
                case "!=": return a !== b;
                case ">": return a > b;
                case "<": return a < b;
                case ">=": return a >= b;
                case "<=": return a <= b;
            }
        }
        return v;
    }
    private add(): any { // + / -  (also string concat on +)
        let v = this.mul();
        while (this.peek() && this.peek().type === "op" && (this.peek().value === "+" || this.peek().value === "-")) {
            const op = this.next().value;
            const r = this.mul();
            if (isMissing(v) || isMissing(r)) { v = mergeMissing(v, r); continue; }
            // Add when both sides look numeric, else concatenate — the same
            // `isNumeric` test the comparison operators above use. Keying off
            // `typeof === "string"` instead meant a form input, which always
            // arrives as a string, concatenated: '80' + 12 gave '8012', not 92.
            // Deliberate string joining has its own `concat(...)` function.
            if (op === "+") v = (isNumeric(v) && isNumeric(r)) ? toNum(v) + toNum(r) : toStr(v) + toStr(r);
            else v = toNum(v) - toNum(r);
        }
        return v;
    }
    private mul(): any { // * / %
        let v = this.factor();
        while (this.peek() && this.peek().type === "op" && ["*", "/", "%"].includes(this.peek().value)) {
            const op = this.next().value;
            const f = this.factor();
            // An unanswered divisor is missing, not zero.
            if (isMissing(v) || isMissing(f)) { v = mergeMissing(v, f); continue; }
            const l = toNum(v);
            const r = toNum(f);
            if (op === "*") {
                v = l * r;
            } else if (r === 0) {
                if (this.strict) throw new Error("Division by zero");
                v = 0;
            } else {
                v = op === "/" ? l / r : l % r;
            }
        }
        return v;
    }
    private factor(): any {
        const t = this.peek();
        if (t && t.type === "op" && t.value === "-") { this.next(); const f = this.factor(); return isMissing(f) ? f : -toNum(f); }
        if (t && t.type === "op" && t.value === "!") { this.next(); const f = this.factor(); return isMissing(f) ? f : !truthy(f); }
        return this.power();
    }
    /** `a ^ b`: right-associative and tighter than unary minus, so -2 ^ 2 is -4 and 2 ^ 3 ^ 2 is 512. */
    private power(): any {
        const base = this.primary();
        if (!(this.peek() && this.peek().type === "op" && this.peek().value === "^")) return base;
        this.next();
        const exponent = this.factor();
        if (isMissing(base) || isMissing(exponent)) return mergeMissing(base, exponent);
        return Math.pow(toNum(base), toNum(exponent));
    }
    private primary(): any {
        const t = this.next();
        // A strict formula that stops where a value is needed, such as `a +`, has no
        // value. Reading the gap as 0 turned `a +` into a confident `a`.
        if (!t) {
            if (this.strict) throw new Error("The formula ends before it is complete.");
            return 0;
        }
        if (t.type === "num") return parseFloat(t.value);
        if (t.type === "str") return t.value;
        if (t.type === "punc" && t.value === "(") {
            const v = this.ternary();
            if (this.peek() && this.peek().value === ")") this.next();
            else throw new Error("Unbalanced parentheses in formula");
            return v;
        }
        if (t.type === "id") {
            if (this.peek() && this.peek().type === "punc" && this.peek().value === "(") {
                this.next(); // consume "("
                const args: any[] = [];
                if (!(this.peek() && this.peek().value === ")")) {
                    args.push(this.ternary());
                    while (this.peek() && this.peek().value === ",") { this.next(); args.push(this.ternary()); }
                }
                if (this.peek() && this.peek().value === ")") this.next();
                else throw new Error(`Unclosed argument list for ${t.value}()`);
                const name = t.value.toLowerCase();
                // Own functions only: a plain object also answers to "constructor", "toString" and the rest.
                const fn = Object.prototype.hasOwnProperty.call(FUNCS, name) ? FUNCS[name] : undefined;
                // An unknown function name is a schema-authoring error, not a value.
                // Returning 0 let `monthlyPayment: undefinedFn(...)` submit as 0.
                if (!fn) throw new Error(`Unknown function in formula: ${t.value}`);
                if (args.some(isMissing)) {
                    if (name === "coalesce") {
                        const found = args.find((a) => !isMissing(a) && a !== null && a !== undefined && a !== "");
                        return found !== undefined ? found : mergeMissing(...args);
                    }
                    if (name === "if") {
                        const [cond, whenTrue, whenFalse] = args;
                        return isMissing(cond) ? cond : truthy(cond) ? whenTrue : whenFalse;
                    }
                    return mergeMissing(...args);
                }
                return fn(...args);
            }
            // Strict scopes are keyed by the whole reference, dotted or not.
            if (this.strict && Object.prototype.hasOwnProperty.call(this.scope, t.value)) {
                const own = this.scope[t.value];
                return own === undefined ? 0 : own;
            }
            // identifier → scope lookup (dotted path supported)
            let v: any = this.scope;
            for (const k of t.value.split(".")) { v = v == null ? undefined : v[k]; }
            return v === undefined ? 0 : v;
        }
        if (this.strict) throw new Error(`Unexpected "${t.value}" in formula`);
        return 0;
    }
}

export function evalFormula(expr: string, scope: Record<string, any>): number | string {
    try {
        if (!expr || typeof expr !== "string") return "";
        const v = new Parser(tokenize(expr), scope || {}).parse();
        if (typeof v === "number") return Number.isFinite(v) ? v : 0;
        return v == null ? "" : v;
    } catch {
        return "";
    }
}

/**
 * Evaluate every computed field against a scope that already contains the
 * computed fields before it, so a formula may reference an earlier computed
 * result and not just the raw inputs.
 *
 * Chaining is the whole point of the feature — a tip calculator's total is
 * `billAmount + tipAmount` where `tipAmount` is itself computed. Evaluating each
 * formula against the input-only scope left that reference unresolved, and an
 * unresolved identifier reads as 0 (see `toNum`), so a $100 bill with an $18 tip
 * totalled $100.
 *
 * Order is field order, which is the order the render_intake_form schema asks
 * for ("Put input fields first, then 'computed' output fields that chain off
 * them"). A formula referencing a computed field declared *below* it still reads
 * 0 — that stays a schema-authoring error rather than becoming a dependency solver.
 */
export function evalComputedFields(
    fields: Array<{ key?: string; id?: string; name?: string; type?: string; formula?: string }>,
    base: Record<string, any>,
): Record<string, any> {
    const scope: Record<string, any> = { ...base };
    for (const f of fields || []) {
        const fieldKey = (f.key || f.id || f.name) as string;
        if (f.type === "computed" && fieldKey) scope[fieldKey] = evalFormula(f.formula || "", scope);
    }
    return scope;
}

/** The functions available in formulas — surfaced to the copilot so it authors valid expressions. */
export const FORMULA_FUNCTIONS = Object.keys(FUNCS);

/** Strict authoring/runtime entry points. Legacy chat evaluation remains forgiving. */
export function expressionReferences(expr: string): string[] {
    const tokens = tokenize(expr);
    for (const [i, token] of tokens.entries()) {
        if (token.type === "id" && tokens[i + 1]?.value === "(" && !Object.prototype.hasOwnProperty.call(FUNCS, token.value.toLowerCase())) throw new Error(`Unknown function: ${token.value}`);
    }
    return [...new Set(tokens.filter((t, i) => t.type === "id" && tokens[i + 1]?.value !== "(" && !["true", "false"].includes(t.value)).map(t => t.value))];
}
export type ExpressionOutcome =
    | { ok: true; value: any }
    | { ok: false; missing: string[] }
    | { ok: false; error: string };

/**
 * Strict evaluation that reports, rather than throws, why there is no value: the
 * unanswered inputs the result depends on, or an error such as a division by zero.
 * A blank, null or absent input counts as unanswered.
 */
export function tryEvaluateExpression(expr: string, scope: Record<string, any>): ExpressionOutcome {
    if (!expr.trim()) return { ok: false, error: "An expression is required." };
    try {
        const strictScope: Record<string, any> = { ...scope, true: true, false: false };
        for (const ref of expressionReferences(expr)) {
            if (!Object.prototype.hasOwnProperty.call(scope, ref) || scope[ref] === "" || scope[ref] == null) strictScope[ref] = new Missing([ref]);
        }
        const result = new Parser(tokenize(expr), strictScope, true).parse();
        if (isMissing(result)) return { ok: false, missing: result.names };
        if (typeof result === "number" && !Number.isFinite(result)) return { ok: false, error: "Calculation is not finite (check divisors and domains)." };
        return { ok: true, value: result };
    } catch (error) {
        return { ok: false, error: (error as Error).message };
    }
}

export function evaluateExpression(expr: string, scope: Record<string, any>): any {
    const outcome = tryEvaluateExpression(expr, scope);
    if (outcome.ok) return outcome.value;
    if ("missing" in outcome) throw new Error(`Missing input: ${outcome.missing.join(", ")}`);
    throw new Error(outcome.error);
}
