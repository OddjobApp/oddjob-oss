import { db } from "@server/database_service.js";
import { aiUsageLogs, users, pipelines, orgs } from "@shared/schema/index.js";
import { calculateCost, extractTokenCounts } from "../../core/infrastructure/cost-calculator.service.js";
import { budgetService } from "../../core/budget.service.js";
import { pipelineExecutions, pipelineStepExecutions } from "@shared/schema/pipelines/pipeline-execution.js";
import { missions } from "@shared/schema/index.js";
import { and, eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger('UsageService');

export interface LogUsageData {
    pipelineId?: number;
    userId: string;
    executionId?: number;
    stepExecutionId?: number;
    provider: string;
    model: string;
    metadata?: any;
    promptTokens?: number;
    completionTokens?: number;
    organizationId?: number | null;
}

export const usageService = {
    /**
     * Log AI usage asynchronously via a queue
     */
    async logAIUsage(data: LogUsageData): Promise<void> {
        try {
            const { queueService } = await import("../../core/infrastructure/queue/queue-service.js");
            await queueService.analyticsQueue.add("logAIUsage", {
                type: "logAIUsage",
                data
            }, {
                attempts: 5,
                backoff: {
                    type: 'exponential',
                    delay: 2000
                }
            });
        } catch (error: any) {
            console.warn("[UsageService] Failed to enqueue AI usage, attempting direct log:", error.message);
            await this.logAIUsageDirect(data).catch(e => console.error("[UsageService] Critical failure: Direct log fallback failed", e));
        }
    },

    /**
     * Direct DB logging (called by worker)
     */
    async logAIUsageDirect(data: LogUsageData): Promise<void> {
        try {
            let promptTokens = data.promptTokens;
            let completionTokens = data.completionTokens;

            if (!promptTokens || !completionTokens) {
                const extracted = extractTokenCounts(data.provider, data.metadata || {});
                promptTokens = promptTokens || extracted.promptTokens;
                completionTokens = completionTokens || extracted.completionTokens;
            }

            const totalTokens = (promptTokens || 0) + (completionTokens || 0);

            const cost = calculateCost(
                data.provider,
                data.model,
                promptTokens || 0,
                completionTokens || 0
            );

            // Treat 'anonymous' as null for DB foreign key constraints
            let dbUserId = (data.userId === 'anonymous' || !data.userId) ? null : data.userId;

            // Verify user exists to avoid FK violations, or nullify if not found
            if (dbUserId) {
                const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, dbUserId)).limit(1);
                if (!user) {
                    logger.warn(`User ${dbUserId} not found, logging with userId: null`);
                    dbUserId = null;
                }
            }

            // Verify pipeline, execution, and step execution exist to avoid FK violations
            let pipelineId = data.pipelineId || null;
            let executionId = data.executionId || null;
            let stepExecutionId = data.stepExecutionId || null;

            if (pipelineId) {
                const [p] = await db.select({ id: pipelines.id }).from(pipelines).where(eq(pipelines.id, pipelineId)).limit(1);
                if (!p) {
                    logger.warn(`Pipeline ${pipelineId} not found, logging with pipelineId: null`);
                    pipelineId = null;
                }
            }

            if (executionId) {
                const [e] = await db.select({ id: pipelineExecutions.id }).from(pipelineExecutions).where(eq(pipelineExecutions.id, executionId)).limit(1);
                if (!e) {
                    logger.warn(`Execution ${executionId} not found, logging with executionId: null`);
                    executionId = null;
                }
            }

            if (stepExecutionId) {
                const [s] = await db.select({ id: pipelineStepExecutions.id }).from(pipelineStepExecutions).where(eq(pipelineStepExecutions.id, stepExecutionId)).limit(1);
                if (!s) {
                    logger.warn(`Step execution ${stepExecutionId} not found, logging with stepExecutionId: null`);
                    stepExecutionId = null;
                }
            }

            let organizationId = data.organizationId || null;
            if (organizationId) {
                const [org] = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.id, organizationId)).limit(1);
                if (!org) {
                    logger.warn(`Organization ${organizationId} not found, logging with organizationId: null`);
                    organizationId = null;
                }
            }

            await db.insert(aiUsageLogs).values({
                pipelineId,
                userId: dbUserId,
                executionId,
                stepExecutionId,
                provider: data.provider,
                model: data.model,
                promptTokens,
                completionTokens,
                totalTokens,
                costUsd: cost.toString(),
                organizationId,
            });

            if (data.pipelineId) {
                await budgetService.checkPipelineBudget(data.pipelineId);
            }

            // Track spend for mini-apps if this is part of an app-init mission
            if (data.executionId && data.organizationId) {
                try {
                    const [execution] = await db.select({ missionId: pipelineExecutions.missionId })
                        .from(pipelineExecutions)
                        .where(eq(pipelineExecutions.id, data.executionId))
                        .limit(1);

                    if (execution?.missionId) {
                        const [mission] = await db.select({ blackboard: missions.blackboard })
                            .from(missions)
                            .where(eq(missions.id, execution.missionId))
                            .limit(1);

                        const blackboard = mission?.blackboard as any;
                        const appSlug = blackboard?.viaAppSlug;

                        if (appSlug && typeof appSlug === 'string') {
                            const { appRegistryService } = await import("../../apps/app-registry.service.js");
                            const deploymentInfo = await appRegistryService.findDeploymentBySlug(appSlug, data.organizationId);

                            if (deploymentInfo) {
                                await appRegistryService.recordAppSpend(deploymentInfo.deployment.id, cost);

                                // Track individual user spend for granular governance
                                const { costAttributionService } = await import("../../analytics/core/cost-attribution.service.js");
                                await costAttributionService.recordAppUserSpend(deploymentInfo.deployment.id, data.userId, cost);
                            }
                        }
                    }
                } catch (err) {
                    console.warn("[UsageService] Failed to track app or user spend:", err);
                }
            }
        } catch (error: any) {
            logger.error(`Failed to log AI usage direct for userId: ${data.userId}`, error);
            throw error;
        }
    }
};


