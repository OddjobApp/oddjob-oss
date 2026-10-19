/**
 * LLM Log Repository
 * Handles database operations for LLM request/response logging
 */

import { db } from "@server/database_service.js";
import { llmRouterLogs } from "@shared/schema/ai/llm-router.js";
import { eq, and, desc, between, lt } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("LLMLogRepository");

export const llmLogRepository = {
    /**
     * Find log entry by ID
     */
    async findById(id: number) {
        const [log] = await db
            .select()
            .from(llmRouterLogs)
            .where(eq(llmRouterLogs.id, id))
            .limit(1);
        return log;
    },

    /**
     * Find log by request ID
     */
    async findByRequestId(requestId: string) {
        const [log] = await db
            .select()
            .from(llmRouterLogs)
            .where(eq(llmRouterLogs.requestId, requestId))
            .limit(1);
        return log;
    },

    /**
     * List logs for an organization
     */
    async findByOrganizationId(organizationId: number, limit: number = 50) {
        return db
            .select()
            .from(llmRouterLogs)
            .where(eq(llmRouterLogs.organizationId, organizationId))
            .orderBy(desc(llmRouterLogs.createdAt))
            .limit(limit);
    },

    /**
     * List logs for a job
     */
    async findByJobId(jobId: number, limit: number = 50) {
        return db
            .select()
            .from(llmRouterLogs)
            .where(eq(llmRouterLogs.jobId, jobId))
            .orderBy(desc(llmRouterLogs.createdAt))
            .limit(limit);
    },

    /**
     * List logs for a job run
     */
    async findByJobRunId(jobRunId: number, limit: number = 50) {
        return db
            .select()
            .from(llmRouterLogs)
            .where(eq(llmRouterLogs.jobRunId, jobRunId))
            .orderBy(desc(llmRouterLogs.createdAt))
            .limit(limit);
    },

    /**
     * List logs by provider
     */
    async findByProviderId(providerId: number, limit: number = 50) {
        return db
            .select()
            .from(llmRouterLogs)
            .where(eq(llmRouterLogs.selectedProviderId, providerId))
            .orderBy(desc(llmRouterLogs.createdAt))
            .limit(limit);
    },

    /**
     * List logs by model
     */
    async findByModelId(modelId: number, limit: number = 50) {
        return db
            .select()
            .from(llmRouterLogs)
            .where(eq(llmRouterLogs.selectedModelId, modelId))
            .orderBy(desc(llmRouterLogs.createdAt))
            .limit(limit);
    },

    /**
     * Find logs within date range
     */
    async findByDateRange(organizationId: number, startDate: Date, endDate: Date, limit: number = 100) {
        return db
            .select()
            .from(llmRouterLogs)
            .where(and(
                eq(llmRouterLogs.organizationId, organizationId),
                between(llmRouterLogs.createdAt, startDate, endDate)
            ))
            .orderBy(desc(llmRouterLogs.createdAt))
            .limit(limit);
    },

    /**
     * Create initial log entry
     */
    async create(data: any) {
        const [log] = await db
            .insert(llmRouterLogs)
            .values(data)
            .returning();
        return log;
    },

    /**
     * Update log with success response
     */
    async updateSuccess(requestId: string, response: any, latencyMs: number) {
        const [log] = await db
            .update(llmRouterLogs)
            .set({
                success: true,
                inputTokens: response.usage?.inputTokens,
                outputTokens: response.usage?.outputTokens,
                totalTokens: response.usage?.totalTokens,
                cost: response.usage?.cost,
                latencyMs,
                responseContent: response.content,
                updatedAt: new Date(),
            })
            .where(eq(llmRouterLogs.requestId, requestId))
            .returning();
        return log;
    },

    /**
     * Update log with failure
     */
    async updateFailure(requestId: string, error: any) {
        const [log] = await db
            .update(llmRouterLogs)
            .set({
                success: false,
                errorMessage: error.message,
                updatedAt: new Date(),
            })
            .where(eq(llmRouterLogs.requestId, requestId))
            .returning();
        return log;
    },

    /**
     * Delete old logs (for cleanup)
     */
    async deleteOlderThan(date: Date) {
        const result = await db
            .delete(llmRouterLogs)
            .where(lt(llmRouterLogs.createdAt, date));
        return (result as any).length || 0;
    },

    /**
     * Get usage statistics
     */
    async getStats(organizationId: number, startDate: Date, endDate: Date) {
        const logs = await this.findByDateRange(organizationId, startDate, endDate, 10000);

        return {
            totalRequests: logs.length,
            successfulRequests: logs.filter(l => l.success).length,
            failedRequests: logs.filter(l => !l.success).length,
            totalTokens: logs.reduce((acc, l) => acc + (l.totalTokens || 0), 0),
            totalCost: logs.reduce((acc, l) => acc + (l.cost || 0), 0),
            avgLatencyMs: logs.length > 0
                ? logs.reduce((acc, l) => acc + (l.latencyMs || 0), 0) / logs.length
                : 0,
        };
    },
};
