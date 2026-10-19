/**
 * CEL (Common Expression Language) Evaluator
 * 
 * Implements CEL expression evaluation for Decision Nodes.
 * Supports Scalar, Textual, Set, Temporal, and Integrity expression types.
 * 
 * CEL Syntax Reference:
 * - Scalar: profile.interest_score > 80
 * - Textual: profile.name.contains("VIP")
 * - Set: profile.tags.has("premium")
 * - Temporal: profile.last_active < timestamp("2024-01-01T00:00:00Z")
 * - Integrity: profile.email.matches("^[a-z]+@example\\.com$")
 * 
 * Extended Functions (from cel-extensions.ts):
 * - text.contains(str, search), text.matches(str, regex), text.lower(str), text.startsWith(str, prefix)
 * - diff.hasChange(path), diff.value(path), diff.oldValue(path), diff.percentageChange(path)
 * - list.size(arr), list.contains(arr, item), list.any(arr, prop, val), list.sum(arr)
 */

import type { VariableContext } from "./variable-resolver.js";
import { textFunctions, diffFunctions, listFunctions } from "@domain/core/infrastructure/cel-extensions.js";

export class CELExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CELExpressionError";
  }
}

/**
 * Evaluate a CEL expression against a context
 * 
 * @param expression - CEL expression string (e.g., "profile.interest_score > 80")
 * @param context - Variable context with step outputs and pipeline data
 * @returns Boolean result of the expression
 */
export function evaluateCELExpression(
  expression: string,
  context: VariableContext & { data?: Record<string, any> }
): boolean {
  if (!expression || expression.trim() === "") {
    throw new CELExpressionError("Expression cannot be empty");
  }

  try {
    // Parse and evaluate the expression
    return evaluateCEL(expression.trim(), context);
  } catch (error) {
    if (error instanceof CELExpressionError) {
      throw error;
    }
    throw new CELExpressionError(
      `CEL evaluation failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Internal CEL evaluator
 */
function evaluateCEL(expression: string, context: VariableContext & { data?: Record<string, any> }): boolean {
  // Build evaluation context from VariableContext
  const evalContext: Record<string, any> = {
    // Inject CEL extension functions (placed first so context.data can overwrite on collision)
    text: textFunctions,
    diff: diffFunctions,
    list: listFunctions,
    ...context.data,
    step: buildStepContext(context),
    pipeline: buildPipelineContext(context),
  };

  // Parse the expression
  const tokens = tokenizeCEL(expression);
  const ast = parseCEL(tokens);
  return evaluateAST(ast, evalContext);
}

/**
 * Build step context from VariableContext
 */
function buildStepContext(context: VariableContext): Record<string, any> {
  const stepContext: Record<string, any> = {};

  // Add positional steps
  for (const [index, output] of Object.entries(context.positional)) {
    stepContext[index] = { output };
  }

  return stepContext;
}

/**
 * Build pipeline context from VariableContext
 */
function buildPipelineContext(context: VariableContext): Record<string, any> {
  return {
    ...context.named,
  };
}

/**
 * Token types for CEL parsing
 */
type TokenType =
  | "IDENTIFIER"
  | "NUMBER"
  | "STRING"
  | "OPERATOR"
  | "LOGICAL"
  | "PAREN"
  | "DOT"
  | "COMMA"
  | "EOF";

interface Token {
  type: TokenType;
  value: string | number;
  position: number;
}

/**
 * Tokenize CEL expression
 */
function tokenizeCEL(expression: string): Token[] {
  const tokens: Token[] = [];
  let position = 0;

  while (position < expression.length) {
    // Skip whitespace
    if (/\s/.test(expression[position])) {
      position++;
      continue;
    }

    const startPos = position;
    const char = expression[position];

    // String literals
    if (char === '"' || char === "'") {
      const quote = char;
      position++;
      let str = "";
      while (position < expression.length && expression[position] !== quote) {
        if (expression[position] === "\\") {
          position++;
          if (position < expression.length) {
            const next = expression[position];
            if (next === "n") str += "\n";
            else if (next === "t") str += "\t";
            else if (next === "\\") str += "\\";
            else if (next === quote) str += quote;
            else str += next;
          }
        } else {
          str += expression[position];
        }
        position++;
      }
      if (position < expression.length) position++; // Skip closing quote
      tokens.push({ type: "STRING", value: str, position: startPos });
      continue;
    }

    // Numbers
    if (/[\d]/.test(char)) {
      let numStr = "";
      while (position < expression.length && /[\d.]/.test(expression[position])) {
        numStr += expression[position];
        position++;
      }
      const num = parseFloat(numStr);
      tokens.push({ type: "NUMBER", value: isNaN(num) ? 0 : num, position: startPos });
      continue;
    }

    // Operators
    if (char === ">" && expression[position + 1] === "=") {
      tokens.push({ type: "OPERATOR", value: ">=", position: startPos });
      position += 2;
      continue;
    }
    if (char === "<" && expression[position + 1] === "=") {
      tokens.push({ type: "OPERATOR", value: "<=", position: startPos });
      position += 2;
      continue;
    }
    if (char === "=" && expression[position + 1] === "=") {
      tokens.push({ type: "OPERATOR", value: "==", position: startPos });
      position += 2;
      continue;
    }
    if (char === "!" && expression[position + 1] === "=") {
      tokens.push({ type: "OPERATOR", value: "!=", position: startPos });
      position += 2;
      continue;
    }
    if (char === ">") {
      tokens.push({ type: "OPERATOR", value: ">", position: startPos });
      position++;
      continue;
    }
    if (char === "<") {
      tokens.push({ type: "OPERATOR", value: "<", position: startPos });
      position++;
      continue;
    }

    // Dot operator
    if (char === ".") {
      tokens.push({ type: "DOT", value: ".", position: startPos });
      position++;
      continue;
    }

    // Comma
    if (char === ",") {
      tokens.push({ type: "COMMA", value: ",", position: startPos });
      position++;
      continue;
    }

    // Parentheses
    if (char === "(") {
      tokens.push({ type: "PAREN", value: "(", position: startPos });
      position++;
      continue;
    }
    if (char === ")") {
      tokens.push({ type: "PAREN", value: ")", position: startPos });
      position++;
      continue;
    }

    // Identifiers and keywords
    if (/[a-zA-Z_]/.test(char)) {
      let ident = "";
      while (position < expression.length && /[a-zA-Z0-9_]/.test(expression[position])) {
        ident += expression[position];
        position++;
      }

      // Check for logical operators
      const upperIdent = ident.toUpperCase();
      if (["AND", "OR", "NOT"].includes(upperIdent)) {
        tokens.push({ type: "LOGICAL", value: upperIdent, position: startPos });
      } else {
        tokens.push({ type: "IDENTIFIER", value: ident, position: startPos });
      }
      continue;
    }

    throw new CELExpressionError(`Unexpected character: ${char} at position ${startPos}`);
  }

  tokens.push({ type: "EOF", value: "", position });
  return tokens;
}

/**
 * AST node types
 */
type ASTNode =
  | { type: "value"; value: any }
  | { type: "path"; path: string[] }
  | { type: "comparison"; left: ASTNode; operator: string; right: ASTNode }
  | { type: "logical"; operator: string; left: ASTNode; right?: ASTNode }
  | { type: "method"; object: ASTNode; method: string; args: ASTNode[] };

/**
 * Parse tokens into AST
 */
function parseCEL(tokens: Token[]): ASTNode {
  let position = 0;

  function peek(): Token {
    return tokens[position] || { type: "EOF", value: "", position: 0 };
  }

  function advance(): Token {
    return tokens[position++] || { type: "EOF", value: "", position: 0 };
  }

  function parseExpression(): ASTNode {
    return parseOr();
  }

  function parseOr(): ASTNode {
    let left = parseAnd();
    while (peek().type === "LOGICAL" && peek().value === "OR") {
      advance();
      const right = parseAnd();
      left = { type: "logical", operator: "OR", left, right };
    }
    return left;
  }

  function parseAnd(): ASTNode {
    let left = parseNot();
    while (peek().type === "LOGICAL" && peek().value === "AND") {
      advance();
      const right = parseNot();
      left = { type: "logical", operator: "AND", left, right };
    }
    return left;
  }

  function parseNot(): ASTNode {
    if (peek().type === "LOGICAL" && peek().value === "NOT") {
      advance();
      return { type: "logical", operator: "NOT", left: parseNot() };
    }
    return parseComparison();
  }

  function parseComparison(): ASTNode {
    const left = parseValue();
    if (peek().type === "OPERATOR") {
      const operator = advance().value as string;
      const right = parseValue();
      return { type: "comparison", left, operator, right };
    }
    return left;
  }

  function parseValue(): ASTNode {
    if (peek().type === "PAREN" && peek().value === "(") {
      advance();
      const expr = parseExpression();
      if (peek().type !== "PAREN" || peek().value !== ")") {
        throw new CELExpressionError("Expected closing parenthesis");
      }
      advance();
      return expr;
    }

    if (peek().type === "STRING") {
      return { type: "value", value: advance().value };
    }

    if (peek().type === "NUMBER") {
      return { type: "value", value: advance().value };
    }

    // Parse path (identifier.dot.identifier...)
    if (peek().type === "IDENTIFIER") {
      const path: string[] = [advance().value as string];
      while (peek().type === "DOT") {
        advance();
        if (peek().type === "IDENTIFIER") {
          path.push(advance().value as string);
        } else {
          throw new CELExpressionError("Expected identifier after dot");
        }
      }

      // Check for method call
      if (peek().type === "PAREN" && peek().value === "(") {
        const method = path.pop();
        if (!method) throw new CELExpressionError("Invalid method call");
        advance(); // (
        const args: ASTNode[] = [];
        if (peek().type !== "PAREN" || peek().value !== ")") {
          // Parse first argument
          args.push(parseValue());

          // Parse additional arguments separated by commas
          while (peek().type === "COMMA") {
            advance(); // consume comma
            // Parse next argument
            args.push(parseValue());
          }
        }
        if (peek().type !== "PAREN" || peek().value !== ")") {
          throw new CELExpressionError("Expected closing parenthesis for method call");
        }
        advance(); // )
        return { type: "method", object: { type: "path", path }, method, args };
      }

      return { type: "path", path };
    }

    throw new CELExpressionError(`Unexpected token: ${peek().type} at position ${peek().position}`);
  }

  return parseExpression();
}

/**
 * Evaluate AST node
 */
function evaluateAST(node: ASTNode, context: Record<string, any>): boolean {
  switch (node.type) {
    case "value":
      return Boolean(node.value);

    case "path":
      const value = resolvePath(node.path, context);
      return Boolean(value);

    case "comparison":
      const leftVal = evaluateValue(node.left, context);
      const rightVal = evaluateValue(node.right, context);
      return compareValues(leftVal, node.operator, rightVal);

    case "logical":
      if (node.operator === "NOT") {
        return !evaluateAST(node.left, context);
      }
      const leftResult = evaluateAST(node.left, context);
      if (node.operator === "AND" && !leftResult) return false;
      if (node.operator === "OR" && leftResult) return true;
      if (node.right) {
        const rightResult = evaluateAST(node.right, context);
        if (node.operator === "AND") return leftResult && rightResult;
        if (node.operator === "OR") return leftResult || rightResult;
      }
      return leftResult;

    case "method":
      // For methods used as standalone expressions (not in comparison),
      // evaluate and cast to boolean
      const methodResult = evaluateMethodForValue(node, context);
      return Boolean(methodResult);

    default:
      throw new CELExpressionError(`Unknown AST node type: ${(node as any).type}`);
  }
}

/**
 * Evaluate value from AST node
 */
function evaluateValue(node: ASTNode, context: Record<string, any>): any {
  switch (node.type) {
    case "value":
      return node.value;
    case "path":
      return resolvePath(node.path, context);
    case "method":
      // Method can return any value (for use in comparisons)
      return evaluateMethodForValue(node, context);
    default:
      throw new CELExpressionError("Expected value node");
  }
}

/**
 * Evaluate method and return the value (for use in comparisons)
 */
function evaluateMethodForValue(node: Extract<ASTNode, { type: "method" }>, context: Record<string, any>): any {
  const obj = evaluateValue(node.object, context);
  const method = node.method;
  const args = node.args.map(arg => evaluateValue(arg, context));

  // Check if obj is a function container (text, diff, list extensions)
  if (obj && typeof obj === "object" && typeof obj[method] === "function") {
    try {
      return obj[method](...args);
    } catch (e) {
      throw new CELExpressionError(`Error calling ${method}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Common methods on primitives
  if (typeof obj === "string") {
    if (method === "contains") return obj.includes(String(args[0]));
    if (method === "matches") return new RegExp(String(args[0])).test(obj);
    if (method === "startsWith") return obj.startsWith(String(args[0]));
    if (method === "endsWith") return obj.endsWith(String(args[0]));
    if (method === "toLowerCase") return obj.toLowerCase();
    if (method === "toUpperCase") return obj.toUpperCase();
    if (method === "trim") return obj.trim();
    if (method === "length") return obj.length;
  }

  if (Array.isArray(obj)) {
    if (method === "contains" || method === "has") return obj.includes(args[0]);
    if (method === "size" || method === "length") return obj.length;
  }

  throw new CELExpressionError(`Unsupported method: ${method} on type ${typeof obj}`);
}

/**
 * Resolve path in context
 */
function resolvePath(path: string[], context: Record<string, any>): any {
  let value: any = context;
  for (const segment of path) {
    if (value == null) {
      throw new CELExpressionError(`Path ${path.join(".")} not found in context`);
    }
    value = value[segment];
  }
  return value;
}

/**
 * Compare two values
 */
function compareValues(left: any, operator: string, right: any): boolean {
  // Try numeric comparison
  const leftNum = parseFloat(String(left));
  const rightNum = parseFloat(String(right));
  const isNumeric = !isNaN(leftNum) && !isNaN(rightNum) && isFinite(leftNum) && isFinite(rightNum);

  switch (operator) {
    case "==":
      return left === right || (isNumeric && leftNum === rightNum);
    case "!=":
      return left !== right && (!isNumeric || leftNum !== rightNum);
    case ">":
      return isNumeric ? leftNum > rightNum : String(left) > String(right);
    case "<":
      return isNumeric ? leftNum < rightNum : String(left) < String(right);
    case ">=":
      return isNumeric ? leftNum >= rightNum : String(left) >= String(right);
    case "<=":
      return isNumeric ? leftNum <= rightNum : String(left) <= String(right);
    default:
      throw new CELExpressionError(`Unknown operator: ${operator}`);
  }
}




