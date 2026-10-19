/**
 * Schema Comparison Service
 * Detects breaking changes and schema drifts between executions.
 */

import { JSONSchema } from "@domain/knowledge/core/schema-inference.service.js";
import { createLogger } from '@server/utils/logger.js';

const logger = createLogger('SchemaComparisonService');

export interface SchemaDiff {
    hasChanges: boolean;
    breakingChanges: SchemaChange[];
    nonBreakingChanges: SchemaChange[];
}

export interface SchemaChange {
    type: 'FIELD_ADDED' | 'FIELD_REMOVED' | 'TYPE_CHANGED' | 'NULLABILITY_CHANGED';
    path: string; // "users.0.email"
    oldValue?: string;
    newValue?: string;
    description: string;
}

export class SchemaComparisonService {

    /**
     * Compare two schemas to find differences
     * @param oldSchema The "known good" or previous schema
     * @param newSchema The current execution schema
     */
    compare(oldSchema: JSONSchema, newSchema: JSONSchema): SchemaDiff {
        const changes: SchemaChange[] = [];

        this.diffRecursive(oldSchema, newSchema, '', changes);

        const breakingChanges = changes.filter(c =>
            c.type === 'FIELD_REMOVED' ||
            c.type === 'TYPE_CHANGED' ||
            (c.type === 'NULLABILITY_CHANGED' && c.newValue === 'nullable')
        );

        const nonBreakingChanges = changes.filter(c => !breakingChanges.includes(c));

        return {
            hasChanges: changes.length > 0,
            breakingChanges,
            nonBreakingChanges
        };
    }

    private diffRecursive(
        oldNode: JSONSchema,
        newNode: JSONSchema,
        path: string,
        changes: SchemaChange[]
    ) {
        // 1. Check Type Change
        if (oldNode.type !== newNode.type) {
            // Allow numeric drift? (integer -> number)? For now strict.
            // Special case: null vs nullable
            if (oldNode.type !== 'null' && newNode.type === 'null') {
                // Became null, technically strict type change if not union
                changes.push({
                    type: 'TYPE_CHANGED',
                    path,
                    oldValue: String(oldNode.type),
                    newValue: 'null',
                    description: `Type changed from ${oldNode.type} to null`
                });
                return;
            } else if (JSON.stringify(oldNode.type) !== JSON.stringify(newNode.type)) {
                changes.push({
                    type: 'TYPE_CHANGED',
                    path,
                    oldValue: String(oldNode.type),
                    newValue: String(newNode.type),
                    description: `Type changed from ${oldNode.type} to ${newNode.type}`
                });
                return; // Stop recurring if type completely changed
            }
        }

        // 2. Structs (Objects)
        if (oldNode.type === 'object' && oldNode.properties && newNode.properties) {
            const oldKeys = Object.keys(oldNode.properties);
            const newKeys = Object.keys(newNode.properties);

            // Check for removed fields (Breaking)
            for (const key of oldKeys) {
                if (!newKeys.includes(key)) {
                    changes.push({
                        type: 'FIELD_REMOVED',
                        path: path ? `${path}.${key}` : key,
                        description: `Required field '${key}' is missing`
                    });
                } else {
                    // Recurse
                    this.diffRecursive(
                        oldNode.properties[key],
                        newNode.properties[key],
                        path ? `${path}.${key}` : key,
                        changes
                    );
                }
            }

            // Check for added fields (Non-breaking usually)
            for (const key of newKeys) {
                if (!oldKeys.includes(key)) {
                    changes.push({
                        type: 'FIELD_ADDED',
                        path: path ? `${path}.${key}` : key,
                        description: `New field '${key}' detected`
                    });
                }
            }
        }

        // 3. Arrays
        if (oldNode.type === 'array' && oldNode.items && newNode.items) {
            // Compare item schemas
            this.diffRecursive(
                oldNode.items,
                newNode.items,
                path ? `${path}[]` : '[]',
                changes
            );
        }
    }
}

export const schemaComparisonService = new SchemaComparisonService();


