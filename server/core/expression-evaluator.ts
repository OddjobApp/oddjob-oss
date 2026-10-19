/**
 * Expression Evaluator for Pipeline Step Conditions
 * 
 * Evaluates custom boolean expressions for pipeline step conditions.
 * Supports:
 * - Variable substitution: {{pipeline.name}}, {{step.N.output}}
 * - Comparisons: ==, !=, >, <, >=, <=, contains, startsWith, endsWith
 * - Logical operators: AND, OR, NOT
 * - String and numeric comparisons
 * 
 * Example expressions:
 * - "{{step.0.output}} == 'success'"
 * - "{{pipeline.status}} != 'error' AND {{step.1.output}} contains 'OK'"
 * - "{{step.0.output}} > 100 OR {{step.1.output}} < 50"
 */

import { VariableContext, resolveVariables, VariableResolverError } from "./variable-resolver.js";
import { AppError, ErrorCode } from "../utils/errors.js";

export class ExpressionEvaluationError extends AppError {
  constructor(message: string) {
    super(message, 400, ErrorCode.VALIDATION_FAILED);
    this.name = "ExpressionEvaluationError";
  }
}

/**
 * Token types for the expression parser
 */
enum TokenType {
  VARIABLE = "VARIABLE",
  STRING = "STRING",
  NUMBER = "NUMBER",
  OPERATOR = "OPERATOR",
  LOGICAL = "LOGICAL",
  PAREN = "PAREN",
  EOF = "EOF",
}

interface Token {
  type: TokenType;
  value: string | number;
  position: number;
}

/**
 * Lexer for tokenizing expressions
 */
class ExpressionLexer {
  private input: string;
  private position: number = 0;

  constructor(input: string) {
    this.input = input.trim();
  }

  private peek(offset: number = 0): string {
    return this.input[this.position + offset] || "";
  }

  private advance(): string {
    return this.input[this.position++] || "";
  }

  private skipWhitespace(): void {
    while (this.position < this.input.length && /\s/.test(this.peek())) {
      this.advance();
    }
  }

  private readVariable(): string {
    let variable = "";
    const startPos = this.position;

    // Read {{...}} pattern
    if (this.peek() !== "{" || this.peek(1) !== "{") {
      throw new ExpressionEvaluationError(`Expected variable at position ${this.position}`);
    }

    this.advance(); // {
    this.advance(); // {

    while (this.position < this.input.length) {
      const char = this.peek();
      if (char === "}" && this.peek(1) === "}") {
        this.advance(); // }
        this.advance(); // }
        break;
      }
      variable += this.advance();
    }

    if (!variable) {
      throw new ExpressionEvaluationError(`Empty variable at position ${startPos}`);
    }

    return `{{${variable}}}`;
  }

  private readString(): string {
    const quote = this.advance(); // ' or "
    let str = "";

    while (this.position < this.input.length) {
      const char = this.peek();
      if (char === quote) {
        this.advance();
        break;
      }
      if (char === "\\") {
        this.advance();
        const next = this.peek();
        if (next === "n") str += "\n";
        else if (next === "t") str += "\t";
        else if (next === "\\") str += "\\";
        else if (next === quote) str += quote;
        else str += this.advance();
      } else {
        str += this.advance();
      }
    }

    return str;
  }

  private readNumber(): number {
    let numStr = "";
    while (this.position < this.input.length && /[\d.]/.test(this.peek())) {
      numStr += this.advance();
    }
    const num = parseFloat(numStr);
    if (isNaN(num)) {
      throw new ExpressionEvaluationError(`Invalid number: ${numStr}`);
    }
    return num;
  }

  private readIdentifier(): string {
    let ident = "";
    while (
      this.position < this.input.length &&
      /[a-zA-Z0-9_.]/.test(this.peek())
    ) {
      ident += this.advance();
    }
    return ident;
  }

  tokenize(): Token[] {
    const tokens: Token[] = [];
    this.position = 0;

    while (this.position < this.input.length) {
      this.skipWhitespace();
      if (this.position >= this.input.length) break;

      const char = this.peek();
      const startPos = this.position;

      // Variable: {{...}}
      if (char === "{" && this.peek(1) === "{") {
        const variable = this.readVariable();
        tokens.push({
          type: TokenType.VARIABLE,
          value: variable,
          position: startPos,
        });
        continue;
      }

      // String: '...' or "..."
      if (char === "'" || char === '"') {
        const str = this.readString();
        tokens.push({
          type: TokenType.STRING,
          value: str,
          position: startPos,
        });
        continue;
      }

      // Number
      if (/[\d]/.test(char)) {
        const num = this.readNumber();
        tokens.push({
          type: TokenType.STRING,
          value: num.toString(),
          position: startPos,
        });
        continue;
      }

      // Parentheses
      if (char === "(") {
        tokens.push({
          type: TokenType.PAREN,
          value: "(",
          position: startPos,
        });
        this.advance();
        continue;
      }

      if (char === ")") {
        tokens.push({
          type: TokenType.PAREN,
          value: ")",
          position: startPos,
        });
        this.advance();
        continue;
      }

      // Operators: ==, !=, >=, <=, >, <
      if (char === "=" && this.peek(1) === "=") {
        tokens.push({
          type: TokenType.OPERATOR,
          value: "==",
          position: startPos,
        });
        this.advance();
        this.advance();
        continue;
      }

      if (char === "!" && this.peek(1) === "=") {
        tokens.push({
          type: TokenType.OPERATOR,
          value: "!=",
          position: startPos,
        });
        this.advance();
        this.advance();
        continue;
      }

      if (char === ">" && this.peek(1) === "=") {
        tokens.push({
          type: TokenType.OPERATOR,
          value: ">=",
          position: startPos,
        });
        this.advance();
        this.advance();
        continue;
      }

      if (char === "<" && this.peek(1) === "=") {
        tokens.push({
          type: TokenType.OPERATOR,
          value: "<=",
          position: startPos,
        });
        this.advance();
        this.advance();
        continue;
      }

      if (char === ">") {
        tokens.push({
          type: TokenType.OPERATOR,
          value: ">",
          position: startPos,
        });
        this.advance();
        continue;
      }

      if (char === "<") {
        tokens.push({
          type: TokenType.OPERATOR,
          value: "<",
          position: startPos,
        });
        this.advance();
        continue;
      }

      // Logical operators: AND, OR, NOT
      const ident = this.readIdentifier();
      if (ident) {
        const upperIdent = ident.toUpperCase();
        if (["AND", "OR", "NOT"].includes(upperIdent)) {
          tokens.push({
            type: TokenType.LOGICAL,
            value: upperIdent,
            position: startPos,
          });
          continue;
        }

        // Function-like operators: contains, startsWith, endsWith
        if (["contains", "startswith", "endswith"].includes(ident.toLowerCase())) {
          tokens.push({
            type: TokenType.OPERATOR,
            value: ident.toLowerCase(),
            position: startPos,
          });
          continue;
        }

        // Bare identifier: treat as variable (fallback)
        tokens.push({
          type: TokenType.VARIABLE,
          value: `{{${ident}}}`,
          position: startPos,
        });
        continue;
      }

      throw new ExpressionEvaluationError(
        `Unexpected character: ${char} at position ${startPos}`
      );
    }

    tokens.push({
      type: TokenType.EOF,
      value: "",
      position: this.position,
    });

    return tokens;
  }
}

/**
 * Parser and evaluator for boolean expressions
 */
class ExpressionEvaluator {
  private tokens: Token[];
  private position: number = 0;
  private context: VariableContext;

  constructor(tokens: Token[], context: VariableContext) {
    this.tokens = tokens;
    this.context = context;
  }

  private peek(): Token {
    return this.tokens[this.position] || { type: TokenType.EOF, value: "", position: 0 };
  }

  private advance(): Token {
    return this.tokens[this.position++] || { type: TokenType.EOF, value: "", position: 0 };
  }

  private expect(type: TokenType, value?: string): Token {
    const token = this.peek();
    if (token.type !== type) {
      throw new ExpressionEvaluationError(
        `Expected ${type}, got ${token.type} at position ${token.position}`
      );
    }
    if (value !== undefined && token.value !== value) {
      throw new ExpressionEvaluationError(
        `Expected ${value}, got ${token.value} at position ${token.position}`
      );
    }
    return this.advance();
  }

  /**
   * Resolve a variable to its value
   */
  private resolveVariable(variable: string): string {
    try {
      return resolveVariables(variable, this.context);
    } catch (error) {
      if (error instanceof VariableResolverError) {
        throw new ExpressionEvaluationError(
          `Variable resolution failed: ${error.message}`
        );
      }
      throw error;
    }
  }

  /**
   * Parse and evaluate a value (variable, string, or number)
   */
  private parseValue(): string {
    const token = this.peek();

    if (token.type === TokenType.VARIABLE) {
      this.advance();
      return this.resolveVariable(token.value as string);
    }

    if (token.type === TokenType.STRING) {
      this.advance();
      return token.value as string;
    }

    throw new ExpressionEvaluationError(
      `Expected value, got ${token.type} at position ${token.position}`
    );
  }

  /**
   * Parse and evaluate a comparison expression
   */
  private parseComparison(): boolean {
    const left = this.parseValue();
    const token = this.peek();

    if (token.type !== TokenType.OPERATOR) {
      // Single value - treat as truthy check
      return this.isTruthy(left);
    }

    const operator = token.value as string;
    this.advance();

    const right = this.parseValue();

    return this.compare(left, operator, right);
  }

  /**
   * Compare two values using an operator
   */
  private compare(left: string, operator: string, right: string): boolean {
    // Try numeric comparison first
    const leftNum = parseFloat(left);
    const rightNum = parseFloat(right);
    const isNumeric = !isNaN(leftNum) && !isNaN(rightNum) && isFinite(leftNum) && isFinite(rightNum);

    switch (operator) {
      case "==":
        return left === right || (isNumeric && leftNum === rightNum);
      case "!=":
        return left !== right && (!isNumeric || leftNum !== rightNum);
      case ">":
        if (isNumeric) return leftNum > rightNum;
        return left > right;
      case "<":
        if (isNumeric) return leftNum < rightNum;
        return left < right;
      case ">=":
        if (isNumeric) return leftNum >= rightNum;
        return left >= right;
      case "<=":
        if (isNumeric) return leftNum <= rightNum;
        return left <= right;
      case "contains":
        return left.toLowerCase().includes(right.toLowerCase());
      case "startswith":
        return left.toLowerCase().startsWith(right.toLowerCase());
      case "endswith":
        return left.toLowerCase().endsWith(right.toLowerCase());
      default:
        throw new ExpressionEvaluationError(`Unknown operator: ${operator}`);
    }
  }

  /**
   * Check if a value is truthy
   */
  private isTruthy(value: string): boolean {
    if (value === "") return false;
    if (value.toLowerCase() === "false") return false;
    if (value.toLowerCase() === "0") return false;
    if (value.toLowerCase() === "null") return false;
    if (value.toLowerCase() === "undefined") return false;
    return true;
  }

  /**
   * Parse and evaluate a NOT expression
   */
  private parseNot(): boolean {
    if (this.peek().type === TokenType.LOGICAL && this.peek().value === "NOT") {
      this.advance();
      return !this.parseNot();
    }

    if (this.peek().type === TokenType.PAREN && this.peek().value === "(") {
      this.advance(); // (
      const result = this.parseOr();
      this.expect(TokenType.PAREN, ")");
      return result;
    }

    return this.parseComparison();
  }

  /**
   * Parse and evaluate an AND expression
   */
  private parseAnd(): boolean {
    let result = this.parseNot();

    while (
      this.peek().type === TokenType.LOGICAL &&
      this.peek().value === "AND"
    ) {
      this.advance();
      result = result && this.parseNot();
    }

    return result;
  }

  /**
   * Parse and evaluate an OR expression
   */
  private parseOr(): boolean {
    let result = this.parseAnd();

    while (
      this.peek().type === TokenType.LOGICAL &&
      this.peek().value === "OR"
    ) {
      this.advance();
      result = result || this.parseAnd();
    }

    return result;
  }

  /**
   * Evaluate the expression
   */
  evaluate(): boolean {
    if (this.tokens.length === 1 && this.tokens[0].type === TokenType.EOF) {
      throw new ExpressionEvaluationError("Empty expression");
    }

    const result = this.parseOr();

    if (this.peek().type !== TokenType.EOF) {
      throw new ExpressionEvaluationError(
        `Unexpected token: ${this.peek().type} at position ${this.peek().position}`
      );
    }

    return result;
  }
}

/**
 * Evaluate a custom condition expression
 * 
 * @param expression - The expression to evaluate (e.g., "{{step.0.output}} == 'success'")
 * @param context - Variable context with step outputs
 * @returns true if the expression evaluates to true, false otherwise
 * @throws ExpressionEvaluationError if the expression is invalid
 */
export function evaluateCondition(
  expression: string,
  context: VariableContext
): boolean {
  if (!expression || expression.trim() === "") {
    throw new ExpressionEvaluationError("Expression cannot be empty");
  }

  try {
    const lexer = new ExpressionLexer(expression);
    const tokens = lexer.tokenize();
    const evaluator = new ExpressionEvaluator(tokens, context);
    return evaluator.evaluate();
  } catch (error) {
    if (error instanceof ExpressionEvaluationError) {
      throw error;
    }
    throw new ExpressionEvaluationError(
      `Expression evaluation failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}




