import { jobConfigSchema } from "@shared/schema/index.js";
import { ZodError } from "zod";

export class ConfigValidationService {
    validate(type: string, config: any): {
        valid: boolean;
        errors: string[];
        suggestions: string[];
    } {
        // Prepare the payload the way jobConfigSchema expects it
        const payload = { type, config };
        const result = jobConfigSchema.safeParse(payload);

        if (result.success) {
            return { valid: true, errors: [], suggestions: [] };
        }

        const errors = result.error.errors.map(err => {
            const path = err.path.join('.') || 'config';
            return `${path}: ${err.message}`;
        });

        const suggestions = this.generateSuggestions(result.error);

        return { valid: false, errors, suggestions };
    }

    private generateSuggestions(error: ZodError): string[] {
        const suggestions: string[] = [];

        for (const err of error.errors) {
            if (err.code === 'invalid_type' && err.received === 'undefined') {
                const path = err.path[err.path.length - 1];
                suggestions.push(`Add missing required field: ${path}`);
            } else if (err.code === 'invalid_type') {
                suggestions.push(`Change field type to ${err.expected} (received ${err.received})`);
            } else if (err.code === 'invalid_enum_value') {
                suggestions.push(`Use one of: ${err.options.join(', ')}`);
            }
        }

        return suggestions;
    }
}

export const configValidationService = new ConfigValidationService();
