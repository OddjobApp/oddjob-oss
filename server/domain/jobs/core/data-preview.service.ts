/**
 * Data Preview Service
 * Dataset preview and validation before processing
 */

import { db } from "@server/database_service.js";
import { datasets, datasetItems } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("DataPreviewService");

interface ValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
    stats: {
        totalRows: number;
        validRows: number;
        invalidRows: number;
        missingFields: string[];
    };
}

interface PreviewResult {
    rows: any[];
    columns: string[];
    totalCount: number;
    truncated: boolean;
    sampleSize: number;
    schema: any;
}

export const dataPreviewService = {
    /**
     * Get preview of dataset rows
     */
    async previewDataset(datasetId: number, options?: {
        limit?: number;
        offset?: number;
    }): Promise<PreviewResult> {
        const { limit = 10, offset = 0 } = options || {};
        
        // Get dataset metadata
        const [dataset] = await db
            .select()
            .from(datasets)
            .where(eq(datasets.id, datasetId))
            .limit(1);
        
        if (!dataset) {
            throw new Error("Dataset not found");
        }
        
        // Get sample rows
        const rows = await db
            .select()
            .from(datasetItems)
            .where(eq(datasetItems.datasetId, datasetId))
            .limit(limit)
            .offset(offset);
        
        // Extract columns from first row
        let columns: string[] = [];
        if (rows.length > 0) {
            const firstRow = rows[0].data as any;
            columns = Object.keys(firstRow);
        } else if (dataset.schemaMapping) {
            const schema = typeof dataset.schemaMapping === "string"
                ? JSON.parse(dataset.schemaMapping)
                : dataset.schemaMapping;
            columns = Object.keys(schema.properties || {});
        }
        
        // Get total count (simplified)
        const [countResult] = await db
            .select({ count: datasetItems.id })
            .from(datasetItems)
            .where(eq(datasetItems.datasetId, datasetId));
        
        return {
            rows: rows.map(r => r.data),
            columns,
            totalCount: countResult ? rows.length : 0, // Would need actual count query
            truncated: rows.length === limit,
            sampleSize: rows.length,
            schema: dataset.schemaMapping,
        };
    },
    
    /**
     * Validate dataset against schema
     */
    async validateDataset(datasetId: number): Promise<ValidationResult> {
        const [dataset] = await db
            .select()
            .from(datasets)
            .where(eq(datasets.id, datasetId))
            .limit(1);
        
        if (!dataset) {
            return {
                isValid: false,
                errors: ["Dataset not found"],
                warnings: [],
                stats: { totalRows: 0, validRows: 0, invalidRows: 0, missingFields: [] },
            };
        }
        
        const schema = typeof dataset.schemaMapping === "string"
            ? JSON.parse(dataset.schemaMapping)
            : dataset.schemaMapping;
        
        if (!schema || !schema.properties) {
            return {
                isValid: true,
                errors: [],
                warnings: ["No schema defined for validation"],
                stats: { totalRows: 0, validRows: 0, invalidRows: 0, missingFields: [] },
            };
        }
        
        // Get all items for validation (limited to first 100 for performance)
        const items = await db
            .select()
            .from(datasetItems)
            .where(eq(datasetItems.datasetId, datasetId))
            .limit(100);
        
        const errors: string[] = [];
        const warnings: string[] = [];
        let validRows = 0;
        let invalidRows = 0;
        const requiredFields = schema.required || [];
        const missingFields = new Set<string>();
        
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const data = item.data as any;
            let rowValid = true;
            
            // Check required fields
            for (const field of requiredFields) {
                if (data[field] === undefined || data[field] === null || data[field] === "") {
                    rowValid = false;
                    missingFields.add(field);
                    if (errors.length < 10) {
                        errors.push(`Row ${i + 1}: Missing required field "${field}"`);
                    }
                }
            }
            
            // Check field types
            if (schema.properties) {
                for (const [field, fieldSchema] of Object.entries(schema.properties)) {
                    const value = data[field];
                    const fSchema = fieldSchema as any;
                    
                    if (value !== undefined && value !== null) {
                        if (fSchema.type === "number" && typeof value !== "number") {
                            rowValid = false;
                            if (errors.length < 10) {
                                errors.push(`Row ${i + 1}: Field "${field}" should be a number`);
                            }
                        }
                        if (fSchema.type === "string" && typeof value !== "string") {
                            rowValid = false;
                            if (errors.length < 10) {
                                errors.push(`Row ${i + 1}: Field "${field}" should be a string`);
                            }
                        }
                    }
                }
            }
            
            if (rowValid) {
                validRows++;
            } else {
                invalidRows++;
            }
        }
        
        return {
            isValid: errors.length === 0,
            errors,
            warnings,
            stats: {
                totalRows: items.length,
                validRows,
                invalidRows,
                missingFields: Array.from(missingFields),
            },
        };
    },
    
    /**
     * Preview job output based on input dataset
     */
    async previewJobOutput(jobId: number, datasetId: number): Promise<{
        inputPreview: PreviewResult;
        outputSchema: any;
        transformations: string[];
    }> {
        const inputPreview = await this.previewDataset(datasetId);
        
        // Get job configuration
        const { jobs } = await import("@shared/schema/index.js");
        const [job] = await db
            .select()
            .from(jobs)
            .where(eq(jobs.id, jobId))
            .limit(1);
        
        const transformations: string[] = [];
        let outputSchema: any = {};
        
        if (job) {
            const config = typeof job.config === "string"
                ? JSON.parse(job.config)
                : job.config;
            
            // Infer transformations from job config
            if (config.mappings) {
                transformations.push(`Field mapping: ${Object.keys(config.mappings).length} fields`);
            }
            if (config.filters) {
                transformations.push(`Filtering: ${config.filters.length} conditions`);
            }
            if (config.enrichments) {
                transformations.push(`Enrichment: ${config.enrichments.length} fields`);
            }
            
            // Build output schema
            outputSchema = this.inferOutputSchema(inputPreview.schema, config);
        }
        
        return {
            inputPreview,
            outputSchema,
            transformations,
        };
    },
    
    /**
     * Infer output schema from input and transformations
     */
    inferOutputSchema(inputSchema: any, config: any): any {
        if (!inputSchema || !inputSchema.properties) {
            return { type: "object", properties: {} };
        }
        
        const outputProperties: any = {};
        
        // Copy mapped fields
        if (config.mappings) {
            for (const [outputField, inputField] of Object.entries(config.mappings)) {
                if (inputSchema.properties[inputField as string]) {
                    outputProperties[outputField] = inputSchema.properties[inputField as string];
                }
            }
        }
        
        // Add enriched fields
        if (config.enrichments) {
            for (const enrichment of config.enrichments) {
                outputProperties[enrichment.outputField] = {
                    type: enrichment.outputType || "string",
                    description: `Enriched from ${enrichment.source}`,
                };
            }
        }
        
        return {
            type: "object",
            properties: outputProperties,
            required: config.requiredOutputFields || Object.keys(outputProperties),
        };
    },
    
    /**
     * Get data statistics for a dataset
     */
    async getDatasetStats(datasetId: number): Promise<any> {
        const [dataset] = await db
            .select()
            .from(datasets)
            .where(eq(datasets.id, datasetId))
            .limit(1);
        
        if (!dataset) {
            throw new Error("Dataset not found");
        }
        
        // Get sample for statistics
        const items = await db
            .select()
            .from(datasetItems)
            .where(eq(datasetItems.datasetId, datasetId))
            .limit(100);
        
        const fieldStats: Record<string, { type: string; nullCount: number; uniqueValues: Set<any> }> = {};
        
        for (const item of items) {
            const data = item.data as any;
            for (const [field, value] of Object.entries(data)) {
                if (!fieldStats[field]) {
                    fieldStats[field] = {
                        type: typeof value,
                        nullCount: 0,
                        uniqueValues: new Set(),
                    };
                }
                
                if (value === null || value === undefined || value === "") {
                    fieldStats[field].nullCount++;
                }
                fieldStats[field].uniqueValues.add(value);
            }
        }
        
        return {
            totalRows: items.length,
            fieldCount: Object.keys(fieldStats).length,
            fields: Object.entries(fieldStats).map(([name, stats]) => ({
                name,
                type: stats.type,
                nullRate: Math.round((stats.nullCount / items.length) * 100),
                uniqueCount: stats.uniqueValues.size,
                isUnique: stats.uniqueValues.size === items.length,
            })),
        };
    },
};
