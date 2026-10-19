import { UnfilterablePropertyError } from './ontology-adapter-errors.js';
import { FINANCIAL_ADAPTERS } from './financial-ontology.js';
import { eq, and, or, isNull, desc, sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { missions } from "@shared/schema/missions/core.js";
import { missionRuns } from "@shared/schema/missions/runs.js";
import { jobs } from "@shared/schema/jobs/table.js";
import { pipelines } from "@shared/schema/pipelines/pipeline-core.js";
import { pipelineSteps } from "@shared/schema/pipelines/pipeline-steps.js";
import { pipelineExecutions, pipelineStepExecutions } from "@shared/schema/pipelines/pipeline-execution.js";
import { datasets } from "@shared/schema/datasets.js";
import { knowledgeNodes } from "@shared/schema/knowledge/graph.js";
import { transferenceRules } from "@shared/schema/ai/transference.js";
import { swarmTasks } from "@shared/schema/swarm.js";
import { promptVersions } from "@shared/schema/learning/prompt-evolution.js";
import { savedQueries } from "@shared/schema/knowledge/query-builder.js";
import { alerts } from "@shared/schema/alerts.js";
import { approvalRequests } from "@shared/schema/hil.js";
import { apps, appDeployments } from "@shared/schema/apps.js";
import { projects, projectResources, projectEvents } from "@shared/schema/projects.js";
import {
    eventPrimitives,
    stateTransitionEvents,
    cycleSignalDeliveries,
} from "@shared/schema/signal-intelligence.js";
import { calculationNodes } from "@shared/schema/knowledge/calculations.js";
import { schedules, scheduledJobs } from "@shared/schema/schedules.js";
import { operationalCycles } from "@shared/schema/operational-cycles.js";
import { spatialRegions } from "@shared/schema/spatial-regions.js";
import { users } from "@shared/schema/auth.js";
import { teams } from "@shared/schema/team-collaboration.js";
import { skills } from "@shared/schema/skills.js";
import { agentCards } from "@shared/schema/agent-cards.js";
import type { OntologyCtx } from "./ontology.service.js";

/**
 * Ontology "virtual" object adapters.
 *
 * A virtual Object Type maps onto an EXISTING org-scoped domain table (missions, jobs,
 * ...) instead of storing its own rows. Each adapter MUST filter by ctx.organizationId
 * — this is the org-isolation boundary for virtual types. Adapters only read.
 */

export interface AdapterListOpts {
    limit?: number;
}

export interface OntologyAdapter {
    /** Human-facing property map surfaced as the Object Type schema. */
    properties: Record<string, string>;
    titleProperty: string;
    list(ctx: OntologyCtx, opts?: AdapterListOpts): Promise<Array<Record<string, any>>>;
    get(ctx: OntologyCtx, id: any): Promise<Record<string, any> | null>;
    /**
     * Exact filter on one property — the inbound half of link traversal
     * ("which deployments deploy THIS app?").
     *
     * Optional. Where an adapter does not implement it the service falls back to a
     * bounded scan and reports the result as incomplete, so a partial answer is
     * always visible as partial rather than passing for the whole set. Implementing
     * it here turns that into an indexed lookup with no cap.
     *
     * MUST throw on a property it cannot filter. Ignoring an unknown property would
     * return every row in the org, and traversal would then present completely
     * unrelated objects as related — far worse than refusing.
     */
    listBy?(
        ctx: OntologyCtx,
        property: string,
        value: any,
        opts?: AdapterListOpts,
    ): Promise<Array<Record<string, any>>>;
}

const clampLimit = (n?: number) => Math.min(Math.max(1, n ?? 50), 200);

/** Raised when a link names a property the adapter cannot filter on. */
export { UnfilterablePropertyError } from './ontology-adapter-errors.js';

/**
 * Build a `listBy` from the projection an adapter already uses.
 *
 * `filterable` maps exposed property names onto the real columns, which is
 * deliberately narrower than `properties` and does not always share their names: a
 * value the adapter computes or joins in (appName) has no column to filter on, and
 * several are aliases over a differently named column (a prediction's `signalId` is
 * `event_primitive_id`). Pretending otherwise would silently widen the result or
 * filter the wrong column.
 *
 * `orgWhere` is passed in rather than assumed, because the org boundary is not the
 * same shape for every table — some join through a parent, apps has a visibility
 * rule a plain organization_id filter would get wrong, and knowledge nodes carry a
 * verification gate that has to survive filtering.
 *
 * `orderBy` is a built expression, not a column: project events are ordered
 * ASCENDING on purpose (a timeline is read forwards) and wrapping everything in
 * desc() here would quietly reverse it.
 */
function makeListBy(
    columns: Record<string, any>,
    from: any,
    orgWhere: (ctx: OntologyCtx) => any,
    orderBy: any,
    filterable: Record<string, any>,
) {
    return async (ctx: OntologyCtx, property: string, value: any, opts?: AdapterListOpts) => {
        const column = filterable[property];
        if (!column) throw new UnfilterablePropertyError(property, Object.keys(filterable));
        return db
            .select(columns)
            .from(from)
            .where(and(orgWhere(ctx), eq(column, value)))
            .orderBy(orderBy)
            .limit(clampLimit(opts?.limit));
    };
}

const missionAdapter: OntologyAdapter = {
    properties: { id: "integer", name: "string", description: "string", status: "string", createdAt: "string" },
    titleProperty: "name",
    async list(ctx, opts) {
        const rows = await db
            .select({ id: missions.id, name: missions.name, description: missions.description, status: missions.status, createdAt: missions.createdAt })
            .from(missions)
            .where(eq(missions.organizationId, ctx.organizationId))
            .orderBy(desc(missions.createdAt))
            .limit(clampLimit(opts?.limit));
        return rows;
    },
    async get(ctx, id) {
        const rows = await db
            .select({ id: missions.id, name: missions.name, description: missions.description, status: missions.status, createdAt: missions.createdAt })
            .from(missions)
            .where(and(eq(missions.organizationId, ctx.organizationId), eq(missions.id, Number(id))))
            .limit(1);
        return rows[0] ?? null;
    },
    listBy: makeListBy(
        { id: missions.id, name: missions.name, description: missions.description, status: missions.status, createdAt: missions.createdAt },
        missions,
        (ctx) => eq(missions.organizationId, ctx.organizationId),
        desc(missions.createdAt),
        { id: missions.id, name: missions.name, status: missions.status },
    ),
};

const missionRunColumns = {
    id: missionRuns.id,
    name: missionRuns.name,
    missionId: missionRuns.missionId,
    parentId: missionRuns.parentId,
    status: missionRuns.status,
    reasoningProtocol: missionRuns.reasoningProtocol,
    currentPipelineId: missionRuns.currentPipelineId,
    currentStepIndex: missionRuns.currentStepIndex,
    pipelineExecutionId: missionRuns.pipelineExecutionId,
    isSuccess: missionRuns.isSuccess,
    failureReason: missionRuns.failureReason,
    actualMetricValue: missionRuns.actualMetricValue,
    metricType: missionRuns.metricType,
    entityCount: missionRuns.entityCount,
    relationshipCount: missionRuns.relationshipCount,
    cycleId: missionRuns.cycleId,
    isShadow: missionRuns.isShadow,
    costUsd: missionRuns.costUsd,
    lastCheckpointAt: missionRuns.lastCheckpointAt,
    createdBy: missionRuns.createdBy,
    createdAt: missionRuns.createdAt,
    updatedAt: missionRuns.updatedAt,
};

/**
 * One execution of a mission — the counterpart to Pipeline Run, and the only place
 * that records that a mission actually ran rather than merely exists. Without it
 * "did this mission ever succeed, and what did it cost" has no object to ask.
 *
 * Definition and execution stay separate types for the same reason Pipeline Step and
 * Pipeline Step Run do: "which mission fails most" and "did it fail this time" are
 * different questions, and folding them makes every count ambiguous.
 *
 * `organization_id` is nullable on the table but populated on all 48 dev rows, and
 * none disagrees with its mission's org, so the plain equality is both correct and
 * honest here — unlike pipeline_executions, there is no null-org population it would
 * hide. Soft-deleted runs are excluded, as in pipelineRunAdapter.
 *
 * `missionContext`, `dynamicTrace`, `resumeCondition` and `pipelineSequence` are
 * deliberately unexposed: they are unbounded jsonb, and the run's real pipeline
 * history is reachable by traversal (`has_pipeline_run`) rather than by reading a
 * planned sequence out of the row.
 *
 * `actualMetricValue` and `costUsd` are drizzle `decimal`, so they arrive as STRINGS
 * and are typed as such — a caller that treats them as numbers gets string
 * concatenation, not arithmetic.
 */
const missionRunAdapter: OntologyAdapter = {
    properties: {
        id: "integer", name: "string", missionId: "integer", parentId: "integer",
        status: "string", reasoningProtocol: "string",
        currentPipelineId: "integer", currentStepIndex: "integer",
        pipelineExecutionId: "integer",
        isSuccess: "boolean", failureReason: "string",
        actualMetricValue: "string", metricType: "string",
        entityCount: "integer", relationshipCount: "integer",
        cycleId: "integer", isShadow: "boolean", costUsd: "string",
        lastCheckpointAt: "string", createdBy: "string",
        createdAt: "string", updatedAt: "string",
    },
    titleProperty: "name",
    async list(ctx, opts) {
        return db
            .select(missionRunColumns)
            .from(missionRuns)
            .where(and(eq(missionRuns.organizationId, ctx.organizationId), isNull(missionRuns.deletedAt)))
            .orderBy(desc(missionRuns.createdAt))
            .limit(clampLimit(opts?.limit));
    },
    async get(ctx, id) {
        const rows = await db
            .select(missionRunColumns)
            .from(missionRuns)
            .where(and(
                eq(missionRuns.organizationId, ctx.organizationId),
                isNull(missionRuns.deletedAt),
                eq(missionRuns.id, Number(id)),
            ))
            .limit(1);
        return rows[0] ?? null;
    },
    listBy: makeListBy(
        missionRunColumns,
        missionRuns,
        (ctx) => and(eq(missionRuns.organizationId, ctx.organizationId), isNull(missionRuns.deletedAt)),
        desc(missionRuns.createdAt),
        {
            id: missionRuns.id, name: missionRuns.name, missionId: missionRuns.missionId,
            parentId: missionRuns.parentId, status: missionRuns.status,
            currentPipelineId: missionRuns.currentPipelineId,
            pipelineExecutionId: missionRuns.pipelineExecutionId,
            isSuccess: missionRuns.isSuccess, cycleId: missionRuns.cycleId,
            isShadow: missionRuns.isShadow, createdBy: missionRuns.createdBy,
        },
    ),
};

const jobAdapter: OntologyAdapter = {
    properties: { id: "integer", name: "string", description: "string", type: "string", lifecycleStatus: "string", createdAt: "string" },
    titleProperty: "name",
    async list(ctx, opts) {
        const rows = await db
            .select({ id: jobs.id, name: jobs.name, description: jobs.description, type: jobs.type, lifecycleStatus: jobs.lifecycleStatus, createdAt: jobs.createdAt })
            .from(jobs)
            .where(eq(jobs.organizationId, ctx.organizationId))
            .orderBy(desc(jobs.createdAt))
            .limit(clampLimit(opts?.limit));
        return rows;
    },
    async get(ctx, id) {
        const rows = await db
            .select({ id: jobs.id, name: jobs.name, description: jobs.description, type: jobs.type, lifecycleStatus: jobs.lifecycleStatus, createdAt: jobs.createdAt })
            .from(jobs)
            .where(and(eq(jobs.organizationId, ctx.organizationId), eq(jobs.id, Number(id))))
            .limit(1);
        return rows[0] ?? null;
    },
    listBy: makeListBy(
        { id: jobs.id, name: jobs.name, description: jobs.description, type: jobs.type, lifecycleStatus: jobs.lifecycleStatus, createdAt: jobs.createdAt },
        jobs,
        (ctx) => eq(jobs.organizationId, ctx.organizationId),
        desc(jobs.createdAt),
        { id: jobs.id, name: jobs.name, type: jobs.type, lifecycleStatus: jobs.lifecycleStatus },
    ),
};

const pipelineAdapter: OntologyAdapter = {
    properties: { id: "integer", name: "string", description: "string", triggerType: "string", lifecycleStatus: "string", createdAt: "string" },
    titleProperty: "name",
    async list(ctx, opts) {
        const rows = await db
            .select({ id: pipelines.id, name: pipelines.name, description: pipelines.description, triggerType: pipelines.triggerType, lifecycleStatus: pipelines.lifecycleStatus, createdAt: pipelines.createdAt })
            .from(pipelines)
            .where(eq(pipelines.organizationId, ctx.organizationId))
            .orderBy(desc(pipelines.createdAt))
            .limit(clampLimit(opts?.limit));
        return rows;
    },
    async get(ctx, id) {
        const rows = await db
            .select({ id: pipelines.id, name: pipelines.name, description: pipelines.description, triggerType: pipelines.triggerType, lifecycleStatus: pipelines.lifecycleStatus, createdAt: pipelines.createdAt })
            .from(pipelines)
            .where(and(eq(pipelines.organizationId, ctx.organizationId), eq(pipelines.id, Number(id))))
            .limit(1);
        return rows[0] ?? null;
    },
    listBy: makeListBy(
        { id: pipelines.id, name: pipelines.name, description: pipelines.description, triggerType: pipelines.triggerType, lifecycleStatus: pipelines.lifecycleStatus, createdAt: pipelines.createdAt },
        pipelines,
        (ctx) => eq(pipelines.organizationId, ctx.organizationId),
        desc(pipelines.createdAt),
        { id: pipelines.id, name: pipelines.name, triggerType: pipelines.triggerType, lifecycleStatus: pipelines.lifecycleStatus },
    ),
};

/**
 * A step has no name column, and every single candidate is null for some real step:
 * outputName is optional, jobId is null for a tool step or a Decision Node, toolName
 * is null for a job step. A title that is null half the time makes the Object Type
 * unreadable in any list, so it is coalesced down to the ordinal, which always exists.
 *
 * Computed, therefore not filterable — same as appName on App Deployment.
 */
const stepLabel = sql<string>`coalesce(${pipelineSteps.outputName}, ${jobs.name}, ${pipelineSteps.toolName}, 'Step ' || ${pipelineSteps.order})`;

const pipelineStepColumns = {
    id: pipelineSteps.id,
    pipelineId: pipelineSteps.pipelineId,
    jobId: pipelineSteps.jobId,
    label: stepLabel,
    jobName: jobs.name,
    order: pipelineSteps.order,
    outputName: pipelineSteps.outputName,
    runOnCondition: pipelineSteps.runOnCondition,
    onFailureAction: pipelineSteps.onFailureAction,
    fallbackJobId: pipelineSteps.fallbackJobId,
    parallelGroup: pipelineSteps.parallelGroup,
    moduleType: pipelineSteps.moduleType,
    toolName: pipelineSteps.toolName,
    createdAt: pipelineSteps.createdAt,
};

/**
 * The DEFINITION of one step in a pipeline — deliberately a different Object Type
 * from Pipeline Step Run below. Asking "which step fails most" is a question about
 * definitions; "did it fail this time" is a question about runs. Collapsing the two
 * into one type makes every count ambiguous between the two readings.
 *
 * pipeline_steps carries no organization_id, so the join to pipelines IS the org
 * boundary — filtering the table directly would hand every org's steps to any caller.
 * The join to jobs is LEFT: a tool step or a Decision Node has no job, and an inner
 * join would silently drop exactly the steps most worth asking about.
 */
const pipelineStepAdapter: OntologyAdapter = {
    properties: {
        id: "integer", pipelineId: "integer", jobId: "integer", label: "string",
        jobName: "string", order: "integer", outputName: "string",
        runOnCondition: "string", onFailureAction: "string", fallbackJobId: "integer",
        parallelGroup: "string", moduleType: "string", toolName: "string",
        createdAt: "string",
    },
    titleProperty: "label",
    async list(ctx, opts) {
        return db
            .select(pipelineStepColumns)
            .from(pipelineSteps)
            .innerJoin(pipelines, eq(pipelines.id, pipelineSteps.pipelineId))
            .leftJoin(jobs, eq(jobs.id, pipelineSteps.jobId))
            .where(eq(pipelines.organizationId, ctx.organizationId))
            // Ordered by position within the pipeline, not by recency: a step list
            // read out of execution order is a different pipeline.
            .orderBy(pipelineSteps.pipelineId, pipelineSteps.order)
            .limit(clampLimit(opts?.limit));
    },
    async get(ctx, id) {
        const rows = await db
            .select(pipelineStepColumns)
            .from(pipelineSteps)
            .innerJoin(pipelines, eq(pipelines.id, pipelineSteps.pipelineId))
            .leftJoin(jobs, eq(jobs.id, pipelineSteps.jobId))
            .where(and(eq(pipelines.organizationId, ctx.organizationId), eq(pipelineSteps.id, Number(id))))
            .limit(1);
        return rows[0] ?? null;
    },
    async listBy(ctx, property, value, opts) {
        const filterable: Record<string, any> = {
            id: pipelineSteps.id,
            pipelineId: pipelineSteps.pipelineId,
            jobId: pipelineSteps.jobId,
            order: pipelineSteps.order,
            outputName: pipelineSteps.outputName,
            runOnCondition: pipelineSteps.runOnCondition,
            onFailureAction: pipelineSteps.onFailureAction,
            fallbackJobId: pipelineSteps.fallbackJobId,
            parallelGroup: pipelineSteps.parallelGroup,
            moduleType: pipelineSteps.moduleType,
            toolName: pipelineSteps.toolName,
        };
        const column = filterable[property];
        if (!column) throw new UnfilterablePropertyError(property, Object.keys(filterable));
        return db
            .select(pipelineStepColumns)
            .from(pipelineSteps)
            .innerJoin(pipelines, eq(pipelines.id, pipelineSteps.pipelineId))
            .leftJoin(jobs, eq(jobs.id, pipelineSteps.jobId))
            .where(and(eq(pipelines.organizationId, ctx.organizationId), eq(column, value)))
            .orderBy(pipelineSteps.pipelineId, pipelineSteps.order)
            .limit(clampLimit(opts?.limit));
    },
};

const pipelineRunColumns = {
    id: pipelineExecutions.id,
    runUuid: pipelineExecutions.runUuid,
    pipelineId: pipelineExecutions.pipelineId,
    pipelineName: pipelines.name,
    status: pipelineExecutions.status,
    startedAt: pipelineExecutions.startedAt,
    completedAt: pipelineExecutions.completedAt,
    error: pipelineExecutions.error,
    missionId: pipelineExecutions.missionId,
    missionRunId: pipelineExecutions.missionRunId,
    parentExecutionId: pipelineExecutions.parentExecutionId,
    traceSource: pipelineExecutions.traceSource,
    isShadow: pipelineExecutions.isShadow,
    createdBy: pipelineExecutions.createdBy,
};

/**
 * One EXECUTION of a pipeline. Needed as its own Object Type because a step run has
 * to hang off something: without it, "which run was that failing step part of" has
 * no object to name.
 *
 * Scoped through the PIPELINE, not through pipeline_executions.organization_id.
 * That column is nullable and mostly unset — 20 of 22 rows in the dev database are
 * null against 0 of 314 pipelines — so filtering on it would have hidden ~90% of
 * every org's runs, and all of its step runs with them, while looking like a working
 * feature. pipeline_id is NOT NULL and the pipeline's org is always populated, so the
 * join is both the complete answer and the authoritative one: a run of your pipeline
 * is yours. (Checked: no row's own org disagrees with its pipeline's.)
 *
 * Soft-deleted rows are excluded — a deleted run reappearing in the ontology would
 * contradict every other surface that hides it.
 */
const pipelineRunAdapter: OntologyAdapter = {
    properties: {
        id: "integer", runUuid: "string", pipelineId: "integer", pipelineName: "string",
        status: "string", startedAt: "string", completedAt: "string", error: "string",
        missionId: "integer", missionRunId: "integer", parentExecutionId: "integer",
        traceSource: "string", isShadow: "boolean", createdBy: "string",
    },
    titleProperty: "pipelineName",
    async list(ctx, opts) {
        return db
            .select(pipelineRunColumns)
            .from(pipelineExecutions)
            .innerJoin(pipelines, eq(pipelines.id, pipelineExecutions.pipelineId))
            .where(and(eq(pipelines.organizationId, ctx.organizationId), isNull(pipelineExecutions.deletedAt)))
            .orderBy(desc(pipelineExecutions.startedAt))
            .limit(clampLimit(opts?.limit));
    },
    async get(ctx, id) {
        const rows = await db
            .select(pipelineRunColumns)
            .from(pipelineExecutions)
            .innerJoin(pipelines, eq(pipelines.id, pipelineExecutions.pipelineId))
            .where(and(
                eq(pipelines.organizationId, ctx.organizationId),
                isNull(pipelineExecutions.deletedAt),
                eq(pipelineExecutions.id, Number(id)),
            ))
            .limit(1);
        return rows[0] ?? null;
    },
    async listBy(ctx, property, value, opts) {
        const filterable: Record<string, any> = {
            id: pipelineExecutions.id,
            runUuid: pipelineExecutions.runUuid,
            pipelineId: pipelineExecutions.pipelineId,
            status: pipelineExecutions.status,
            missionId: pipelineExecutions.missionId,
            missionRunId: pipelineExecutions.missionRunId,
            parentExecutionId: pipelineExecutions.parentExecutionId,
            traceSource: pipelineExecutions.traceSource,
            createdBy: pipelineExecutions.createdBy,
        };
        const column = filterable[property];
        if (!column) throw new UnfilterablePropertyError(property, Object.keys(filterable));
        return db
            .select(pipelineRunColumns)
            .from(pipelineExecutions)
            .innerJoin(pipelines, eq(pipelines.id, pipelineExecutions.pipelineId))
            .where(and(
                eq(pipelines.organizationId, ctx.organizationId),
                isNull(pipelineExecutions.deletedAt),
                eq(column, value),
            ))
            .orderBy(desc(pipelineExecutions.startedAt))
            .limit(clampLimit(opts?.limit));
    },
};

const pipelineStepRunColumns = {
    id: pipelineStepExecutions.id,
    pipelineExecutionId: pipelineStepExecutions.pipelineExecutionId,
    pipelineStepId: pipelineStepExecutions.pipelineStepId,
    jobId: pipelineStepExecutions.jobId,
    stepOrder: pipelineStepExecutions.stepOrder,
    status: pipelineStepExecutions.status,
    outputName: pipelineStepExecutions.outputName,
    error: pipelineStepExecutions.error,
    executedAt: pipelineStepExecutions.executedAt,
    completedAt: pipelineStepExecutions.completedAt,
    retryCount: pipelineStepExecutions.retryCount,
    parentStepExecutionId: pipelineStepExecutions.parentStepExecutionId,
    dependencyStatus: pipelineStepExecutions.dependencyStatus,
    traceId: pipelineStepExecutions.traceId,
};

/**
 * One execution of one step. This is the row that answers "which step keeps failing",
 * and the reason the step spine is worth modelling at all.
 *
 * `output` is deliberately NOT exposed: it is unbounded step output, frequently a
 * whole document, and surfacing it here would put it into every list and every agent
 * context that touches the type. `outputUri` stays out for the same reason plus the
 * signed-URL question. The error message is exposed, because that IS the answer.
 *
 * This table has no organization_id, and neither, in practice, does the execution it
 * hangs off — every step-execution row in the dev database belongs to a run whose own
 * org column is null. So the boundary is the join all the way up to the pipeline, for
 * the reason set out on Pipeline Run above.
 */
const pipelineStepRunAdapter: OntologyAdapter = {
    properties: {
        id: "integer", pipelineExecutionId: "integer", pipelineStepId: "integer",
        jobId: "integer", stepOrder: "integer", status: "string", outputName: "string",
        error: "string", executedAt: "string", completedAt: "string",
        retryCount: "integer", parentStepExecutionId: "integer",
        dependencyStatus: "string", traceId: "string",
    },
    titleProperty: "status",
    async list(ctx, opts) {
        return db
            .select(pipelineStepRunColumns)
            .from(pipelineStepExecutions)
            .innerJoin(pipelineExecutions, eq(pipelineExecutions.id, pipelineStepExecutions.pipelineExecutionId))
            .innerJoin(pipelines, eq(pipelines.id, pipelineExecutions.pipelineId))
            .where(and(
                eq(pipelines.organizationId, ctx.organizationId),
                isNull(pipelineStepExecutions.deletedAt),
            ))
            .orderBy(desc(pipelineStepExecutions.executedAt))
            .limit(clampLimit(opts?.limit));
    },
    async get(ctx, id) {
        const rows = await db
            .select(pipelineStepRunColumns)
            .from(pipelineStepExecutions)
            .innerJoin(pipelineExecutions, eq(pipelineExecutions.id, pipelineStepExecutions.pipelineExecutionId))
            .innerJoin(pipelines, eq(pipelines.id, pipelineExecutions.pipelineId))
            .where(and(
                eq(pipelines.organizationId, ctx.organizationId),
                isNull(pipelineStepExecutions.deletedAt),
                eq(pipelineStepExecutions.id, Number(id)),
            ))
            .limit(1);
        return rows[0] ?? null;
    },
    async listBy(ctx, property, value, opts) {
        const filterable: Record<string, any> = {
            id: pipelineStepExecutions.id,
            pipelineExecutionId: pipelineStepExecutions.pipelineExecutionId,
            pipelineStepId: pipelineStepExecutions.pipelineStepId,
            jobId: pipelineStepExecutions.jobId,
            stepOrder: pipelineStepExecutions.stepOrder,
            status: pipelineStepExecutions.status,
            outputName: pipelineStepExecutions.outputName,
            parentStepExecutionId: pipelineStepExecutions.parentStepExecutionId,
            dependencyStatus: pipelineStepExecutions.dependencyStatus,
            traceId: pipelineStepExecutions.traceId,
        };
        const column = filterable[property];
        if (!column) throw new UnfilterablePropertyError(property, Object.keys(filterable));
        return db
            .select(pipelineStepRunColumns)
            .from(pipelineStepExecutions)
            .innerJoin(pipelineExecutions, eq(pipelineExecutions.id, pipelineStepExecutions.pipelineExecutionId))
            .innerJoin(pipelines, eq(pipelines.id, pipelineExecutions.pipelineId))
            .where(and(
                eq(pipelines.organizationId, ctx.organizationId),
                isNull(pipelineStepExecutions.deletedAt),
                eq(column, value),
            ))
            .orderBy(desc(pipelineStepExecutions.executedAt))
            .limit(clampLimit(opts?.limit));
    },
};

const datasetAdapter: OntologyAdapter = {
    properties: { id: "integer", name: "string", description: "string", tags: "string", createdAt: "string" },
    titleProperty: "name",
    async list(ctx, opts) {
        const rows = await db
            .select({ id: datasets.id, name: datasets.name, description: datasets.description, tags: datasets.tags, createdAt: datasets.createdAt })
            .from(datasets)
            .where(eq(datasets.organizationId, ctx.organizationId))
            .orderBy(desc(datasets.createdAt))
            .limit(clampLimit(opts?.limit));
        return rows;
    },
    async get(ctx, id) {
        const rows = await db
            .select({ id: datasets.id, name: datasets.name, description: datasets.description, tags: datasets.tags, createdAt: datasets.createdAt })
            .from(datasets)
            .where(and(eq(datasets.organizationId, ctx.organizationId), eq(datasets.id, Number(id))))
            .limit(1);
        return rows[0] ?? null;
    },
    listBy: makeListBy(
        { id: datasets.id, name: datasets.name, description: datasets.description, tags: datasets.tags, createdAt: datasets.createdAt },
        datasets,
        (ctx) => eq(datasets.organizationId, ctx.organizationId),
        desc(datasets.createdAt),
        { id: datasets.id, name: datasets.name },
    ),
};

const knowledgeGraphAdapter: OntologyAdapter = {
    properties: {
        id: "integer", label: "string", name: "string", externalId: "string",
        verificationStatus: "string", confidenceScore: "number", sourceType: "string",
        missionId: "integer", data: "object", createdAt: "string",
    },
    titleProperty: "name",
    async list(ctx, opts) {
        return db.select({
            id: knowledgeNodes.id,
            label: knowledgeNodes.label,
            name: knowledgeNodes.name,
            externalId: knowledgeNodes.externalId,
            verificationStatus: knowledgeNodes.verificationStatus,
            confidenceScore: knowledgeNodes.confidenceScore,
            sourceType: knowledgeNodes.sourceType,
            missionId: knowledgeNodes.missionId,
            data: knowledgeNodes.data,
            createdAt: knowledgeNodes.createdAt,
        }).from(knowledgeNodes)
          .where(and(eq(knowledgeNodes.organizationId, ctx.organizationId), eq(knowledgeNodes.verificationStatus, "verified")))
          .orderBy(desc(knowledgeNodes.updatedAt))
          .limit(clampLimit(opts?.limit));
    },
    async get(ctx, id) {
        const rows = await db.select({
            id: knowledgeNodes.id,
            label: knowledgeNodes.label,
            name: knowledgeNodes.name,
            externalId: knowledgeNodes.externalId,
            verificationStatus: knowledgeNodes.verificationStatus,
            confidenceScore: knowledgeNodes.confidenceScore,
            sourceType: knowledgeNodes.sourceType,
            missionId: knowledgeNodes.missionId,
            extractionSources: knowledgeNodes.extractionSources,
            data: knowledgeNodes.data,
            createdAt: knowledgeNodes.createdAt,
        }).from(knowledgeNodes)
          .where(and(
              eq(knowledgeNodes.organizationId, ctx.organizationId),
              eq(knowledgeNodes.id, Number(id)),
              eq(knowledgeNodes.verificationStatus, "verified"),
          )).limit(1);
        return rows[0] ?? null;
    },
    // The verification gate is part of the boundary, not part of the ordering: both
    // other reads refuse unverified nodes, and a filter that dropped it would let
    // traversal surface claims the graph has not stood behind. verificationStatus is
    // therefore not itself filterable — it is pinned.
    listBy: makeListBy(
        {
            id: knowledgeNodes.id,
            label: knowledgeNodes.label,
            name: knowledgeNodes.name,
            externalId: knowledgeNodes.externalId,
            verificationStatus: knowledgeNodes.verificationStatus,
            confidenceScore: knowledgeNodes.confidenceScore,
            sourceType: knowledgeNodes.sourceType,
            missionId: knowledgeNodes.missionId,
            data: knowledgeNodes.data,
            createdAt: knowledgeNodes.createdAt,
        },
        knowledgeNodes,
        (ctx) => and(
            eq(knowledgeNodes.organizationId, ctx.organizationId),
            eq(knowledgeNodes.verificationStatus, "verified"),
        ),
        desc(knowledgeNodes.updatedAt),
        {
            id: knowledgeNodes.id,
            label: knowledgeNodes.label,
            name: knowledgeNodes.name,
            externalId: knowledgeNodes.externalId,
            sourceType: knowledgeNodes.sourceType,
            missionId: knowledgeNodes.missionId,
        },
    ),
};

/**
 * Transference rules are PLATFORM-WIDE: transference_rules has no tenant column of
 * any kind, because a prompt-hash to local-handler mapping is learned across the
 * whole installation rather than owned by an org.
 *
 * So this adapter cannot satisfy the org filter every other one applies, and it
 * previously satisfied nothing at all — list returned every row to every caller.
 * A super-admin gate is the honest reading: it is platform telemetry, and an
 * ordinary tenant has no business reading the routing table learned from everyone's
 * traffic. Giving the table an org dimension would be the alternative, and a much
 * larger change.
 */
const transferenceRulesAdapter: OntologyAdapter = {
    properties: {
        id: "integer",
        promptHash: "string",
        mode: "string",
        tier: "integer",
        handlerPath: "string",
        accuracyScore: "integer",
        totalShadowCount: "integer",
        mismatchCount: "integer",
        createdAt: "string",
    },
    titleProperty: "promptHash",
    async list(ctx, opts) {
        if (!ctx.isSuperAdmin) return [];
        const rows = await db
            .select({
                id: transferenceRules.id,
                promptHash: transferenceRules.promptHash,
                mode: transferenceRules.mode,
                tier: transferenceRules.tier,
                handlerPath: transferenceRules.handlerPath,
                accuracyScore: transferenceRules.accuracyScore,
                totalShadowCount: transferenceRules.totalShadowCount,
                mismatchCount: transferenceRules.mismatchCount,
                createdAt: transferenceRules.createdAt,
            })
            .from(transferenceRules)
            .orderBy(desc(transferenceRules.createdAt))
            .limit(clampLimit(opts?.limit));
        return rows;
    },
    async get(ctx, id) {
        if (!ctx.isSuperAdmin) return null;
        const rows = await db
            .select({
                id: transferenceRules.id,
                promptHash: transferenceRules.promptHash,
                mode: transferenceRules.mode,
                tier: transferenceRules.tier,
                handlerPath: transferenceRules.handlerPath,
                accuracyScore: transferenceRules.accuracyScore,
                totalShadowCount: transferenceRules.totalShadowCount,
                mismatchCount: transferenceRules.mismatchCount,
                createdAt: transferenceRules.createdAt,
            })
            .from(transferenceRules)
            .where(eq(transferenceRules.id, Number(id)))
            .limit(1);
        return rows[0] ?? null;
    },
    // Hand-written for the same reason list and get are: there is no org column to
    // filter on, so the super-admin gate IS the boundary. An empty result for an
    // ordinary tenant matches what the other two reads already do.
    async listBy(ctx, property, value, opts) {
        const filterable: Record<string, any> = {
            id: transferenceRules.id,
            promptHash: transferenceRules.promptHash,
            mode: transferenceRules.mode,
            tier: transferenceRules.tier,
            handlerPath: transferenceRules.handlerPath,
        };
        const column = filterable[property];
        if (!column) throw new UnfilterablePropertyError(property, Object.keys(filterable));
        if (!ctx.isSuperAdmin) return [];
        return db
            .select({
                id: transferenceRules.id,
                promptHash: transferenceRules.promptHash,
                mode: transferenceRules.mode,
                tier: transferenceRules.tier,
                handlerPath: transferenceRules.handlerPath,
                accuracyScore: transferenceRules.accuracyScore,
                totalShadowCount: transferenceRules.totalShadowCount,
                mismatchCount: transferenceRules.mismatchCount,
                createdAt: transferenceRules.createdAt,
            })
            .from(transferenceRules)
            .where(eq(column, value))
            .orderBy(desc(transferenceRules.createdAt))
            .limit(clampLimit(opts?.limit));
    },
};

/**
 * Swarm tasks, scoped through the mission that owns them.
 *
 * swarm_tasks has no organization_id of its own, and both reads here USED TO HAVE NO
 * FILTER AT ALL — list returned every org's tasks and get resolved any id — which
 * broke the isolation contract stated at the top of this file. missionId is NOT NULL
 * and missions are org-scoped, so the join is the scope.
 */
const swarmTasksAdapter: OntologyAdapter = {
    properties: {
        id: "integer",
        missionId: "integer",
        requestingAgentId: "integer",
        description: "string",
        status: "string",
        winningBidId: "integer",
        createdAt: "string",
    },
    titleProperty: "description",
    async list(ctx, opts) {
        const rows = await db
            .select({
                id: swarmTasks.id,
                missionId: swarmTasks.missionId,
                requestingAgentId: swarmTasks.requestingAgentId,
                description: swarmTasks.description,
                status: swarmTasks.status,
                winningBidId: swarmTasks.winningBidId,
                createdAt: swarmTasks.createdAt,
            })
            .from(swarmTasks)
            .innerJoin(missions, eq(missions.id, swarmTasks.missionId))
            .where(eq(missions.organizationId, ctx.organizationId))
            .orderBy(desc(swarmTasks.createdAt))
            .limit(clampLimit(opts?.limit));
        return rows;
    },
    async get(ctx, id) {
        const rows = await db
            .select({
                id: swarmTasks.id,
                missionId: swarmTasks.missionId,
                requestingAgentId: swarmTasks.requestingAgentId,
                description: swarmTasks.description,
                status: swarmTasks.status,
                winningBidId: swarmTasks.winningBidId,
                createdAt: swarmTasks.createdAt,
            })
            .from(swarmTasks)
            .innerJoin(missions, eq(missions.id, swarmTasks.missionId))
            .where(and(eq(missions.organizationId, ctx.organizationId), eq(swarmTasks.id, Number(id))))
            .limit(1);
        return rows[0] ?? null;
    },
    // swarm_tasks has no organization_id; the join to missions is the scope, exactly
    // as in list and get. Filtering the table directly would reinstate the leak those
    // two were fixed for.
    async listBy(ctx, property, value, opts) {
        const filterable: Record<string, any> = {
            id: swarmTasks.id,
            missionId: swarmTasks.missionId,
            requestingAgentId: swarmTasks.requestingAgentId,
            status: swarmTasks.status,
            winningBidId: swarmTasks.winningBidId,
        };
        const column = filterable[property];
        if (!column) throw new UnfilterablePropertyError(property, Object.keys(filterable));
        return db
            .select({
                id: swarmTasks.id,
                missionId: swarmTasks.missionId,
                requestingAgentId: swarmTasks.requestingAgentId,
                description: swarmTasks.description,
                status: swarmTasks.status,
                winningBidId: swarmTasks.winningBidId,
                createdAt: swarmTasks.createdAt,
            })
            .from(swarmTasks)
            .innerJoin(missions, eq(missions.id, swarmTasks.missionId))
            .where(and(eq(missions.organizationId, ctx.organizationId), eq(column, value)))
            .orderBy(desc(swarmTasks.createdAt))
            .limit(clampLimit(opts?.limit));
    },
};

const promptVersionsAdapter: OntologyAdapter = {
    properties: {
        id: "integer",
        organizationId: "integer",
        promptType: "string",
        versionId: "string",
        parentVersionId: "string",
        status: "string",
        generationMethod: "string",
        fitnessScore: "number",
        successRate: "number",
        createdAt: "string",
    },
    titleProperty: "versionId",
    async list(ctx, opts) {
        const rows = await db
            .select({
                id: promptVersions.id,
                organizationId: promptVersions.organizationId,
                promptType: promptVersions.promptType,
                versionId: promptVersions.versionId,
                parentVersionId: promptVersions.parentVersionId,
                status: promptVersions.status,
                generationMethod: promptVersions.generationMethod,
                fitnessScore: promptVersions.fitnessScore,
                successRate: promptVersions.successRate,
                createdAt: promptVersions.createdAt,
            })
            .from(promptVersions)
            .where(eq(promptVersions.organizationId, ctx.organizationId))
            .orderBy(desc(promptVersions.createdAt))
            .limit(clampLimit(opts?.limit));
        return rows;
    },
    async get(ctx, id) {
        const rows = await db
            .select({
                id: promptVersions.id,
                organizationId: promptVersions.organizationId,
                promptType: promptVersions.promptType,
                versionId: promptVersions.versionId,
                parentVersionId: promptVersions.parentVersionId,
                status: promptVersions.status,
                generationMethod: promptVersions.generationMethod,
                fitnessScore: promptVersions.fitnessScore,
                successRate: promptVersions.successRate,
                createdAt: promptVersions.createdAt,
            })
            .from(promptVersions)
            .where(and(eq(promptVersions.organizationId, ctx.organizationId), eq(promptVersions.id, Number(id))))
            .limit(1);
        return rows[0] ?? null;
    },
    // organizationId is surfaced as a property but deliberately not filterable: it is
    // already pinned by the org boundary, and accepting it would invite a link that
    // looks like it crosses tenants.
    listBy: makeListBy(
        {
            id: promptVersions.id,
            organizationId: promptVersions.organizationId,
            promptType: promptVersions.promptType,
            versionId: promptVersions.versionId,
            parentVersionId: promptVersions.parentVersionId,
            status: promptVersions.status,
            generationMethod: promptVersions.generationMethod,
            fitnessScore: promptVersions.fitnessScore,
            successRate: promptVersions.successRate,
            createdAt: promptVersions.createdAt,
        },
        promptVersions,
        (ctx) => eq(promptVersions.organizationId, ctx.organizationId),
        desc(promptVersions.createdAt),
        {
            id: promptVersions.id,
            promptType: promptVersions.promptType,
            versionId: promptVersions.versionId,
            // The self-link: a version's parent is another version's versionId.
            parentVersionId: promptVersions.parentVersionId,
            status: promptVersions.status,
            generationMethod: promptVersions.generationMethod,
        },
    ),
};

/**
 * Project Spaces as an Ontology Object Type (PROJECT_SPACES_DESIGN §6.2). Modelling
 * projects here rather than as a parallel subsystem is what gives them a live REST
 * surface and registered agent tools on day one.
 */
const projectAdapter: OntologyAdapter = {
    properties: {
        id: "integer", key: "string", name: "string", objective: "string",
        status: "string", visibility: "string", ownerUserId: "string",
        budgetLimitUsd: "string", isDefault: "boolean", createdAt: "string",
    },
    titleProperty: "name",
    async list(ctx, opts) {
        return db
            .select({
                id: projects.id, key: projects.key, name: projects.name,
                objective: projects.objective, status: projects.status,
                visibility: projects.visibility, ownerUserId: projects.ownerUserId,
                budgetLimitUsd: projects.budgetLimitUsd, isDefault: projects.isDefault,
                createdAt: projects.createdAt,
            })
            .from(projects)
            .where(eq(projects.organizationId, ctx.organizationId))
            .orderBy(desc(projects.isDefault), desc(projects.createdAt))
            .limit(clampLimit(opts?.limit));
    },
    listBy: makeListBy(
        {
            id: projects.id, key: projects.key, name: projects.name,
            objective: projects.objective, status: projects.status,
            visibility: projects.visibility, ownerUserId: projects.ownerUserId,
            budgetLimitUsd: projects.budgetLimitUsd, isDefault: projects.isDefault,
            createdAt: projects.createdAt,
        },
        projects,
        (ctx) => eq(projects.organizationId, ctx.organizationId),
        desc(projects.createdAt),
        {
            id: projects.id, key: projects.key, name: projects.name,
            status: projects.status, visibility: projects.visibility,
            ownerUserId: projects.ownerUserId,
        },
    ),
    async get(ctx, id) {
        // Accept either the numeric id or the URL key — agents tend to have the key.
        const numeric = Number(id);
        const byId = Number.isInteger(numeric) && String(id).trim() === String(numeric);
        const rows = await db
            .select({
                id: projects.id, key: projects.key, name: projects.name,
                objective: projects.objective, description: projects.description,
                status: projects.status, visibility: projects.visibility,
                ownerUserId: projects.ownerUserId, budgetLimitUsd: projects.budgetLimitUsd,
                isDefault: projects.isDefault, createdAt: projects.createdAt,
            })
            .from(projects)
            .where(and(
                eq(projects.organizationId, ctx.organizationId),
                byId ? eq(projects.id, numeric) : eq(projects.key, String(id)),
            ))
            .limit(1);
        return rows[0] ?? null;
    },
};

/**
 * The containment relation itself. project_resources carries no organization_id —
 * it inherits org scope from its parent project, so every query here joins through
 * `projects` rather than filtering the junction directly.
 */
const projectResourceAdapter: OntologyAdapter = {
    properties: {
        id: "integer", projectId: "integer", projectKey: "string",
        resourceType: "string", resourceId: "integer", relation: "string",
        createdAt: "string",
    },
    titleProperty: "resourceType",
    async list(ctx, opts) {
        return db
            .select({
                id: projectResources.id, projectId: projectResources.projectId,
                projectKey: projects.key, resourceType: projectResources.resourceType,
                resourceId: projectResources.resourceId, relation: projectResources.relation,
                createdAt: projectResources.createdAt,
            })
            .from(projectResources)
            .innerJoin(projects, eq(projects.id, projectResources.projectId))
            .where(eq(projects.organizationId, ctx.organizationId))
            .orderBy(desc(projectResources.createdAt))
            .limit(clampLimit(opts?.limit));
    },
    async get(ctx, id) {
        const rows = await db
            .select({
                id: projectResources.id, projectId: projectResources.projectId,
                projectKey: projects.key, resourceType: projectResources.resourceType,
                resourceId: projectResources.resourceId, relation: projectResources.relation,
                createdAt: projectResources.createdAt,
            })
            .from(projectResources)
            .innerJoin(projects, eq(projects.id, projectResources.projectId))
            .where(and(eq(projects.organizationId, ctx.organizationId), eq(projectResources.id, Number(id))))
            .limit(1);
        return rows[0] ?? null;
    },
    // The org boundary here is the JOINED projects row, not a column on this table —
    // project_resources carries no organization_id. Filtering the junction directly
    // would read every org's rows, so the join is part of the isolation, not an
    // optimisation.
    async listBy(ctx, property, value, opts) {
        const filterable: Record<string, any> = {
            id: projectResources.id,
            projectId: projectResources.projectId,
            resourceType: projectResources.resourceType,
            resourceId: projectResources.resourceId,
            relation: projectResources.relation,
        };
        const column = filterable[property];
        if (!column) throw new UnfilterablePropertyError(property, Object.keys(filterable));
        return db
            .select({
                id: projectResources.id, projectId: projectResources.projectId,
                projectKey: projects.key, resourceType: projectResources.resourceType,
                resourceId: projectResources.resourceId, relation: projectResources.relation,
                createdAt: projectResources.createdAt,
            })
            .from(projectResources)
            .innerJoin(projects, eq(projects.id, projectResources.projectId))
            .where(and(eq(projects.organizationId, ctx.organizationId), eq(column, value)))
            .orderBy(desc(projectResources.createdAt))
            .limit(clampLimit(opts?.limit));
    },
};

/**
 * Signal Intelligence, made referenceable.
 *
 * A signal, the prediction made about it, and the surprise when that prediction
 * was wrong were reachable only by the code that produced them: agents received
 * them pushed into a mission blackboard and could not ask about them, and people
 * could only see them on a dashboard. Registering them here gives both halves of
 * a hybrid team one way to name the same thing — `ontology_get_object` for an
 * agent, the ontology browser for a person.
 *
 * Read-through, like every adapter in this file: no rows are copied, and
 * ctx.organizationId is the isolation boundary.
 *
 * The three are one story rather than three tables. `correlationId` — which is
 * the event primitive's id — threads signal -> prediction -> action -> outcome
 * -> surprise, so any one of them resolves the whole episode. That is what a
 * team actually refers to; a single row rarely is.
 */
const signalAdapter: OntologyAdapter = {
    properties: {
        id: "string", eventType: "string", targetSector: "string", jurisdiction: "string",
        severity: "string", confidenceScore: "number", summary: "string", observedAt: "string",
    },
    titleProperty: "eventType",
    async list(ctx, opts) {
        const rows = await db
            .select({
                id: eventPrimitives.id, eventType: eventPrimitives.eventType,
                targetSector: eventPrimitives.targetSector, jurisdiction: eventPrimitives.jurisdiction,
                severity: eventPrimitives.severity, confidenceScore: eventPrimitives.confidenceScore,
                summary: eventPrimitives.rawText, observedAt: eventPrimitives.extractionTimestamp,
            })
            .from(eventPrimitives)
            .where(eq(eventPrimitives.organizationId, ctx.organizationId))
            .orderBy(desc(eventPrimitives.extractionTimestamp))
            .limit(clampLimit(opts?.limit));
        return rows;
    },
    async get(ctx, id) {
        const rows = await db
            .select({
                id: eventPrimitives.id, eventType: eventPrimitives.eventType,
                targetSector: eventPrimitives.targetSector, jurisdiction: eventPrimitives.jurisdiction,
                severity: eventPrimitives.severity, confidenceScore: eventPrimitives.confidenceScore,
                summary: eventPrimitives.rawText, observedAt: eventPrimitives.extractionTimestamp,
            })
            .from(eventPrimitives)
            .where(and(eq(eventPrimitives.organizationId, ctx.organizationId), eq(eventPrimitives.id, String(id))))
            .limit(1);
        return rows[0] ?? null;
    },
    // `summary` and `observedAt` are aliases over rawText and extractionTimestamp;
    // neither is a sensible join key, so they are left out rather than mapped. `id` is
    // the correlation that threads signal -> prediction -> surprise, which is the
    // traversal this type exists to serve.
    listBy: makeListBy(
        {
            id: eventPrimitives.id, eventType: eventPrimitives.eventType,
            targetSector: eventPrimitives.targetSector, jurisdiction: eventPrimitives.jurisdiction,
            severity: eventPrimitives.severity, confidenceScore: eventPrimitives.confidenceScore,
            summary: eventPrimitives.rawText, observedAt: eventPrimitives.extractionTimestamp,
        },
        eventPrimitives,
        (ctx) => eq(eventPrimitives.organizationId, ctx.organizationId),
        desc(eventPrimitives.extractionTimestamp),
        {
            id: eventPrimitives.id, eventType: eventPrimitives.eventType,
            targetSector: eventPrimitives.targetSector, jurisdiction: eventPrimitives.jurisdiction,
            severity: eventPrimitives.severity,
        },
    ),
};

/**
 * A prediction is the world model's projection about a signal — what it expects
 * to be affected and how far the impact reaches. `signalId` is the correlation
 * that ties it back to the signal and forward to any surprise.
 */
const predictionAdapter: OntologyAdapter = {
    properties: {
        id: "string", signalId: "string", status: "string", affectedEntities: "string",
        impactHorizons: "string", predictedAt: "string",
    },
    titleProperty: "id",
    async list(ctx, opts) {
        const rows = await db
            .select({
                id: stateTransitionEvents.id, signalId: stateTransitionEvents.eventPrimitiveId,
                status: stateTransitionEvents.status, affectedEntities: stateTransitionEvents.affectedEntities,
                impactHorizons: stateTransitionEvents.impactHorizons, predictedAt: stateTransitionEvents.createdAt,
            })
            .from(stateTransitionEvents)
            .where(eq(stateTransitionEvents.organizationId, ctx.organizationId))
            .orderBy(desc(stateTransitionEvents.createdAt))
            .limit(clampLimit(opts?.limit));
        return rows;
    },
    async get(ctx, id) {
        const rows = await db
            .select({
                id: stateTransitionEvents.id, signalId: stateTransitionEvents.eventPrimitiveId,
                status: stateTransitionEvents.status, affectedEntities: stateTransitionEvents.affectedEntities,
                impactHorizons: stateTransitionEvents.impactHorizons, predictedAt: stateTransitionEvents.createdAt,
            })
            .from(stateTransitionEvents)
            .where(and(
                eq(stateTransitionEvents.organizationId, ctx.organizationId),
                eq(stateTransitionEvents.id, String(id)),
            ))
            .limit(1);
        return rows[0] ?? null;
    },
    // `signalId` is an ALIAS over event_primitive_id. Mapping it to a column of the
    // same name would filter nothing that exists; this is the one property anyone
    // will actually traverse on, since it is what ties a prediction to its signal.
    listBy: makeListBy(
        {
            id: stateTransitionEvents.id, signalId: stateTransitionEvents.eventPrimitiveId,
            status: stateTransitionEvents.status, affectedEntities: stateTransitionEvents.affectedEntities,
            impactHorizons: stateTransitionEvents.impactHorizons, predictedAt: stateTransitionEvents.createdAt,
        },
        stateTransitionEvents,
        (ctx) => eq(stateTransitionEvents.organizationId, ctx.organizationId),
        desc(stateTransitionEvents.createdAt),
        {
            id: stateTransitionEvents.id,
            signalId: stateTransitionEvents.eventPrimitiveId,
            status: stateTransitionEvents.status,
        },
    ),
};

/**
 * A surprise is prediction error: the outcome contradicted the projection.
 *
 * It has no table of its own — it is recorded onto the delivery row that carried
 * the signal to a cycle, so this reads out of that row's jsonb. That is the one
 * concession in this file to a shape that is not first-class, and the reason a
 * `signal_surprises` table would be worth having if surprises become
 * queryable on their own terms (by dimension, by error band) rather than just
 * referenceable.
 */
const surpriseAdapter: OntologyAdapter = {
    properties: {
        id: "string", signalId: "string", cycleId: "integer", dimension: "string",
        predicted: "string", observed: "string", error: "number", summary: "string", raisedAt: "string",
    },
    titleProperty: "summary",
    async list(ctx, opts) {
        const rows = await db
            .select({
                id: cycleSignalDeliveries.id, signalId: cycleSignalDeliveries.eventPrimitiveId,
                cycleId: cycleSignalDeliveries.cycleId, payload: cycleSignalDeliveries.payload,
                deliveredAt: cycleSignalDeliveries.deliveredAt,
            })
            .from(cycleSignalDeliveries)
            .where(and(
                eq(cycleSignalDeliveries.organizationId, ctx.organizationId),
                // Only deliveries that actually carried a surprise.
                sql`${cycleSignalDeliveries.payload} ? 'surprise'`,
            ))
            .orderBy(desc(cycleSignalDeliveries.deliveredAt))
            .limit(clampLimit(opts?.limit));
        return rows.map(flattenSurprise);
    },
    async get(ctx, id) {
        const rows = await db
            .select({
                id: cycleSignalDeliveries.id, signalId: cycleSignalDeliveries.eventPrimitiveId,
                cycleId: cycleSignalDeliveries.cycleId, payload: cycleSignalDeliveries.payload,
                deliveredAt: cycleSignalDeliveries.deliveredAt,
            })
            .from(cycleSignalDeliveries)
            .where(and(
                eq(cycleSignalDeliveries.organizationId, ctx.organizationId),
                eq(cycleSignalDeliveries.id, String(id)),
            ))
            .limit(1);
        const row = rows[0];
        if (!row || !(row.payload as Record<string, unknown>)?.surprise) return null;
        return flattenSurprise(row);
    },
    // Only the three real columns are filterable. dimension, predicted, observed,
    // error and summary are lifted out of the delivery payload by flattenSurprise and
    // have no column to match on — a link declared over one of those falls back to
    // the service's bounded scan, which filters the flattened rows correctly.
    // The `? 'surprise'` guard is carried over: a delivery without one is not a
    // surprise, and admitting it here would invent rows the other reads exclude.
    async listBy(ctx, property, value, opts) {
        const filterable: Record<string, any> = {
            id: cycleSignalDeliveries.id,
            signalId: cycleSignalDeliveries.eventPrimitiveId,
            cycleId: cycleSignalDeliveries.cycleId,
        };
        const column = filterable[property];
        if (!column) throw new UnfilterablePropertyError(property, Object.keys(filterable));
        const rows = await db
            .select({
                id: cycleSignalDeliveries.id, signalId: cycleSignalDeliveries.eventPrimitiveId,
                cycleId: cycleSignalDeliveries.cycleId, payload: cycleSignalDeliveries.payload,
                deliveredAt: cycleSignalDeliveries.deliveredAt,
            })
            .from(cycleSignalDeliveries)
            .where(and(
                eq(cycleSignalDeliveries.organizationId, ctx.organizationId),
                sql`${cycleSignalDeliveries.payload} ? 'surprise'`,
                eq(column, value),
            ))
            .orderBy(desc(cycleSignalDeliveries.deliveredAt))
            .limit(clampLimit(opts?.limit));
        return rows.map(flattenSurprise);
    },
};

/** Lifts the surprise out of a delivery payload into flat, quotable properties. */
function flattenSurprise(row: {
    id: string; signalId: string; cycleId: number;
    payload: unknown; deliveredAt: Date | null;
}): Record<string, any> {
    const surprise = ((row.payload as Record<string, any>)?.surprise ?? {}) as Record<string, any>;
    return {
        id: row.id,
        signalId: row.signalId,
        cycleId: row.cycleId,
        dimension: surprise.dimension ?? null,
        predicted: surprise.predicted ?? null,
        observed: surprise.observed ?? null,
        error: surprise.error ?? null,
        summary: surprise.summary ?? null,
        raisedAt: (row.payload as Record<string, any>)?.surpriseAppliedAt ?? row.deliveredAt,
    };
}

/**
 * Ownership for an approval, in the order the row can actually prove it.
 *
 * `approval_requests.organization_id` is nullable and unset on 16 of 23 rows in the
 * dev database, so filtering on it alone would hide most of the history — the same
 * trap as pipeline_executions above. The job and the mission are both org-scoped and
 * neither disagrees with the approval's own org where both are set, so they are
 * consulted in turn. What is NOT done is defaulting: an approval that can prove no
 * owner (15 old rows carry the sentinel job_id = 0, which matches no job) stays
 * invisible to everybody, because the alternative is showing it to everybody.
 *
 * Written as an OR rather than a coalesce so the overwhelmingly common branch — the
 * org column IS set, as it is on every row the decision router writes now — can still
 * use the (organization_id, status) index.
 */
const approvalOrgWhere = (ctx: OntologyCtx) =>
    or(
        eq(approvalRequests.organizationId, ctx.organizationId),
        and(isNull(approvalRequests.organizationId), eq(jobs.organizationId, ctx.organizationId)),
        and(
            isNull(approvalRequests.organizationId),
            isNull(jobs.organizationId),
            eq(missions.organizationId, ctx.organizationId),
        ),
    );

const approvalColumns = {
    id: approvalRequests.id,
    label: sql<string>`coalesce(${approvalRequests.toolName}, 'Approval ' || ${approvalRequests.id})`,
    status: approvalRequests.status,
    toolName: approvalRequests.toolName,
    approverType: approvalRequests.approverType,
    approverId: approvalRequests.approverId,
    approverEmail: approvalRequests.approverEmail,
    executionId: approvalRequests.executionId,
    jobId: approvalRequests.jobId,
    missionId: approvalRequests.missionId,
    knowledgeNodeId: approvalRequests.knowledgeNodeId,
    isEvolutionary: approvalRequests.isEvolutionary,
    snoozedUntil: approvalRequests.snoozedUntil,
    decisionAt: approvalRequests.decisionAt,
    comments: approvalRequests.comments,
    createdAt: approvalRequests.createdAt,
};

const approvalJoins = <T extends { leftJoin: any }>(q: T) =>
    (q as any)
        .leftJoin(jobs, eq(jobs.id, approvalRequests.jobId))
        .leftJoin(missions, eq(missions.id, approvalRequests.missionId));

/**
 * A human decision the platform is waiting on, or has already recorded.
 *
 * This is the gate every ontology write action already routes through — the action
 * log stores the approvalId — so registering it makes "what is blocked, on whom, and
 * what did it stop" answerable from the ontology instead of only from the HIL inbox.
 *
 * Three fields are deliberately NOT surfaced. `token` is the bearer secret in the
 * external approval link: anything holding it can approve, so it must never reach a
 * list an agent can read. `toolArgs` and `modifiedOutput` are the payload of the
 * action being gated — unbounded, and frequently the exact data the approval exists
 * to protect. `approverEmail` IS surfaced, because "who is this waiting on" is the
 * question the type is for.
 */
const approvalAdapter: OntologyAdapter = {
    properties: {
        id: "integer", label: "string", status: "string", toolName: "string",
        approverType: "string", approverId: "string", approverEmail: "string",
        executionId: "string", jobId: "integer", missionId: "integer",
        knowledgeNodeId: "integer", isEvolutionary: "boolean", snoozedUntil: "string",
        decisionAt: "string", comments: "string", createdAt: "string",
    },
    titleProperty: "label",
    async list(ctx, opts) {
        return approvalJoins(db.select(approvalColumns).from(approvalRequests))
            .where(approvalOrgWhere(ctx))
            .orderBy(desc(approvalRequests.createdAt))
            .limit(clampLimit(opts?.limit));
    },
    async get(ctx, id) {
        const rows = await approvalJoins(db.select(approvalColumns).from(approvalRequests))
            .where(and(approvalOrgWhere(ctx), eq(approvalRequests.id, Number(id))))
            .limit(1);
        return rows[0] ?? null;
    },
    async listBy(ctx, property, value, opts) {
        const filterable: Record<string, any> = {
            id: approvalRequests.id,
            status: approvalRequests.status,
            toolName: approvalRequests.toolName,
            approverType: approvalRequests.approverType,
            approverId: approvalRequests.approverId,
            approverEmail: approvalRequests.approverEmail,
            executionId: approvalRequests.executionId,
            jobId: approvalRequests.jobId,
            missionId: approvalRequests.missionId,
            knowledgeNodeId: approvalRequests.knowledgeNodeId,
        };
        const column = filterable[property];
        if (!column) throw new UnfilterablePropertyError(property, Object.keys(filterable));
        return approvalJoins(db.select(approvalColumns).from(approvalRequests))
            .where(and(approvalOrgWhere(ctx), eq(column, value)))
            .orderBy(desc(approvalRequests.createdAt))
            .limit(clampLimit(opts?.limit));
    },
};

/**
 * The authored half of a project's timeline.
 *
 * Signals are observed; these are asserted by a person — a deadline, a launch, a
 * commitment made in a meeting the platform never saw. Registering them here is
 * what lets an agent be asked "what is coming up on this project" and answer
 * from the same list a human is looking at, rather than from a separate feature
 * only the UI knows about.
 */
const projectEventAdapter: OntologyAdapter = {
    properties: {
        id: "integer", projectId: "integer", title: "string", description: "string",
        kind: "string", severity: "string", startsAt: "string", endsAt: "string",
        createdBy: "string",
    },
    titleProperty: "title",
    async list(ctx, opts) {
        return db
            .select({
                id: projectEvents.id, projectId: projectEvents.projectId, title: projectEvents.title,
                description: projectEvents.description, kind: projectEvents.kind,
                severity: projectEvents.severity, startsAt: projectEvents.startsAt,
                endsAt: projectEvents.endsAt, createdBy: projectEvents.createdBy,
            })
            .from(projectEvents)
            .where(eq(projectEvents.organizationId, ctx.organizationId))
            // Soonest first: a timeline is read forwards, unlike an audit log.
            .orderBy(projectEvents.startsAt)
            .limit(clampLimit(opts?.limit));
    },
    async get(ctx, id) {
        const rows = await db
            .select({
                id: projectEvents.id, projectId: projectEvents.projectId, title: projectEvents.title,
                description: projectEvents.description, kind: projectEvents.kind,
                severity: projectEvents.severity, startsAt: projectEvents.startsAt,
                endsAt: projectEvents.endsAt, createdBy: projectEvents.createdBy,
            })
            .from(projectEvents)
            .where(and(eq(projectEvents.organizationId, ctx.organizationId), eq(projectEvents.id, Number(id))))
            .limit(1);
        return rows[0] ?? null;
    },
    // Ascending, matching list: a timeline is read forwards, and a traversal that
    // returned this project's events newest-first would answer "what is coming up"
    // with the wrong end of the list.
    listBy: makeListBy(
        {
            id: projectEvents.id, projectId: projectEvents.projectId, title: projectEvents.title,
            description: projectEvents.description, kind: projectEvents.kind,
            severity: projectEvents.severity, startsAt: projectEvents.startsAt,
            endsAt: projectEvents.endsAt, createdBy: projectEvents.createdBy,
        },
        projectEvents,
        (ctx) => eq(projectEvents.organizationId, ctx.organizationId),
        projectEvents.startsAt,
        {
            id: projectEvents.id, projectId: projectEvents.projectId,
            kind: projectEvents.kind, severity: projectEvents.severity,
            createdBy: projectEvents.createdBy,
        },
    ),
};

/**
 * Calculation nodes for mathematical operations in the knowledge graph.
 *
 * These represent computational nodes that can perform calculations on other
 * graph nodes. They enable reactive updates, caching, and formula evaluation
 * within the neuro-symbolic graph architecture.
 */
const calculationAdapter: OntologyAdapter = {
    properties: {
        id: "integer", nodeId: "integer", operation: "string", formula: "string",
        outputUnit: "string", status: "string", cachedResult: "string",
        lastCalculatedAt: "string", cacheTtlSeconds: "integer", createdAt: "string",
    },
    titleProperty: "formula",
    async list(ctx, opts) {
        const rows = await db
            .select({
                id: calculationNodes.id, nodeId: calculationNodes.nodeId,
                operation: calculationNodes.operation, formula: calculationNodes.formula,
                outputUnit: calculationNodes.outputUnit, status: calculationNodes.status,
                cachedResult: calculationNodes.cachedResult, lastCalculatedAt: calculationNodes.lastCalculatedAt,
                cacheTtlSeconds: calculationNodes.cacheTtlSeconds, createdAt: calculationNodes.createdAt,
            })
            .from(calculationNodes)
            .where(eq(calculationNodes.organizationId, ctx.organizationId))
            .orderBy(desc(calculationNodes.createdAt))
            .limit(clampLimit(opts?.limit));
        return rows;
    },
    async get(ctx, id) {
        const rows = await db
            .select({
                id: calculationNodes.id, nodeId: calculationNodes.nodeId,
                operation: calculationNodes.operation, formula: calculationNodes.formula,
                outputUnit: calculationNodes.outputUnit, status: calculationNodes.status,
                cachedResult: calculationNodes.cachedResult, lastCalculatedAt: calculationNodes.lastCalculatedAt,
                cacheTtlSeconds: calculationNodes.cacheTtlSeconds, createdAt: calculationNodes.createdAt,
            })
            .from(calculationNodes)
            .where(and(eq(calculationNodes.organizationId, ctx.organizationId), eq(calculationNodes.id, Number(id))))
            .limit(1);
        return rows[0] ?? null;
    },
    // nodeId is the point of this one: a calculation hangs off a knowledge node, so
    // "what computes over this node" is the traversal it exists for.
    listBy: makeListBy(
        {
            id: calculationNodes.id, nodeId: calculationNodes.nodeId,
            operation: calculationNodes.operation, formula: calculationNodes.formula,
            outputUnit: calculationNodes.outputUnit, status: calculationNodes.status,
            cachedResult: calculationNodes.cachedResult, lastCalculatedAt: calculationNodes.lastCalculatedAt,
            cacheTtlSeconds: calculationNodes.cacheTtlSeconds, createdAt: calculationNodes.createdAt,
        },
        calculationNodes,
        (ctx) => eq(calculationNodes.organizationId, ctx.organizationId),
        desc(calculationNodes.createdAt),
        {
            id: calculationNodes.id, nodeId: calculationNodes.nodeId,
            operation: calculationNodes.operation, status: calculationNodes.status,
        },
    ),
};

/**
 * Saved knowledge-graph queries, exposed alongside the other primitives.
 *
 * `cypherQuery` is deliberately NOT surfaced. The platform has no Cypher engine
 * — the string is generated for the builder's preview pane and executed by
 * nothing — so publishing it as a property of the primitive would invite agents
 * and templates to treat it as runnable. What executes is `queryStructure`, and
 * running a query goes through run_saved_query rather than through anything
 * read off this adapter.
 *
 * Note the org filter differs from the other adapters: saved_queries.organization_id
 * is NULLABLE, so `eq` would silently exclude rows belonging to no org. That is
 * the intended reading here — a null-org query must not appear inside every
 * org's ontology — but it is a choice, not the accident it looks like.
 */
const savedQueryAdapter: OntologyAdapter = {
    properties: {
        id: "integer",
        name: "string",
        description: "string",
        runCount: "integer",
        lastRunAt: "string",
        createdAt: "string",
    },
    titleProperty: "name",
    async list(ctx, opts) {
        const rows = await db
            .select({
                id: savedQueries.id,
                name: savedQueries.name,
                description: savedQueries.description,
                runCount: savedQueries.runCount,
                lastRunAt: savedQueries.lastRunAt,
                createdAt: savedQueries.createdAt,
            })
            .from(savedQueries)
            .where(eq(savedQueries.organizationId, ctx.organizationId))
            .orderBy(desc(savedQueries.createdAt))
            .limit(clampLimit(opts?.limit));
        return rows;
    },
    async get(ctx, id) {
        const rows = await db
            .select({
                id: savedQueries.id,
                name: savedQueries.name,
                description: savedQueries.description,
                runCount: savedQueries.runCount,
                lastRunAt: savedQueries.lastRunAt,
                createdAt: savedQueries.createdAt,
            })
            .from(savedQueries)
            .where(and(eq(savedQueries.organizationId, ctx.organizationId), eq(savedQueries.id, Number(id))))
            .limit(1);
        return rows[0] ?? null;
    },
    // Same plain equality as the other two reads, and for the documented reason:
    // organization_id is NULLABLE here, and a null-org query must not appear inside
    // every org's ontology. cypherQuery stays unfilterable because it stays unsurfaced.
    listBy: makeListBy(
        {
            id: savedQueries.id,
            name: savedQueries.name,
            description: savedQueries.description,
            runCount: savedQueries.runCount,
            lastRunAt: savedQueries.lastRunAt,
            createdAt: savedQueries.createdAt,
        },
        savedQueries,
        (ctx) => eq(savedQueries.organizationId, ctx.organizationId),
        desc(savedQueries.createdAt),
        { id: savedQueries.id, name: savedQueries.name },
    ),
};

const alertColumns = {
    id: alerts.id, severity: alerts.severity, category: alerts.category,
    message: alerts.message, details: alerts.details,
    jobRunId: alerts.jobRunId, pipelineRunId: alerts.pipelineRunId,
    scheduledJobId: alerts.scheduledJobId,
    createdAt: alerts.createdAt, acknowledgedAt: alerts.acknowledgedAt,
    resolvedAt: alerts.resolvedAt, suppressed: alerts.suppressed,
};

/**
 * Operational alerts, so an agent triaging an incident can read what the platform
 * already knows instead of being told about it.
 *
 * `alerts.organization_id` is NULLABLE and some writers leave it null — the DLQ
 * failure alert in dead-letter-queue.service.ts is one — so `eq` means those rows
 * appear in NO org's ontology. That is deliberate: an alert that names a job run
 * without saying whose it is must not be broadcast to every tenant, and the fix
 * belongs in the writers stamping an org, not in a filter here that would leak.
 * Same reasoning as savedQueryAdapter above.
 *
 * Of the three columns that look like references, only `scheduled_job_id` is one:
 * it carries a real foreign key and is the sole linkable end here.
 * `pipeline_run_id` is a bare integer whose intended writer is `Alerts.pipelineFailure`
 * — trustworthy, but see the note on that link type.
 * `jobRunId` is NOT a key at all and is not linkable: no `job_runs` table exists,
 * and the only thing minting a job run id (streaming-logs.service.ts) uses
 * `Date.now()`. It is exposed because it correlates an alert with streamed logs,
 * not because it identifies a row anywhere.
 */
const alertAdapter: OntologyAdapter = {
    properties: {
        id: "integer",
        severity: "string",
        category: "string",
        message: "string",
        details: "object",
        jobRunId: "integer",
        pipelineRunId: "integer",
        scheduledJobId: "integer",
        createdAt: "string",
        acknowledgedAt: "string",
        resolvedAt: "string",
        suppressed: "boolean",
    },
    titleProperty: "message",
    async list(ctx, opts) {
        const rows = await db
            .select(alertColumns)
            .from(alerts)
            .where(eq(alerts.organizationId, ctx.organizationId))
            .orderBy(desc(alerts.createdAt))
            .limit(clampLimit(opts?.limit));
        return rows;
    },
    async get(ctx, id) {
        const rows = await db
            .select(alertColumns)
            .from(alerts)
            .where(and(eq(alerts.organizationId, ctx.organizationId), eq(alerts.id, Number(id))))
            .limit(1);
        return rows[0] ?? null;
    },
    listBy: makeListBy(
        alertColumns,
        alerts,
        // Deliberately the same plain equality the adapter's list uses: an alert with
        // a NULL org is invisible to every tenant by design, and a filter that let it
        // through here would leak it into a traversal.
        (ctx) => eq(alerts.organizationId, ctx.organizationId),
        desc(alerts.createdAt),
        {
            id: alerts.id, severity: alerts.severity, category: alerts.category,
            jobRunId: alerts.jobRunId, pipelineRunId: alerts.pipelineRunId,
            scheduledJobId: alerts.scheduledJobId,
        },
    ),
};

/** An app is AUTHORED by `developerOrgId ?? organizationId` — the platform's own rule. */
const appOwnerFilter = (org: number) =>
    or(eq(apps.developerOrgId, org), and(isNull(apps.developerOrgId), eq(apps.organizationId, org)));

/**
 * What an org can see in the catalogue: the apps it authored, plus the standard
 * built-ins that belong to nobody and are available to everyone.
 *
 * Note what is NOT included: another org's `isPublic` app. `is_public` does not mean
 * "listed for sale" today — 19 of the 20 org-authored apps in dev carry it and not one
 * app is priced — so treating it as a marketplace signal would publish every org's
 * private work to every other org.
 */
const appVisibleFilter = (org: number) => or(appOwnerFilter(org), eq(apps.isSystem, true));

/**
 * The distribution class of an app: 'standard' | 'custom' | 'listed'.
 *
 * A real column (migration 0070) rather than a rule inferred from `isSystem` and
 * `isPublic`. Those two cannot express a marketplace listing — `isPublic` means "not
 * access-restricted" and Org Forge sets it on everything it installs — and a class
 * that decides whether something is for sale should not be guesswork.
 */
const appDistribution = apps.distribution;

/**
 * Apps as the catalogue sees them: what this org authored, plus the standard built-ins.
 *
 * Authorship is `developerOrgId ?? organizationId`, the rule the rest of the platform
 * authorizes against (app-forge.service, apps.route, app-readiness.service), so it is
 * reproduced rather than simplified to one column — filtering on `organizationId`
 * alone would hide an org's own apps.
 *
 * What an org HAS is a different question from what it can see, and it is answered by
 * App Deployment below: an installed app is a deployment row, which is also where a
 * demo or a purchase will live when the marketplace exists.
 */
const appAdapter: OntologyAdapter = {
    properties: {
        id: "integer",
        name: "string",
        slug: "string",
        description: "string",
        status: "string",
        blueprint: "string",
        version: "string",
        distribution: "string",
        isPublic: "boolean",
        isSystem: "boolean",
        oddjobMissionId: "integer",
        projectId: "integer",
        createdAt: "string",
    },
    titleProperty: "name",
    async list(ctx, opts) {
        const rows = await db
            .select({
                id: apps.id, name: apps.name, slug: apps.slug, description: apps.description,
                status: apps.status, blueprint: apps.blueprint, version: apps.version,
                distribution: appDistribution,
                isPublic: apps.isPublic, isSystem: apps.isSystem,
                oddjobMissionId: apps.oddjobMissionId, projectId: apps.projectId,
                createdAt: apps.createdAt,
            })
            .from(apps)
            .where(appVisibleFilter(ctx.organizationId))
            .orderBy(desc(apps.createdAt))
            .limit(clampLimit(opts?.limit));
        return rows;
    },
    // appVisibleFilter, not a plain organization_id equality: an org can legitimately
    // see apps it does not own, and narrowing to one column here would hide its own.
    listBy: makeListBy(
        {
            id: apps.id, name: apps.name, slug: apps.slug, description: apps.description,
            status: apps.status, blueprint: apps.blueprint, version: apps.version,
            distribution: appDistribution,
            isPublic: apps.isPublic, isSystem: apps.isSystem,
            oddjobMissionId: apps.oddjobMissionId, projectId: apps.projectId,
            createdAt: apps.createdAt,
        },
        apps,
        (ctx) => appVisibleFilter(ctx.organizationId),
        desc(apps.createdAt),
        {
            id: apps.id, name: apps.name, slug: apps.slug, status: apps.status,
            projectId: apps.projectId, oddjobMissionId: apps.oddjobMissionId,
        },
    ),
    async get(ctx, id) {
        // Slug as well as id: the platform's own getApp accepts either, and an agent
        // that read `slug` off a list row would otherwise be unable to fetch by it.
        const identifier = /^\d+$/.test(String(id)) ? eq(apps.id, Number(id)) : eq(apps.slug, String(id));
        const rows = await db
            .select({
                id: apps.id, name: apps.name, slug: apps.slug, description: apps.description,
                status: apps.status, blueprint: apps.blueprint, version: apps.version,
                distribution: appDistribution,
                isPublic: apps.isPublic, isSystem: apps.isSystem,
                oddjobMissionId: apps.oddjobMissionId, projectId: apps.projectId,
                createdAt: apps.createdAt,
            })
            .from(apps)
            .where(and(appVisibleFilter(ctx.organizationId), identifier))
            .limit(1);
        return rows[0] ?? null;
    },
};

/**
 * What this org actually HAS: an installed app, with its runtime state and spend.
 *
 * Separate from App on purpose. An org that installs ten apps and authors none owns
 * nothing in the catalogue but runs ten things, and "what am I running, what is it
 * costing me, is it published" is the question an operator or an agent actually asks.
 * When apps become purchasable this is also where a demo and a purchase differ — a
 * trial is a deployment with a budget and an expiry, not a second copy of the app —
 * so the primitive is already the right shape for it.
 *
 * organization_id is NOT NULL here, so the filter is a plain equality: unlike alerts
 * and apps, a deployment always belongs to exactly one org. Titled by the app's name,
 * because publicSlug and title are both nullable and a deployment with neither would
 * render blank.
 */
const appDeploymentAdapter: OntologyAdapter = {
    properties: {
        id: "integer",
        appId: "integer",
        appName: "string",
        appSlug: "string",
        status: "string",
        publicSlug: "string",
        url: "string",
        isPublished: "boolean",
        accessPolicy: "string",
        budgetLimitUsd: "string",
        currentSpendUsd: "string",
        deploymentMode: "string",
        plan: "string",
        expiresAt: "string",
        projectId: "integer",
        installedAt: "string",
    },
    titleProperty: "appName",
    async list(ctx, opts) {
        const rows = await db
            .select({
                id: appDeployments.id, appId: appDeployments.appId,
                appName: apps.name, appSlug: apps.slug,
                status: appDeployments.status, publicSlug: appDeployments.publicSlug,
                url: appDeployments.url, isPublished: appDeployments.isPublished,
                accessPolicy: appDeployments.accessPolicy,
                budgetLimitUsd: appDeployments.budgetLimitUsd,
                currentSpendUsd: appDeployments.currentSpendUsd,
                deploymentMode: appDeployments.deploymentMode,
                plan: appDeployments.plan, expiresAt: appDeployments.expiresAt,
                projectId: appDeployments.projectId, installedAt: appDeployments.installedAt,
            })
            .from(appDeployments)
            .innerJoin(apps, eq(apps.id, appDeployments.appId))
            .where(eq(appDeployments.organizationId, ctx.organizationId))
            .orderBy(desc(appDeployments.installedAt))
            .limit(clampLimit(opts?.limit));
        return rows;
    },
    async get(ctx, id) {
        const rows = await db
            .select({
                id: appDeployments.id, appId: appDeployments.appId,
                appName: apps.name, appSlug: apps.slug,
                status: appDeployments.status, publicSlug: appDeployments.publicSlug,
                url: appDeployments.url, isPublished: appDeployments.isPublished,
                accessPolicy: appDeployments.accessPolicy,
                budgetLimitUsd: appDeployments.budgetLimitUsd,
                currentSpendUsd: appDeployments.currentSpendUsd,
                deploymentMode: appDeployments.deploymentMode,
                plan: appDeployments.plan, expiresAt: appDeployments.expiresAt,
                projectId: appDeployments.projectId, installedAt: appDeployments.installedAt,
            })
            .from(appDeployments)
            .innerJoin(apps, eq(apps.id, appDeployments.appId))
            .where(and(eq(appDeployments.organizationId, ctx.organizationId), eq(appDeployments.id, Number(id))))
            .limit(1);
        return rows[0] ?? null;
    },
    // Hand-written rather than via makeListBy: the projection joins `apps`, and the
    // filterable set is only the deployment's OWN columns. appName and appSlug come
    // from the joined row — filtering an installed-app question by the catalogue's
    // name would answer a different question than the one asked.
    async listBy(ctx, property, value, opts) {
        const filterable: Record<string, any> = {
            id: appDeployments.id,
            appId: appDeployments.appId,
            projectId: appDeployments.projectId,
            status: appDeployments.status,
            publicSlug: appDeployments.publicSlug,
            plan: appDeployments.plan,
            deploymentMode: appDeployments.deploymentMode,
        };
        const column = filterable[property];
        if (!column) throw new UnfilterablePropertyError(property, Object.keys(filterable));
        return db
            .select({
                id: appDeployments.id, appId: appDeployments.appId,
                appName: apps.name, appSlug: apps.slug,
                status: appDeployments.status, publicSlug: appDeployments.publicSlug,
                url: appDeployments.url, isPublished: appDeployments.isPublished,
                accessPolicy: appDeployments.accessPolicy,
                budgetLimitUsd: appDeployments.budgetLimitUsd,
                currentSpendUsd: appDeployments.currentSpendUsd,
                deploymentMode: appDeployments.deploymentMode,
                plan: appDeployments.plan, expiresAt: appDeployments.expiresAt,
                projectId: appDeployments.projectId, installedAt: appDeployments.installedAt,
            })
            .from(appDeployments)
            .innerJoin(apps, eq(apps.id, appDeployments.appId))
            .where(and(eq(appDeployments.organizationId, ctx.organizationId), eq(column, value)))
            .orderBy(desc(appDeployments.installedAt))
            .limit(clampLimit(opts?.limit));
    },
};

const scheduleColumns = {
    id: schedules.id,
    name: schedules.name,
    description: schedules.description,
    pattern: schedules.pattern,
    patternLabel: schedules.patternLabel,
    patternString: schedules.patternString,
    // Lifted out of the jsonb because it is THE answer to "when does this run", and
    // leaving it inside would make every caller parse the blob to find it.
    // patternLabel is the column that was meant to say this and is null on all 42
    // rows; `pattern` is an opaque integer code. The cron string is what is actually
    // populated.
    cron: sql<string | null>`${schedules.patternString}->>'cron'`.as("cron"),
    // The dispatch mechanism. Rows carrying 'mission-trigger' here are the ones whose
    // job/pipeline/mission columns are all null — they route by this instead, so an
    // empty target is not the orphan it looks like.
    dispatchAction: sql<string | null>`${schedules.patternString}->>'action'`.as("dispatch_action"),
    timezone: schedules.timezone,
    calendarId: schedules.calendarId,
    onHolidayBehavior: schedules.onHolidayBehavior,
    isActive: schedules.isActive,
    createdBy: schedules.createdBy,
    createdAt: schedules.createdAt,
};

const scheduledJobColumns = {
    id: scheduledJobs.id,
    name: scheduledJobs.name,
    scheduleId: scheduledJobs.scheduleId,
    scheduleName: schedules.name,
    jobId: scheduledJobs.jobId,
    pipelineId: scheduledJobs.pipelineId,
    missionId: scheduledJobs.missionId,
    triggerType: scheduledJobs.triggerType,
    priority: scheduledJobs.priority,
    isActive: scheduledJobs.isActive,
    maxRetries: scheduledJobs.maxRetries,
    retryDelaySeconds: scheduledJobs.retryDelaySeconds,
    maxConcurrentRuns: scheduledJobs.maxConcurrentRuns,
    queueTimeout: scheduledJobs.queueTimeout,
    alertOnFailure: scheduledJobs.alertOnFailure,
    alertOnSuccess: scheduledJobs.alertOnSuccess,
    alertOnDelay: scheduledJobs.alertOnDelay,
    delayThreshold: scheduledJobs.delayThreshold,
    slaMinutes: scheduledJobs.slaMinutes,
    catchupPolicy: scheduledJobs.catchupPolicy,
    createdBy: scheduledJobs.createdBy,
    createdAt: scheduledJobs.createdAt,
};

/**
 * WHEN something recurs, separate from WHAT recurs.
 *
 * A schedule is a reusable recurrence — a pattern, a timezone, and a holiday policy —
 * and several scheduled jobs can share one. Keeping it apart from Scheduled Job is
 * what lets "everything on the overnight schedule" be a question at all; folded into
 * the job it would be a property repeated 42 times with no way to ask across them.
 *
 * organization_id is nullable on this table but populated on every row in practice
 * (42 of 42), so the plain equality is the right filter AND the honest one: unlike
 * pipeline_executions, there is no population of null-org rows that it would hide.
 *
 * `pattern` is an opaque integer code and `patternString` the jsonb definition behind
 * it. `patternLabel` was meant to carry the rendered human reading but is null on
 * every row, so the cron expression is lifted out of the jsonb as its own property
 * rather than left for each caller to dig out.
 */
const scheduleAdapter: OntologyAdapter = {
    properties: {
        id: "integer", name: "string", description: "string", pattern: "integer",
        cron: "string", dispatchAction: "string",
        patternLabel: "string", patternString: "object", timezone: "string",
        calendarId: "integer", onHolidayBehavior: "string", isActive: "boolean",
        createdBy: "string", createdAt: "string",
    },
    titleProperty: "name",
    async list(ctx, opts) {
        return db
            .select(scheduleColumns)
            .from(schedules)
            .where(eq(schedules.organizationId, ctx.organizationId))
            .orderBy(desc(schedules.createdAt))
            .limit(clampLimit(opts?.limit));
    },
    async get(ctx, id) {
        const rows = await db
            .select(scheduleColumns)
            .from(schedules)
            .where(and(eq(schedules.organizationId, ctx.organizationId), eq(schedules.id, Number(id))))
            .limit(1);
        return rows[0] ?? null;
    },
    listBy: makeListBy(
        scheduleColumns,
        schedules,
        (ctx) => eq(schedules.organizationId, ctx.organizationId),
        desc(schedules.createdAt),
        {
            id: schedules.id, name: schedules.name, pattern: schedules.pattern,
            timezone: schedules.timezone, calendarId: schedules.calendarId,
            isActive: schedules.isActive, createdBy: schedules.createdBy,
        },
    ),
};

/**
 * WHAT recurs: a target bound to a schedule, with its retry, alerting and SLA policy.
 *
 * The hub of the automation half of the ontology — it is the only row that knows a
 * mission ran because something asked for it rather than because a person did. Its
 * three target columns are mutually exclusive by intent (a scheduled job runs a job,
 * OR a pipeline, OR a mission), which is why they are three separate Link Types
 * rather than one polymorphic link: the column itself names the type, so there is no
 * discriminator to read.
 *
 * `parameterValues` and `escalationPolicy` are deliberately NOT surfaced — unbounded
 * jsonb that would land in every list and every agent context touching the type.
 * `triggerCredentialId` stays out because a credential reference is not something to
 * hand agents by default.
 */
const scheduledJobAdapter: OntologyAdapter = {
    properties: {
        id: "integer", name: "string", scheduleId: "integer", scheduleName: "string",
        jobId: "integer", pipelineId: "integer", missionId: "integer",
        triggerType: "string", priority: "integer", isActive: "boolean",
        maxRetries: "integer", retryDelaySeconds: "integer",
        maxConcurrentRuns: "integer", queueTimeout: "integer",
        alertOnFailure: "boolean", alertOnSuccess: "boolean", alertOnDelay: "boolean",
        delayThreshold: "integer", slaMinutes: "integer", catchupPolicy: "string",
        createdBy: "string", createdAt: "string",
    },
    titleProperty: "name",
    async list(ctx, opts) {
        return db
            .select(scheduledJobColumns)
            .from(scheduledJobs)
            .leftJoin(schedules, eq(schedules.id, scheduledJobs.scheduleId))
            .where(eq(scheduledJobs.organizationId, ctx.organizationId))
            .orderBy(desc(scheduledJobs.createdAt))
            .limit(clampLimit(opts?.limit));
    },
    async get(ctx, id) {
        const rows = await db
            .select(scheduledJobColumns)
            .from(scheduledJobs)
            .leftJoin(schedules, eq(schedules.id, scheduledJobs.scheduleId))
            .where(and(eq(scheduledJobs.organizationId, ctx.organizationId), eq(scheduledJobs.id, Number(id))))
            .limit(1);
        return rows[0] ?? null;
    },
    // LEFT join, so scheduleName is a joined value with no column of its own and is
    // absent from `filterable` — filtering an automation question by the schedule's
    // NAME would answer a different question than the one asked, and scheduleId is
    // the join key that actually means it.
    async listBy(ctx, property, value, opts) {
        const filterable: Record<string, any> = {
            id: scheduledJobs.id,
            name: scheduledJobs.name,
            scheduleId: scheduledJobs.scheduleId,
            jobId: scheduledJobs.jobId,
            pipelineId: scheduledJobs.pipelineId,
            missionId: scheduledJobs.missionId,
            triggerType: scheduledJobs.triggerType,
            priority: scheduledJobs.priority,
            isActive: scheduledJobs.isActive,
            createdBy: scheduledJobs.createdBy,
        };
        const column = filterable[property];
        if (!column) throw new UnfilterablePropertyError(property, Object.keys(filterable));
        return db
            .select(scheduledJobColumns)
            .from(scheduledJobs)
            .leftJoin(schedules, eq(schedules.id, scheduledJobs.scheduleId))
            .where(and(eq(scheduledJobs.organizationId, ctx.organizationId), eq(column, value)))
            .orderBy(desc(scheduledJobs.createdAt))
            .limit(clampLimit(opts?.limit));
    },
};

/**
 * Operational Cycles — the temporal container that owns missions and, through
 * `projectId`, hangs off a Project Space.
 *
 * Two columns are deliberately not surfaced. `executionPlan` is the computed CPM
 * wave plan and `executionPolicy` the concurrency controls: both are orchestrator
 * state, large, and rewritten at launch, so exposing them as ontology properties
 * would put a moving internal structure in front of agents that read properties as
 * stable facts. What a caller wants from them — where a cycle is, and what it is
 * waiting on — is the cycle's Mission Runs, which are already their own type.
 *
 * `deletedAt` is a soft-delete tombstone, so every read here filters it out.
 * The other adapters have no equivalent because their tables hard-delete; getting
 * this wrong would surface cancelled work as live.
 */
const cycleColumns = {
    id: operationalCycles.id,
    name: operationalCycles.name,
    description: operationalCycles.description,
    objective: operationalCycles.objective,
    status: operationalCycles.status,
    recurrence: operationalCycles.recurrence,
    timezone: operationalCycles.timezone,
    priority: operationalCycles.priority,
    budgetLimitUsd: operationalCycles.budgetLimitUsd,
    currentSpendUsd: operationalCycles.currentSpendUsd,
    blueprintCount: operationalCycles.blueprintCount,
    projectId: operationalCycles.projectId,
    startDate: operationalCycles.startDate,
    endDate: operationalCycles.endDate,
    nextRunAt: operationalCycles.nextRunAt,
    lastRunAt: operationalCycles.lastRunAt,
    createdBy: operationalCycles.createdBy,
    createdAt: operationalCycles.createdAt,
};

const cycleOrgWhere = (ctx: OntologyCtx) =>
    and(
        eq(operationalCycles.organizationId, ctx.organizationId),
        isNull(operationalCycles.deletedAt),
    );

const cycleAdapter: OntologyAdapter = {
    properties: {
        id: "integer",
        name: "string",
        description: "string",
        objective: "string",
        status: "string",
        recurrence: "string",
        timezone: "string",
        priority: "integer",
        // decimal() comes back as a STRING from drizzle, not a number.
        budgetLimitUsd: "string",
        currentSpendUsd: "string",
        blueprintCount: "integer",
        projectId: "integer",
        startDate: "string",
        endDate: "string",
        nextRunAt: "string",
        lastRunAt: "string",
        createdBy: "string",
        createdAt: "string",
    },
    titleProperty: "name",
    async list(ctx, opts) {
        return db
            .select(cycleColumns)
            .from(operationalCycles)
            .where(cycleOrgWhere(ctx))
            .orderBy(desc(operationalCycles.createdAt))
            .limit(clampLimit(opts?.limit));
    },
    async get(ctx, id) {
        const rows = await db
            .select(cycleColumns)
            .from(operationalCycles)
            .where(and(cycleOrgWhere(ctx), eq(operationalCycles.id, Number(id))))
            .limit(1);
        return rows[0] ?? null;
    },
    listBy: makeListBy(
        cycleColumns,
        operationalCycles,
        cycleOrgWhere,
        desc(operationalCycles.createdAt),
        {
            id: operationalCycles.id,
            name: operationalCycles.name,
            status: operationalCycles.status,
            projectId: operationalCycles.projectId,
            recurrence: operationalCycles.recurrence,
            createdBy: operationalCycles.createdBy,
        },
    ),
};

/**
 * Spatial Regions — named areas, as the ontology sees them.
 *
 * `cells` is NOT surfaced as a property. The cell set is the region's geometry
 * and is routinely thousands of entries; more importantly, a property is
 * something agents read and compare, and a raw cell list invites exactly the
 * naive membership test ("is my cell in this array?") that mixed-resolution
 * containment exists to prevent — a fine position cell will never appear
 * verbatim in a set whose interior is stored coarse, so the test reads "not in
 * the region" for positions that are squarely inside it.
 *
 * `cellCount`, `minResolution` and `maxResolution` are surfaced instead: they
 * describe the geometry's shape and precision without being usable as a
 * shortcut around it. Membership goes through spatialRegionService.locate(),
 * which returns `inside` and `indeterminate` separately.
 */
const spatialRegionColumns = {
    id: spatialRegions.id,
    name: spatialRegions.name,
    description: spatialRegions.description,
    kind: spatialRegions.kind,
    cellCount: sql<number>`jsonb_array_length(${spatialRegions.cells})`.as("cell_count"),
    minResolution: spatialRegions.minResolution,
    maxResolution: spatialRegions.maxResolution,
    parentRegionId: spatialRegions.parentRegionId,
    createdBy: spatialRegions.createdBy,
    createdAt: spatialRegions.createdAt,
};

const spatialRegionOrgWhere = (ctx: OntologyCtx) =>
    and(eq(spatialRegions.organizationId, ctx.organizationId), isNull(spatialRegions.deletedAt));

const spatialRegionAdapter: OntologyAdapter = {
    properties: {
        id: "integer",
        name: "string",
        description: "string",
        kind: "string",
        cellCount: "integer",
        minResolution: "integer",
        maxResolution: "integer",
        parentRegionId: "integer",
        createdBy: "string",
        createdAt: "string",
    },
    titleProperty: "name",
    async list(ctx, opts) {
        return db
            .select(spatialRegionColumns)
            .from(spatialRegions)
            .where(spatialRegionOrgWhere(ctx))
            .orderBy(desc(spatialRegions.createdAt))
            .limit(clampLimit(opts?.limit));
    },
    async get(ctx, id) {
        const rows = await db
            .select(spatialRegionColumns)
            .from(spatialRegions)
            .where(and(spatialRegionOrgWhere(ctx), eq(spatialRegions.id, Number(id))))
            .limit(1);
        return rows[0] ?? null;
    },
    listBy: makeListBy(
        spatialRegionColumns,
        spatialRegions,
        spatialRegionOrgWhere,
        desc(spatialRegions.createdAt),
        {
            // cellCount is computed, not a column, so it is not filterable — the
            // same reason appName is absent from the app deployment filter set.
            id: spatialRegions.id,
            name: spatialRegions.name,
            kind: spatialRegions.kind,
            parentRegionId: spatialRegions.parentRegionId,
            createdBy: spatialRegions.createdBy,
        },
    ),
};

/**
 * Users / Human Actors — org-scoped, sanitized identity projection.
 *
 * Excludes all sensitive security fields (passwords, PINs, auth tokens, salts).
 * Projects public display attributes, timezone, and organizational binding.
 */
const userColumns = {
    id: users.id,
    username: users.username,
    email: users.email,
    firstName: users.firstName,
    lastName: users.lastName,
    displayName: sql<string>`COALESCE(NULLIF(TRIM(CONCAT(${users.firstName}, ' ', ${users.lastName})), ''), ${users.username})`.as("display_name"),
    defaultOrgId: users.defaultOrgId,
    slackHandle: users.slackHandle,
    quietHoursEnabled: users.quietHoursEnabled,
    quietHoursTimezone: users.quietHoursTimezone,
    legalAcceptedAt: users.legalAcceptedAt,
};

const userOrgWhere = (ctx: OntologyCtx) =>
    or(
        eq(users.defaultOrgId, ctx.organizationId),
        sql`EXISTS (SELECT 1 FROM user_orgs WHERE user_orgs.user_id = ${users.id} AND user_orgs.org_id = ${ctx.organizationId})`
    );

const userAdapter: OntologyAdapter = {
    properties: {
        id: "string",
        username: "string",
        email: "string",
        firstName: "string",
        lastName: "string",
        displayName: "string",
        defaultOrgId: "integer",
        slackHandle: "string",
        quietHoursEnabled: "boolean",
        quietHoursTimezone: "string",
        legalAcceptedAt: "string",
    },
    titleProperty: "displayName",
    async list(ctx, opts) {
        return db
            .select(userColumns)
            .from(users)
            .where(userOrgWhere(ctx))
            .limit(opts?.limit ?? 50);
    },
    async get(ctx, id) {
        const rows = await db
            .select(userColumns)
            .from(users)
            .where(and(userOrgWhere(ctx), eq(users.id, String(id))))
            .limit(1);
        return rows[0] ?? null;
    },
    listBy: makeListBy(
        userColumns,
        users,
        userOrgWhere,
        desc(users.id),
        {
            id: users.id,
            username: users.username,
            email: users.email,
            defaultOrgId: users.defaultOrgId,
            slackHandle: users.slackHandle,
        },
    ),
};

/**
 * Teams & Squads — hybrid collaborative units of human operators and autonomous agent pods.
 */
const teamColumns = {
    id: teams.id,
    name: teams.name,
    slug: teams.slug,
    description: teams.description,
    organizationId: teams.organizationId,
    squadType: teams.squadType,
    leadUserId: teams.leadUserId,
    homeH3Index: teams.homeH3Index,
    status: teams.status,
    createdBy: teams.createdBy,
    createdAt: teams.createdAt,
    humanMemberCount: sql<number>`COALESCE((SELECT COUNT(*) FROM team_members WHERE team_members.team_id = ${teams.id} AND (team_members.member_type = 'user' OR team_members.member_type IS NULL)), 0)`.as("human_member_count"),
    agentMemberCount: sql<number>`COALESCE((SELECT COUNT(*) FROM team_members WHERE team_members.team_id = ${teams.id} AND team_members.member_type = 'agent'), 0)`.as("agent_member_count"),
};

const teamOrgWhere = (ctx: OntologyCtx) =>
    and(eq(teams.organizationId, ctx.organizationId), isNull(teams.deletedAt));

const teamAdapter: OntologyAdapter = {
    properties: {
        id: "integer",
        name: "string",
        slug: "string",
        description: "string",
        organizationId: "integer",
        squadType: "string",
        leadUserId: "string",
        homeH3Index: "string",
        status: "string",
        humanMemberCount: "integer",
        agentMemberCount: "integer",
        createdBy: "string",
        createdAt: "string",
    },
    titleProperty: "name",
    async list(ctx, opts) {
        return db
            .select(teamColumns)
            .from(teams)
            .where(teamOrgWhere(ctx))
            .orderBy(desc(teams.createdAt))
            .limit(opts?.limit ?? 50);
    },
    async get(ctx, id) {
        const rows = await db
            .select(teamColumns)
            .from(teams)
            .where(and(teamOrgWhere(ctx), eq(teams.id, Number(id))))
            .limit(1);
        return rows[0] ?? null;
    },
    listBy: makeListBy(
        teamColumns,
        teams,
        teamOrgWhere,
        desc(teams.createdAt),
        {
            id: teams.id,
            name: teams.name,
            slug: teams.slug,
            squadType: teams.squadType,
            status: teams.status,
            leadUserId: teams.leadUserId,
            createdBy: teams.createdBy,
        },
    ),
};


// ---------------------------------------------------------------------------
// Skill adapter
// Surfaces imported / provisioned skills as a virtual Object Type so the
// assistant can answer "which high-risk skills were imported this week" and
// so augmentation link traversal (Skill --augments-> AgentCard) is possible.
//
// `code` is intentionally omitted from the list projection — it is an
// unbounded text blob and would make every list response enormous. Callers
// that need the implementation text should `get` the individual skill.
// ---------------------------------------------------------------------------

const skillColumns = {
    id: skills.id,
    name: skills.name,
    description: skills.description,
    language: skills.language,
    isInstalled: skills.isInstalled,
    isPublic: skills.isPublic,
    organizationId: skills.organizationId,
    createdAt: skills.createdAt,
    updatedAt: skills.updatedAt,
};

const skillOrgWhere = (ctx: OntologyCtx) =>
    eq(skills.organizationId, ctx.organizationId);

const skillAdapter: OntologyAdapter = {
    properties: {
        id: "integer",
        name: "string",
        description: "string",
        language: "string",
        isInstalled: "boolean",
        isPublic: "boolean",
        organizationId: "integer",
        createdAt: "string",
        updatedAt: "string",
    },
    titleProperty: "name",
    async list(ctx, opts) {
        return db
            .select(skillColumns)
            .from(skills)
            .where(skillOrgWhere(ctx))
            .orderBy(desc(skills.createdAt))
            .limit(clampLimit(opts?.limit));
    },
    async get(ctx, id) {
        const rows = await db
            .select({
                ...skillColumns,
                code: skills.code,
                installCommand: skills.installCommand,
                metadata: skills.metadata,
            })
            .from(skills)
            .where(and(skillOrgWhere(ctx), eq(skills.id, Number(id))))
            .limit(1);
        return rows[0] ?? null;
    },
    listBy: makeListBy(
        skillColumns,
        skills,
        skillOrgWhere,
        desc(skills.createdAt),
        {
            id: skills.id,
            name: skills.name,
            language: skills.language,
            isInstalled: skills.isInstalled,
            isPublic: skills.isPublic,
            organizationId: skills.organizationId,
        },
    ),
};

// ---------------------------------------------------------------------------
// Agent Card adapter
// Surfaces agent cards as a virtual Object Type so the assistant can answer
// "which agents have a given capability" and so the Skill --augments-> AgentCard
// link is traversable in both directions.
//
// Heavy jsonb arrays (capabilities, tools, topicAffinities, intentAffinities,
// oceanTraits) are omitted from the list projection for the same reason as
// skill.code above; they are included in `get` where a single row is fetched.
// ---------------------------------------------------------------------------

const agentCardColumns = {
    id: agentCards.id,
    organizationId: agentCards.organizationId,
    name: agentCards.name,
    description: agentCards.description,
    personaType: agentCards.personaType,
    enabled: agentCards.enabled,
    isDefault: agentCards.isDefault,
    soulArchetype: agentCards.soulArchetype,
    createdAt: agentCards.createdAt,
    updatedAt: agentCards.updatedAt,
};

const agentCardOrgWhere = (ctx: OntologyCtx) =>
    eq(agentCards.organizationId, ctx.organizationId);

const agentCardAdapter: OntologyAdapter = {
    properties: {
        id: "integer",
        organizationId: "integer",
        name: "string",
        description: "string",
        personaType: "string",
        enabled: "boolean",
        isDefault: "boolean",
        soulArchetype: "string",
        createdAt: "string",
        updatedAt: "string",
    },
    titleProperty: "name",
    async list(ctx, opts) {
        return db
            .select(agentCardColumns)
            .from(agentCards)
            .where(agentCardOrgWhere(ctx))
            .orderBy(desc(agentCards.createdAt))
            .limit(clampLimit(opts?.limit));
    },
    async get(ctx, id) {
        const rows = await db
            .select({
                ...agentCardColumns,
                capabilities: agentCards.capabilities,
                tools: agentCards.tools,
                topicAffinities: agentCards.topicAffinities,
                intentAffinities: agentCards.intentAffinities,
                oceanTraits: agentCards.oceanTraits,
                legend: agentCards.legend,
            })
            .from(agentCards)
            .where(and(agentCardOrgWhere(ctx), eq(agentCards.id, Number(id))))
            .limit(1);
        return rows[0] ?? null;
    },
    listBy: makeListBy(
        agentCardColumns,
        agentCards,
        agentCardOrgWhere,
        desc(agentCards.createdAt),
        {
            id: agentCards.id,
            organizationId: agentCards.organizationId,
            name: agentCards.name,
            personaType: agentCards.personaType,
            enabled: agentCards.enabled,
            isDefault: agentCards.isDefault,
        },
    ),
};

export const ONTOLOGY_ADAPTERS: Record<string, OntologyAdapter> = {
    ...FINANCIAL_ADAPTERS,
    projects: projectAdapter,
    project_resources: projectResourceAdapter,
    missions: missionAdapter,
    mission_runs: missionRunAdapter,
    jobs: jobAdapter,
    pipelines: pipelineAdapter,
    schedules: scheduleAdapter,
    scheduled_jobs: scheduledJobAdapter,
    pipeline_steps: pipelineStepAdapter,
    pipeline_runs: pipelineRunAdapter,
    pipeline_step_runs: pipelineStepRunAdapter,
    datasets: datasetAdapter,
    knowledge_graph: knowledgeGraphAdapter,
    transference_rules: transferenceRulesAdapter,
    swarm_tasks: swarmTasksAdapter,
    prompt_versions: promptVersionsAdapter,
    saved_queries: savedQueryAdapter,
    alerts: alertAdapter,
    apps: appAdapter,
    app_deployments: appDeploymentAdapter,
    signals: signalAdapter,
    predictions: predictionAdapter,
    surprises: surpriseAdapter,
    project_events: projectEventAdapter,
    approvals: approvalAdapter,
    calculations: calculationAdapter,
    operational_cycles: cycleAdapter,
    spatial_regions: spatialRegionAdapter,
    users: userAdapter,
    teams: teamAdapter,
    // ── Skill Integration System ──────────────────────────────────────────
    // Added to support ontology traversal for imported skills and the
    // Skill --augments→ AgentCard link type declared by the seed script.
    skills: skillAdapter,
    agent_cards: agentCardAdapter,
};

export function getAdapter(key: string): OntologyAdapter | undefined {
    return ONTOLOGY_ADAPTERS[key];
}
