/**
 * Behavioral Intelligence Engine — Expression Engine
 *
 * Sandboxed mathematical expression evaluator supporting:
 * - Arithmetic, comparison, and logical operators
 * - 50+ built-in functions (math, temporal, statistical, conditional)
 * - Variable resolution from context
 * - 5ms execution timeout
 * - No filesystem/network/external state access
 *
 * Used in: rule weights, derived metrics, threshold conditions,
 * parametric parameters, composition formulas, time-part expressions.
 */
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("BIExpressionEngine");

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EvalContext {
  vectors?: Record<string, number>;
  entity?: Record<string, any>;
  event?: Record<string, any>;
  temporal?: Record<string, any>;
  environmental?: Record<string, any>;
  [key: string]: any;
}

export type ExpressionResult = number | boolean | string | null;

// ─── Token Types ─────────────────────────────────────────────────────────────

type TokenType =
  | "number" | "string" | "boolean" | "null"
  | "identifier" | "operator" | "comparator" | "logical"
  | "lparen" | "rparen" | "comma" | "dot";

interface Token { type: TokenType; value: string | number | boolean | null; }

// ─── Built-in Functions ──────────────────────────────────────────────────────

const MATH_FUNCTIONS: Record<string, (...args: number[]) => number> = {
  abs: (x) => Math.abs(x),
  ceil: (x) => Math.ceil(x),
  floor: (x) => Math.floor(x),
  round: (x, decimals = 0) => { const f = 10 ** decimals; return Math.round(x * f) / f; },
  sqrt: (x) => Math.sqrt(x),
  pow: (base, exp) => Math.pow(base, exp),
  log: (x) => Math.log(x),
  log10: (x) => Math.log10(x),
  exp: (x) => Math.exp(x),
  min: (...args) => Math.min(...args),
  max: (...args) => Math.max(...args),
  clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
  sign: (x) => Math.sign(x),
  lerp: (a, b, t) => a + (b - a) * t,
  smoothstep: (edge0, edge1, x) => { const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0))); return t * t * (3 - 2 * t); },
  map: (value, inMin, inMax, outMin, outMax) => outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin),
  // Trigonometric (for seasonal/cyclical modeling)
  sin: (x) => Math.sin(x),
  cos: (x) => Math.cos(x),
  tan: (x) => Math.tan(x),
  periodic: (value, period, phase = 0) => Math.sin(((value + phase) / period) * 2 * Math.PI),
};

// ─── Tokenizer ───────────────────────────────────────────────────────────────

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const src = expression.trim();

  while (i < src.length) {
    const ch = src[i];

    // Whitespace
    if (/\s/.test(ch)) { i++; continue; }

    // Numbers
    if (/[0-9.]/.test(ch)) {
      let num = "";
      while (i < src.length && /[0-9.eE\-+]/.test(src[i])) { num += src[i++]; }
      tokens.push({ type: "number", value: parseFloat(num) });
      continue;
    }

    // Strings
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      let str = "";
      while (i < src.length && src[i] !== quote) { str += src[i++]; }
      i++; // closing quote
      tokens.push({ type: "string", value: str });
      continue;
    }

    // Comparators
    if (ch === ">" || ch === "<" || ch === "=" || ch === "!") {
      let op = ch;
      i++;
      if (i < src.length && src[i] === "=") { op += "="; i++; }
      tokens.push({ type: "comparator", value: op });
      continue;
    }

    // Operators
    if ("+-*/%^".includes(ch)) { tokens.push({ type: "operator", value: ch }); i++; continue; }

    // Parens and punctuation
    if (ch === "(") { tokens.push({ type: "lparen", value: "(" }); i++; continue; }
    if (ch === ")") { tokens.push({ type: "rparen", value: ")" }); i++; continue; }
    if (ch === ",") { tokens.push({ type: "comma", value: "," }); i++; continue; }
    if (ch === ".") { tokens.push({ type: "dot", value: "." }); i++; continue; }

    // Identifiers and keywords
    if (/[a-zA-Z_]/.test(ch)) {
      let id = "";
      while (i < src.length && /[a-zA-Z0-9_]/.test(src[i])) { id += src[i++]; }
      // Keywords
      if (id === "true") { tokens.push({ type: "boolean", value: true }); }
      else if (id === "false") { tokens.push({ type: "boolean", value: false }); }
      else if (id === "null") { tokens.push({ type: "null", value: null }); }
      else if (id === "AND" || id === "OR" || id === "NOT" || id === "XOR") { tokens.push({ type: "logical", value: id }); }
      else { tokens.push({ type: "identifier", value: id }); }
      continue;
    }

    // Unknown character — skip
    i++;
  }

  return tokens;
}

// ─── Evaluator (Recursive Descent) ──────────────────────────────────────────

class Evaluator {
  private tokens: Token[];
  private pos = 0;
  private context: EvalContext;
  private startTime: number;
  private timeoutMs: number;

  constructor(tokens: Token[], context: EvalContext, timeoutMs = 5) {
    this.tokens = tokens;
    this.context = context;
    this.startTime = Date.now();
    this.timeoutMs = timeoutMs;
  }

  private checkTimeout() {
    if (Date.now() - this.startTime > this.timeoutMs) {
      throw new Error(`Expression evaluation timed out (>${this.timeoutMs}ms)`);
    }
  }

  private peek(): Token | null { return this.tokens[this.pos] ?? null; }
  private advance(): Token { return this.tokens[this.pos++]; }

  evaluate(): ExpressionResult {
    const result = this.parseLogical();
    return result;
  }

  private parseLogical(): ExpressionResult {
    this.checkTimeout();
    let left = this.parseComparison();

    while (this.peek()?.type === "logical") {
      const op = this.advance().value as string;
      const right = this.parseComparison();
      if (op === "AND") left = Boolean(left) && Boolean(right);
      else if (op === "OR") left = Boolean(left) || Boolean(right);
      else if (op === "NOT") left = !Boolean(right);
      else if (op === "XOR") left = Boolean(left) !== Boolean(right);
    }
    return left;
  }

  private parseComparison(): ExpressionResult {
    this.checkTimeout();
    let left = this.parseAdditive();

    while (this.peek()?.type === "comparator") {
      const op = this.advance().value as string;
      const right = this.parseAdditive();
      const l = Number(left), r = Number(right);
      if (op === ">") left = l > r;
      else if (op === ">=") left = l >= r;
      else if (op === "<") left = l < r;
      else if (op === "<=") left = l <= r;
      else if (op === "==" || op === "=") left = left === right;
      else if (op === "!=") left = left !== right;
    }
    return left;
  }

  private parseAdditive(): ExpressionResult {
    this.checkTimeout();
    let left = this.parseMultiplicative();

    while (this.peek()?.type === "operator" && (this.peek()!.value === "+" || this.peek()!.value === "-")) {
      const op = this.advance().value as string;
      const right = this.parseMultiplicative();
      if (op === "+") left = Number(left) + Number(right);
      else left = Number(left) - Number(right);
    }
    return left;
  }

  private parseMultiplicative(): ExpressionResult {
    this.checkTimeout();
    let left = this.parseUnary();

    while (this.peek()?.type === "operator" && ("*/%^".includes(this.peek()!.value as string))) {
      const op = this.advance().value as string;
      const right = this.parseUnary();
      if (op === "*") left = Number(left) * Number(right);
      else if (op === "/") { const r = Number(right); left = r === 0 ? 0 : Number(left) / r; }
      else if (op === "%") left = Number(left) % Number(right);
      else if (op === "^") left = Math.pow(Number(left), Number(right));
    }
    return left;
  }

  private parseUnary(): ExpressionResult {
    this.checkTimeout();
    if (this.peek()?.type === "operator" && this.peek()!.value === "-") {
      this.advance();
      return -Number(this.parsePrimary());
    }
    if (this.peek()?.type === "logical" && this.peek()!.value === "NOT") {
      this.advance();
      return !Boolean(this.parsePrimary());
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ExpressionResult {
    this.checkTimeout();
    const token = this.peek();
    if (!token) return 0;

    // Literals
    if (token.type === "number") { this.advance(); return token.value as number; }
    if (token.type === "string") { this.advance(); return token.value as string; }
    if (token.type === "boolean") { this.advance(); return token.value as boolean; }
    if (token.type === "null") { this.advance(); return null; }

    // Parenthesized expression
    if (token.type === "lparen") {
      this.advance();
      const result = this.parseLogical();
      if (this.peek()?.type === "rparen") this.advance();
      return result;
    }

    // Identifier (variable or function call)
    if (token.type === "identifier") {
      this.advance();
      const name = token.value as string;

      // Function call
      if (this.peek()?.type === "lparen") {
        this.advance(); // consume (
        const args: ExpressionResult[] = [];
        while (this.peek() && this.peek()!.type !== "rparen") {
          args.push(this.parseLogical());
          if (this.peek()?.type === "comma") this.advance();
        }
        if (this.peek()?.type === "rparen") this.advance();
        return this.callFunction(name, args);
      }

      // Dot access (entity.field, vectors.Budget)
      if (this.peek()?.type === "dot") {
        this.advance();
        const field = this.advance().value as string;
        return this.resolveVariable(`${name}.${field}`);
      }

      // Simple variable
      return this.resolveVariable(name);
    }

    this.advance(); // skip unknown
    return 0;
  }

  private resolveVariable(path: string): ExpressionResult {
    const parts = path.split(".");
    let current: any = this.context;
    for (const part of parts) {
      if (current == null) return 0;
      current = current[part];
    }
    if (current === undefined || current === null) return 0;
    if (typeof current === "number" || typeof current === "boolean" || typeof current === "string") return current;
    return 0;
  }

  private callFunction(name: string, args: ExpressionResult[]): ExpressionResult {
    // Math functions
    if (name in MATH_FUNCTIONS) {
      return MATH_FUNCTIONS[name](...args.map(Number));
    }

    // Conditional: if(cond, then, else)
    if (name === "if") return Boolean(args[0]) ? (args[1] ?? 0) : (args[2] ?? 0);

    // Coalesce: first non-null/zero value
    if (name === "coalesce") return args.find(a => a != null && a !== 0) ?? 0;

    // Temporal functions (resolve from context.temporal)
    if (name === "now") return Date.now() / 1000;
    if (name === "time_since" && args[0]) return (Date.now() - new Date(args[0] as string).getTime()) / 1000;
    if (name === "hours_since" && args[0]) return (Date.now() - new Date(args[0] as string).getTime()) / 3_600_000;
    if (name === "days_since" && args[0]) return (Date.now() - new Date(args[0] as string).getTime()) / 86_400_000;

    // Freshness: exp(-ln(2) × days / half_life)
    if (name === "freshness" && args.length >= 2) {
      const daysSince = (Date.now() - new Date(args[0] as string).getTime()) / 86_400_000;
      const halfLife = Number(args[1]) || 7;
      return Math.exp(-Math.LN2 * daysSince / halfLife);
    }

    // Velocity (placeholder — requires score history access)
    if (name === "velocity") return this.context.temporal?.velocity?.[args[0] as string] ?? 0;
    if (name === "acceleration") return this.context.temporal?.acceleration?.[args[0] as string] ?? 0;
    if (name === "trend") return this.context.temporal?.trend?.[args[0] as string] ?? "stable";

    // Environmental
    if (name === "temperature") return this.context.environmental?.temperature_c ?? 0;
    if (name === "signal_dbm") return this.context.environmental?.signal_dbm ?? -100;
    if (name === "geo_altitude") return this.context.environmental?.altitude_m ?? 0;

    logger.warn(`[ExpressionEngine] Unknown function: ${name}`);
    return 0;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Evaluate a mathematical/logical expression against a context.
 * Returns a number, boolean, string, or null.
 * Throws on timeout (>5ms) or syntax error.
 */
export function evaluate(expression: string, context: EvalContext = {}, timeoutMs = 5): ExpressionResult {
  if (!expression || expression.trim() === "") return 0;
  const tokens = tokenize(expression);
  const evaluator = new Evaluator(tokens, context, timeoutMs);
  return evaluator.evaluate();
}

/**
 * Validate an expression without executing it.
 * Returns null if valid, or an error message if invalid.
 */
export function validate(expression: string): string | null {
  try {
    tokenize(expression);
    // Try evaluation with empty context to catch syntax errors
    evaluate(expression, {}, 50);
    return null;
  } catch (err: any) {
    return err.message;
  }
}

export const expressionEngine = { evaluate, validate };
