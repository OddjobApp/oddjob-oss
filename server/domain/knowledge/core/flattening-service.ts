/**
 * Flattening Service
 * 
 * Smart JSON flattening for dataset storage.
 * Converts nested objects to dot-notation columns for effective data analysis.
 */

import { createLogger } from '../../../utils/logger.js';

const logger = createLogger('FlatteningService');

/**
 * Schema mapping configuration for user-guided field selection
 */
export interface SchemaMapping {
    /** Fields to include (dot-notation paths). If empty, auto-flatten all. */
    includedFields?: string[];
    /** Fields to explicitly exclude */
    excludedFields?: string[];
    /** Column renames: { "original.path": "newColumnName" } */
    columnRenames?: Record<string, string>;
    /** Maximum nesting depth (default: 3) */
    maxDepth?: number;
    columns?: SchemaColumn[];
    /** Whether to store array counts */
    storeArrayCounts?: boolean;
    /** Data hygiene configuration */
    hygiene?: DataHygiene;
}

/**
 * Data Hygiene Configuration
 */
export interface DataHygiene {
    deduplication?: {
        enabled: boolean;
        /** Columns to check for duplicates. If empty, uses all columns. */
        keyColumns?: string[];
        /** Which record to keep when duplicates are found within the batch */
        strategy: 'keepFirst' | 'keepLast';
        /** Scope of deduplication. 'local' = only current batch; 'global' = check against storage */
        scope?: 'local' | 'global';
        /** If global scope is used, what to do on conflict */
        globalConflictResolution?: 'skip' | 'update';
    };
    nullHandling?: {
        /** 
         * keep: Leave as null
         * drop: Remove the entire row
         * fill: Replace with fillValue
         */
        strategy: 'keep' | 'drop' | 'fill';
        fillValue?: string;
    };
    validation?: {
        dropInvalidTypes: boolean;
    };
}

/**
 * Column definition with type and transformation
 */
export interface SchemaColumn {
    jsonPath: string;
    datasetKey: string;
    type: 'text' | 'number' | 'boolean' | 'date' | 'json';
    transform?: 'uppercase' | 'lowercase' | 'trim' | 'regex' | 'none';
}

/**
 * Flattening options
 */
export interface FlattenOptions {
    /** Maximum depth to flatten (default: 3) */
    maxDepth?: number;
    /** Prefix for keys (used internally for recursion) */
    prefix?: string;
    /** Current depth (used internally for recursion) */
    currentDepth?: number;
    /** Fields to skip (patterns) */
    skipFields?: string[];
    /** Whether to store array counts as separate columns */
    storeArrayCounts?: boolean;
}

/** Default fields to skip during flattening */
const DEFAULT_SKIP_FIELDS = [
    '_links',
    'self',
    'expand',
    '__metadata',
    '_raw',
    'formatted_prompt',
];

/**
 * Flatten a nested JSON object into dot-notation columns
 */
export function flattenObject(
    data: any,
    options: FlattenOptions = {}
): Record<string, any> {
    const {
        maxDepth = 3,
        prefix = '',
        currentDepth = 0,
        skipFields = DEFAULT_SKIP_FIELDS,
        storeArrayCounts = true,
    } = options;

    const result: Record<string, any> = {};

    if (data === null || data === undefined) {
        return result;
    }

    // Handle primitives at root level
    if (typeof data !== 'object') {
        return { [prefix || 'value']: data };
    }

    // Handle arrays
    if (Array.isArray(data)) {
        const key = prefix || 'items';

        if (storeArrayCounts) {
            result[`${key}_count`] = data.length;
        }

        if (data.length === 0) {
            result[key] = '[]';
        } else if (typeof data[0] !== 'object') {
            // Array of primitives - store as JSON string
            result[key] = JSON.stringify(data);
        } else if (currentDepth < maxDepth) {
            // Array of objects - flatten first item as sample, store full array as JSON
            const sampleFlattened = flattenObject(data[0], {
                ...options,
                prefix: `${key}[]`,
                currentDepth: currentDepth + 1,
            });

            // Merge sample structure (shows available fields in schema)
            Object.assign(result, sampleFlattened);

            // Also store the full array as JSON for complete data
            result[`${key}_json`] = JSON.stringify(data);
        } else {
            // Max depth reached - serialize
            result[key] = JSON.stringify(data);
        }

        return result;
    }

    // Handle objects
    for (const [key, value] of Object.entries(data)) {
        // Skip metadata fields
        if (skipFields.some(skip => key === skip || key.startsWith(`${skip}.`))) {
            continue;
        }

        const fullKey = prefix ? `${prefix}.${key}` : key;

        if (value === null || value === undefined) {
            result[fullKey] = null;
        } else if (typeof value !== 'object') {
            // Primitive value
            result[fullKey] = value;
        } else if (Array.isArray(value)) {
            // Nested array
            const nested = flattenObject(value, {
                ...options,
                prefix: fullKey,
                currentDepth: currentDepth + 1,
            });
            Object.assign(result, nested);
        } else if (currentDepth < maxDepth) {
            // Nested object - recurse
            const nested = flattenObject(value, {
                ...options,
                prefix: fullKey,
                currentDepth: currentDepth + 1,
            });
            Object.assign(result, nested);
        } else {
            // Max depth reached - serialize as JSON
            result[fullKey] = JSON.stringify(value);
        }
    }

    return result;
}

/**
 * Apply schema mapping to select/rename fields
 */
export function applySchemaMapping(
    flattened: Record<string, any>,
    mapping?: SchemaMapping | null
): Record<string, any> {
    if (!mapping) {
        return flattened;
    }

    let result: Record<string, any> = {};

    // If columns definition is present (new style), use it
    if (mapping.columns && mapping.columns.length > 0) {
        // Only keep fields defined in columns
        const newResult: Record<string, any> = {};

        for (const col of mapping.columns) {
            if (col.jsonPath in flattened) {
                let value = flattened[col.jsonPath];

                // 1. Type Coercion
                if (col.type) {
                    value = coerceValue(value, col.type);
                }

                // 2. Transformation
                if (col.transform) {
                    value = applyTransform(value, col.transform);
                }

                // 3. Rename (use datasetKey)
                newResult[col.datasetKey] = value;
            }
        }

        return newResult;
    }

    // Legacy behavior (includedFields, excludedFields, columnRenames)

    // If specific fields are included, only keep those
    if (mapping.includedFields && mapping.includedFields.length > 0) {
        for (const field of mapping.includedFields) {
            if (field in flattened) {
                result[field] = flattened[field];
            }
        }
    } else {
        // Start with all fields
        result = { ...flattened };
    }

    // Remove excluded fields
    if (mapping.excludedFields) {
        for (const field of mapping.excludedFields) {
            delete result[field];
        }
    }

    // Apply renames
    if (mapping.columnRenames) {
        for (const [original, renamed] of Object.entries(mapping.columnRenames)) {
            if (original in result) {
                result[renamed] = result[original];
                delete result[original];
            }
        }
    }

    return result;
}

/**
 * Main entry point: Flatten data for dataset storage
 * 
 * @param data - Raw JSON data from job output
 * @param schemaMapping - Optional user-defined field mapping
 * @returns Flattened object ready for dataset storage
 */
export function flattenForDataset(
    data: any,
    schemaMapping?: SchemaMapping | null
): { raw: any; flattened: Record<string, any> } {
    // Always preserve raw data
    const raw = data;

    // Flatten with configured depth
    const maxDepth = schemaMapping?.maxDepth ?? 3;
    const storeArrayCounts = schemaMapping?.storeArrayCounts ?? true;

    let flattened: Record<string, any>;

    // NEW FLOW: If strict columns are defined, we extract directly from RAW data
    // This allows selecting intermediate objects as JSON blobs even if they would normally be flattened
    if (schemaMapping?.columns && schemaMapping.columns.length > 0) {
        flattened = extractFields(data, schemaMapping.columns);
    } else if (schemaMapping === null) {
        // IDENTITY MAPPING: If schemaMapping is explicitly null, we store the object exactly as is
        // This is useful for storing raw JSON without enforcing a schema or flattening
        flattened = data;
    } else {
        // LEGACY FLOW: Flatten everything first, then filter/rename
        flattened = flattenObject(data, {
            maxDepth,
            storeArrayCounts,
        });
        // Apply user mappings if configured (renames, etc.)
        flattened = applySchemaMapping(flattened, schemaMapping);
    }

    // Note: Hygiene is applied at batch level usually, but we can apply per-row logic here if needed.
    // However, deduplication needs context. Null handling can be done here but let's keep it consistent
    // and assume the caller (knowledge-store) might batch process hygiene or we handle the single row case here?
    // Actually, flattenForDataset is single row. Knowledge Store handles batch.
    // So we just return the 'normalized' row here.

    // Debug log the flattening result
    logger.info(`[FlattenForDataset] Input keys: ${Object.keys(data || {}).join(', ')}`);
    logger.info(`[FlattenForDataset] Output keys: ${Object.keys(flattened).join(', ')}`);

    return { raw, flattened };
}

/**
 * Extract fields directly from raw data based on column definitions
 * This replaces flattenObject + applySchemaMapping for defined schemas
 */
export function extractFields(data: any, columns: SchemaColumn[]): Record<string, any> {
    const result: Record<string, any> = {};

    for (const col of columns) {
        // 1. Extract raw value (safe deep get)
        let value = getNestedValue(data, col.jsonPath);

        // 2. Type Coercion
        if (col.type) {
            value = coerceValue(value, col.type);
        }

        // 3. Transformation
        if (col.transform) {
            value = applyTransform(value, col.transform);
        }

        // 4. Store (using datasetKey as alias)
        result[col.datasetKey] = value;
    }

    return result;
}

/**
 * Safe deep property access (like lodash.get)
 */
function getNestedValue(obj: any, path: string): any {
    if (obj === null || obj === undefined) return undefined;
    if (!path) return obj;

    const keys = path.split('.');
    let current = obj;

    for (const key of keys) {
        if (current === null || current === undefined) return undefined;
        // Handle array syntax like items[0] if needed, but for now assuming simple dot notation or keys
        // Simple array index support: "items.0" works automatically in JS if current is generic object/array
        current = current[key];
    }

    return current;
}

/**
 * Batch process hygiene rules (Deduplication, Null Handling)
 */
export interface HygieneResult {
    rows: Record<string, any>[];
    stats: {
        inputCount: number;
        outputCount: number;
        deduplicatedCount: number;
        nullDroppedCount: number;
        validationDroppedCount: number;
    };
}

/**
 * Batch process hygiene rules (Deduplication, Null Handling)
 */
export function applyHygiene(rows: Record<string, any>[], hygiene?: DataHygiene): HygieneResult {
    const stats = {
        inputCount: rows.length,
        outputCount: 0,
        deduplicatedCount: 0,
        nullDroppedCount: 0,
        validationDroppedCount: 0,
    };

    if (!hygiene) {
        stats.outputCount = rows.length;
        return { rows, stats };
    }

    let processed = [...rows]; // strict copy

    // 1. Validation (Drop Invalid Types - placeholder for now as logic is upstream or handled here if we check types again)
    // Currently type coercion happens during extraction. 
    // If we wanted to check 'validity' here, we would need the schema again. 
    // For now, validationDroppedCount stays 0 unless we add explicit checks.

    // 2. Null Handling
    if (hygiene.nullHandling) {
        const { strategy, fillValue } = hygiene.nullHandling;

        if (strategy === 'drop') {
            const initialCount = processed.length;
            processed = processed.filter(row => {
                return Object.values(row).every(val => val !== null && val !== undefined);
            });
            stats.nullDroppedCount = initialCount - processed.length;
        } else if (strategy === 'fill') {
            processed = processed.map(row => {
                const newRow = { ...row };
                for (const key in newRow) {
                    if (newRow[key] === null || newRow[key] === undefined) {
                        newRow[key] = fillValue || '';
                    }
                }
                return newRow;
            });
        }
    }

    // 3. Deduplication
    if (hygiene.deduplication && hygiene.deduplication.enabled) {
        const { strategy, keyColumns } = hygiene.deduplication;
        const seen = new Set<string>();
        const uniqueRows: Record<string, any>[] = [];
        const initialCount = processed.length;

        // If strategy is keepLast, we reverse, dedupe, then reverse back
        const rowsToIterate = strategy === 'keepLast' ? [...processed].reverse() : processed;

        for (const row of rowsToIterate) {
            // Generate fingerprint
            let keyParts: string[] = [];
            if (keyColumns && keyColumns.length > 0) {
                keyParts = keyColumns.map(k => String(row[k]));
            } else {
                keyParts = Object.keys(row).sort().map(k => String(row[k]));
            }
            const fingerprint = keyParts.join('||');

            if (!seen.has(fingerprint)) {
                seen.add(fingerprint);
                uniqueRows.push(row);
            }
        }

        processed = strategy === 'keepLast' ? uniqueRows.reverse() : uniqueRows;
        stats.deduplicatedCount = initialCount - processed.length;
    }

    stats.outputCount = processed.length;
    return { rows: processed, stats };
}

/**
 * Get available flattened field names from a sample object
 * Used by the UI for field selection
 */
export function getAvailableFields(sampleData: any): string[] {
    const flattened = flattenObject(sampleData, { maxDepth: 4 });
    return Object.keys(flattened).sort();
}

/**
 * Get fields with inferred types from sample data
 */
export function getFieldsWithTypes(sampleData: any): Record<string, string> {
    const flattened = flattenObject(sampleData, { maxDepth: 4 });
    const types: Record<string, string> = {};

    for (const [key, value] of Object.entries(flattened)) {
        types[key] = inferType(value);
    }

    return types;
}

/**
 * Infer data type from a value
 */
export function inferType(value: any): string {
    if (value === null || value === undefined) return 'text';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') return 'number';
    if (value instanceof Date) return 'date';

    if (typeof value === 'string') {
        // Check for ISO date
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) return 'date';
        // Check for numeric string (but not if it's empty or whitespace)
        if (value.trim() !== '' && !isNaN(Number(value))) return 'number';
    }

    if (typeof value === 'object') return 'json';

    return 'text';
}

/**
 * Coerce a value to a specific type
 */
export function coerceValue(value: any, type: string): any {
    if (value === null || value === undefined) return null;

    switch (type) {
        case 'text':
            return typeof value === 'object' ? JSON.stringify(value) : String(value);

        case 'number':
            if (typeof value === 'number') return value;
            const num = Number(value);
            return isNaN(num) ? null : num;

        case 'boolean':
            if (typeof value === 'boolean') return value;
            const strVal = String(value).toLowerCase();
            return strVal === 'true' || strVal === '1' || strVal === 'yes';

        case 'date':
            if (value instanceof Date) return value.toISOString();
            const date = new Date(value);
            return isNaN(date.getTime()) ? null : date.toISOString();

        case 'json':
            return value;

        default:
            return value;
    }
}

/**
 * Apply transformation to a value
 */
export function applyTransform(value: any, transform?: string): any {
    if (!transform || transform === 'none' || value === null || value === undefined) return value;

    const strValue = String(value);

    switch (transform) {
        case 'uppercase':
            return strValue.toUpperCase();
        case 'lowercase':
            return strValue.toLowerCase();
        case 'trim':
            return strValue.trim();
        default:
            return value;
    }
}

export const flatteningService = {
    flattenObject,
    applySchemaMapping,
    flattenForDataset,
    getAvailableFields,
    getFieldsWithTypes,
    inferType,
    coerceValue,
    applyTransform,
    extractFields,
    applyHygiene,
};


