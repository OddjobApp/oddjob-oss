import { db } from "@server/database_service.js";
import {
    pipelines,
    pipelineExecutions,
    pipelineStepExecutions,
    pipelineSteps,
    agentDeployments,
} from "@shared/schema/index.js";
import { eq, and, desc, asc, sql, isNull, type SQL } from "drizzle-orm";
import { NotFoundError, BadRequestError, ErrorCode } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";
import { withQueryTracking } from "@domain/knowledge/core/query-monitor.service.js";
import type { OrgContext, RunPipelineInput } from "./types.js";
import { pipelineEngine, getOrgConditions } from "./pipeline-engine.js";

const logger = createLogger("PipelineExecutionService");

export const executionManager = {
    /**
     * Run a pipeline
     */
    async run(pipelineId: number, input: RunPipelineInput, orgContext: OrgContext): Promise<any> {
        const pipeline = await pipelineEngine.getById(pipelineId, orgContext);

        if (pipeline.steps.length === 0) {
            throw new Error("Pipeline has no steps");
        }

        const { pipelineExecutor } = await import("../../../core/pipeline-executor.js");

        const execution = await pipelineExecutor.executePipeline(
            pipelineId,
            orgContext.userId,
            input.startStepId,
            null,
            input.input,
            undefined,
            undefined, // initialState
            input.missionId,
            input.missionRunId
        );

        return execution;
    },

    /**
     * Resume a pipeline execution
     */
    async resume(executionId: number, fromStepId: number | null, orgContext: OrgContext, resumeData?: Record<string, any>): Promise<any> {
        return withQueryTracking("pipelineService.resume", async () => {
            await this.getExecutionDetails(executionId, orgContext);

            const { pipelineExecutor } = await import("../../../core/pipeline-executor.js");
            const result = await pipelineExecutor.resumePipelineExecution(
                executionId,
                fromStepId,
                resumeData
            );
            return result;
        }, { table: "pipeline_executions", operation: "update" });
    },

    /**
     * Rerun a pipeline execution
     */
    async rerun(executionId: number, startStepId: number | null, orgContext: OrgContext): Promise<any> {
        return withQueryTracking("pipelineService.rerun", async () => {
            const details = await this.getExecutionDetails(executionId, orgContext);

            const { pipelineExecutor } = await import("../../../core/pipeline-executor.js");
            const result = await pipelineExecutor.executePipeline(
                details.execution.pipelineId,
                orgContext.userId,
                startStepId
            );
            return result;
        }, { table: "pipeline_executions", operation: "insert" });
    },

    /**
     * List recent executions for an organization
     */
    async listRecentExecutions(orgContext: OrgContext, options: { limit?: number; status?: string; pipelineId?: number } = {}): Promise<any[]> {
        return withQueryTracking("pipelineService.listRecentExecutions", async () => {
            const conditions: SQL[] = [isNull(pipelineExecutions.deletedAt)];

            if (orgContext.organizationId !== null) {
                conditions.push(eq(pipelineExecutions.organizationId, orgContext.organizationId));
            }

            if (options.status) {
                conditions.push(eq(pipelineExecutions.status, options.status));
            }
            if (options.pipelineId) {
                conditions.push(eq(pipelineExecutions.pipelineId, options.pipelineId));
            }

            const results = await db
                .select({
                    execution: pipelineExecutions,
                    pipelineName: pipelines.name
                })
                .from(pipelineExecutions)
                .leftJoin(pipelines, eq(pipelineExecutions.pipelineId, pipelines.id))
                .where(and(...conditions))
                .orderBy(desc(pipelineExecutions.startedAt))
                .limit(options.limit || 20);

            return results.map(r => ({
                ...r.execution,
                pipelineName: r.pipelineName || "Unknown"
            }));
        }, { table: "pipeline_executions", operation: "select" });
    },

    /**
     * Get pipeline executions
     */
    async getExecutions(
        pipelineId: number,
        orgContext: OrgContext,
        options?: { limit?: number; status?: string }
    ) {
        return withQueryTracking("pipelineService.getExecutions", async () => {
            await pipelineEngine.getById(pipelineId, orgContext);

            let query = db
                .select()
                .from(pipelineExecutions)
                .where(and(eq(pipelineExecutions.pipelineId, pipelineId), isNull(pipelineExecutions.deletedAt)))
                .orderBy(desc(pipelineExecutions.startedAt));

            if (options?.limit) {
                query = query.limit(options.limit) as typeof query;
            }

            return await query;
        }, { table: "pipeline_executions", operation: "select" });
    },

    /**
     * Get a single execution by ID with security check
     */
    async getExecution(executionId: number, orgContext: OrgContext) {
        return withQueryTracking("pipelineService.getExecution", async () => {
            const [execution] = await db
                .select()
                .from(pipelineExecutions)
                .where(and(eq(pipelineExecutions.id, executionId), isNull(pipelineExecutions.deletedAt)))
                .limit(1);

            if (!execution) return null;

            // Security check
            await pipelineEngine.getById(execution.pipelineId, orgContext);

            return execution;
        }, { table: "pipeline_executions", operation: "select" });
    },

    /**
     * Get execution details with step executions
     */
    async getExecutionDetails(executionId: number, orgContext: OrgContext) {
        return withQueryTracking("pipelineService.getExecutionDetails", async () => {
            const [execution] = await db
                .select()
                .from(pipelineExecutions)
                .where(and(eq(pipelineExecutions.id, executionId), isNull(pipelineExecutions.deletedAt)))
                .limit(1);

            if (!execution) {
                throw new NotFoundError("Execution not found");
            }

            await pipelineEngine.getById(execution.pipelineId, orgContext);

            const stepExecutions = await db
                .select()
                .from(pipelineStepExecutions)
                .where(eq(pipelineStepExecutions.pipelineExecutionId, executionId))
                .orderBy(asc(pipelineStepExecutions.executedAt));

            return { execution, stepExecutions };
        }, { table: "pipeline_step_executions", operation: "select" });
    },

    /**
     * Get Enriched Execution Details
     */
    async getEnrichedExecutionDetails(executionId: number, orgContext: OrgContext): Promise<any> {
        const { jobs } = await import("@shared/schema/index.js");
        return withQueryTracking("pipelineService.getEnrichedExecutionDetails", async () => {
            const [execution] = await db
                .select()
                .from(pipelineExecutions)
                .where(and(eq(pipelineExecutions.id, executionId), isNull(pipelineExecutions.deletedAt)));

            if (!execution) throw new NotFoundError("Pipeline execution not found", ErrorCode.NOT_FOUND, { executionId });

            const [pipeline] = await db
                .select()
                .from(pipelines)
                .where(and(eq(pipelines.id, execution.pipelineId), ...getOrgConditions(orgContext)));

            if (!pipeline) throw new NotFoundError("Pipeline not found (or access denied)");

            const stepExecutions = await db
                .select({
                    id: pipelineStepExecutions.id,
                    pipelineStepId: pipelineStepExecutions.pipelineStepId,
                    jobId: pipelineStepExecutions.jobId,
                    stepOrder: pipelineStepExecutions.stepOrder,
                    outputName: pipelineStepExecutions.outputName,
                    output: pipelineStepExecutions.output,
                    status: pipelineStepExecutions.status,
                    executedAt: pipelineStepExecutions.executedAt,
                    completedAt: pipelineStepExecutions.completedAt,
                    traceId: pipelineStepExecutions.traceId,
                    retryCount: pipelineStepExecutions.retryCount,
                    error: pipelineStepExecutions.error,
                    outputSchema: pipelineStepExecutions.outputSchema,
                    jobName: jobs.name,
                    jobType: jobs.type,
                    agentSlug: agentDeployments.slug,
                    // Retry policy (from the step definition) so the UI can show
                    // the configured attempt budget / backoff alongside retryCount.
                    retryConfig: pipelineSteps.retryConfig,
                })
                .from(pipelineStepExecutions)
                .leftJoin(jobs, eq(pipelineStepExecutions.jobId, jobs.id))
                .leftJoin(pipelineSteps, eq(pipelineStepExecutions.pipelineStepId, pipelineSteps.id))
                .leftJoin(agentDeployments, eq(jobs.id, agentDeployments.jobId))
                .where(eq(pipelineStepExecutions.pipelineExecutionId, executionId))
                .orderBy(pipelineStepExecutions.stepOrder);

            const totalSteps = stepExecutions.length;
            const failedSteps = stepExecutions.filter(s => s.status === 'failure').length;
            const duration = execution.completedAt
                ? new Date(execution.completedAt).getTime() - new Date(execution.startedAt).getTime()
                : null;

            return {
                ...execution,
                pipeline,
                stepExecutions,
                metrics: {
                    totalSteps,
                    failedSteps,
                    duration: duration ? Math.round(duration / 1000) : null,
                },
            };
        }, { table: "pipeline_executions", operation: "select" });
    },

    /**
     * Cancel a running execution
     */
    async cancelExecution(executionId: number, orgContext: OrgContext) {
        const { execution } = await this.getExecutionDetails(executionId, orgContext);

        if (execution.status !== "running" && execution.status !== "pending") {
            throw new BadRequestError("Cannot cancel execution that is not running or pending");
        }

        const [updated] = await db
            .update(pipelineExecutions)
            .set({
                status: "cancelled",
                cancelledAt: new Date(),
            })
            .where(eq(pipelineExecutions.id, executionId))
            .returning();

        // Signal the in-memory executor to abort the running loop
        try {
            const { pipelineExecutor } = await import("@server/core/pipeline-executor.js");
            pipelineExecutor.abortExecution(executionId);
        } catch (err) {
            logger.warn(`Could not signal abort to executor for execution ${executionId}:`, {}, err);
        }

        logger.info("Execution cancelled", { executionId });
        return updated;
    },

    async listExecutionsEnriched(pipelineId: number, orgContext: OrgContext): Promise<any[]> {
        return withQueryTracking("pipelineService.listExecutionsEnriched", async () => {
            await pipelineEngine.getById(pipelineId, orgContext);

            return await db
                .select({
                    id: pipelineExecutions.id,
                    pipelineId: pipelineExecutions.pipelineId,
                    status: pipelineExecutions.status,
                    startedAt: pipelineExecutions.startedAt,
                    completedAt: pipelineExecutions.completedAt,
                    error: pipelineExecutions.error,
                    createdBy: pipelineExecutions.createdBy,
                    stepCount: sql<number>`COALESCE(COUNT(${pipelineStepExecutions.id}), 0)`.as('stepCount'),
                    failedStepCount: sql<number>`COALESCE(COUNT(CASE WHEN ${pipelineStepExecutions.status} = 'failure' THEN 1 END), 0)`.as('failedStepCount'),
                })
                .from(pipelineExecutions)
                .leftJoin(pipelineStepExecutions, eq(pipelineExecutions.id, pipelineStepExecutions.pipelineExecutionId))
                .where(and(eq(pipelineExecutions.pipelineId, pipelineId), isNull(pipelineExecutions.deletedAt)))
                .groupBy(
                    pipelineExecutions.id,
                    pipelineExecutions.pipelineId,
                    pipelineExecutions.status,
                    pipelineExecutions.startedAt,
                    pipelineExecutions.completedAt,
                    pipelineExecutions.error,
                    pipelineExecutions.createdBy
                )
                .orderBy(desc(pipelineExecutions.startedAt))
                .limit(200);
        }, { table: "pipeline_executions", operation: "select" });
    },

    async getChildExecutions(parentExecutionId: number, orgContext: OrgContext) {
        return withQueryTracking("pipelineService.getChildExecutions", async () => {
            const children = await db
                .select({
                    id: pipelineExecutions.id,
                    pipelineId: pipelineExecutions.pipelineId,
                    status: pipelineExecutions.status,
                    startedAt: pipelineExecutions.startedAt,
                    completedAt: pipelineExecutions.completedAt,
                    pipelineName: pipelines.name,
                })
                .from(pipelineExecutions)
                .innerJoin(pipelines, eq(pipelineExecutions.pipelineId, pipelines.id))
                .where(and(
                    eq(pipelineExecutions.parentExecutionId, parentExecutionId),
                    isNull(pipelineExecutions.deletedAt),
                    ...getOrgConditions(orgContext)
                ))
                .orderBy(pipelineExecutions.startedAt);

            return children;
        }, { table: "pipeline_executions", operation: "select" });
    },

    /**
     * Get execution by ID (System/Internal use - skips org check)
     */
    async getExecutionSystem(executionId: number) {
        return withQueryTracking("pipelineService.getExecutionSystem", async () => {
            const [execution] = await db.select().from(pipelineExecutions).where(and(eq(pipelineExecutions.id, executionId), isNull(pipelineExecutions.deletedAt)));
            return execution;
        }, { table: "pipeline_executions", operation: "select" });
    },

    /**
     * Create execution record
     */
    async createExecution(execution: any) {
        return withQueryTracking("pipelineService.createExecution", async () => {
            const [result] = await db.insert(pipelineExecutions).values(execution).returning();
            return result;
        }, { table: "pipeline_executions", operation: "insert" });
    },

    /**
     * Update execution record
     */
    async updateExecution(id: number, update: any) {
        return withQueryTracking("pipelineService.updateExecution", async () => {
            const [result] = await db
                .update(pipelineExecutions)
                .set(update)
                .where(eq(pipelineExecutions.id, id))
                .returning();

            if (!result) throw new NotFoundError("Execution not found");
            return result;
        }, { table: "pipeline_executions", operation: "update" });
    },

    /**
     * Create step execution record
     */
    async createStepExecution(execution: any) {
        return withQueryTracking("pipelineService.createStepExecution", async () => {
            const [result] = await db.insert(pipelineStepExecutions).values(execution).returning();
            return result;
        }, { table: "pipeline_step_executions", operation: "insert" });
    },

    /**
     * Get a single step execution by ID
     */
    async getStepExecution(id: number) {
        return withQueryTracking("pipelineService.getStepExecution", async () => {
            const [result] = await db
                .select()
                .from(pipelineStepExecutions)
                .where(eq(pipelineStepExecutions.id, id))
                .limit(1);
            return result || null;
        }, { table: "pipeline_step_executions", operation: "select" });
    },

    /**
     * Update step execution record
     */
    async updateStepExecution(id: number, update: any): Promise<any> {
        return withQueryTracking("pipelineService.updateStepExecution", async () => {
            const [result] = await db
                .update(pipelineStepExecutions)
                .set(update)
                .where(eq(pipelineStepExecutions.id, id))
                .returning();
            return result;
        }, { table: "pipeline_step_executions", operation: "update" });
    },

    /**
     * Get Latest Run with details
     */
    async getLatestRun(pipelineId: number, orgContext: OrgContext): Promise<any> {
        return withQueryTracking("pipelineService.getLatestRun", async () => {
            await pipelineEngine.getById(pipelineId, orgContext);

            const [latestExec] = await db
                .select({ id: pipelineExecutions.id })
                .from(pipelineExecutions)
                .where(and(eq(pipelineExecutions.pipelineId, pipelineId), isNull(pipelineExecutions.deletedAt)))
                .orderBy(desc(pipelineExecutions.startedAt))
                .limit(1);

            if (!latestExec) {
                return null;
            }

            const executionId = latestExec.id;

            const [execution] = await db
                .select()
                .from(pipelineExecutions)
                .where(eq(pipelineExecutions.id, executionId))
                .limit(1);

            const stepResults = await db
                .select()
                .from(pipelineStepExecutions)
                .where(eq(pipelineStepExecutions.pipelineExecutionId, executionId))
                .orderBy(pipelineStepExecutions.stepOrder);

            return {
                ...execution,
                stepResults,
            };
        }, { table: "pipeline_executions", operation: "select" });
    },

    /**
     * List executions for a specific mission
     */
    async listExecutionsByMissionId(missionId: number, orgContext: OrgContext) {
        return withQueryTracking("pipelineService.listExecutionsByMissionId", async () => {
            const conditions: SQL[] = [eq(pipelineExecutions.missionId, missionId)];
            if (orgContext.organizationId !== null) {
                conditions.push(eq(pipelineExecutions.organizationId, orgContext.organizationId));
            }

            return await db
                .select()
                .from(pipelineExecutions)
                .where(and(...conditions, isNull(pipelineExecutions.deletedAt)))
                .orderBy(desc(pipelineExecutions.startedAt));
        }, { table: "pipeline_executions", operation: "select" });
    },

    /**
     * Run multiple pipelines in parallel
     */
    async runBulk(
        runs: Array<{ pipelineId: number; input: RunPipelineInput }>,
        orgContext: OrgContext,
        options: { continueOnError?: boolean; maxConcurrency?: number } = {}
    ): Promise<Array<{ pipelineId: number; executionId?: number; status: 'success' | 'error'; error?: string }>> {
        const { continueOnError = true, maxConcurrency = 5 } = options;
        const results: Array<{ pipelineId: number; executionId?: number; status: 'success' | 'error'; error?: string }> = [];

        logger.info("Starting bulk pipeline execution", { count: runs.length, maxConcurrency });

        for (let i = 0; i < runs.length; i += maxConcurrency) {
            const batch = runs.slice(i, i + maxConcurrency);
            const batchPromises = batch.map(async ({ pipelineId, input }) => {
                try {
                    const execution = await this.run(pipelineId, input, orgContext);
                    return { pipelineId, executionId: execution.id, status: 'success' as const };
                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    logger.error("Bulk execution failed for pipeline", { pipelineId, error: errorMsg });
                    if (!continueOnError) {
                        throw error;
                    }
                    return { pipelineId, status: 'error' as const, error: errorMsg };
                }
            });

            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);
        }

        const successCount = results.filter(r => r.status === 'success').length;
        logger.info("Bulk pipeline execution completed", { total: runs.length, successful: successCount, failed: runs.length - successCount });

        return results;
    },

    /**
     * Cancel multiple executions at once
     */
    async cancelBulk(executionIds: number[], orgContext: OrgContext): Promise<{ cancelled: number; failed: number; errors: string[] }> {
        let cancelled = 0;
        let failed = 0;
        const errors: string[] = [];

        logger.info("Starting bulk cancellation", { count: executionIds.length });

        await Promise.all(executionIds.map(async (executionId) => {
            try {
                await this.cancelExecution(executionId, orgContext);
                cancelled++;
            } catch (error) {
                failed++;
                const errorMsg = error instanceof Error ? error.message : String(error);
                errors.push(`Execution ${executionId}: ${errorMsg}`);
                logger.warn("Failed to cancel execution", { executionId, error: errorMsg });
            }
        }));

        logger.info("Bulk cancellation completed", { cancelled, failed });
        return { cancelled, failed, errors };
    },
};


