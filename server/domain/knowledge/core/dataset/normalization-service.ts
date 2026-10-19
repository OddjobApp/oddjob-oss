import { db } from "../../../../database_service.js";
import { datasetItems } from "@shared/schema/index.js";
import { createLogger } from "../../../../utils/logger.js";
import { withQueryTracking } from "@domain/knowledge/core/query-monitor.service.js";
import type { OrgContext } from "../../../../domain/jobs/job.service.js";
import { BadRequestError } from "@server/utils/errors.js";
import { coreService } from "./core-service.js";
import { itemService } from "./item-service.js";
import type { AddItemInput } from "./types.js";
import { storageService } from "../storage-service.js";

const logger = createLogger("DatasetNormalizationService");

export const normalizationService = {
    /**
     * Normalize dataset items (re-flatten with a new schema mapping)
     */
    async normalizeDataset(
        datasetId: number,
        columns: Array<{ source: string; target: string }>,
        orgContext: OrgContext
    ): Promise<{ count: number }> {
        return withQueryTracking("datasetService.normalizeDataset", async () => {
            // Verify access
            await coreService.getById(datasetId, orgContext);

            const { flattenForDataset } = await import("../flattening-service.js");

            // Construct Schema Mapping
            const schemaMapping = {
                includedFields: columns.map(c => c.source),
                columnRenames: columns.reduce((acc, c) => {
                    if (c.source !== c.target) {
                        acc[c.source] = c.target;
                    }
                    return acc;
                }, {} as Record<string, string>)
            };

            // Update dataset schema mapping
            await coreService.update(datasetId, { schemaMapping }, orgContext);

            // Paginate through items and normalize
            let offset = 0;
            const limit = 500;
            let count = 0;
            let hasMore = true;

            while (hasMore) {
                const result = await itemService.getItems(datasetId, orgContext, { limit, offset });

                if (result.items.length === 0) {
                    hasMore = false;
                    break;
                }

                const promises = result.items.map(async (item) => {
                    const sourceData = item.rawData || item.data;
                    const { flattened } = flattenForDataset(sourceData, schemaMapping);
                    await itemService.updateItem(datasetId, item.id, { data: flattened }, orgContext);
                });

                await Promise.all(promises);
                count += result.items.length;
                offset += limit;

                if (result.items.length < limit) hasMore = false;
            }

            logger.info("Dataset normalized", { datasetId, count });
            return { count };
        }, { table: "dataset_items", operation: "update" });
    },

    /**
     * Import data from CSV content
     */
    async importCsv(
        datasetId: number,
        csvContent: string,
        orgContext: OrgContext,
        filename?: string
    ): Promise<{ inserted: number; message: string }> {
        return withQueryTracking("datasetService.importCsv", async () => {
            // Verify access
            await coreService.getById(datasetId, orgContext);

            // Persist for audit/recovery if filename provided
            if (filename) {
                try {
                    const storagePath = `datasets/${datasetId}/imports/${Date.now()}-${filename}`;
                    await storageService.saveFile(orgContext.organizationId, storagePath, csvContent);
                } catch (err) {
                    logger.warn("Failed to persist import file, proceeding with in-memory import", { err });
                }
            }

            const lines = csvContent.split(/\r?\n/).filter((line: string) => line.trim());
            if (lines.length < 2) {
                throw new BadRequestError("CSV must have header row and at least one data row");
            }

            // Parse header row
            const parseCSVLine = (line: string): string[] => {
                const result: string[] = [];
                let current = '';
                let inQuotes = false;
                for (let i = 0; i < line.length; i++) {
                    const char = line[i];
                    if (char === '"') {
                        if (inQuotes && line[i + 1] === '"') {
                            current += '"';
                            i++;
                        } else {
                            inQuotes = !inQuotes;
                        }
                    } else if (char === ',' && !inQuotes) {
                        result.push(current.trim());
                        current = '';
                    } else {
                        current += char;
                    }
                }
                result.push(current.trim());
                return result;
            };

            const headers = parseCSVLine(lines[0]);

            // Parse data rows
            const items: AddItemInput[] = [];
            for (let i = 1; i < lines.length; i++) {
                const values = parseCSVLine(lines[i]);
                if (values.length === 0 || (values.length === 1 && !values[0])) continue;

                const rowData: Record<string, any> = {};
                headers.forEach((header, idx) => {
                    let value: any = values[idx] ?? '';
                    // Type inference
                    if (value === 'true') value = true;
                    else if (value === 'false') value = false;
                    else if (!isNaN(Number(value)) && value !== '') value = Number(value);
                    rowData[header] = value;
                });
                items.push({ data: rowData });
            }

            if (items.length === 0) {
                throw new BadRequestError("No valid data rows found in CSV");
            }

            const result = await itemService.addItems(datasetId, items, orgContext);
            return { inserted: result.inserted, message: `Successfully imported ${result.inserted} rows` };
        }, { table: "dataset_items", operation: "insert" });
    },

    /**
     * Export dataset to CSV format
     */
    async exportCsv(
        datasetId: number,
        orgContext: OrgContext,
        options: {
            sortBy?: string;
            sortOrder?: 'asc' | 'desc';
            filter?: { field: string; value: string };
        }
    ): Promise<AsyncGenerator<string, void, unknown>> {
        // Verify access
        await coreService.getById(datasetId, orgContext);

        const keys = await itemService.getDatasetKeys(datasetId, orgContext);
        const headers = ['id', 'createdAt', ...keys.map(k => k.key)];

        const escapeCsv = (val: any) => {
            if (val === null || val === undefined) return '';
            const str = String(val);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        // Use a generator to stream rows
        async function* generator() {
            yield headers.map(escapeCsv).join(',') + '\n';

            const limit = 1000;
            let offset = 0;
            let hasMore = true;

            while (hasMore) {
                const result = await itemService.getItems(datasetId, orgContext, {
                    limit,
                    offset,
                    ...options
                });

                if (result.items.length === 0) {
                    hasMore = false;
                    break;
                }

                for (const item of result.items) {
                    const row = [
                        item.id,
                        item.createdAt,
                        ...keys.map((k: any) => {
                            const val = (item.data as any)[k.key];
                            return typeof val === 'object' ? JSON.stringify(val) : val;
                        })
                    ];
                    yield row.map(escapeCsv).join(',') + '\n';
                }

                if (result.items.length < limit) {
                    hasMore = false;
                } else {
                    offset += limit;
                }
            }
        }

        return generator();
    },
};


