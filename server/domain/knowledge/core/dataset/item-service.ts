import { db } from "../../../../database_service.js";
import { datasetItems, type DatasetItem } from "@shared/schema/index.js";
import { eq, and, desc, sql, inArray, type SQL } from "drizzle-orm";
import { NotFoundError, BadRequestError } from "@server/utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";
import { withQueryTracking } from "@domain/knowledge/core/query-monitor.service.js";
import type { OrgContext } from "../../../../domain/jobs/job.service.js";
import { validateRecord } from "./utils.js";
import type { AddItemInput } from "./types.js";
import { coreService } from "./core-service.js";
import { getOrgConditions } from "../../../../utils/index.js";

const logger = createLogger("DatasetItemService");

/** The "Identified Bugs" dataset. Inserts here auto-launch a triage cycle. */
export const BUG_DATASET_ID = 71;

/**
 * Launch a Bug Triage cycle (and its Copilot intervention) for each inserted item.
 *
 * Extracted from addItem and addItems, which carried near-identical copies of
 * this -- 67 identical lines between them. They had already drifted apart in
 * their error handling, and every fix had to be applied twice.
 *
 * Fire-and-forget by design: the caller does not await it, and a failure here
 * must never fail the insert that triggered it. The cycle manifest is read once
 * and its blueprints reused across items; each launch is isolated so one bad
 * item cannot take down the rest of a batch.
 */
export async function launchBugTriageCycles(items: DatasetItem[], orgContext: OrgContext): Promise<void> {
    if (items.length === 0) return;

    try {
        const { CycleManagerService } = await import("../../../mission/core/cycle-manager.service.js");
        const { eventStream } = await import("../../../core/infrastructure/event-stream.service.js");
        const fs = await import("fs/promises");
        const path = await import("path");
        const yaml = await import("js-yaml");

        const yamlPath = path.resolve(process.cwd(), "server/cycles/bug-triage.cycle.yaml");
        const yamlContent = await fs.readFile(yamlPath, "utf-8");
        const yamlLoad = yaml.load || (yaml as any).default?.load;
        const manifest = yamlLoad(yamlContent) as any;

        const blueprints = manifest.missions.map((m: any) => {
            const dependencies: any[] = [];
            if (m.trigger && typeof m.trigger === 'string' && m.trigger.startsWith("on_success(")) {
                const upstreamId = m.trigger.replace("on_success(", "").replace(")", "");
                const upstreamMission = manifest.missions.find((x: any) => x.id === upstreamId);
                if (upstreamMission) {
                    dependencies.push({
                        blueprintName: upstreamMission.name,
                        type: "finish_to_start"
                    });
                }
            }
            return {
                name: m.name,
                objective: m.objective || m.name,
                type: m.type || "mission",
                dependencies,
                config: {
                    trigger: m.trigger,
                    environment: m.environment,
                    primaryAgent: m.primary_agent,
                    sequence: m.sequence
                },
                metadata: {}
            };
        });

        const userId = orgContext.userId || "system";
        // Never stamp an unattributable cycle onto org 1. With no organization in
        // context there is no tenant to launch this triage into.
        const orgId = orgContext.organizationId;
        if (orgId == null) {
            logger.warn(
                `[BugTriageTrigger] Skipping ${items.length} cycle launch(es): no organization in context.`,
            );
            return;
        }

        for (const item of items) {
            try {
                const bugSummary = (item.data as any)?.bug_summary || "New E2E Failure";
                const bugDescription = (item.data as any)?.description || "No description provided.";

                const cycleData = {
                    name: `Bug Triage: ${bugSummary.slice(0, 45)}`,
                    objective: `Triage and classify defect: "${bugSummary}". Description: ${bugDescription.slice(0, 100)}`,
                    priority: 4,
                    budgetLimitUsd: "5.00",
                    requiresApproval: 0,
                    blueprints
                };

                const cycle = await CycleManagerService.launchCycle(cycleData, userId, orgId);
                logger.info(`[BugTriageTrigger] Launched Bug Triage Cycle ID ${cycle.id} for bug item ${item.id}`);

                // Publish Copilot notification (Intervention Trigger)
                await eventStream.publish("intervention.triggered", {
                    interventionId: `e2e-fail-${item.id}-${Date.now()}`,
                    vector: "O",
                    title: `E2E Failure: ${bugSummary.slice(0, 40)}`,
                    description: `E2E test failed: "${bugSummary}". View report: /health/e2e-tests`,
                    aiPrompt: `Triage and classify E2E defect: "${bugSummary}". It is logged as bug item ID ${item.id} in dataset ${BUG_DATASET_ID}.`,
                    rationale: `Automated E2E failure alert registered for "${bugSummary}".`,
                    priority: "high",
                    confidence: 1.0,
                    sessionId: "system",
                    context: {
                        bugId: item.id,
                        datasetId: BUG_DATASET_ID,
                    }
                }, {
                    organizationId: orgId,
                });
                logger.info(`[BugTriageTrigger] Dispatched Copilot Intervention for bug item ${item.id}`);
            } catch (itemErr: any) {
                logger.error(`[BugTriageTrigger] Failed to launch cycle for bug item ${item.id}:`, itemErr);
            }
        }
    } catch (err: any) {
        logger.error(`[BugTriageTrigger] Failed to load config for bug triage trigger:`, err);
    }
}

export const itemService = {
    /**
     * Get items (rows) for a dataset
     */
    async getItems(
        datasetId: number,
        orgContext: OrgContext,
        options?: {
            limit?: number;
            offset?: number;
            sortBy?: string;
            sortOrder?: 'asc' | 'desc';
            filter?: { field: string; value: string };
        }
    ): Promise<{ items: DatasetItem[]; total: number }> {
        return withQueryTracking("datasetService.getItems", async () => {
            // Verify access
            await coreService.getById(datasetId, orgContext);

            // Base conditions
            const conditions: SQL[] = [eq(datasetItems.datasetId, datasetId)];

            // Apply filters
            if (options?.filter) {
                if (/^[a-zA-Z0-9_]+$/.test(options.filter.field)) {
                    conditions.push(sql`data->>${sql.raw(options.filter.field)} = ${options.filter.value}`);
                }
            }

            // Get total count with filters
            const [countResult] = await db
                .select({ count: sql<number>`count(*)::int` })
                .from(datasetItems)
                .where(and(...conditions));

            const total = countResult?.count || 0;

            // Get items
            let query = db
                .select()
                .from(datasetItems)
                .where(and(...conditions));

            // Apply sorting
            if (options?.sortBy && /^[a-zA-Z0-9_]+$/.test(options.sortBy)) {
                if (options.sortBy === 'id') {
                    query.orderBy(options.sortOrder === 'asc' ? datasetItems.id : desc(datasetItems.id));
                } else if (options.sortBy === 'createdAt') {
                    query.orderBy(options.sortOrder === 'asc' ? datasetItems.createdAt : desc(datasetItems.createdAt));
                } else {
                    query.orderBy(options.sortOrder === 'asc'
                        ? sql`data->>${sql.raw(options.sortBy)}`
                        : sql`data->>${sql.raw(options.sortBy)} DESC`);
                }
            } else {
                query.orderBy(desc(datasetItems.createdAt));
            }

            if (options?.limit) {
                query = query.limit(options.limit) as typeof query;
            }
            if (options?.offset) {
                query = query.offset(options.offset) as typeof query;
            }

            const items = await query;
            return { items, total };
        }, { table: "dataset_items", operation: "select" });
    },

    /**
     * Get all items across datasets (for system sync)
     */
    async getAllItems(orgContext: OrgContext, limit: number = 50): Promise<{ id: number }[]> {
        return withQueryTracking("datasetService.getAllItems", async () => {
            // Note: We don't verify dataset access here as this is for system sync
            // But we still apply org conditions if applicable
            const conditions = getOrgConditions(orgContext, datasetItems);

            return await db
                .select({ id: datasetItems.id })
                .from(datasetItems)
                .where(and(...conditions))
                .limit(limit)
                .orderBy(datasetItems.id);
        }, { table: "dataset_items", operation: "select" });
    },

    /**
     * Add an item to a dataset
     */
    async addItem(datasetId: number, input: AddItemInput, orgContext: OrgContext): Promise<DatasetItem> {
        return withQueryTracking("datasetService.addItem", async () => {
            // Verify access and get rules
            const dataset = await coreService.getById(datasetId, orgContext);

            // Validate
            if (dataset.validationRules) {
                const errors = validateRecord(input.data, dataset.validationRules);
                if (errors.length > 0) {
                    throw new BadRequestError(`Validation Failed: ${errors.join('; ')}`);
                }
            }

            const [item] = await db.insert(datasetItems).values({
                datasetId,
                data: input.data,
                rawData: input.rawData,
                pipelineExecutionId: input.pipelineExecutionId,
                knowledgeNodeId: input.knowledgeNodeId,
            }).returning();

            logger.debug("Item added to dataset", { datasetId, itemId: item.id });

            // Fire-and-forget: a triage failure must not fail the insert.
            if (datasetId === BUG_DATASET_ID) {
                void launchBugTriageCycles([item], orgContext);
            }

            return item;
        }, { table: "dataset_items", operation: "insert" });
    },

    /**
     * Add multiple items (batch)
     */
    async addItems(
        datasetId: number,
        items: AddItemInput[],
        orgContext: OrgContext
    ): Promise<{ inserted: number; items?: DatasetItem[]; errors?: string[] }> {
        return withQueryTracking("datasetService.addItems", async () => {
            // Verify access
            const dataset = await coreService.getById(datasetId, orgContext);

            if (items.length === 0) {
                return { inserted: 0 };
            }

            // Validate all items
            if (dataset.validationRules) {
                const batchErrors: string[] = [];
                items.forEach((item, index) => {
                    const rowErrors = validateRecord(item.data, dataset.validationRules);
                    if (rowErrors.length > 0) {
                        batchErrors.push(`Row ${index + 1}: ${rowErrors.join(', ')}`);
                    }
                });

                if (batchErrors.length > 0) {
                    throw new BadRequestError(`Batch Validation Failed:\n${batchErrors.slice(0, 10).join('\n')}${batchErrors.length > 10 ? '\n...' : ''}`);
                }
            }

            const allInserted: DatasetItem[] = [];
            const chunkSize = 100; // Safe chunk size for wide datasets

            for (let i = 0; i < items.length; i += chunkSize) {
                const chunk = items.slice(i, i + chunkSize);
                const insertedChunk = await db.insert(datasetItems).values(
                    chunk.map(item => ({
                        datasetId,
                        data: item.data,
                        rawData: item.rawData,
                        pipelineExecutionId: item.pipelineExecutionId,
                        knowledgeNodeId: item.knowledgeNodeId,
                    }))
                ).returning();
                allInserted.push(...insertedChunk);
            }

            logger.info("Batch items added to dataset", { datasetId, count: items.length });

            // Fire-and-forget: a triage failure must not fail the insert.
            if (datasetId === BUG_DATASET_ID) {
                void launchBugTriageCycles(allInserted, orgContext);
            }

            return { inserted: items.length, items: allInserted };
        }, { table: "dataset_items", operation: "insert" });
    },

    /**
     * Delete an item
     */
    async deleteItem(datasetId: number, itemId: number, orgContext: OrgContext): Promise<void> {
        return withQueryTracking("datasetService.deleteItem", async () => {
            await coreService.getById(datasetId, orgContext);

            await db.delete(datasetItems).where(
                and(
                    eq(datasetItems.id, itemId),
                    eq(datasetItems.datasetId, datasetId)
                )
            );

            logger.debug("Item deleted from dataset", { datasetId, itemId });
        }, { table: "dataset_items", operation: "delete" });
    },

    /**
     * Delete multiple items (batch)
     */
    async deleteItems(datasetId: number, itemIds: number[], orgContext: OrgContext): Promise<{ deleted: number }> {
        return withQueryTracking("datasetService.deleteItems", async () => {
            await coreService.getById(datasetId, orgContext);

            if (itemIds.length === 0) {
                return { deleted: 0 };
            }

            let totalDeleted = 0;
            const chunkSize = 500;

            for (let i = 0; i < itemIds.length; i += chunkSize) {
                const chunk = itemIds.slice(i, i + chunkSize);
                const result = await db.delete(datasetItems).where(
                    and(
                        eq(datasetItems.datasetId, datasetId),
                        inArray(datasetItems.id, chunk)
                    )
                );
                totalDeleted += (result as any).rowCount || 0;
            }

            logger.info("Batch items deleted", { datasetId, count: totalDeleted });
            return { deleted: totalDeleted };
        }, { table: "dataset_items", operation: "delete" });
    },

    /**
     * Update an item
     */
    async updateItem(datasetId: number, itemId: number, input: Partial<AddItemInput>, orgContext: OrgContext): Promise<DatasetItem> {
        return withQueryTracking("datasetService.updateItem", async () => {
            await coreService.getById(datasetId, orgContext);

            const [updated] = await db
                .update(datasetItems)
                .set({
                    data: input.data,
                    rawData: input.rawData,
                    pipelineExecutionId: input.pipelineExecutionId,
                    knowledgeNodeId: input.knowledgeNodeId
                })
                .where(and(
                    eq(datasetItems.id, itemId),
                    eq(datasetItems.datasetId, datasetId)
                ))
                .returning();

            if (!updated) {
                throw new NotFoundError("Item not found");
            }

            return updated;
        }, { table: "dataset_items", operation: "update" });
    },

    /**
     * Update multiple records (batch update)
     */
    async updateRecords(
        datasetId: number,
        updates: Record<string, any>,
        orgContext: OrgContext
    ): Promise<{ updated: number }> {
        return withQueryTracking("datasetService.updateRecords", async () => {
            await coreService.getById(datasetId, orgContext);

            let updatedCount = 0;
            const entries = Object.entries(updates);

            await db.transaction(async (tx) => {
                for (const [itemIdStr, dataUpdate] of entries) {
                    const itemId = parseInt(itemIdStr);
                    if (isNaN(itemId)) continue;

                    const [result] = await tx
                        .update(datasetItems)
                        .set({
                            data: dataUpdate,
                            updatedAt: new Date()
                        })
                        .where(and(
                            eq(datasetItems.id, itemId),
                            eq(datasetItems.datasetId, datasetId)
                        ))
                        .returning();

                    if (result) updatedCount++;
                }
            });

            logger.info("Batch items updated", { datasetId, count: updatedCount });
            return { updated: updatedCount };
        }, { table: "dataset_items", operation: "update" });
    },

    /**
     * Resolve open incidents for a given test name.
     *
     * Used by the E2E self-healing loop: when a Playwright test passes, any prior
     * "failed" incidents it logged (insert-only reporter) are marked resolved so they
     * stop counting as open failures. History is preserved (no delete) — we only flip
     * metadata.outcome to 'resolved' and stamp resolvedAt.
     */
    async resolveIncidentsByTestName(
        datasetId: number,
        testName: string,
        orgContext: OrgContext
    ): Promise<{ resolved: number }> {
        return withQueryTracking("datasetService.resolveIncidentsByTestName", async () => {
            await coreService.getById(datasetId, orgContext);

            if (!testName) return { resolved: 0 };

            const result = await db.execute(sql`
                UPDATE dataset_items
                SET data = jsonb_set(
                        jsonb_set(data, '{metadata,outcome}', '"resolved"'::jsonb, true),
                        '{metadata,resolvedAt}', to_jsonb(now()::text), true
                    ),
                    updated_at = now()
                WHERE dataset_id = ${datasetId}
                  AND data->'metadata'->>'testName' = ${testName}
                  AND COALESCE(data->'metadata'->>'outcome', 'failed')
                      NOT IN ('resolved', 'healed', 'passed', 'pass', 'success', 'all_passed')
            `);

            const resolved = (result as any).rowCount || 0;
            if (resolved > 0) {
                logger.info("Resolved open incidents for passing test", { datasetId, testName, resolved });
            }
            return { resolved };
        }, { table: "dataset_items", operation: "update" });
    },

    /**
     * Deduplicate items based on a field
     */
    async deduplicateItems(datasetId: number, field: string, orgContext: OrgContext): Promise<void> {
        return withQueryTracking("datasetService.deduplicateItems", async () => {
            await coreService.getById(datasetId, orgContext);

            if (!/^[a-zA-Z0-9_]+$/.test(field)) {
                throw new BadRequestError("Invalid deduplication field name");
            }

            await db.execute(sql`
                DELETE FROM dataset_items 
                WHERE dataset_id = ${datasetId}
                AND id NOT IN (
                    SELECT MIN(id)
                    FROM dataset_items
                    WHERE dataset_id = ${datasetId}
                    GROUP BY data->>${field}
                )
            `);

            logger.info("Dataset items deduplicated", { datasetId, field });
        }, { table: "dataset_items", operation: "delete" });
    },

    /**
     * Clear all items from a dataset
     */
    async clearItems(datasetId: number, orgContext: OrgContext): Promise<{ deleted: number }> {
        return withQueryTracking("datasetService.clearItems", async () => {
            await coreService.getById(datasetId, orgContext);

            const result = await db.delete(datasetItems).where(eq(datasetItems.datasetId, datasetId));

            const deleted = (result as any).rowCount || 0;
            logger.info("Dataset items cleared", { datasetId, deleted });
            return { deleted };
        }, { table: "dataset_items", operation: "delete" });
    },

    /**
     * Get dataset statistics
     */
    async getStats(datasetId: number, orgContext: OrgContext): Promise<{
        rowCount: number;
        lastUpdated: Date | null;
    }> {
        const dataset = await coreService.getById(datasetId, orgContext);

        const [countResult] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(datasetItems)
            .where(eq(datasetItems.datasetId, datasetId));

        return {
            rowCount: countResult?.count || 0,
            lastUpdated: dataset.updatedAt,
        };
    },

    /**
     * Get keys/structure of a dataset
     */
    async getDatasetKeys(datasetId: number, orgContext: OrgContext): Promise<{ key: string; type: string; nullCount: number }[]> {
        const result = await this.getItems(datasetId, orgContext, { limit: 50 });
        const items = result.items;
        if (items.length === 0) return [];

        const stats = new Map<string, { total: number; nulls: number; types: Map<string, number> }>();

        items.forEach(item => {
            if (item.data && typeof item.data === 'object') {
                Object.entries(item.data).forEach(([key, value]) => {
                    if (!stats.has(key)) {
                        stats.set(key, { total: 0, nulls: 0, types: new Map() });
                    }
                    const stat = stats.get(key)!;
                    stat.total++;

                    if (value === null || value === undefined) {
                        stat.nulls++;
                    } else {
                        let type: string = typeof value;
                        if (type === 'string') {
                            if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
                                type = 'date';
                            }
                        }
                        stat.types.set(type, (stat.types.get(type) || 0) + 1);
                    }
                });
            }
        });

        return Array.from(stats.entries()).map(([key, stat]) => {
            let dominantType = 'string';
            let maxCount = 0;
            stat.types.forEach((count, type) => {
                if (count > maxCount) {
                    maxCount = count;
                    dominantType = type;
                }
            });

            return {
                key,
                type: dominantType,
                nullCount: stat.nulls
            };
        }).sort((a, b) => a.key.localeCompare(b.key));
    },
};


