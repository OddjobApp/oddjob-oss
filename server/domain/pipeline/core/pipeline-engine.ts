import { db } from "@server/database_service.js";
import {
    pipelines,
    pipelineSteps,
    pipelineVersions,
    pipelineTriggers,
    pipelineExecutions,
    jobs,
    credentials,
    pipelineInputParams,
    pipelineOutputParams,
    agentToolHints,
    missionRuns,
    appDeployments
} from "@shared/schema/index.js";
import { eq, and, or, sql, inArray, desc, asc, type SQL } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { withQueryTracking } from "@domain/knowledge/core/query-monitor.service.js";
import { NotFoundError, BadRequestError, ValidationError } from "@server/utils/errors.js";
import { getOrgConditions as getCanonicalOrgConditions } from "@server/utils/org-conditions.js";
import { pipelineGraph } from "./pipeline-graph.js";
import {
    type PipelineListOptions,
    type CreatePipelineInput,
    type UpdatePipelineInput,
    type CreatePipelineStepInput
} from "./types.js";
import { type OrgContext } from "../../jobs/job.service.js";

const logger = createLogger("PipelineCoreService");

/**
 * Org filter for pipeline queries.
 *
 * Delegates to the canonical helper rather than restating the rule. Kept as a
 * named export because `execution-manager.ts` and the pipeline tests import it
 * from here; every call site filters the `pipelines` table (including the
 * execution join), so binding the table here is correct.
 *
 * `allowGlobal: false` preserves the previous behaviour: a pipeline with a NULL
 * organization is NOT visible to an org-scoped user.
 */
export function getOrgConditions(orgContext: OrgContext): SQL[] {
    return getCanonicalOrgConditions(orgContext, pipelines, false);
}

export const pipelineEngine = {
    /**
     * List pipelines for an organization
     */
    async list(orgContext: OrgContext, options: PipelineListOptions = {}) {
        return withQueryTracking("pipelineService.list", async () => {
            const conditions: SQL[] = getOrgConditions(orgContext);

            if (options.pipelineIds && options.pipelineIds.length > 0) {
                conditions.push(inArray(pipelines.id, options.pipelineIds));
            }

            if (!options.includeInactive) {
                conditions.push(eq(pipelines.isActive, true));
            }

            const { getTableColumns } = await import("drizzle-orm");

            const pipelineColumns = getTableColumns(pipelines);
            let query = db
                .select({
                    ...pipelineColumns,
                    stepCount: sql<number>`COALESCE(COUNT(${pipelineSteps.id}), 0)`.as('stepCount'),
                })
                .from(pipelines)
                .leftJoin(pipelineSteps, eq(pipelines.id, pipelineSteps.pipelineId))
                .where(and(...conditions))
                .groupBy(...Object.values(pipelineColumns))
                .orderBy(desc(pipelines.createdAt));

            if (options.limit) {
                query = query.limit(options.limit) as typeof query;
            }

            return await query;
        }, { table: "pipelines", operation: "select" });
    },

    /**
     * Get pipeline by ID with steps
     */
    async getById(pipelineId: number, orgContext: OrgContext) {
        return withQueryTracking("pipelineService.getById", async () => {
            const conditions = [eq(pipelines.id, pipelineId), ...getOrgConditions(orgContext)];

            const [pipeline] = await db.select().from(pipelines).where(and(...conditions)).limit(1);
            if (!pipeline) {
                throw new NotFoundError("Pipeline not found");
            }

            const steps = await db
                .select()
                .from(pipelineSteps)
                .where(eq(pipelineSteps.pipelineId, pipelineId))
                .orderBy(asc(pipelineSteps.order));

            return { ...pipeline, steps };
        }, { table: "pipelines", operation: "select" });
    },

    /**
     * Create a new pipeline with steps
     */
    async create(input: CreatePipelineInput, orgContext: OrgContext) {
        return withQueryTracking("pipelineService.create", async () => {
            const { steps, eventConfig, ...pipelineData } = input;

            if (pipelineData.triggerType === 'webhook' && pipelineData.triggerCredentialId) {
                const [credential] = await db
                    .select()
                    .from(credentials)
                    .where(eq(credentials.id, pipelineData.triggerCredentialId))
                    .limit(1);

                if (!credential) throw new BadRequestError("Webhook credential not found");
                if (credential.type !== "webhook") throw new BadRequestError("Credential must be of type 'webhook'");
            }

            if (steps && steps.length > 0) {
                for (const step of steps) {
                    if (!step.jobId) {
                        // Skip job existence check for tool or forge-based steps
                        if (!step.toolName && !step.forgeConfig) {
                            throw new ValidationError("Step must have either a jobId, toolName, or forgeConfig");
                        }
                        continue;
                    }
                    logger.debug("Verifying job existence", { jobId: step.jobId, orgId: orgContext.organizationId });
                    const [job] = await db.select().from(jobs).where(and(
                        eq(jobs.id, step.jobId),
                        ...(orgContext.organizationId !== null ? [eq(jobs.organizationId, orgContext.organizationId)] : [sql`${jobs.organizationId} IS NULL` as any])
                    )).limit(1);
                    if (!job) {
                        logger.warn("Job lookup failed", { jobId: step.jobId, orgId: orgContext.organizationId });
                        throw new ValidationError(`Job ${step.jobId} not found or not accessible`);
                    }
                }
                pipelineGraph.validateSteps(steps);
            }

            const [pipeline] = await db.insert(pipelines).values({
                ...pipelineData,
                monthlyBudgetUsd: pipelineData.monthlyBudgetUsd ? String(pipelineData.monthlyBudgetUsd) : null,
                organizationId: orgContext.organizationId,
                createdBy: typeof orgContext.userId === 'string' ? orgContext.userId : 'system'
            }).returning();

            const pipelineId = pipeline.id;

            if (pipelineData.triggerType === 'event' && eventConfig) {
                if (!eventConfig.eventType) {
                    throw new BadRequestError("Event Type is required for Event triggers");
                }
                await db.insert(pipelineTriggers).values({
                    pipelineId,
                    eventType: eventConfig.eventType,
                    filterCondition: eventConfig.filterCondition || null,
                    isActive: true,
                });
            }

            if (steps && steps.length > 0) {
                await this.insertSteps(pipelineId, steps);
                await pipelineGraph.validateGraph(pipelineId);
            }

            try {
                await this.createSnapshot(pipelineId, typeof orgContext.userId === 'string' ? orgContext.userId : 'system', "Initial version", orgContext);
            } catch (snapshotError) {
                logger.warn("Failed to create initial snapshot", { error: snapshotError, pipelineId });
            }

            logger.info("Pipeline created", { pipelineId });

            // Index dataset READ edges from this pipeline's steps (fire-and-forget)
            import("@domain/xray/core/xray-indexing.service.js")
              .then(({ indexPipelineDatasetEdges }) =>
                indexPipelineDatasetEdges(pipelineId, orgContext.organizationId ?? null))
              .catch(() => {});

            return pipeline;
        }, { table: "pipelines", operation: "insert" });
    },

    /**
     * Update a pipeline
     */
    async update(pipelineId: number, input: UpdatePipelineInput, orgContext: OrgContext) {
        return withQueryTracking("pipelineService.update", async () => {
            const conditions = [eq(pipelines.id, pipelineId), ...getOrgConditions(orgContext)];

            const [existing] = await db.select().from(pipelines).where(and(...conditions)).limit(1);
            if (!existing) {
                throw new NotFoundError("Pipeline not found");
            }

            const { steps, eventConfig, ...pipelineData } = input;

            if (pipelineData.triggerType === 'webhook' && pipelineData.triggerCredentialId) {
                const [credential] = await db
                    .select()
                    .from(credentials)
                    .where(eq(credentials.id, pipelineData.triggerCredentialId))
                    .limit(1);

                if (!credential) throw new BadRequestError("Webhook credential not found");
                if (credential.type !== "webhook") throw new BadRequestError("Credential must be of type 'webhook'");
            }

            let updated;
            if (Object.keys(pipelineData).length > 0 || pipelineData.monthlyBudgetUsd !== undefined) {
                const [result] = await db
                    .update(pipelines)
                    .set({
                        ...pipelineData,
                        monthlyBudgetUsd: pipelineData.monthlyBudgetUsd ? String(pipelineData.monthlyBudgetUsd) : undefined
                    })
                    .where(and(...conditions))
                    .returning();
                updated = result;
            } else {
                updated = existing;
            }

            if (pipelineData.triggerType === 'event' && eventConfig) {
                if (!eventConfig.eventType) throw new ValidationError("Event Type is required for Event triggers");

                await db.delete(pipelineTriggers).where(eq(pipelineTriggers.pipelineId, pipelineId));
                await db.insert(pipelineTriggers).values({
                    pipelineId,
                    eventType: eventConfig.eventType,
                    filterCondition: eventConfig.filterCondition || null,
                    isActive: true
                });
            } else if (pipelineData.triggerType && pipelineData.triggerType !== 'event') {
                await db.delete(pipelineTriggers).where(eq(pipelineTriggers.pipelineId, pipelineId));
            }

            if (steps && Array.isArray(steps)) {
                pipelineGraph.validateSteps(steps);
                await db.delete(pipelineSteps).where(eq(pipelineSteps.pipelineId, pipelineId));
                if (steps.length > 0) {
                    await this.insertSteps(pipelineId, steps);
                    await pipelineGraph.validateGraph(pipelineId);
                }
            }

            try {
                await this.createSnapshot(pipelineId, orgContext.userId + "" || "system", "Auto-save", orgContext);
            } catch (err) {
                logger.warn("Failed to create auto-save snapshot", { error: err, pipelineId });
            }

            logger.info("Pipeline updated", { pipelineId });

            // Re-index dataset READ edges when steps change (fire-and-forget)
            if (steps !== undefined) {
              import("@domain/xray/core/xray-indexing.service.js")
                .then(({ indexPipelineDatasetEdges }) =>
                  indexPipelineDatasetEdges(pipelineId, orgContext.organizationId ?? null))
                .catch(() => {});
            }

            return updated;
        }, { table: "pipelines", operation: "update" });
    },

    /**
     * Helper to insert steps
     */
    async insertSteps(pipelineId: number, steps: CreatePipelineStepInput[]) {
        if (steps.length === 0) return;
        // Bulk insert — single round-trip regardless of step count
        await db.insert(pipelineSteps).values(
            steps.map((step, index) => ({
                pipelineId,
                jobId: step.jobId || null,
                order: step.order !== undefined ? step.order : index,
                outputName: step.outputName || null,
                runOnCondition: step.runOnCondition || "on_success",
                waitDurationSeconds: step.waitDurationSeconds || null,
                onFailureAction: step.onFailureAction || (step.onError === 'continue' ? "Continue to Next" : "Stop Pipeline"),
                fallbackJobId: step.fallbackJobId ?? null,
                parallelGroup: step.parallelGroup || null,
                conditionExpression: step.conditionExpression || step.condition || null,
                moduleType: step.moduleType || null,
                destinationStepId: step.destinationStepId || null,
                decisionNodeConfig: step.decisionNodeConfig || null,
                knowledgeGraphConfig: step.knowledgeGraphConfig || null,
                retryConfig: step.retryConfig || (step.maxRetries ? { maxRetries: step.maxRetries } : null),
                forgeConfig: step.forgeConfig || null,
                toolName: step.toolName || null,
                toolArguments: step.toolArguments || null,
            }))
        );
    },

    /**
     * Delete a pipeline
     */
    async delete(pipelineId: number, orgContext: OrgContext): Promise<void> {
        return withQueryTracking("pipelineService.delete", async () => {
            const conditions = [eq(pipelines.id, pipelineId), ...getOrgConditions(orgContext)];

            // Verify ownership before deleting
            const [pipeline] = await db.select({ id: pipelines.id })
                .from(pipelines)
                .where(and(...conditions))
                .limit(1);
            if (!pipeline) throw new NotFoundError("Pipeline not found");

            // Wrap all deletes in a transaction — partial deletes leave orphaned rows
            await db.transaction(async (tx) => {
                // NULL out NO ACTION foreign keys that block the delete
                await tx.update(missionRuns)
                    .set({ currentPipelineId: null })
                    .where(eq(missionRuns.currentPipelineId, pipelineId));
                await tx.update(appDeployments)
                    .set({ nextPipelineId: null })
                    .where(eq(appDeployments.nextPipelineId, pipelineId));

                await tx.delete(pipelineInputParams).where(eq(pipelineInputParams.pipelineId, pipelineId));
                await tx.delete(pipelineOutputParams).where(eq(pipelineOutputParams.pipelineId, pipelineId));
                await tx.delete(agentToolHints).where(eq(agentToolHints.pipelineId, pipelineId));
                await tx.delete(pipelineSteps).where(eq(pipelineSteps.pipelineId, pipelineId));
                await tx.delete(pipelineTriggers).where(eq(pipelineTriggers.pipelineId, pipelineId));
                await tx.delete(pipelines).where(and(...conditions));
            });

            logger.info("Pipeline deleted", { pipelineId });
        }, { table: "pipelines", operation: "delete" });
    },

    /**
     * Pipeline Input Params Methods
     */
    async getInputParams(pipelineId: number, orgContext: OrgContext) {
        await this.getById(pipelineId, orgContext);
        return await db.select().from(pipelineInputParams).where(eq(pipelineInputParams.pipelineId, pipelineId));
    },

    async createInputParam(pipelineId: number, data: any, orgContext: OrgContext) {
        await this.getById(pipelineId, orgContext);
        const [param] = await db.insert(pipelineInputParams).values({ ...data, pipelineId }).returning();
        return param;
    },

    async updateInputParam(pipelineId: number, paramId: number, data: any, orgContext: OrgContext) {
        await this.getById(pipelineId, orgContext);
        const [updated] = await db.update(pipelineInputParams)
            .set({ ...data, updatedAt: new Date() })
            .where(and(eq(pipelineInputParams.id, paramId), eq(pipelineInputParams.pipelineId, pipelineId)))
            .returning();
        if (!updated) throw new NotFoundError("Input parameter not found");
        return updated;
    },

    async deleteInputParam(pipelineId: number, paramId: number, orgContext: OrgContext) {
        await this.getById(pipelineId, orgContext);
        const [deleted] = await db.delete(pipelineInputParams)
            .where(and(eq(pipelineInputParams.id, paramId), eq(pipelineInputParams.pipelineId, pipelineId)))
            .returning();
        if (!deleted) throw new NotFoundError("Input parameter not found");
        return true;
    },

    /**
     * Pipeline Output Params Methods
     */
    async getOutputParams(pipelineId: number, orgContext: OrgContext) {
        await this.getById(pipelineId, orgContext);
        return await db.select().from(pipelineOutputParams).where(eq(pipelineOutputParams.pipelineId, pipelineId));
    },

    async createOutputParam(pipelineId: number, data: any, orgContext: OrgContext) {
        await this.getById(pipelineId, orgContext);
        const [param] = await db.insert(pipelineOutputParams).values({ ...data, pipelineId }).returning();
        return param;
    },

    async updateOutputParam(pipelineId: number, paramId: number, data: any, orgContext: OrgContext) {
        await this.getById(pipelineId, orgContext);
        const [updated] = await db.update(pipelineOutputParams)
            .set({ ...data, updatedAt: new Date() })
            .where(and(eq(pipelineOutputParams.id, paramId), eq(pipelineOutputParams.pipelineId, pipelineId)))
            .returning();
        if (!updated) throw new NotFoundError("Output parameter not found");
        return updated;
    },

    async deleteOutputParam(pipelineId: number, paramId: number, orgContext: OrgContext) {
        await this.getById(pipelineId, orgContext);
        const [deleted] = await db.delete(pipelineOutputParams)
            .where(and(eq(pipelineOutputParams.id, paramId), eq(pipelineOutputParams.pipelineId, pipelineId)))
            .returning();
        if (!deleted) throw new NotFoundError("Output parameter not found");
        return true;
    },

    /**
     * Create Pipeline Snapshot
     */
    async createSnapshot(pipelineId: number, userId: string | null, description?: string, orgContext?: OrgContext): Promise<any> {
        return withQueryTracking("pipelineService.createSnapshot", async () => {
            return await db.transaction(async (tx) => {
                const [pipeline] = await tx
                    .select()
                    .from(pipelines)
                    .where(eq(pipelines.id, pipelineId))
                    .limit(1);

                if (!pipeline) {
                    throw new Error("Pipeline not found");
                }

                const steps = await tx
                    .select()
                    .from(pipelineSteps)
                    .where(eq(pipelineSteps.pipelineId, pipelineId))
                    .orderBy(pipelineSteps.order);

                const lastVersion = await tx
                    .select()
                    .from(pipelineVersions)
                    .where(eq(pipelineVersions.pipelineId, pipelineId))
                    .orderBy(desc(pipelineVersions.versionNumber))
                    .limit(1);

                const nextVersion = (lastVersion[0]?.versionNumber || 0) + 1;

                const snapshot = {
                    pipeline: {
                        name: pipeline.name,
                        description: pipeline.description,
                        triggerType: pipeline.triggerType,
                        triggerCredentialId: pipeline.triggerCredentialId,
                        labels: pipeline.labels,
                        isActive: pipeline.isActive,
                        organizationId: pipeline.organizationId,
                        createdBy: pipeline.createdBy,
                    },
                    steps: steps.map((step) => ({
                        jobId: step.jobId,
                        order: step.order,
                        outputName: step.outputName,
                        runOnCondition: step.runOnCondition,
                        waitDurationSeconds: step.waitDurationSeconds,
                        onFailureAction: step.onFailureAction,
                        parallelGroup: step.parallelGroup,
                        conditionExpression: step.conditionExpression,
                        moduleType: step.moduleType,
                        destinationStepId: step.destinationStepId,
                        decisionNodeConfig: step.decisionNodeConfig,
                    })),
                };

                const [newVersion] = await tx.insert(pipelineVersions).values({
                    pipelineId,
                    versionNumber: nextVersion,
                    snapshot,
                    description: description || `v${nextVersion} manual snapshot`,
                    createdBy: userId,
                }).returning();

                await tx
                    .update(pipelines)
                    .set({ currentVersion: nextVersion })
                    .where(eq(pipelines.id, pipelineId));

                return newVersion;
            });
        }, { table: "pipeline_versions", operation: "insert" });
    },

    /**
     * List steps for a pipeline (Internal/System use mainly)
     */
    async listSteps(pipelineId: number) {
        return withQueryTracking("pipelineService.listSteps", async () => {
            return await db.select().from(pipelineSteps).where(eq(pipelineSteps.pipelineId, pipelineId));
        }, { table: "pipeline_steps", operation: "select" });
    },

    /**
     * Get a specific pipeline step by ID
     */
    async getStepById(stepId: number) {
        return withQueryTracking("pipelineService.getStepById", async () => {
            const [step] = await db.select().from(pipelineSteps).where(eq(pipelineSteps.id, stepId));
            if (!step) throw new NotFoundError("Pipeline step not found");
            return step;
        }, { table: "pipeline_steps", operation: "select" });
    },

    /**
     * Get pipeline by ID (System/Internal use - skips org check)
     */
    async getSystem(pipelineId: number) {
        return withQueryTracking("pipelineService.getSystem", async () => {
            const [pipeline] = await db.select().from(pipelines).where(eq(pipelines.id, pipelineId));
            return pipeline;
        }, { table: "pipelines", operation: "select" });
    },

    /**
     * Get pipeline usage for a job
     */
    async getJobPipelineUsage(jobId: number): Promise<any[]> {
        return withQueryTracking("pipelineService.getJobPipelineUsage", async () => {
            return await db
                .select({
                    id: pipelines.id,
                    name: pipelines.name,
                    isActive: pipelines.isActive
                })
                .from(pipelineSteps)
                .innerJoin(pipelines, eq(pipelineSteps.pipelineId, pipelines.id))
                .where(eq(pipelineSteps.jobId, jobId));
        }, { table: "pipeline_steps", operation: "select" });
    },

    /**
     * Get pipeline usage for multiple jobs
     */
    async getBulkJobPipelineUsage(jobIds: number[]): Promise<any[]> {
        return withQueryTracking("pipelineService.getBulkJobPipelineUsage", async () => {
            if (!jobIds || jobIds.length === 0) return [];
            return await db
                .select({
                    pipelineId: pipelines.id,
                    pipelineName: pipelines.name,
                    isActive: pipelines.isActive,
                    jobId: pipelineSteps.jobId
                })
                .from(pipelineSteps)
                .innerJoin(pipelines, eq(pipelineSteps.pipelineId, pipelines.id))
                .where(inArray(pipelineSteps.jobId, jobIds));
        }, { table: "pipeline_steps", operation: "select" });
    },

    async findPipelinesUsingTopic(topicId: number, orgContext: OrgContext) {
        return withQueryTracking("pipelineService.findPipelinesUsingTopic", async () => {
            const conditions = [
                orgContext.organizationId ? eq(pipelines.organizationId, orgContext.organizationId) : sql`${pipelines.organizationId} IS NULL`,
                sql`${jobs.config}::text LIKE ${'%"topicIds"%' + topicId + '%'}`
            ];

            return await db
                .selectDistinct({ id: pipelines.id, name: pipelines.name })
                .from(pipelines)
                .innerJoin(pipelineSteps, eq(pipelineSteps.pipelineId, pipelines.id))
                .innerJoin(jobs, eq(jobs.id, pipelineSteps.jobId))
                .where(and(...conditions))
                .limit(5);
        }, { table: "pipelines", operation: "select" });
    },

    /**
     * Get enriched pipeline details (with steps and job info)
     */
    async getEnrichedById(pipelineId: number, orgContext: OrgContext) {
        return withQueryTracking("pipelineService.getEnrichedById", async () => {
            const conditions = [eq(pipelines.id, pipelineId), ...getOrgConditions(orgContext)];
            const [pipeline] = await db.select().from(pipelines).where(and(...conditions)).limit(1);

            if (!pipeline) {
                throw new NotFoundError("Pipeline not found");
            }

            const steps = await db.select({
                id: pipelineSteps.id,
                jobId: pipelineSteps.jobId,
                order: pipelineSteps.order,
                outputName: pipelineSteps.outputName,
                runOnCondition: pipelineSteps.runOnCondition,
                waitDurationSeconds: pipelineSteps.waitDurationSeconds,
                onFailureAction: pipelineSteps.onFailureAction,
                parallelGroup: pipelineSteps.parallelGroup,
                conditionExpression: pipelineSteps.conditionExpression,
                moduleType: pipelineSteps.moduleType,
                destinationStepId: pipelineSteps.destinationStepId,
                decisionNodeConfig: pipelineSteps.decisionNodeConfig,
                forgeConfig: pipelineSteps.forgeConfig,
                jobName: jobs.name,
                jobTool: jobs.tool,
                jobOutputSchema: jobs.outputSchema
            })
                .from(pipelineSteps)
                .leftJoin(jobs, eq(pipelineSteps.jobId, jobs.id))
                .where(eq(pipelineSteps.pipelineId, pipelineId))
                .orderBy(asc(pipelineSteps.order));

            return { ...pipeline, steps };
        }, { table: "pipelines", operation: "select" });
    },

    /**
     * Get Triggers for a Pipeline
     */
    async getTriggersByPipelineId(pipelineId: number, orgContext: OrgContext) {
        return withQueryTracking("pipelineService.getTriggersByPipelineId", async () => {
            // Access check
            await this.getById(pipelineId, orgContext);
            return await db
                .select()
                .from(pipelineTriggers)
                .where(eq(pipelineTriggers.pipelineId, pipelineId));
        }, { table: "pipeline_triggers", operation: "select" });
    },

    /**
     * Create a Trigger for a Pipeline
     */
    async createTrigger(pipelineId: number, data: any, orgContext: OrgContext) {
        return withQueryTracking("pipelineService.createTrigger", async () => {
            await this.getById(pipelineId, orgContext);
            const [trigger] = await db
                .insert(pipelineTriggers)
                .values({ ...data, pipelineId })
                .returning();
            return trigger;
        }, { table: "pipeline_triggers", operation: "insert" });
    },

    /**
     * Update a Trigger
     */
    async updateTrigger(pipelineId: number, triggerId: number, data: any, orgContext: OrgContext) {
        return withQueryTracking("pipelineService.updateTrigger", async () => {
            await this.getById(pipelineId, orgContext);
            const [updated] = await db
                .update(pipelineTriggers)
                .set({ ...data })
                .where(and(eq(pipelineTriggers.id, triggerId), eq(pipelineTriggers.pipelineId, pipelineId)))
                .returning();
            if (!updated) throw new NotFoundError("Trigger not found");
            return updated;
        }, { table: "pipeline_triggers", operation: "update" });
    },

    /**
     * Delete a Trigger
     */
    async deleteTrigger(pipelineId: number, triggerId: number, orgContext: OrgContext) {
        return withQueryTracking("pipelineService.deleteTrigger", async () => {
            await this.getById(pipelineId, orgContext);
            const [deleted] = await db
                .delete(pipelineTriggers)
                .where(and(eq(pipelineTriggers.id, triggerId), eq(pipelineTriggers.pipelineId, pipelineId)))
                .returning();
            if (!deleted) throw new NotFoundError("Trigger not found");
            return true;
        }, { table: "pipeline_triggers", operation: "delete" });
    },

    /**
     * Promote a specific run's output to be the Gold Baseline for the pipeline
     */
    async promoteToBaseline(pipelineId: number, runId: number, orgContext: OrgContext) {
        return withQueryTracking("pipelineService.promoteToBaseline", async () => {
            // 1. Verify access
            await this.getById(pipelineId, orgContext);

            // 2. Fetch the run (execution)
            const [execution] = await db
                .select()
                .from(pipelineExecutions)
                .where(and(eq(pipelineExecutions.id, runId), eq(pipelineExecutions.pipelineId, pipelineId)))
                .limit(1);

            if (!execution) throw new NotFoundError("Pipeline run not found");
            if (execution.status !== 'completed') throw new BadRequestError("Only completed runs can be promoted to baseline");

            // 3. Update the pipeline with the baseline output
            const [updated] = await db
                .update(pipelines)
                .set({
                    baselineRunId: runId,
                    baselineOutput: null // Step-level outputs are in pipeline_step_executions
                })
                .where(eq(pipelines.id, pipelineId))
                .returning();

            logger.info("Pipeline baseline updated", { pipelineId, runId });
            return updated;
        }, { table: "pipelines", operation: "update" });
    },
};


