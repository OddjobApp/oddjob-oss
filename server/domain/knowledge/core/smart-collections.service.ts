/**
 * Smart Collections Service
 * Auto-populating collections based on rules
 */

import { db } from "@server/database_service.js";
import { jobs, jobCollections, jobCollectionItems } from "@shared/schema/index.js";
import { eq, and, or, sql, inArray, not, like, gte, lte } from "drizzle-orm";
import type { OrgContext } from "@server/utils/auth-context.js";

export interface SmartRule {
    field: string;
    operator: "equals" | "not_equals" | "contains" | "starts_with" | "ends_with" | "gte" | "lte" | "in" | "not_in" | "is_null" | "is_not_null";
    value?: any;
}

export const smartCollectionsService = {
    /**
     * Evaluate smart rules against agents and return matching IDs
     */
    async evaluateRules(rules: SmartRule[], orgContext: OrgContext): Promise<number[]> {
        if (!rules || rules.length === 0) return [];

        // Build conditions from rules
        const conditions = rules.map((rule) => {
            switch (rule.operator) {
                case "equals":
                    return sql`${jobs.config}->>${rule.field} = ${rule.value}`;
                case "not_equals":
                    return sql`${jobs.config}->>${rule.field} != ${rule.value}`;
                case "contains":
                    return sql`${jobs.config}->>${rule.field} LIKE ${`%${rule.value}%`}`;
                case "starts_with":
                    return sql`${jobs.config}->>${rule.field} LIKE ${`${rule.value}%`}`;
                case "ends_with":
                    return sql`${jobs.config}->>${rule.field} LIKE ${`%${rule.value}`}`;
                case "gte":
                    return sql`(${jobs.config}->>${rule.field})::numeric >= ${rule.value}`;
                case "lte":
                    return sql`(${jobs.config}->>${rule.field})::numeric <= ${rule.value}`;
                case "in":
                    return sql`${jobs.config}->>${rule.field} IN (${rule.value.join(",")})`;
                case "not_in":
                    return sql`${jobs.config}->>${rule.field} NOT IN (${rule.value.join(",")})`;
                case "is_null":
                    return sql`${jobs.config}->>${rule.field} IS NULL`;
                case "is_not_null":
                    return sql`${jobs.config}->>${rule.field} IS NOT NULL`;
                default:
                    return undefined;
            }
        }).filter(Boolean);

        if (conditions.length === 0) return [];

        // Query matching agents
        const result = await db
            .select({ id: jobs.id })
            .from(jobs)
            .where(and(
                eq(jobs.organizationId, orgContext.organizationId!),
                or(...conditions)
            ));

        return result.map((r) => r.id);
    },

    /**
     * Get pre-defined smart collection presets
     */
    getSmartPresets(): { id: string; name: string; description: string; rules: SmartRule[] }[] {
        return [
            {
                id: "production-agents",
                name: "Production Agents",
                description: "All agents tagged as production",
                rules: [{ field: "tag", operator: "equals", value: "production" }],
            },
            {
                id: "high-retry-agents",
                name: "High Retry Agents",
                description: "Agents with high retry counts",
                rules: [{ field: "maxRetries", operator: "gte", value: 5 }],
            },
            {
                id: "llm-powered",
                name: "LLM Powered",
                description: "Agents using LLM tools",
                rules: [{ field: "tool", operator: "equals", value: "llm" }],
            },
            {
                id: "scheduled-agents",
                name: "Scheduled Agents",
                description: "Agents with cron schedules",
                rules: [{ field: "schedule", operator: "is_not_null" }],
            },
            {
                id: "failed-recently",
                name: "Failed Recently",
                description: "Agents with recent failures",
                rules: [
                    { field: "lastStatus", operator: "equals", value: "failed" },
                    { field: "lastRunAt", operator: "gte", value: "now() - interval '24 hours'" },
                ],
            },
            {
                id: "data-processors",
                name: "Data Processors",
                description: "Agents that process data",
                rules: [{ field: "type", operator: "in", value: ["data_extraction", "data_transformation", "data_loading"] }],
            },
        ];
    },

    /**
     * Sync a smart collection - add/remove agents based on current rules
     */
    async syncCollection(collectionId: number, orgContext: OrgContext): Promise<{ added: number; removed: number }> {
        const [collection] = await db
            .select({ smartRules: jobCollections.smartRules })
            .from(jobCollections)
            .where(and(
                eq(jobCollections.id, collectionId),
                eq(jobCollections.isSmart, 1)
            ))
            .limit(1);

        if (!collection || !collection.smartRules) {
            return { added: 0, removed: 0 };
        }

        const rules = collection.smartRules as SmartRule[];
        const matchingIds = await this.evaluateRules(rules, orgContext);

        // Get current members
        const currentItems = await db
            .select({ jobId: jobCollectionItems.jobId })
            .from(jobCollectionItems)
            .where(eq(jobCollectionItems.collectionId, collectionId));
        const currentIds = new Set(currentItems.map((i) => i.jobId));

        // Calculate changes
        const toAdd = matchingIds.filter((id) => !currentIds.has(id));
        const toRemove = Array.from(currentIds).filter((id) => !matchingIds.includes(id));

        // Apply changes
        if (toAdd.length > 0) {
            await db.insert(jobCollectionItems).values(
                toAdd.map((jobId) => ({ collectionId, jobId }))
            );
        }

        if (toRemove.length > 0) {
            await db.delete(jobCollectionItems).where(
                and(
                    eq(jobCollectionItems.collectionId, collectionId),
                    inArray(jobCollectionItems.jobId, toRemove)
                )
            );
        }

        return { added: toAdd.length, removed: toRemove.length };
    },

    /**
     * Sync all smart collections for an organization
     */
    async syncAllSmartCollections(orgContext: OrgContext): Promise<{ collectionId: number; changes: { added: number; removed: number } }[]> {
        const smartCollectionsList = await db
            .select({ id: jobCollections.id, smartRules: jobCollections.smartRules })
            .from(jobCollections)
            .where(and(
                eq(jobCollections.isSmart, 1),
                eq(jobCollections.organizationId, orgContext.organizationId!)
            ));

        const results = [];
        for (const collection of smartCollectionsList) {
            const changes = await this.syncCollection(collection.id, orgContext);
            results.push({ collectionId: collection.id, changes });
        }

        return results;
    },
};
