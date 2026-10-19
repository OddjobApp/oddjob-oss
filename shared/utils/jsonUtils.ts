/**
 * JSON Validation, Schema, and Transformation Utilities
 * Shared utilities for validating, formatting, and manipulating JSON data
 */

export interface JsonValidationError {
    message: string;
    line?: number;
    column?: number;
    position?: number;
    context?: string;
}

export interface JsonValidationResult {
    isValid: boolean;
    error?: JsonValidationError;
    formatted?: string;
}

/**
 * Get context around an error position (for better error messages)
 */
export function getErrorContext(input: string, position: number, contextLength = 20): string {
    const start = Math.max(0, position - contextLength);
    const end = Math.min(input.length, position + contextLength);

    let context = '';
    if (start > 0) context += '...';
    context += input.slice(start, end);
    if (end < input.length) context += '...';

    return context;
}

/**
 * Parse position from JSON.parse error message
 * Different engines format this differently:
 * - V8: "at position 5"
 * - Firefox: "at line 1 column 6"
 */
function parseErrorPosition(message: string): { line?: number; column?: number; position?: number } {
    // Check for "at position X" (V8/Node)
    const posMatch = message.match(/at position (\d+)/i);
    if (posMatch) {
        return { position: parseInt(posMatch[1], 10) };
    }

    // Check for "at line X column Y" (Firefox)
    const lineColMatch = message.match(/at line (\d+) column (\d+)/i);
    if (lineColMatch) {
        return {
            line: parseInt(lineColMatch[1], 10),
            column: parseInt(lineColMatch[2], 10),
        };
    }

    // Check for "line X" anywhere in error
    const lineMatch = message.match(/line (\d+)/i);
    if (lineMatch) {
        return { line: parseInt(lineMatch[1], 10) };
    }

    return {};
}

/**
 * Convert position to line and column
 */
function positionToLineColumn(input: string, position: number): { line: number; column: number } {
    const lines = input.slice(0, position).split('\n');
    return {
        line: lines.length,
        column: (lines[lines.length - 1]?.length || 0) + 1,
    };
}

/**
 * Improve error message to be more user-friendly
 */
function improveErrorMessage(originalMessage: string, input: string, position?: number): string {
    // Common JSON error patterns and human-friendly replacements
    const errorPatterns: [RegExp, string][] = [
        [/Unexpected token '?(.)'? (?:in JSON )?at position/i, 'Unexpected character "$1" at'],
        [/Expected '(.*)' but found '(.*)'/i, 'Expected "$1" but found "$2"'],
        [/Unexpected end of JSON input/i, 'JSON is incomplete - missing closing bracket, brace, or quote'],
        [/Unterminated string/i, 'Missing closing quote for string'],
        [/Expected property name or '}'/i, 'Expected a property name or closing brace'],
        [/Expected ':' after property name/i, 'Missing colon after property name'],
        [/Expected ',' or '}'/i, 'Missing comma between properties or closing brace'],
        [/Expected ',' or ']'/i, 'Missing comma between array items or closing bracket'],
    ];

    let message = originalMessage;
    for (const [pattern, replacement] of errorPatterns) {
        if (pattern.test(message)) {
            message = message.replace(pattern, replacement);
            break;
        }
    }

    // Try to determine what's wrong at the specific position
    if (position !== undefined && position < input.length) {
        const char = input[position];
        const context = input.slice(Math.max(0, position - 10), position);

        // Detect specific issues
        if (char === '"' && context.includes('"') && !context.includes(':')) {
            message = 'Missing comma between properties';
        } else if (char === '{' && context.trim().endsWith('}')) {
            message = 'Missing comma before object';
        } else if (char === '[' && context.trim().endsWith(']')) {
            message = 'Missing comma before array';
        }
    }

    return message;
}

/**
 * Validate a JSON string and return detailed error information
 */
export function validateJson(input: string): JsonValidationResult {
    // Handle empty/whitespace-only input
    const trimmed = input.trim();
    if (!trimmed) {
        return {
            isValid: true,
            formatted: '',
        };
    }

    // Allow empty object/array
    if (trimmed === '{}' || trimmed === '[]') {
        return {
            isValid: true,
            formatted: trimmed,
        };
    }

    try {
        const parsed = JSON.parse(trimmed);
        const formatted = JSON.stringify(parsed, null, 2);

        return {
            isValid: true,
            formatted,
        };
    } catch (e) {
        const error = e as SyntaxError;
        const errorMessage = error.message || 'Invalid JSON';

        // Extract position information
        const { line, column, position: errPos } = parseErrorPosition(errorMessage);

        // Calculate line/column if we only have position
        let finalLine = line;
        let finalColumn = column;
        let position = errPos;

        if (position !== undefined && (!finalLine || !finalColumn)) {
            const lineCol = positionToLineColumn(trimmed, position);
            finalLine = lineCol.line;
            finalColumn = lineCol.column;
        }

        // If we have line/column but not position, calculate position
        if (finalLine && !position) {
            const lines = trimmed.split('\n');
            position = 0;
            for (let i = 0; i < finalLine - 1; i++) {
                position += (lines[i]?.length || 0) + 1; // +1 for newline
            }
            position += (finalColumn || 1) - 1;
        }

        // Get context around error
        const context = position !== undefined ? getErrorContext(trimmed, position) : undefined;

        // Improve error message
        const improvedMessage = improveErrorMessage(errorMessage, trimmed, position);

        return {
            isValid: false,
            error: {
                message: improvedMessage,
                line: finalLine,
                column: finalColumn,
                position,
                context,
            },
        };
    }
}

/**
 * Format JSON string with proper indentation
 * Returns null if input is invalid
 */
export function formatJson(input: string): string | null {
    const result = validateJson(input);
    return result.isValid ? (result.formatted ?? null) : null;
}

/**
 * Check if a string is valid JSON
 */
export function isValidJson(input: string): boolean {
    return validateJson(input).isValid;
}

/**
 * Try to fix common JSON errors
 * Returns the fixed JSON or null if unfixable
 */
export function tryFixJson(input: string): { fixed: string; changes: string[] } | null {
    const changes: string[] = [];
    let fixed = input.trim();

    if (!fixed) return null;

    // Try parsing first - if valid, no fixes needed
    try {
        JSON.parse(fixed);
        return { fixed, changes: [] };
    } catch {
        // Continue with fixes
    }

    // Fix 1: Add missing commas between properties (very common)
    // Pattern: "value" "key" -> "value", "key"
    const missingCommaPattern = /("[^"\\]*(?:\\.[^"\\]*)*")\s*("[^"\\]*(?:\\.[^"\\]*)*"\s*:)/g;
    if (missingCommaPattern.test(fixed)) {
        fixed = fixed.replace(missingCommaPattern, '$1, $2');
        changes.push('Added missing comma between properties');
    }

    // Fix 2: Remove trailing commas
    const trailingCommaPattern = /,(\s*[}\]])/g;
    if (trailingCommaPattern.test(fixed)) {
        fixed = fixed.replace(trailingCommaPattern, '$1');
        changes.push('Removed trailing comma');
    }

    // Fix 3: Add missing closing brackets/braces
    const openBraces = (fixed.match(/{/g) || []).length;
    const closeBraces = (fixed.match(/}/g) || []).length;
    const openBrackets = (fixed.match(/\[/g) || []).length;
    const closeBrackets = (fixed.match(/]/g) || []).length;

    if (openBraces > closeBraces) {
        fixed += '}'.repeat(openBraces - closeBraces);
        changes.push(`Added ${openBraces - closeBraces} missing closing brace(s)`);
    }
    if (openBrackets > closeBrackets) {
        fixed += ']'.repeat(openBrackets - closeBrackets);
        changes.push(`Added ${openBrackets - closeBrackets} missing closing bracket(s)`);
    }

    // Validate the result
    try {
        JSON.parse(fixed);
        return { fixed, changes };
    } catch {
        return null;
    }
}

// ============================================================================
// JSON SCHEMA VALIDATION UTILITIES
// ============================================================================

export interface JsonSchema {
    type?: string;
    properties?: Record<string, JsonSchema>;
    items?: JsonSchema;
    required?: string[];
    enum?: any[];
    minimum?: number;
    maximum?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    format?: string;
    [key: string]: any;
}

export interface SchemaValidationResult {
    isValid: boolean;
    errors: SchemaValidationError[];
}

export interface SchemaValidationError {
    path: string;
    message: string;
    value?: any;
    expected?: any;
}

/**
 * Validate JSON data against a schema
 */
export function validateJsonSchema(data: any, schema: JsonSchema): SchemaValidationResult {
    const errors: SchemaValidationError[] = [];

    function validateValue(value: any, schema: JsonSchema, path = ''): void {
        if (!schema) return;

        // Type validation
        if (schema.type) {
            const actualType = getJsonType(value);
            if (actualType !== schema.type) {
                if (!(schema.type === 'number' && actualType === 'integer')) {
                    errors.push({
                        path,
                        message: `Expected type '${schema.type}', got '${actualType}'`,
                        value,
                        expected: schema.type
                    });
                    return; // Don't continue validating if type is wrong
                }
            }
        }

        // Object validation
        if (schema.type === 'object' && value && typeof value === 'object') {
            // Required properties
            if (schema.required) {
                for (const required of schema.required) {
                    if (!(required in value)) {
                        errors.push({
                            path: path ? `${path}.${required}` : required,
                            message: `Missing required property '${required}'`,
                            value: undefined
                        });
                    }
                }
            }

            // Property validation
            if (schema.properties) {
                for (const [prop, propSchema] of Object.entries(schema.properties)) {
                    if (prop in value) {
                        validateValue(value[prop], propSchema, path ? `${path}.${prop}` : prop);
                    }
                }
            }
        }

        // Array validation
        if (schema.type === 'array' && Array.isArray(value)) {
            if (schema.items) {
                value.forEach((item, index) => {
                    validateValue(item, schema.items!, path ? `${path}[${index}]` : `[${index}]`);
                });
            }
        }

        // String validations
        if (schema.type === 'string' && typeof value === 'string') {
            if (schema.minLength !== undefined && value.length < schema.minLength) {
                errors.push({
                    path,
                    message: `String length ${value.length} is less than minimum ${schema.minLength}`,
                    value
                });
            }
            if (schema.maxLength !== undefined && value.length > schema.maxLength) {
                errors.push({
                    path,
                    message: `String length ${value.length} exceeds maximum ${schema.maxLength}`,
                    value
                });
            }
            if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
                errors.push({
                    path,
                    message: `String does not match required pattern`,
                    value
                });
            }
        }

        // Number validations
        if ((schema.type === 'number' || schema.type === 'integer') && typeof value === 'number') {
            if (schema.minimum !== undefined && value < schema.minimum) {
                errors.push({
                    path,
                    message: `Value ${value} is less than minimum ${schema.minimum}`,
                    value
                });
            }
            if (schema.maximum !== undefined && value > schema.maximum) {
                errors.push({
                    path,
                    message: `Value ${value} exceeds maximum ${schema.maximum}`,
                    value
                });
            }
        }

        // Enum validation
        if (schema.enum && !schema.enum.includes(value)) {
            errors.push({
                path,
                message: `Value must be one of: ${schema.enum.join(', ')}`,
                value,
                expected: schema.enum
            });
        }
    }

    validateValue(data, schema);
    return {
        isValid: errors.length === 0,
        errors
    };
}

/**
 * Get JSON type of a value
 */
function getJsonType(value: any): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'number' && Number.isInteger(value)) return 'integer';
    return typeof value;
}

/**
 * Infer a basic JSON schema from data
 */
export function inferJsonSchema(data: any): JsonSchema {
    if (data === null) return { type: 'null' };
    if (Array.isArray(data)) {
        const itemSchemas = data.map(inferJsonSchema);
        return {
            type: 'array',
            items: itemSchemas.length > 0 ? mergeSchemas(itemSchemas) : { type: 'string' }
        };
    }
    if (typeof data === 'object') {
        const properties: Record<string, JsonSchema> = {};
        const required: string[] = [];

        for (const [key, value] of Object.entries(data)) {
            properties[key] = inferJsonSchema(value);
            required.push(key);
        }

        return {
            type: 'object',
            properties,
            required
        };
    }

    return { type: typeof data };
}

/**
 * Merge multiple schemas into one (for array items)
 */
function mergeSchemas(schemas: JsonSchema[]): JsonSchema {
    if (schemas.length === 0) return { type: 'string' };
    if (schemas.length === 1) return schemas[0];

    const types = new Set(schemas.map(s => s.type));
    if (types.size === 1) return schemas[0];

    return { type: 'string' }; // Fallback for mixed types
}

// ============================================================================
// JSON TRANSFORMATION UTILITIES
// ============================================================================

/**
 * Transform JSON using a mapping specification
 */
export function transformJson(data: any, mapping: Record<string, any>): any {
    if (typeof mapping === 'string') {
        return getNestedValue(data, mapping);
    }

    if (Array.isArray(mapping)) {
        return mapping.map(item => transformJson(data, item));
    }

    if (typeof mapping === 'object') {
        const result: any = {};
        for (const [key, value] of Object.entries(mapping)) {
            result[key] = transformJson(data, value);
        }
        return result;
    }

    return mapping;
}

/**
 * Get nested value from object using dot notation or array access
 */
function getNestedValue(obj: any, path: string): any {
    return path.split(/\.|\[|\]/).filter(Boolean).reduce((current, key) => {
        if (current && typeof current === 'object') {
            if (Array.isArray(current) && /^\d+$/.test(key)) {
                return current[parseInt(key)];
            }
            return current[key];
        }
        return undefined;
    }, obj);
}

/**
 * Flatten nested JSON object to dot notation
 */
export function flattenJson(obj: any, prefix = ''): Record<string, any> {
    const result: Record<string, any> = {};

    for (const [key, value] of Object.entries(obj)) {
        const newKey = prefix ? `${prefix}.${key}` : key;

        if (value && typeof value === 'object' && !Array.isArray(value)) {
            Object.assign(result, flattenJson(value, newKey));
        } else {
            result[newKey] = value;
        }
    }

    return result;
}

/**
 * Unflatten dot notation object back to nested structure
 */
export function unflattenJson(obj: Record<string, any>): any {
    const result: any = {};

    for (const [key, value] of Object.entries(obj)) {
        const keys = key.split('.');
        let current = result;

        for (let i = 0; i < keys.length - 1; i++) {
            const k = keys[i];
            if (!(k in current)) current[k] = {};
            current = current[k];
        }

        current[keys[keys.length - 1]] = value;
    }

    return result;
}

// ============================================================================
// JSON COMPARISON UTILITIES
// ============================================================================

export interface JsonDiff {
    type: 'added' | 'removed' | 'modified' | 'unchanged';
    path: string;
    oldValue?: any;
    newValue?: any;
}

/**
 * Compare two JSON objects and return differences
 */
export function compareJson(oldObj: any, newObj: any, path = ''): JsonDiff[] {
    const diffs: JsonDiff[] = [];

    function compareValues(oldVal: any, newVal: any, currentPath: string): void {
        if (oldVal === newVal) {
            diffs.push({ type: 'unchanged', path: currentPath, oldValue: oldVal, newValue: newVal });
            return;
        }

        if (oldVal === undefined) {
            diffs.push({ type: 'added', path: currentPath, newValue: newVal });
            return;
        }

        if (newVal === undefined) {
            diffs.push({ type: 'removed', path: currentPath, oldValue: oldVal });
            return;
        }

        if (typeof oldVal !== typeof newVal) {
            diffs.push({ type: 'modified', path: currentPath, oldValue: oldVal, newValue: newVal });
            return;
        }

        if (Array.isArray(oldVal) && Array.isArray(newVal)) {
            // Simple array comparison - could be enhanced
            if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
                diffs.push({ type: 'modified', path: currentPath, oldValue: oldVal, newValue: newVal });
            }
        } else if (typeof oldVal === 'object' && typeof newVal === 'object') {
            // Compare objects
            const allKeys = new Set([...Object.keys(oldVal), ...Object.keys(newVal)]);

            for (const key of allKeys) {
                const newPath = currentPath ? `${currentPath}.${key}` : key;
                compareValues(oldVal[key], newVal[key], newPath);
            }
        } else {
            diffs.push({ type: 'modified', path: currentPath, oldValue: oldVal, newValue: newVal });
        }
    }

    compareValues(oldObj, newObj, path);
    return diffs;
}

/**
 * Filter diffs to only show changes (exclude unchanged)
 */
export function getJsonChanges(diffs: JsonDiff[]): JsonDiff[] {
    return diffs.filter(diff => diff.type !== 'unchanged');
}
