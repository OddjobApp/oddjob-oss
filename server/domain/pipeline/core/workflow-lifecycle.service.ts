import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@server/database_service.js";
import {
    pipelineSteps,
    pipelineTriggers,
    pipelineExecutions,
    workflows,
    workflowReleases,
    workflowDeployments,
    projectResources,
    hilForms,
    formStudioRevisions,
    type Workflow,
    type WorkflowRelease,
    type WorkflowDeployment,
} from "@shared/schema/index.js";
import {
    WORKFLOW_MANIFEST_VERSION,
    type WorkflowReleaseManifest,
} from "@shared/workflow-release.js";
import { createLogger } from "@server/utils/logger.js";
import { withQueryTracking } from "@domain/knowledge/core/query-monitor.service.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@server/utils/errors.js";
import { getOrgConditions } from "@server/utils/org-conditions.js";
import { requireOrgId, getSystemOrgContext, type OrgContext } from "@server/utils/auth-context.js";
import { pipelineService } from "./pipeline.service.js";
import { jobService } from "../../jobs/job.service.js";
import { jobDigest, manifestDigest } from "./workflow-manifest.js";
import { projectService, type ProjectCtx } from "@domain/projects/core/project.service.js";
import type { ProjectRole } from "@shared/schema/projects.js";

const logger = createLogger("WorkflowLifecycle");

/**
 * Workflow lifecycle: DRAFT (the editable pipeline) -> RELEASE (an immutable
 * manifest snapshot) -> DEPLOYMENT (one release activated per environment).
 *
 * Org scoping is a security boundary here like everywhere else: every read of
 * `workflows` funnels through getOrgConditions on workflows.organizationId —
 * never `.where(undefined)`, which Drizzle treats as no filter at all.
 *
 * Project roles (when the workflow has a primary project): create/publish need
 * `editor`; activation needs `operator`, the role that runs but cannot reshape.
 * `assertRole` is private to projectService, so the operator check is done via
 * the public `roleFor` against the same rank ladder PROJECT_ROLES declares.
 */

const ROLE_RANK: Record<ProjectRole, number> = {
    viewer: 1,
    operator: 2,
    editor: 3,
    owner: 4,
};

function toProjectCtx(ctx: OrgContext): ProjectCtx {
    return {
        organizationId: requireOrgId(ctx),
        userId: ctx.userId,
        isSuperAdmin: ctx.isSuperAdmin,
        isOrgAdmin: ctx.isOrgAdmin,
    };
}

/** Org scope for workflow reads. Workflows are never global. */
function workflowOrgConditions(ctx: OrgContext): SQL[] {
    return getOrgConditions(ctx, workflows, false);
}

export const workflowLifecycleService = {
    /**
     * Register a pipeline as a workflow. Idempotent on the pipeline: the unique
     * index on draft_pipeline_id makes a second call return the same row — and
     * still attaches it to the given project if it was not already.
     */
    async createFromPipeline(
        ctx: OrgContext,
        input: { pipelineId: number; projectId?: number | null; title?: string; description?: string | null },
    ): Promise<Workflow> {
        return withQueryTracking("workflowLifecycle.createFromPipeline", async () => {
            // The pipeline must belong to the caller's org; getById is org-scoped.
            const pipeline = await pipelineService.getById(input.pipelineId, ctx);

            const [existing] = await db
                .select()
                .from(workflows)
                .where(and(eq(workflows.draftPipelineId, pipeline.id), ...workflowOrgConditions(ctx)))
                .limit(1);
            if (existing) {
                if (input.projectId != null) {
                    await this.attachToProject(ctx, existing.id, input.projectId);
                }
                return existing;
            }

            const [workflow] = await db
                .insert(workflows)
                .values({
                    organizationId: pipeline.organizationId ?? requireOrgId(ctx),
                    title: input.title ?? pipeline.name,
                    description: input.description ?? pipeline.description ?? null,
                    draftPipelineId: pipeline.id,
                    createdBy: ctx.userId,
                })
                .returning();

            if (input.projectId != null) {
                try {
                    // attachResource asserts the editor role on the project itself.
                    await this.attachToProject(ctx, workflow.id, input.projectId);
                } catch (error) {
                    // No transaction can span the project service, so roll the create
                    // back by hand — a half-registered workflow would block the retry.
                    await db.delete(workflows).where(eq(workflows.id, workflow.id));
                    throw error;
                }
            }

            logger.info(`[Workflows] Registered workflow ${workflow.id} for pipeline ${pipeline.id}.`);
            return workflow;
        }, { table: "workflows", operation: "insert" });
    },

    async attachToProject(ctx: OrgContext, workflowId: number, projectId: number) {
        return projectService.attachResource(toProjectCtx(ctx), projectId, "workflow", workflowId, "primary");
    },

    async get(ctx: OrgContext, workflowId: number) {
        return withQueryTracking("workflowLifecycle.get", async () => {
            const workflow = await this.getWorkflowRow(ctx, workflowId);
            await this.assertProjectRead(ctx, workflow.id);
            const [releases, deployments, projectId] = await Promise.all([
                db.select().from(workflowReleases)
                    .where(eq(workflowReleases.workflowId, workflow.id))
                    .orderBy(desc(workflowReleases.releaseNumber)),
                db.select().from(workflowDeployments)
                    .where(eq(workflowDeployments.workflowId, workflow.id)),
                projectService.resolveProjectForResource("workflow", workflow.id),
            ]);
            return { workflow, releases, deployments, projectId };
        }, { table: "workflows", operation: "select" });
    },

    async list(ctx: OrgContext, opts: { projectId?: number } = {}) {
        return withQueryTracking("workflowLifecycle.list", async () => {
            const conditions = workflowOrgConditions(ctx);
            if (opts.projectId != null) {
                // The project's read gate first: a private project the caller
                // cannot see must not have its workflows listed.
                await projectService.getProject(toProjectCtx(ctx), opts.projectId);
                return await db
                    .select({ workflow: workflows })
                    .from(workflows)
                    .innerJoin(
                        projectResources,
                        and(
                            eq(projectResources.resourceType, "workflow"),
                            eq(projectResources.resourceId, workflows.id),
                            eq(projectResources.projectId, opts.projectId),
                        ),
                    )
                    .where(and(...conditions))
                    .orderBy(desc(workflows.createdAt))
                    .then((rows) => rows.map((r) => r.workflow));
            }
            const rows = await db
                .select()
                .from(workflows)
                .where(and(...conditions))
                .orderBy(desc(workflows.createdAt));
            // Org scoping alone listed workflows of private projects to every
            // org member; drop the ones whose project the caller cannot read.
            const readable = await Promise.all(rows.map((w) => this.canReadProject(ctx, w.id)));
            return rows.filter((_, i) => readable[i]);
        }, { table: "workflows", operation: "select" });
    },

    /**
     * Snapshot the draft pipeline as a manifest: pipeline row, steps ordered by
     * `order`, every referenced job (incl. fallback jobs), and its triggers.
     * Mirrors what pipeline-executor loads at executePipeline's start.
     */
    async buildManifest(pipelineId: number): Promise<WorkflowReleaseManifest> {
        return withQueryTracking("workflowLifecycle.buildManifest", async () => {
            const pipeline = await pipelineService.getSystem(pipelineId);
            if (!pipeline) throw new NotFoundError(`Pipeline ${pipelineId} not found`);

            const steps = await db
                .select()
                .from(pipelineSteps)
                .where(eq(pipelineSteps.pipelineId, pipelineId))
                .orderBy(pipelineSteps.order);
            if (steps.length === 0) {
                throw new ValidationError(`Pipeline ${pipelineId} has no steps — nothing to release`);
            }

            const jobIds = new Set<number>();
            for (const step of steps) {
                if (step.jobId) jobIds.add(step.jobId);
                if (step.fallbackJobId) jobIds.add(step.fallbackJobId);
            }
            const jobList = await jobService.getByIds(
                Array.from(jobIds),
                getSystemOrgContext(pipeline.organizationId),
            );
            const jobsById = new Map(jobList.map((j) => [j.id, j]));
            const missing = [...jobIds].filter((id) => !jobsById.has(id));
            if (missing.length > 0) {
                throw new ValidationError(
                    `Pipeline ${pipelineId} references job(s) that no longer exist: ${missing.join(", ")}`,
                );
            }

            const triggers = await db
                .select()
                .from(pipelineTriggers)
                .where(eq(pipelineTriggers.pipelineId, pipelineId));

            const jobs: Record<string, Record<string, unknown>> = {};
            const dependencies: WorkflowReleaseManifest["dependencies"] = [];
            const formReleases: NonNullable<WorkflowReleaseManifest["formReleases"]> = {};
            for (const job of jobList) {
                const row = job as unknown as Record<string, unknown>;
                jobs[String(job.id)] = row;
                dependencies.push({ kind: "job", id: String(job.id), digest: jobDigest(row) });
            }

            // A human_approval step configured {formId, stageId} opens a stage
            // of the form's CURRENT release at run time — so pin the release
            // that is current NOW into the manifest, or republishing the form
            // would silently change what a released run asks for.
            const formIds = new Set<number>();
            for (const job of jobList) {
                const config = (job.config ?? {}) as Record<string, unknown>;
                const formId = Number(config.formId);
                const stageId = config.stageId;
                if (job.type !== "human_approval" || !Number.isInteger(formId) || formId <= 0 || !stageId) continue;
                if (formIds.has(formId)) continue;
                formIds.add(formId);

                const [form] = await db.select().from(hilForms)
                    .where(and(
                        eq(hilForms.id, formId),
                        eq(hilForms.kind, "template"),
                        eq(hilForms.isArchived, false),
                        ...getOrgConditions(
                            getSystemOrgContext(pipeline.organizationId),
                            hilForms,
                            false,
                        ),
                    ))
                    .limit(1);
                if (!form) {
                    throw new ValidationError(`Form ${formId} referenced by job "${job.name}" was not found in this organization`);
                }
                const published = ((form.config ?? {}) as any).formStudio?.published;
                if (!published?.releaseNumber) {
                    throw new ValidationError(
                        `Publish form "${form.name}" before releasing this workflow — step "${job.name}" asks for one of its stages`,
                    );
                }
                const [release] = await db.select().from(formStudioRevisions)
                    .where(and(
                        eq(formStudioRevisions.formId, form.id),
                        eq(formStudioRevisions.kind, "release"),
                        eq(formStudioRevisions.releaseNumber, published.releaseNumber),
                    ))
                    .limit(1);
                if (!release) {
                    throw new ValidationError(
                        `Release v${published.releaseNumber} of form "${form.name}" was not found — publish the form again`,
                    );
                }
                dependencies.push({
                    kind: "form_release",
                    id: String(form.id),
                    revision: published.releaseNumber,
                    digest: jobDigest(release.schema as Record<string, unknown>),
                });
                formReleases[String(form.id)] = {
                    releaseNumber: published.releaseNumber,
                    formRevision: release.formRevision,
                    name: release.name,
                };
            }
            dependencies.sort((a, b) =>
                a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

            return {
                manifestVersion: WORKFLOW_MANIFEST_VERSION,
                pipeline: {
                    id: pipeline.id,
                    name: pipeline.name,
                    description: pipeline.description,
                    triggerType: pipeline.triggerType,
                    triggerCredentialId: pipeline.triggerCredentialId,
                    labels: pipeline.labels,
                    organizationId: pipeline.organizationId,
                    governorSettings: pipeline.governorSettings,
                    governorPolicyId: pipeline.governorPolicyId,
                    enableKnowledgeGraph: pipeline.enableKnowledgeGraph,
                    knowledgeGraphConfig: pipeline.knowledgeGraphConfig,
                    monthlyBudgetUsd: pipeline.monthlyBudgetUsd,
                },
                steps: steps as unknown as Array<Record<string, unknown>>,
                jobs,
                triggers: triggers as unknown as Array<Record<string, unknown>>,
                dependencies,
                formReleases,
                createdAt: new Date().toISOString(),
            };
        }, { table: "pipelines", operation: "select" });
    },

    /**
     * Publish the draft as a release. Digest-identical re-publishes return the
     * latest release with `unchanged: true` rather than minting a duplicate.
     */
    async publish(
        ctx: OrgContext,
        workflowId: number,
        input: { description?: string } = {},
    ): Promise<{ release: WorkflowRelease; unchanged: boolean }> {
        return withQueryTracking("workflowLifecycle.publish", async () => {
            const workflow = await this.getWorkflowRow(ctx, workflowId);
            await this.assertProjectRole(ctx, workflow.id, "editor");

            const manifest = await this.buildManifest(workflow.draftPipelineId);
            const digest = manifestDigest(manifest);

            const [latest] = await db
                .select()
                .from(workflowReleases)
                .where(eq(workflowReleases.workflowId, workflow.id))
                .orderBy(desc(workflowReleases.releaseNumber))
                .limit(1);
            if (latest && latest.digest === digest) {
                return { release: latest, unchanged: true };
            }

            const validation = {
                stepCount: manifest.steps.length,
                jobCount: Object.keys(manifest.jobs).length,
                checkedAt: new Date().toISOString(),
            };

            // The (workflowId, releaseNumber) unique index is the real guard; a
            // concurrent publish just retries the numbering once.
            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    const release = await db.transaction(async (tx) => {
                        const [{ max }] = await tx
                            .select({ max: sql<number>`COALESCE(MAX(${workflowReleases.releaseNumber}), 0)` })
                            .from(workflowReleases)
                            .where(eq(workflowReleases.workflowId, workflow.id));
                        const [row] = await tx
                            .insert(workflowReleases)
                            .values({
                                workflowId: workflow.id,
                                releaseNumber: Number(max) + 1,
                                manifest,
                                digest,
                                validation,
                                description: input.description ?? null,
                                createdBy: ctx.userId,
                            })
                            .returning();
                        return row;
                    });
                    return { release, unchanged: false };
                } catch (error) {
                    const code = (error as { code?: string; cause?: { code?: string } })?.code
                        ?? (error as { cause?: { code?: string } })?.cause?.code;
                    if (code === "23505" && attempt === 0) continue;
                    throw error;
                }
            }
            throw new ConflictError("Could not allocate a release number — try again.");
        }, { table: "workflow_releases", operation: "insert" });
    },

    /** List releases, newest first. */
    async listReleases(ctx: OrgContext, workflowId: number): Promise<WorkflowRelease[]> {
        const workflow = await this.getWorkflowRow(ctx, workflowId);
        await this.assertProjectRead(ctx, workflow.id);
        return db
            .select()
            .from(workflowReleases)
            .where(eq(workflowReleases.workflowId, workflow.id))
            .orderBy(desc(workflowReleases.releaseNumber));
    },

    /**
     * Activate a release in an environment. One deployment row per
     * (workflow, environment): activation upserts it and bumps the generation.
     */
    async activate(
        ctx: OrgContext,
        workflowId: number,
        input: { releaseId: number; environment?: string },
    ): Promise<WorkflowDeployment> {
        return withQueryTracking("workflowLifecycle.activate", async () => {
            const workflow = await this.getWorkflowRow(ctx, workflowId);
            await this.assertProjectRole(ctx, workflow.id, "operator");

            const [release] = await db
                .select()
                .from(workflowReleases)
                .where(and(
                    eq(workflowReleases.id, input.releaseId),
                    eq(workflowReleases.workflowId, workflow.id),
                ))
                .limit(1);
            if (!release) {
                throw new NotFoundError(`Release ${input.releaseId} not found on workflow ${workflow.id}.`);
            }

            const environment = input.environment ?? "production";
            const [deployment] = await db
                .insert(workflowDeployments)
                .values({
                    workflowId: workflow.id,
                    releaseId: release.id,
                    environment,
                    status: "active",
                    activationGeneration: 1,
                    activatedAt: new Date(),
                    createdBy: ctx.userId,
                })
                .onConflictDoUpdate({
                    target: [workflowDeployments.workflowId, workflowDeployments.environment],
                    set: {
                        releaseId: release.id,
                        status: "active",
                        activationGeneration: sql`${workflowDeployments.activationGeneration} + 1`,
                        activatedAt: new Date(),
                        updatedAt: new Date(),
                    },
                })
                .returning();
            return deployment;
        }, { table: "workflow_deployments", operation: "insert" });
    },

    async pause(ctx: OrgContext, workflowId: number, deploymentId: number) {
        return this.setDeploymentStatus(ctx, workflowId, deploymentId, "paused");
    },

    async resume(ctx: OrgContext, workflowId: number, deploymentId: number) {
        return this.setDeploymentStatus(ctx, workflowId, deploymentId, "active");
    },

    async retire(ctx: OrgContext, workflowId: number, deploymentId: number) {
        return this.setDeploymentStatus(ctx, workflowId, deploymentId, "retired");
    },

    async setDeploymentStatus(
        ctx: OrgContext,
        workflowId: number,
        deploymentId: number,
        status: "paused" | "active" | "retired",
    ): Promise<WorkflowDeployment> {
        return withQueryTracking(`workflowLifecycle.${status}`, async () => {
            const workflow = await this.getWorkflowRow(ctx, workflowId);
            await this.assertProjectRole(ctx, workflow.id, "operator");
            const [updated] = await db
                .update(workflowDeployments)
                .set({ status, updatedAt: new Date() })
                .where(and(
                    eq(workflowDeployments.id, deploymentId),
                    eq(workflowDeployments.workflowId, workflow.id),
                ))
                .returning();
            if (!updated) {
                throw new NotFoundError(`Deployment ${deploymentId} not found on workflow ${workflow.id}.`);
            }
            return updated;
        }, { table: "workflow_deployments", operation: "update" });
    },

    /**
     * What the executor/trigger side asks: which release is live for this
     * pipeline's deployment in `environment` (production unless the caller —
     * e.g. a signal subscription bound to another environment — says otherwise).
     * System-level — no caller ctx.
     */
    async resolveActiveRelease(
        pipelineId: number,
        environment = "production",
    ): Promise<{ workflowId: number; releaseId: number; deploymentId: number; manifest: WorkflowReleaseManifest } | null> {
        return withQueryTracking("workflowLifecycle.resolveActiveRelease", async () => {
            const rows = await db
                .select({
                    workflowId: workflows.id,
                    releaseId: workflowReleases.id,
                    deploymentId: workflowDeployments.id,
                    manifest: workflowReleases.manifest,
                })
                .from(workflows)
                .innerJoin(workflowDeployments, and(
                    eq(workflowDeployments.workflowId, workflows.id),
                    eq(workflowDeployments.environment, environment),
                    eq(workflowDeployments.status, "active"),
                ))
                .innerJoin(workflowReleases, eq(workflowReleases.id, workflowDeployments.releaseId))
                .where(eq(workflows.draftPipelineId, pipelineId))
                .limit(1);
            return rows[0] ?? null;
        }, { table: "workflows", operation: "select" });
    },

    /** System-level lookup by workflow id — no caller ctx, no org filter. */
    async getByIdSystem(workflowId: number): Promise<Workflow | null> {
        const [row] = await db
            .select()
            .from(workflows)
            .where(eq(workflows.id, workflowId))
            .limit(1);
        return row ?? null;
    },

    /** System-level lookup by draft pipeline — no caller ctx. */
    async findByPipeline(pipelineId: number): Promise<Workflow | null> {
        const [row] = await db
            .select()
            .from(workflows)
            .where(eq(workflows.draftPipelineId, pipelineId))
            .limit(1);
        return row ?? null;
    },

    async getReleaseManifest(
        releaseId: number,
    ): Promise<{ workflowId: number; manifest: WorkflowReleaseManifest } | null> {
        const [row] = await db
            .select({ workflowId: workflowReleases.workflowId, manifest: workflowReleases.manifest })
            .from(workflowReleases)
            .where(eq(workflowReleases.id, releaseId))
            .limit(1);
        return row ?? null;
    },

    /**
     * Start a run under the environment's ACTIVE deployment — a run of a draft
     * is a different thing entirely and goes through the pipeline routes.
     */
    async startRun(
        ctx: OrgContext,
        workflowId: number,
        input: { input?: Record<string, unknown>; environment?: string } = {},
    ): Promise<{ executionId: number }> {
        const workflow = await this.getWorkflowRow(ctx, workflowId);
        // Running is an operation, like activate/pause: it needs operator.
        await this.assertProjectRole(ctx, workflow.id, "operator");
        const environment = input.environment ?? "production";

        const [deployment] = await db
            .select()
            .from(workflowDeployments)
            .where(and(
                eq(workflowDeployments.workflowId, workflow.id),
                eq(workflowDeployments.environment, environment),
                eq(workflowDeployments.status, "active"),
            ))
            .limit(1);
        if (!deployment) {
            throw new ConflictError(
                `No active deployment for workflow ${workflow.id} in '${environment}' — activate a release first.`,
            );
        }

        const { pipelineExecutor } = await import("@server/core/pipeline-executor.js");
        const result = await pipelineExecutor.executePipeline(
            workflow.draftPipelineId,
            ctx.userId,
            null,
            null,
            input.input as Record<string, any> | undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            { workflowReleaseId: deployment.releaseId, workflowDeploymentId: deployment.id },
        );
        return { executionId: result.executionId };
    },

    async listRuns(ctx: OrgContext, workflowId: number, opts: { limit?: number } = {}) {
        const workflow = await this.getWorkflowRow(ctx, workflowId);
        await this.assertProjectRead(ctx, workflow.id);
        return db
            .select()
            .from(pipelineExecutions)
            .where(and(
                eq(pipelineExecutions.pipelineId, workflow.draftPipelineId),
                ...getOrgConditions(ctx, pipelineExecutions, false),
            ))
            .orderBy(desc(pipelineExecutions.startedAt))
            .limit(Math.min(Math.max(1, opts.limit ?? 50), 500));
    },

    // ---- internals ----------------------------------------------------------

    async getWorkflowRow(ctx: OrgContext, workflowId: number): Promise<Workflow> {
        const [workflow] = await db
            .select()
            .from(workflows)
            .where(and(eq(workflows.id, workflowId), ...workflowOrgConditions(ctx)))
            .limit(1);
        if (!workflow) throw new NotFoundError(`Workflow ${workflowId} not found`);
        return workflow;
    },

    /**
     * Reading follows the project's own read gate: an org-visible project is
     * readable by the org, a private one only by its members. Role checks
     * (below) are for writes and operations.
     */
    async assertProjectRead(ctx: OrgContext, workflowId: number) {
        const projectId = await projectService.resolveProjectForResource("workflow", workflowId);
        if (projectId == null) return;
        await projectService.getProject(toProjectCtx(ctx), projectId);
    },

    async canReadProject(ctx: OrgContext, workflowId: number): Promise<boolean> {
        try {
            await this.assertProjectRead(ctx, workflowId);
            return true;
        } catch {
            return false;
        }
    },

    /**
     * When the workflow has a primary project, the caller must hold `required`
     * on it. No project means no project gate — org scoping already applied.
     */
    async assertProjectRole(ctx: OrgContext, workflowId: number, required: ProjectRole) {
        const projectId = await projectService.resolveProjectForResource("workflow", workflowId);
        if (projectId == null) return;
        const pctx = toProjectCtx(ctx);
        const project = await projectService.getProject(pctx, projectId);
        const role = await projectService.roleFor(pctx, project);
        if (!role || ROLE_RANK[role] < ROLE_RANK[required]) {
            throw new ForbiddenError(
                `This action requires the '${required}' role on project '${project.key}'.`,
            );
        }
    },
};
