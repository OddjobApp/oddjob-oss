
import _ from "lodash";
const { get } = _;
import type { EntityRule, JobOutputSchema } from "@shared/schema/index.js";

export interface ExtractedEntity {
    entityType: string;
    label: string;
    name: string;
    externalId?: string;
    data: Record<string, any>;
    sourceCreatedAt?: string;
    sourceUpdatedAt?: string;
}

/**
 * Safe Condition Evaluator
 * Parsers simple expressions like: {{field}} == 'value'
 * Supports: ==, ===, !=, !==, >, <, >=, <=, AND, OR
 */
export function evaluateSimpleCondition(condition: string, data: any): boolean {
    try {
        const tokens = tokenize(condition);
        const parser = new Parser(tokens, data);
        return parser.parse();
    } catch (e) {
        console.error(`[Knowledge Graph] Condition evaluation error: "${condition}"`, e);
        return false;
    }
}

type TokenType = 'IDENTIFIER' | 'STRING' | 'NUMBER' | 'BOOLEAN' | 'NULL' | 'OPERATOR' | 'LPAREN' | 'RPAREN';
interface Token { type: TokenType; value: any; }

function tokenize(input: string): Token[] {
    const tokens: Token[] = [];
    let cursor = 0;

    while (cursor < input.length) {
        const char = input[cursor];

        // Whitespace
        if (/\s/.test(char)) {
            cursor++;
            continue;
        }

        // Parentheses
        if (char === '(') { tokens.push({ type: 'LPAREN', value: '(' }); cursor++; continue; }
        if (char === ')') { tokens.push({ type: 'RPAREN', value: ')' }); cursor++; continue; }

        // Operators
        const threeCharOp = input.substr(cursor, 3);
        if (['===', '!=='].includes(threeCharOp)) {
            tokens.push({ type: 'OPERATOR', value: threeCharOp }); cursor += 3; continue;
        }
        const twoCharOp = input.substr(cursor, 2);
        if (['==', '!=', '>=', '<=', '&&', '||'].includes(twoCharOp)) {
            tokens.push({ type: 'OPERATOR', value: twoCharOp }); cursor += 2; continue;
        }
        if (['>', '<'].includes(char)) {
            tokens.push({ type: 'OPERATOR', value: char }); cursor++; continue;
        }

        // Strings
        if (char === "'" || char === '"') {
            let value = '';
            const quote = char;
            cursor++;
            while (cursor < input.length && input[cursor] !== quote) {
                value += input[cursor];
                cursor++;
            }
            cursor++; // Skip closing quote
            tokens.push({ type: 'STRING', value });
            continue;
        }

        // Variables {{path}}
        if (char === '{' && input[cursor + 1] === '{') {
            let value = '';
            cursor += 2;
            while (cursor < input.length - 1 && !(input[cursor] === '}' && input[cursor + 1] === '}')) {
                value += input[cursor];
                cursor++;
            }
            cursor += 2; // Skip closing }}
            tokens.push({ type: 'IDENTIFIER', value: value.trim() });
            continue;
        }

        // Numbers
        if (/[0-9]/.test(char)) {
            let value = '';
            while (cursor < input.length && /[0-9.]/.test(input[cursor])) {
                value += input[cursor];
                cursor++;
            }
            tokens.push({ type: 'NUMBER', value: Number(value) });
            continue;
        }

        // Booleans / Null / Raw Identifiers (unsupported but handled as strings)
        const alphaMatch = input.substr(cursor).match(/^[a-zA-Z_][a-zA-Z0-9_]*/);
        if (alphaMatch) {
            const value = alphaMatch[0];
            if (value === 'true') tokens.push({ type: 'BOOLEAN', value: true });
            else if (value === 'false') tokens.push({ type: 'BOOLEAN', value: false });
            else if (value === 'null') tokens.push({ type: 'NULL', value: null });
            else tokens.push({ type: 'STRING', value }); // Fallback
            cursor += value.length;
            continue;
        }

        cursor++; // Skip unknown
    }
    return tokens;
}

class Parser {
    private tokens: Token[];
    private data: any;
    private pos = 0;

    constructor(tokens: Token[], data: any) {
        this.tokens = tokens;
        this.data = data;
    }

    parse(): boolean {
        return this.parseExpression();
    }

    private parseExpression(): boolean {
        let left = this.parseComparison();
        while (this.match('&&', '||')) {
            const operator = this.previous().value;
            const right = this.parseComparison();
            if (operator === '&&') left = left && right;
            if (operator === '||') left = left || right;
        }
        return left;
    }

    private parseComparison(): boolean {
        let left = this.parsePrimary();
        if (this.match('==', '===', '!=', '!==', '>', '<', '>=', '<=')) {
            const operator = this.previous().value;
            const right = this.parsePrimary();
            return this.evaluateComparison(left, operator, right);
        }
        return Boolean(left); // Implicit truthiness
    }

    private parsePrimary(): any {
        if (this.match('STRING', 'NUMBER', 'BOOLEAN', 'NULL')) return this.previous().value;
        if (this.match('IDENTIFIER')) {
            return get(this.data, this.previous().value);
        }
        if (this.match('LPAREN')) {
            const expr = this.parseExpression();
            this.consume('RPAREN');
            return expr;
        }
        return null;
    }

    private match(...types: any[]): boolean {
        for (const type of types) {
            if (this.check(type)) {
                this.advance();
                return true;
            }
        }
        return false;
    }

    private check(type: string | TokenType): boolean {
        if (this.isAtEnd()) return false;
        // Check against either specific value (for operators) or global type
        const token = this.peek();
        return token.type === type || token.value === type;
    }

    private advance(): Token {
        if (!this.isAtEnd()) this.pos++;
        return this.previous();
    }

    private isAtEnd(): boolean { return this.pos >= this.tokens.length; }
    private peek(): Token { return this.tokens[this.pos]; }
    private previous(): Token { return this.tokens[this.pos - 1]; }
    private consume(type: TokenType) {
        if (this.check(type)) return this.advance();
        throw new Error(`Expected ${type}`);
    }

    private evaluateComparison(left: any, operator: string, right: any): boolean {
        switch (operator) {
            case '==': return left == right;
            case '===': return left === right;
            case '!=': return left != right;
            case '!==': return left !== right;
            case '>': return left > right;
            case '<': return left < right;
            case '>=': return left >= right;
            case '<=': return left <= right;
            default: return false;
        }
    }
}

/**
 * Extract entities from data using entity rules
 */
export function extractEntities(
    data: any,
    entityRules: EntityRule[],
    schema?: JobOutputSchema
): ExtractedEntity[] {
    const entities: ExtractedEntity[] = [];

    for (const rule of entityRules) {
        try {
            // Determine the data to iterate over
            let itemsToProcess: any[] = [];

            if (rule.rootPath) {
                // If rootPath is specified, extract the array from that path
                const rootData = get(data, rule.rootPath);
                if (Array.isArray(rootData)) {
                    itemsToProcess = rootData;
                } else if (rootData !== undefined && rootData !== null) {
                    // If rootPath exists but is not an array, treat as single item if user insisted
                    itemsToProcess = [rootData];
                }
            } else {
                // Default behavior: treat the entire data as the item (or array of items if root is array)
                itemsToProcess = Array.isArray(data) ? data : [data];
            }

            for (const item of itemsToProcess) {
                // Check condition if provided
                if (rule.condition) {
                    try {
                        const conditionResult = evaluateSimpleCondition(rule.condition, item);
                        if (!conditionResult) {
                            continue; // Skip if condition is false
                        }
                    } catch (e) {
                        console.warn(`[Knowledge Graph] Failed to evaluate condition for entity rule ${rule.label}: ${rule.condition}`, e);
                        continue;
                    }
                }

                const rawName = get(item, rule.mappings.name);
                if (!rawName) {
                    continue; // Skip if name is missing
                }

                if (typeof rawName === 'object') {
                    console.warn(`[Knowledge Graph] Skipping entity rule "${rule.label}": Mapped name is an object/array (${JSON.stringify(rawName).substring(0, 50)}...). Please ensure the mapping points to a string property.`);
                    continue;
                }

                const name = String(rawName);

                const externalId = rule.mappings.externalId
                    ? get(item, rule.mappings.externalId)
                    : undefined;

                // Extract data fields
                const entityData: Record<string, any> = {};
                if (rule.mappings.data) {
                    for (const [key, path] of Object.entries(rule.mappings.data)) {
                        const value = get(item, path);
                        if (value !== undefined && value !== null) {
                            entityData[key] = value;
                        }
                    }
                }

                // Extract temporal metadata
                const sourceCreatedAt = get(item, 'sourceCreatedAt') || get(item, 'created_at') || get(item, 'fields.created');
                const sourceUpdatedAt = get(item, 'sourceUpdatedAt') || get(item, 'updated_at') || get(item, 'fields.updated');

                entities.push({
                    entityType: rule.entityType,
                    label: rule.label,
                    name: String(name),
                    externalId: externalId ? String(externalId) : undefined,
                    data: entityData,
                    sourceCreatedAt: sourceCreatedAt ? String(sourceCreatedAt) : undefined,
                    sourceUpdatedAt: sourceUpdatedAt ? String(sourceUpdatedAt) : undefined,
                });
            }
        } catch (error) {
            console.error(`[Knowledge Graph] Error extracting entity with rule ${rule.entityType}:`, error);
        }
    }

    return entities;
}


