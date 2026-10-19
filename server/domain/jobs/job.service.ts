/**
 * Job Service
 * 
 * Business logic layer for job operations.
 * Separates domain logic from HTTP handling.
 * 
 * Benefits:
 * - Testable without HTTP layer
 * - Reusable from multiple entry points (API, CLI, workers)
 * - Clear transaction boundaries
 */

import { db } from "@server/database_service.js";
import { jobs, orgs, orgSettings, jobCollections, jobCollectionItems, outputStorageSettingsSchema, users, type Job } from "@shared/schema/index.js";
import { topicService } from "@domain/knowledge/core/topic-service.js";
import { eq, and, desc, sql, inArray, type SQL } from "drizzle-orm";
import { NotFoundError, BadRequestError, ForbiddenError, JobNotFoundError, ValidationError, ConflictError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";
import { withQueryTracking } from "@domain/knowledge/core/query-monitor.service.js";
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { configValidationService } from "./core/config-validation.service.js";

const tracer = trace.getTracer('job-service');

const logger = createLogger("JobService");

// ============================================================================
// TYPES
// ============================================================================

import type { OrgContext } from "@server/utils/auth-context.js";
export type { OrgContext } from "@server/utils/auth-context.js";

export interface CreateJobInput {
    name: string;
    type: string;
    description?: string | null;
    config?: Record<string, any> | null;
    isActive?: boolean;
    isHidden?: boolean | null;
    lifecycleStatus?: string;
    priority?: number;
    tool?: string;
    parameterSchema?: Record<string, any> | null;
    outputDatasetId?: number | null;
    enableKnowledgeStore?: boolean;
    outputKnowledgeTopicId?: number | null;
    outputTags?: string[] | null;
    outputStorageSettings?: Record<string, any> | null;
}

export interface UpdateJobInput extends Partial<CreateJobInput> {
    outputStorageSettings?: any;
    outputTags?: string[] | null;
}

export interface JobListOptions {
    type?: string;
    includeDrafts?: boolean;
    includeHidden?: boolean;
    limit?: number;
    offset?: number;
    search?: string;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Build org-scoped conditions
 */
function getOrgConditions(orgContext: OrgContext): SQL[] {
    return orgContext.organizationId !== null
        ? [eq(jobs.organizationId, orgContext.organizationId)]
        : [sql`${jobs.organizationId} IS NULL`];
}

/**
 * Get user by ID
 */
async function getUser(userId: string) {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    return user;
}

/**
 * Validate knowledge topic access
 */
async function validateKnowledgeTopic(topicId: number, orgContext: OrgContext): Promise<void> {
    const topic = await topicService.getTopicById(topicId, orgContext);

    if (!topic) {
        throw new BadRequestError("Selected knowledge topic not found or access denied");
    }
}

// ============================================================================
// JOB SERVICE
// ============================================================================

export const jobService = {
    /**
     * List jobs for an organization (with pagination)
     */
    async list(orgContext: OrgContext, options: JobListOptions = {}): Promise<{ items: Job[], total: number }> {
        return withQueryTracking("jobService.list", async () => {
            const conditions: SQL[] = getOrgConditions(orgContext);

            // Filter hidden jobs unless explicitly requested
            if (!options.includeHidden) {
                conditions.push(sql`${jobs.isHidden} IS NOT TRUE`);
            }

            // Filter drafts unless explicitly requested
            if (!options.includeDrafts) {
                conditions.push(sql`${jobs.lifecycleStatus} != 'draft'`);
            }

            // Filter by type if provided
            if (options.type) {
                conditions.push(eq(jobs.type, options.type));
            }

            // Filter by search query if provided
            if (options.search) {
                const searchPattern = `%${options.search}%`;
                conditions.push(
                    sql`(${jobs.name} ILIKE ${searchPattern} OR ${jobs.description} ILIKE ${searchPattern})`
                );
            }

            const whereClause = and(...conditions);

            // Get total count
            const [countResult] = await db
                .select({ count: sql<number>`count(*)` })
                .from(jobs)
                .where(whereClause);

            const total = Number(countResult?.count || 0);

            let query = db
                .select()
                .from(jobs)
                .where(whereClause)
                .orderBy(desc(jobs.createdAt));

            if (options.limit) {
                query = query.limit(options.limit) as typeof query;
            }
            if (options.offset) {
                query = query.offset(options.offset) as typeof query;
            }

            const items = await query;

            logger.debug(`Listed ${items.length} jobs (Total: ${total})`, {
                organizationId: orgContext.organizationId,
                count: items.length,
                total
            });

            return { items, total };
        }, { table: "jobs", operation: "select" });
    },

    /**
     * Get job by ID with access control
     */
    async getById(jobId: number, orgContext: OrgContext): Promise<Job> {
        return withQueryTracking("jobService.getById", async () => {
            const [job] = await db
                .select()
                .from(jobs)
                .where(eq(jobs.id, jobId))
                .limit(1);

            if (!job) {
                throw new JobNotFoundError(jobId);
            }

            // Check org access
            const isContextMatch =
                orgContext.organizationId === null ||
                job.organizationId === null ||
                job.organizationId === orgContext.organizationId;

            if (!isContextMatch) {
                // Check if user has access to target org
                const hasAccess = await this.checkCrossOrgAccess(job.organizationId, orgContext.userId);

                if (hasAccess) {
                    let orgName = "Global";
                    if (job.organizationId) {
                        const [org] = await db.select().from(orgs).where(eq(orgs.id, job.organizationId)).limit(1);
                        if (org) orgName = org.name;
                    }
                    throw new ForbiddenError(
                        `This job belongs to organization "${orgName}". Please switch organizations to view it.`,
                        { targetOrganizationId: job.organizationId }
                    );
                }

                throw new JobNotFoundError(jobId);
            }

            return job;
        }, { table: "jobs", operation: "select" });
    },

    /**
     * Get multiple jobs by ID with access control
     */
    async getByIds(jobIds: number[], orgContext: OrgContext): Promise<Job[]> {
        if (jobIds.length === 0) return [];

        return withQueryTracking("jobService.getByIds", async () => {
            const accessibleJobs = await db
                .select()
                .from(jobs)
                .where(inArray(jobs.id, jobIds));

            // Filter by org access
            return accessibleJobs.filter(job => {
                return orgContext.organizationId === null ||
                    job.organizationId === null ||
                    job.organizationId === orgContext.organizationId;
            });
        }, { table: "jobs", operation: "select" });
    },

    /**
     * Alias for getById to maintain backward compatibility
     */
    async getJob(jobId: number, orgContext: OrgContext): Promise<Job> {
        return this.getById(jobId, orgContext);
    },

    /**
     * Create a new job
     */
    async create(input: CreateJobInput, orgContext: OrgContext): Promise<Job> {
        return withQueryTracking("jobService.create", async () => {
            const user = await getUser(orgContext.userId);
            if (!user) {
                throw new NotFoundError("User not found");
            }

            // Validate knowledge topic if specified
            if (input.enableKnowledgeStore && input.outputKnowledgeTopicId) {
                await validateKnowledgeTopic(input.outputKnowledgeTopicId, orgContext);
            }

            // Check for deprecated job types
            const deprecatedTypes = ['api'];
            if (deprecatedTypes.includes(input.type)) {
                throw new ValidationError(`Job type '${input.type}' is deprecated. Use 'curl' instead.`);
            }

            // Check allowed job types
            if (orgContext.organizationId) {
                const [settings] = await db
                    .select()
                    .from(orgSettings)
                    .where(eq(orgSettings.organizationId, orgContext.organizationId))
                    .limit(1);

                if (settings?.allowedJobTypes && settings.allowedJobTypes.length > 0) {
                    if (!settings.allowedJobTypes.includes(input.type)) {
                        throw new ForbiddenError(`Job type '${input.type}' is not allowed in this organization.`);
                    }
                } else if (settings?.allowedJobTypes && settings.allowedJobTypes.length === 0) {
                    // If array exists but is empty, it means explicit "Disable All"
                    throw new ForbiddenError(`No job types are allowed in this organization.`);
                }
            }

            const isDraft = input.lifecycleStatus === "draft" || input.isActive === false;
            if (!isDraft) {
                const validation = configValidationService.validate(input.type, input.config || {});
                if (!validation.valid) {
                    throw new ValidationError("Job configuration is not ready for activation", {
                        errors: validation.errors,
                        suggestions: validation.suggestions,
                    });
                }
            }

            const [job] = await db.insert(jobs).values({
                name: input.name,
                type: input.type,
                description: input.description,
                config: input.config || {},
                isActive: input.isActive ?? true,
                isHidden: input.isHidden ?? false,
                lifecycleStatus: input.lifecycleStatus || "active",
                outputDatasetId: input.outputDatasetId,
                enableKnowledgeStore: input.enableKnowledgeStore,
                outputKnowledgeTopicId: input.outputKnowledgeTopicId,
                organizationId: orgContext.organizationId,
                createdBy: user.username,
                // Enhanced fields
                priority: input.priority || 2,
                tool: input.tool || "None",
                parameterSchema: input.parameterSchema || null,
                outputTags: input.outputTags || [],
                outputStorageSettings: input.outputStorageSettings || null
            }).returning();

            logger.info("Job created", {
                jobId: job.id,
                name: job.name,
                type: job.type,
                organizationId: orgContext.organizationId,
            });

            // Index dataset READ edges from this job's config (fire-and-forget)
            import("@domain/xray/core/xray-indexing.service.js")
              .then(({ indexJobDatasetEdges }) => indexJobDatasetEdges(job.id, job.organizationId ?? null))
              .catch(() => {});

            return job;
        }, { table: "jobs", operation: "insert" });
    },

    /**
     * Update a job
     */
    async update(jobId: number, input: UpdateJobInput, orgContext: OrgContext): Promise<Job> {
        return withQueryTracking("jobService.update", async () => {
            const conditions = [eq(jobs.id, jobId), ...getOrgConditions(orgContext)];

            // Get current job for validation
            const [currentJob] = await db.select().from(jobs).where(and(...conditions)).limit(1);
            if (!currentJob) {
                throw new JobNotFoundError(jobId);
            }

            // Check allowed job types if type is changing
            if (input.type && input.type !== currentJob.type && orgContext.organizationId) {
                const [settings] = await db
                    .select()
                    .from(orgSettings)
                    .where(eq(orgSettings.organizationId, orgContext.organizationId))
                    .limit(1);

                if (settings?.allowedJobTypes) {
                    if (!settings.allowedJobTypes.includes(input.type)) {
                        throw new ForbiddenError(`Job type '${input.type}' is not allowed in this organization.`);
                    }
                }
            }

            // Validate knowledge store configuration
            if (input.enableKnowledgeStore !== undefined || input.outputKnowledgeTopicId !== undefined) {
                await this.validateKnowledgeStoreUpdate(input, currentJob, orgContext);
            }

            // Validate output storage settings
            if (input.outputStorageSettings) {
                outputStorageSettingsSchema.parse(input.outputStorageSettings);
            }

            const nextIsActive = input.isActive ?? currentJob.isActive;
            const nextLifecycleStatus = input.lifecycleStatus ?? currentJob.lifecycleStatus;
            const activationRelevantChange =
                input.isActive === true ||
                input.lifecycleStatus === "active" ||
                input.config !== undefined ||
                input.type !== undefined;

            if (activationRelevantChange && nextIsActive && nextLifecycleStatus !== "draft") {
                const validation = configValidationService.validate(
                    input.type || currentJob.type,
                    input.config ?? currentJob.config,
                );
                if (!validation.valid) {
                    throw new ValidationError("Job configuration is not ready for activation", {
                        errors: validation.errors,
                        suggestions: validation.suggestions,
                    });
                }
            }

            const [updated] = await db
                .update(jobs)
                .set({ ...input, updatedAt: new Date() })
                .where(and(...conditions))
                .returning();

            if (!updated) {
                throw new JobNotFoundError(jobId);
            }

            logger.info("Job updated", { jobId });

            // Re-index dataset READ edges if config changed (fire-and-forget)
            if (input.config !== undefined) {
              import("@domain/xray/core/xray-indexing.service.js")
                .then(({ indexJobDatasetEdges }) => indexJobDatasetEdges(jobId, updated.organizationId ?? null))
                .catch(() => {});
            }

            return updated;
        }, { table: "jobs", operation: "update" });
    },

    /**
     * Delete a job
     */
    async delete(jobId: number, orgContext: OrgContext): Promise<void> {
        return withQueryTracking("jobService.delete", async () => {
            // Check for pipeline dependencies
            const { pipelineSteps, pipelines } = await import("@shared/schema/index.js");

            const dependentSteps = await db
                .select({
                    pipelineName: pipelines.name,
                    pipelineId: pipelines.id
                })
                .from(pipelineSteps)
                .innerJoin(pipelines, eq(pipelineSteps.pipelineId, pipelines.id))
                .where(eq(pipelineSteps.jobId, jobId));

            if (dependentSteps.length > 0) {
                // Deduplicate pipelines
                const uniquePipelines = Array.from(
                    new Map(dependentSteps.map(item => [item.pipelineId, item])).values()
                );

                throw new ConflictError(JSON.stringify({
                    message: "Cannot delete job because it is used in pipelines",
                    pipelines: uniquePipelines.map(p => ({ id: p.pipelineId, name: p.pipelineName }))
                }));
            }

            const conditions = [eq(jobs.id, jobId), ...getOrgConditions(orgContext)];
            await db.delete(jobs).where(and(...conditions));
            logger.info("Job deleted", { jobId });

            // Cleanup empty collections
            await this.cleanupEmptyCollections(orgContext);
        }, { table: "jobs", operation: "delete" });
    },

    /**
     * Bulk Update jobs
     */
    async bulkUpdate(jobIds: number[], data: UpdateJobInput, orgContext: OrgContext): Promise<{ success: number[], failed: { id: number, reason: string }[] }> {
        const success: number[] = [];
        const failed: { id: number, reason: string }[] = [];

        await db.transaction(async (tx) => {
            for (const id of jobIds) {
                try {
                    const conditions = [eq(jobs.id, id), ...getOrgConditions(orgContext)];
                    const [updated] = await tx
                        .update(jobs)
                        .set({ ...data, updatedAt: new Date() })
                        .where(and(...conditions))
                        .returning();

                    if (updated) {
                        success.push(id);
                    } else {
                        failed.push({ id, reason: "Job not found or access denied" });
                    }
                } catch (err: any) {
                    failed.push({ id, reason: err.message });
                    logger.warn("Failed to update job during bulk operation", { jobId: id, error: err.message });
                }
            }
        });

        return { success, failed };
    },

    /**
     * Bulk Delete jobs — batched implementation.
     *
     * Issues 3 queries regardless of input size:
     *   1. Batch SELECT job names for reporting.
     *   2. Batch dependency check — which jobs are used in pipelines.
     *   3. Batch DELETE for unblocked jobs + one cleanupEmptyCollections.
     */
    async bulkDelete(jobIds: number[], orgContext: OrgContext): Promise<{ success: number[], failed: { id: number, name: string, reason: string }[] }> {
        const success: number[] = [];
        const failed: { id: number, name: string, reason: string }[] = [];

        if (jobIds.length === 0) return { success, failed };

        const { pipelineSteps, pipelines } = await import("@shared/schema/index.js");

        // 1. Fetch job names in one query for error reporting
        const jobRows = await db
            .select({ id: jobs.id, name: jobs.name })
            .from(jobs)
            .where(and(inArray(jobs.id, jobIds), ...getOrgConditions(orgContext)));

        const nameMap = new Map(jobRows.map(j => [j.id, j.name]));

        // 2. Find all jobs that are blocked by pipeline dependencies (one batch join)
        const blockedRows = await db
            .select({
                jobId: pipelineSteps.jobId,
                pipelineId: pipelines.id,
                pipelineName: pipelines.name,
            })
            .from(pipelineSteps)
            .innerJoin(pipelines, eq(pipelineSteps.pipelineId, pipelines.id))
            .where(inArray(pipelineSteps.jobId, jobIds));

        // Group conflicts by jobId
        const conflictMap = new Map<number, { id: number; name: string }[]>();
        for (const row of blockedRows) {
            const jobId = row.jobId!;
            const pipelineId = row.pipelineId!;
            if (!conflictMap.has(jobId)) conflictMap.set(jobId, []);
            const existing = conflictMap.get(jobId)!;
            if (!existing.find(p => p.id === pipelineId)) {
                existing.push({ id: pipelineId, name: row.pipelineName });
            }
        }

        // Separate blocked from deletable
        const deletableIds: number[] = [];
        for (const id of jobIds) {
            const jobName = nameMap.get(id) ?? `ID: ${id}`;
            const conflicts = conflictMap.get(id);
            if (conflicts && conflicts.length > 0) {
                failed.push({
                    id,
                    name: jobName,
                    reason: `Cannot delete job because it is used in pipelines: ${conflicts.map(p => p.name).join(', ')}`,
                });
            } else {
                deletableIds.push(id);
            }
        }

        // 3. Batch delete the unblocked jobs
        if (deletableIds.length > 0) {
            try {
                await db.delete(jobs).where(and(
                    inArray(jobs.id, deletableIds),
                    ...getOrgConditions(orgContext),
                ));
                success.push(...deletableIds);
                logger.info("Jobs bulk deleted", { count: deletableIds.length, ids: deletableIds });
            } catch (err: any) {
                // If the batch delete fails (e.g. FK constraint), fall back to individual deletes
                // so we can report granular failures without losing the successful ones.
                logger.warn("Batch delete failed, falling back to individual deletes", { error: err.message });
                for (const id of deletableIds) {
                    try {
                        await db.delete(jobs).where(and(eq(jobs.id, id), ...getOrgConditions(orgContext)));
                        success.push(id);
                    } catch (individualErr: any) {
                        failed.push({ id, name: nameMap.get(id) ?? `ID: ${id}`, reason: individualErr.message });
                    }
                }
            }

            // Single cleanup pass for all deleted jobs
            await this.cleanupEmptyCollections(orgContext);
        }

        return { success, failed };
    },


    /**
     * Unlink a dataset from all jobs
     */
    async unlinkDataset(datasetId: number): Promise<void> {
        return withQueryTracking("jobService.unlinkDataset", async () => {
            await db.update(jobs)
                .set({ outputDatasetId: null })
                .where(eq(jobs.outputDatasetId, datasetId));

            logger.info("Dataset unlinked from jobs", { datasetId });
        }, { table: "jobs", operation: "update" });
    },

    /**
     * Copy a job
     */
    async copy(jobId: number, orgContext: OrgContext): Promise<Job> {
        return withQueryTracking("jobService.copy", async () => {
            const user = await getUser(orgContext.userId);
            if (!user) {
                throw new NotFoundError("User not found");
            }

            const sourceJob = await this.getById(jobId, orgContext);

            // Check if user is allowed to create this type of job
            if (orgContext.organizationId) {
                const [settings] = await db
                    .select()
                    .from(orgSettings)
                    .where(eq(orgSettings.organizationId, orgContext.organizationId))
                    .limit(1);

                if (settings?.allowedJobTypes && settings.allowedJobTypes.length > 0) {
                    if (!settings.allowedJobTypes.includes(sourceJob.type)) {
                        throw new ForbiddenError(`Job type '${sourceJob.type}' is not allowed in this organization.`);
                    }
                } else if (settings?.allowedJobTypes && settings.allowedJobTypes.length === 0) {
                    throw new ForbiddenError(`No job types are allowed in this organization.`);
                }
            }

            const { id, createdAt, updatedAt, createdBy, ...jobData } = sourceJob;

            const [newJob] = await db.insert(jobs).values({
                ...jobData,
                name: `${sourceJob.name} (Copy)`,
                createdBy: user.username,
                organizationId: orgContext.organizationId,
                lastTestedAt: null,
                lastTestStatus: null,
            }).returning();

            logger.info("Job copied", { sourceJobId: jobId, newJobId: newJob.id });
            return newJob;
        }, { table: "jobs", operation: "insert" });
    },

    /**
     * Store job output
     */
    async storeOutput(jobId: number, output: string, status?: string): Promise<{ stored: boolean; message: string }> {
        const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);

        if (!job) {
            throw new JobNotFoundError(jobId);
        }

        // Check if any output storage is configured
        if ((!job.enableKnowledgeStore || !job.outputKnowledgeTopicId) && !job.outputDatasetId) {
            return { stored: false, message: "No output storage configured" };
        }

        const { storeJobOutputAsKnowledge, getJobOutputStorageConfig } = await import("@domain/knowledge/core/knowledge-store.js");

        const settings = getJobOutputStorageConfig(job);

        // Store asynchronously
        storeJobOutputAsKnowledge({
            output,
            job,
            stepExecution: {
                id: 0,
                status: status || "success",
                executedAt: new Date(),
            },
            topicId: job.outputKnowledgeTopicId,
            datasetId: job.outputDatasetId,
            tags: job.outputTags || [],
            settings,
        }).catch((error: any) => {
            logger.error("Failed to store job output", error, { jobId });
        });

        return { stored: true, message: "Output storage initiated" };
    },

    /**
     * Get pipeline usage for a job
     */
    async getPipelineStatus(jobId: number, orgContext: OrgContext): Promise<any[]> {
        const job = await this.getById(jobId, orgContext);
        const { pipelineService } = await import("@domain/pipeline/core/pipeline.service.js");
        return pipelineService.getJobPipelineUsage(jobId);
    },

    /**
     * Get pipeline usage for multiple jobs
     */
    async getBulkPipelineStatus(jobIds: number[], orgContext: OrgContext): Promise<Record<number, any[]>> {
        const { pipelineService } = await import("@domain/pipeline/core/pipeline.service.js");
        const { inArray } = await import("drizzle-orm");

        // Validate access to all jobs in bulk
        const conditions = [inArray(jobs.id, jobIds), ...getOrgConditions(orgContext)];
        const accessibleJobs = await db.select({ id: jobs.id }).from(jobs).where(and(...conditions));
        const accessibleIds = accessibleJobs.map(j => j.id);

        if (accessibleIds.length === 0) return {};

        const rawResults = await pipelineService.getBulkJobPipelineUsage(accessibleIds);

        // Group by jobId
        const results: Record<number, any[]> = {};
        for (const row of rawResults) {
            if (!results[row.jobId]) results[row.jobId] = [];
            results[row.jobId].push({
                id: row.pipelineId,
                name: row.pipelineName,
                isActive: row.isActive
            });
        }
        return results;
    },

    /**
     * Get recent executions for a job
     */
    async getJobExecutions(jobId: number, limit: number, orgContext: OrgContext) {
        // Verify access via getById
        await this.getById(jobId, orgContext);

        const { pipelineStepExecutions, aiUsageLogs } = await import("@shared/schema/index.js");
        const { desc } = await import("drizzle-orm");

        return withQueryTracking("jobService.getJobExecutions", async () => {
            return await db
                .select({
                    id: pipelineStepExecutions.id,
                    jobId: pipelineStepExecutions.jobId,
                    status: pipelineStepExecutions.status,
                    executedAt: pipelineStepExecutions.executedAt,
                    completedAt: pipelineStepExecutions.completedAt,
                    executionStats: pipelineStepExecutions.executionStats,
                    traceId: pipelineStepExecutions.traceId,
                    aiUsage: {
                        costUsd: aiUsageLogs.costUsd,
                        totalTokens: aiUsageLogs.totalTokens
                    }
                })
                .from(pipelineStepExecutions)
                .leftJoin(aiUsageLogs, eq(pipelineStepExecutions.id, aiUsageLogs.stepExecutionId))
                .where(eq(pipelineStepExecutions.jobId, jobId))
                .orderBy(desc(pipelineStepExecutions.executedAt))
                .limit(limit);
        }, { table: "pipelineStepExecutions", operation: "select" });
    },

    async findJobsUsingTopic(topicId: number, orgContext: OrgContext) {
        return withQueryTracking("jobService.findJobsUsingTopic", async () => {
            const conditions = getOrgConditions(orgContext);
            return await db.select().from(jobs).where(and(
                ...conditions,
                sql`${jobs.config}::text LIKE ${'%"topicIds"%' + topicId + '%'}`
            )).limit(10);
        }, { table: "jobs", operation: "select" });
    },

    // ========================================================================
    // PRIVATE HELPERS
    // ========================================================================

    async checkCrossOrgAccess(targetOrgId: number | null, userId: string): Promise<boolean> {
        const { validateOrgAccess } = await import("@server/utils/auth-context.js");
        return validateOrgAccess(targetOrgId, userId);
    },

    async validateKnowledgeStoreUpdate(
        input: UpdateJobInput,
        currentJob: Job,
        orgContext: OrgContext
    ): Promise<void> {
        const isEnabling = input.enableKnowledgeStore === true;
        const isDisabling = input.enableKnowledgeStore === false;
        const isUpdatingTopic = input.outputKnowledgeTopicId !== undefined;
        const isRemovingTopic = isUpdatingTopic && input.outputKnowledgeTopicId === null;

        if (isEnabling) {
            const topicId = input.outputKnowledgeTopicId ?? currentJob.outputKnowledgeTopicId;
            if (!topicId) {
                throw new BadRequestError("Knowledge topic is required when enabling knowledge store");
            }
        }

        if (!isDisabling && currentJob.enableKnowledgeStore && isRemovingTopic) {
            throw new BadRequestError(
                "Cannot remove knowledge topic while knowledge store is enabled. Please disable knowledge store first."
            );
        }

        const willBeEnabled = input.enableKnowledgeStore ?? currentJob.enableKnowledgeStore;
        if (willBeEnabled && !isDisabling && isUpdatingTopic && !isRemovingTopic) {
            const topicId = input.outputKnowledgeTopicId;
            if (topicId) {
                await validateKnowledgeTopic(topicId, orgContext);
            }
        }
    },

    /**
     * Delete any collections that no longer have any jobs
     */
    async cleanupEmptyCollections(orgContext: OrgContext): Promise<void> {
        return withQueryTracking("jobService.cleanupEmptyCollections", async () => {
            const orgConditions = orgContext.organizationId !== null
                ? [eq(jobCollections.organizationId, orgContext.organizationId)]
                : [sql`${jobCollections.organizationId} IS NULL`];

            // Find collections with 0 items
            const emptyCollections = await db
                .select({ id: jobCollections.id })
                .from(jobCollections)
                .leftJoin(jobCollectionItems, eq(jobCollections.id, jobCollectionItems.collectionId))
                .where(and(
                    ...orgConditions,
                    sql`${jobCollectionItems.jobId} IS NULL`
                ));

            if (emptyCollections.length > 0) {
                const idsToDelete = emptyCollections.map(c => c.id);
                await db.delete(jobCollections).where(inArray(jobCollections.id, idsToDelete));
                logger.info("Cleaned up empty collections", { count: idsToDelete.length, ids: idsToDelete });
            }
        }, { table: "jobCollections", operation: "delete" });
    },
};

export default jobService;


