/**
 * Schema Inference Service
 * Generates JSON Schema from runtime data for mismatch detection.
 */

import { createLogger } from '@server/utils/logger.js';

const logger = createLogger('SchemaInferenceService');

export interface JSONSchema {
    type?: string | string[];
    properties?: Record<string, JSONSchema>;
    items?: JSONSchema;
    required?: string[];
    format?: string;
    enum?: any[];
    nullable?: boolean;
}

export class SchemaInferenceService {

    /**
     * Infer JSON Schema from a value
     */
    infer(data: any): JSONSchema {
        if (data === null) {
            return { type: 'null' };
        }

        if (Array.isArray(data)) {
            return this.inferArray(data);
        }

        if (typeof data === 'object') {
            return this.inferObject(data);
        }

        return this.inferPrimitive(data);
    }

    private inferPrimitive(data: any): JSONSchema {
        const type = typeof data;

        if (type === 'string') {
            // Basic format detection
            if (this.isIsoDate(data)) return { type: 'string', format: 'date-time' };
            if (this.isEmail(data)) return { type: 'string', format: 'email' };
            if (this.isUrl(data)) return { type: 'string', format: 'uri' };
            // Check if it looks like a number but is a string? Maybe not for now.
            return { type: 'string' };
        }

        if (type === 'number') {
            return { type: 'number' }; // Could differentiate integer/float
        }

        if (type === 'boolean') {
            return { type: 'boolean' };
        }

        return { type: 'string' }; // Fallback
    }

    private inferArray(data: any[]): JSONSchema {
        if (data.length === 0) {
            return { type: 'array', items: {} }; // Empty array, unknown items
        }

        // Heuristic: Infer schema from the first item. 
        // In a robust system, we might merge schemas from all items.
        const itemSchema = this.infer(data[0]);

        // Check if we have mixed types (e.g. nulls and objects)
        // For now, keep it simple.

        return {
            type: 'array',
            items: itemSchema,
        };
    }

    private inferObject(data: any): JSONSchema {
        // Handle Date objects (should have been strings by JSON.stringify usually, but runtime objects exist)
        if (data instanceof Date) {
            return { type: 'string', format: 'date-time' };
        }

        const properties: Record<string, JSONSchema> = {};
        const required: string[] = [];

        // Keys to ignore (internal metadata)
        const ignoredKeys = ['__metadata', 'formatted_prompt'];

        for (const [key, value] of Object.entries(data)) {
            if (ignoredKeys.includes(key)) continue;

            properties[key] = this.infer(value);

            // Assume all present keys are required for this instance
            required.push(key);
        }

        return {
            type: 'object',
            properties,
            required,
        };
    }

    private isIsoDate(str: string): boolean {
        if (!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(str)) return false;
        const d = new Date(str);
        return d.toString() !== 'Invalid Date' && !isNaN(d.getTime());
    }

    private isEmail(str: string): boolean {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
    }

    private isUrl(str: string): boolean {
        try {
            new URL(str);
            return true;
        } catch {
            return false;
        }
    }
}

export const schemaInferenceService = new SchemaInferenceService();


