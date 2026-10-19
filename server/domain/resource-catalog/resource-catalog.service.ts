import { and, desc, eq, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";

import { db } from "@server/database_service.js";
import { nodeRedisClient as redis } from "@domain/core/infrastructure/redis/redis-client.js";
import { createLogger } from "@server/utils/logger.js";
import type { OrgContext } from "@server/utils/auth-context.js";
import {
  appDeployments,
  apps,
  approvalRequests,
  agentDeployments,
  agentLongTermMemories,
  agentRunSteps,
  agentSessions,
  agentToolUsage,
  alerts,
  antigravityIncidents,
  credentials,
  crewSessions,
  cycleBlueprints,
  datasets,
  documentTemplates,
  evaluationRuns,
  evaluationTestSets,
  failureClusters,
  failureIncidents,
  failurePatterns,
  governorPolicies,
  governanceApprovals,
  hilForms,
  jobs,
  knowledgeDocuments,
  knowledgeTopics,
  mcpServers,
  missionDeliverables,
  missionRuns,
  missions,
  policyViolations,
  preventionRules,
  operationalCycles,
  pipelineSteps,
  pipelines,
  schedules,
  slackWorkspaces,
} from "@shared/schema/index.js";
import { forgeReleases } from "@shared/schema/apps/forge-releases.js";
import { hermesTraces } from "@shared/schema/gms/hermes-traces.js";
import {
  filterCatalogResources,
  makeResourceKey,
  RESOURCE_TYPE_DEFINITIONS,
  summarizeCatalogResources,
  type PlatformResource,
  type ResourceAction,
  type ResourceActionParamSchema,
  type ResourceCatalogQuery,
  type ResourceCatalogResponse,
  type ResourceHealth,
  type ResourceLifecycle,
  type ResourceRelation,
  type ResourceRiskLevel,
  type ResourceType,
} from "@shared/resource-catalog.js";

const DEFAULT_PER_TYPE_LIMIT = 100;
const MAX_PER_TYPE_LIMIT = 500;

type Collector = (orgContext: OrgContext, limit: number, idFilter?: string | number) => Promise<PlatformResource[]>;

function normalizeLimit(limit: number | undefined, fallback = DEFAULT_PER_TYPE_LIMIT): number {
  if (!limit || Number.isNaN(limit)) return fallback;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_PER_TYPE_LIMIT);
}

function iso(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return undefined;
}

function compact<T>(values: Array<T | null | undefined | false>): T[] {
  return values.filter(Boolean) as T[];
}

function scopedOrgCondition(
  organizationColumn: any,
  orgContext: OrgContext,
  includeGlobal = true,
): SQL | undefined {
  if (orgContext.isSuperAdmin && orgContext.organizationId == null) {
    return undefined;
  }

  if (orgContext.organizationId == null) {
    return includeGlobal ? isNull(organizationColumn) : sql`false`;
  }

  return includeGlobal
    ? or(eq(organizationColumn, orgContext.organizationId), isNull(organizationColumn))
    : eq(organizationColumn, orgContext.organizationId);
}

function whereAll(...conditions: Array<SQL | undefined>): SQL | undefined {
  const filtered = compact(conditions);
  if (filtered.length === 0) return undefined;
  if (filtered.length === 1) return filtered[0];
  return and(...filtered);
}

function idCondition(column: any, idFilter: string | number | undefined): SQL | undefined {
  if (idFilter == null) return undefined;
  const numericId = Number(idFilter);
  return Number.isInteger(numericId) ? eq(column, numericId) : sql`false`;
}

function textIdCondition(column: any, idFilter: string | number | undefined): SQL | undefined {
  return idFilter == null ? undefined : eq(column, String(idFilter));
}

/** Shared body schema for the app deploy/publish endpoint (POST /api/apps/:appId/deploy), which both `app`'s "deploy" action and `app_deployment`'s "publish" action invoke. Covers the publishing-relevant subset of insertAppDeploymentSchema, not its full ~25 fields. */
function appDeploymentPublishParams(): ResourceActionParamSchema {
  return {
    location: "body",
    fields: [
      { name: "isPublished", type: "boolean" },
      { name: "publicSlug", type: "string" },
      { name: "accessPolicy", type: "enum", enumValues: ["public", "password", "internal_only"] },
      { name: "password", type: "string", label: "Plaintext password (only when accessPolicy is password)" },
      { name: "title", type: "string" },
      { name: "description", type: "string" },
    ],
  };
}

function action(
  id: string,
  label: string,
  method: ResourceAction["method"],
  href: string,
  options?: Partial<Pick<ResourceAction, "capability" | "destructive" | "params">>,
): ResourceAction {
  return { id, label, method, href, ...options };
}

function relation(
  type: ResourceRelation["type"],
  targetType: ResourceType,
  targetId: string | number | null | undefined,
  label?: string,
  metadata?: Record<string, unknown>,
): ResourceRelation | undefined {
  if (targetId == null) return undefined;
  const target = String(targetId);
  return {
    type,
    targetType,
    targetId: target,
    targetKey: makeResourceKey(targetType, target),
    label,
    metadata,
    source: "derived",
  };
}

function lifecycleFromStatus(status: string | null | undefined): ResourceLifecycle {
  switch ((status ?? "").toLowerCase()) {
    case "active":
    case "installed":
    case "published":
    case "running":
      return "active";
    case "draft":
    case "planning":
    case "queued":
      return "draft";
    case "paused":
    case "suspended":
      return "paused";
    case "pending":
    case "pending_approval":
    case "reviewing":
    case "waiting_on_human":
    case "waiting_on_file":
      return "waiting";
    case "failed":
    case "rejected":
    case "cancelled":
    case "unhealthy":
      return "failed";
    case "completed":
    case "approved":
    case "closed":
      return "completed";
    case "archived":
      return "archived";
    default:
      return "unknown";
  }
}

function lifecycleForCycle(status: string | null | undefined, deletedAt?: Date | string | null): ResourceLifecycle {
  if (deletedAt) return "deleted";
  return lifecycleFromStatus(status);
}

function lifecycleForMission(
  status: string | null | undefined,
  isDraft?: boolean | null,
  deletedAt?: Date | string | null,
): ResourceLifecycle {
  if (deletedAt) return "deleted";
  if (isDraft) return "draft";
  return lifecycleFromStatus(status);
}

function healthFromLifecycle(lifecycle: ResourceLifecycle, message?: string | null): ResourceHealth {
  if (lifecycle === "failed") {
    return { state: "error", message: message ?? undefined };
  }
  if (lifecycle === "paused" || lifecycle === "waiting") {
    return { state: "warning", message: message ?? undefined };
  }
  if (lifecycle === "unknown") {
    return { state: "unknown", message: message ?? undefined };
  }
  return { state: "healthy", message: message ?? undefined };
}

function riskForLifecycle(lifecycle: ResourceLifecycle): ResourceRiskLevel {
  if (lifecycle === "failed" || lifecycle === "deleted") return "high";
  if (lifecycle === "waiting" || lifecycle === "paused") return "medium";
  return "low";
}

const RISK_ORDER: Record<ResourceRiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };

function maxRisk(...levels: ResourceRiskLevel[]): ResourceRiskLevel {
  return levels.reduce((highest, level) => (RISK_ORDER[level] > RISK_ORDER[highest] ? level : highest));
}

function tagsFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function idsFrom(value: unknown): Array<string | number> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string | number => typeof item === "string" || typeof item === "number");
}

function labelsFrom(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>)
    .filter(([, labelValue]) => labelValue === true || typeof labelValue === "string" || typeof labelValue === "number")
    .map(([key, labelValue]) => (labelValue === true ? key : `${key}:${labelValue}`));
}

function objectKeys(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value as Record<string, unknown>);
}

function hasContent(value: unknown): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

function typedResource(params: Omit<PlatformResource, "key">): PlatformResource {
  return {
    ...params,
    key: makeResourceKey(params.type, params.id),
  };
}

export class ResourceCatalogService {
  private readonly collectors: Partial<Record<ResourceType, Collector>> = {
    cycle: this.collectCycles.bind(this),
    cycle_blueprint: this.collectCycleBlueprints.bind(this),
    mission: this.collectMissions.bind(this),
    mission_run: this.collectMissionRuns.bind(this),
    agent_deployment: this.collectAgentDeployments.bind(this),
    agent_session: this.collectAgentSessions.bind(this),
    agent_run: this.collectAgentRuns.bind(this),
    crew_room: this.collectCrewRooms.bind(this),
    pipeline: this.collectPipelines.bind(this),
    pipeline_step: this.collectPipelineSteps.bind(this),
    job: this.collectJobs.bind(this),
    tool_call: this.collectToolCalls.bind(this),
    mcp_server: this.collectMcpServers.bind(this),
    dataset: this.collectDatasets.bind(this),
    memory: this.collectMemories.bind(this),
    knowledge_topic: this.collectKnowledgeTopics.bind(this),
    knowledge_document: this.collectKnowledgeDocuments.bind(this),
    document_template: this.collectDocumentTemplates.bind(this),
    hil_form: this.collectHilForms.bind(this),
    approval_request: this.collectApprovalRequests.bind(this),
    policy: this.collectPolicies.bind(this),
    approval_policy: this.collectApprovalPolicies.bind(this),
    app: this.collectApps.bind(this),
    app_deployment: this.collectAppDeployments.bind(this),
    app_release: this.collectAppReleases.bind(this),
    artifact: this.collectArtifacts.bind(this),
    report: this.collectReports.bind(this),
    evidence_bundle: this.collectEvidenceBundles.bind(this),
    trace: this.collectTraces.bind(this),
    trace_event: this.collectTraceEvents.bind(this),
    eval_dataset: this.collectEvalDatasets.bind(this),
    eval_run: this.collectEvalRuns.bind(this),
    schedule: this.collectSchedules.bind(this),
    credential: this.collectCredentials.bind(this),
    slack_workspace: this.collectSlackWorkspaces.bind(this),
    incident: this.collectIncidents.bind(this),
    alert: this.collectAlerts.bind(this),
    failure_pattern: this.collectFailurePatterns.bind(this),
    remediation: this.collectRemediations.bind(this),
    runbook: this.collectRunbooks.bind(this),
  };

  async listResources(
    orgContext: OrgContext,
    query: ResourceCatalogQuery = {},
  ): Promise<ResourceCatalogResponse> {
    const cacheKey = `rc:list:${orgContext.organizationId}:${Buffer.from(JSON.stringify(query)).toString("base64")}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as ResourceCatalogResponse;
      }
    } catch {
      // Fail open if Redis is unreachable
    }

    const selectedTypes = query.types?.length
      ? query.types
      : (Object.keys(this.collectors) as ResourceType[]);
    const perTypeLimit = normalizeLimit(query.perTypeLimit ?? query.limit);

    const groups = await Promise.all(
      selectedTypes.map((type) => {
        const collector = this.collectors[type];
        return collector ? collector(orgContext, perTypeLimit) : Promise.resolve([]);
      }),
    );
    const resources = filterCatalogResources(groups.flat(), query);

    const result: ResourceCatalogResponse = {
      resources,
      summary: summarizeCatalogResources(resources),
      definitions: RESOURCE_TYPE_DEFINITIONS,
      generatedAt: new Date().toISOString(),
    };

    try {
      await redis.setex(cacheKey, 30, JSON.stringify(result));
    } catch {
      // Non-blocking fail open
    }

    return result;
  }

  async getResourceByKey(key: string, orgContext: OrgContext): Promise<PlatformResource> {
    const [type, ...idParts] = key.split(":");
    const id = idParts.join(":");
    if (!type || !id || !(type in this.collectors)) {
      throw Object.assign(new Error(`Invalid resource key: ${key}`), { status: 400 });
    }

    const collector = this.collectors[type as ResourceType];
    if (!collector) {
      throw Object.assign(new Error(`Invalid resource key: ${key}`), { status: 400 });
    }

    const [resource] = await collector(orgContext, 1, id);
    if (!resource) {
      throw Object.assign(new Error(`Resource not found: ${key}`), { status: 404 });
    }
    return resource;
  }

  private async collectCycles(orgContext: OrgContext, limit: number, idFilter?: string | number): Promise<PlatformResource[]> {
    const where = whereAll(
      scopedOrgCondition(operationalCycles.organizationId, orgContext),
      idCondition(operationalCycles.id, idFilter),
    );
    const rows = await db
      .select()
      .from(operationalCycles)
      .where(where)
      .orderBy(desc(operationalCycles.updatedAt))
      .limit(limit);

    return rows.map((cycle) => {
      const lifecycle = lifecycleForCycle(cycle.status, cycle.deletedAt);
      return typedResource({
        type: "cycle",
        id: String(cycle.id),
        name: cycle.name,
        description: cycle.description ?? cycle.objective,
        status: cycle.status,
        lifecycle,
        riskLevel: maxRisk(riskForLifecycle(lifecycle), cycle.requiresApproval ? "medium" : "low"),
        organizationId: cycle.organizationId,
        ownerId: cycle.createdBy,
        createdAt: iso(cycle.createdAt),
        updatedAt: iso(cycle.updatedAt),
        url: `/cycles/${cycle.id}`,
        tags: compact([cycle.recurrence, cycle.timezone, cycle.priority ? `priority:${cycle.priority}` : undefined]),
        capabilities: compact([
          "budget_guardrails",
          "outcome_metrics",
          cycle.executionPlan ? "execution_plan" : undefined,
          cycle.executionPolicy ? "execution_policy" : undefined,
          cycle.requiresApproval ? "approval_gate" : undefined,
        ]),
        actions: [
          action("view", "View cycle", "GET", `/api/cycles/${cycle.id}`),
          action("resume", "Resume cycle", "POST", `/api/cycles/${cycle.id}/resume`, { capability: "cycle:resume" }),
          action("pause", "Pause cycle", "POST", `/api/cycles/${cycle.id}/pause`, { capability: "cycle:pause" }),
        ],
        relations: [],
        health: healthFromLifecycle(lifecycle),
        governance: {
          requiresApproval: Boolean(cycle.requiresApproval),
        },
        metadata: {
          objective: cycle.objective,
          recurrence: cycle.recurrence,
          budgetLimitUsd: cycle.budgetLimitUsd,
          currentSpendUsd: cycle.currentSpendUsd,
          tokenLimit: cycle.tokenLimit,
          blueprintCount: cycle.blueprintCount,
          nextRunAt: iso(cycle.nextRunAt),
          lastRunAt: iso(cycle.lastRunAt),
        },
      });
    });
  }

  private async collectCycleBlueprints(orgContext: OrgContext, limit: number, idFilter?: string | number): Promise<PlatformResource[]> {
    const where = whereAll(
      scopedOrgCondition(operationalCycles.organizationId, orgContext),
      isNotNull(operationalCycles.id),
      idCondition(cycleBlueprints.id, idFilter),
    );
    const rows = await db
      .select({
        blueprint: cycleBlueprints,
        cycle: {
          id: operationalCycles.id,
          name: operationalCycles.name,
          organizationId: operationalCycles.organizationId,
        },
      })
      .from(cycleBlueprints)
      .leftJoin(operationalCycles, eq(cycleBlueprints.cycleId, operationalCycles.id))
      .where(where)
      .orderBy(desc(cycleBlueprints.updatedAt))
      .limit(limit);

    return rows.map(({ blueprint, cycle }) => {
      const lifecycle: ResourceLifecycle = blueprint.onCriticalPath ? "active" : "unknown";
      return typedResource({
        type: "cycle_blueprint",
        id: String(blueprint.id),
        name: blueprint.name,
        description: blueprint.objective,
        status: blueprint.onCriticalPath ? "critical_path" : blueprint.type,
        lifecycle,
        riskLevel: blueprint.onCriticalPath ? "medium" : "low",
        organizationId: cycle?.organizationId ?? null,
        createdAt: iso(blueprint.createdAt),
        updatedAt: iso(blueprint.updatedAt),
        url: cycle?.id ? `/cycles/${cycle.id}` : undefined,
        tags: compact([blueprint.type, blueprint.waveIndex != null ? `wave:${blueprint.waveIndex}` : undefined]),
        capabilities: compact([
          "dependency_node",
          hasContent(blueprint.dependencies) ? "dependencies" : undefined,
          blueprint.onCriticalPath ? "critical_path" : undefined,
        ]),
        actions: [
          action("view", "View cycle blueprint", "GET", `/api/cycles/${blueprint.cycleId}`),
        ],
        relations: compact([
          relation("contained_by", "cycle", blueprint.cycleId, cycle?.name),
        ]),
        health: healthFromLifecycle(lifecycle),
        metadata: {
          type: blueprint.type,
          estimatedDays: blueprint.estimatedDays,
          waveIndex: blueprint.waveIndex,
          onCriticalPath: blueprint.onCriticalPath,
          dependencies: blueprint.dependencies,
        },
      });
    });
  }

  private async collectMissions(orgContext: OrgContext, limit: number, idFilter?: string | number): Promise<PlatformResource[]> {
    const where = whereAll(
      scopedOrgCondition(missions.organizationId, orgContext),
      isNull(missions.deletedAt),
      idCondition(missions.id, idFilter),
    );
    const rows = await db
      .select()
      .from(missions)
      .where(where)
      .orderBy(desc(missions.updatedAt))
      .limit(limit);

    return rows.map((mission) => {
      const lifecycle = lifecycleForMission(mission.status, mission.isDraft, mission.deletedAt);
      return typedResource({
        type: "mission",
        id: String(mission.id),
        name: mission.name,
        description: mission.description ?? mission.objective,
        status: mission.status,
        lifecycle,
        riskLevel: maxRisk(riskForLifecycle(lifecycle), mission.governorPolicyId ? "medium" : "low"),
        organizationId: mission.organizationId,
        ownerId: mission.createdBy,
        createdAt: iso(mission.createdAt),
        updatedAt: iso(mission.updatedAt),
        url: `/missions/${mission.id}`,
        tags: compact([
          mission.type,
          mission.executionStrategy,
          mission.reasoningProtocol,
          mission.isShadowMode ? "shadow" : undefined,
          mission.isScheduled ? "scheduled" : undefined,
        ]),
        capabilities: compact([
          "agentic_execution",
          "mission_memory",
          mission.autoSynthesis ? "auto_synthesis" : undefined,
          mission.recursiveOptimization ? "recursive_optimization" : undefined,
          mission.workflowBlueprint ? "workflow_blueprint" : undefined,
          mission.isXRayIndexed ? "xray_indexed" : undefined,
        ]),
        actions: [
          action("view", "View mission", "GET", `/api/missions/${mission.id}`),
          action("run", "Run mission", "POST", `/api/missions/${mission.id}/launch-mission`, { capability: "mission:run" }),
          action("activity", "View activity", "GET", `/api/missions/${mission.id}/activity`),
        ],
        relations: compact([
          relation("contained_by", "mission", mission.parentId, "Parent mission"),
          relation("scheduled_by", "schedule", mission.scheduleId),
        ]),
        schema: mission.workflowBlueprint ? { output: mission.workflowBlueprint } : undefined,
        health: healthFromLifecycle(lifecycle),
        governance: {
          policyId: mission.governorPolicyId ? String(mission.governorPolicyId) : undefined,
          requiresApproval: mission.hilStrictness === "strict",
        },
        metadata: {
          objective: mission.objective,
          type: mission.type,
          budgetLimitUsd: mission.budgetLimitUsd,
          currentSpendUsd: mission.currentSpendUsd,
          executionStrategy: mission.executionStrategy,
          reasoningProtocol: mission.reasoningProtocol,
          targetMetric: mission.targetMetric,
          entityCount: mission.entityCount,
          relationshipCount: mission.relationshipCount,
          sourceTemplateId: mission.sourceTemplateId,
        },
      });
    });
  }

  private async collectMissionRuns(orgContext: OrgContext, limit: number, idFilter?: string | number): Promise<PlatformResource[]> {
    const where = whereAll(
      scopedOrgCondition(missionRuns.organizationId, orgContext),
      isNull(missionRuns.deletedAt),
      idCondition(missionRuns.id, idFilter),
    );
    const rows = await db
      .select()
      .from(missionRuns)
      .where(where)
      .orderBy(desc(missionRuns.updatedAt))
      .limit(limit);

    return rows.map((run) => {
      const lifecycle = lifecycleForMission(run.status, false, run.deletedAt);
      return typedResource({
        type: "mission_run",
        id: String(run.id),
        name: run.name,
        description: run.failureReason,
        status: run.status,
        lifecycle,
        riskLevel: run.failureReason ? "high" : riskForLifecycle(lifecycle),
        organizationId: run.organizationId,
        ownerId: run.createdBy,
        createdAt: iso(run.createdAt),
        updatedAt: iso(run.updatedAt),
        url: `/mission-runs/${run.id}`,
        tags: compact([
          run.reasoningProtocol,
          run.isShadow ? "shadow" : undefined,
          run.isSuccess === true ? "success" : undefined,
          run.isSuccess === false ? "not_successful" : undefined,
        ]),
        capabilities: compact([
          "durable_checkpoint",
          run.resumeCondition ? "resume_condition" : undefined,
          run.pipelineSequence ? "pipeline_sequence" : undefined,
          run.dynamicTrace ? "dynamic_trace" : undefined,
        ]),
        actions: [
          action("view", "View mission run", "GET", `/api/mission-runs/${run.id}`),
          action("resume", "Resume mission run", "POST", `/api/mission-runs/${run.id}/resume`, { capability: "mission-run:resume" }),
        ],
        relations: compact([
          relation("derived_from", "mission", run.missionId),
          relation("contained_by", "mission_run", run.parentId, "Parent run"),
          relation("uses", "pipeline", run.currentPipelineId, "Current pipeline"),
          relation("contained_by", "cycle", run.cycleId),
        ]),
        health: healthFromLifecycle(lifecycle, run.failureReason),
        metadata: {
          currentStepIndex: run.currentStepIndex,
          actualMetricValue: run.actualMetricValue,
          metricType: run.metricType,
          costUsd: run.costUsd,
          lastCheckpointAt: iso(run.lastCheckpointAt),
          pipelineExecutionId: run.pipelineExecutionId,
        },
      });
    });
  }

  private async collectAgentDeployments(orgContext: OrgContext, limit: number, idFilter?: string | number): Promise<PlatformResource[]> {
    const where = whereAll(
      scopedOrgCondition(agentDeployments.organizationId, orgContext, false),
      idCondition(agentDeployments.id, idFilter),
    );
    const rows = await db.select().from(agentDeployments).where(where).orderBy(desc(agentDeployments.updatedAt)).limit(limit);

    return rows.map((deployment) => {
      const lifecycle = deployment.isActive ? "active" : "paused";
      return typedResource({
        type: "agent_deployment",
        id: String(deployment.id),
        name: deployment.title,
        description: deployment.description,
        status: deployment.isActive ? "active" : "inactive",
        lifecycle,
        riskLevel: deployment.accessPolicy === "public" ? "medium" : "low",
        organizationId: deployment.organizationId,
        ownerId: deployment.createdBy,
        createdAt: iso(deployment.createdAt),
        updatedAt: iso(deployment.updatedAt),
        url: `/agents/deployments/${deployment.slug}`,
        tags: compact([deployment.accessPolicy, deployment.soulArchetype, deployment.isActive ? "active" : "inactive"]),
        capabilities: compact([
          "agent_surface",
          deployment.allowedTools?.length ? "scoped_tools" : undefined,
          deployment.allowedDatasetIds?.length ? "dataset_bound" : undefined,
          deployment.allowedPipelineIds?.length ? "pipeline_bound" : undefined,
        ]),
        actions: [action("view", "View agent deployment", "GET", `/api/agent-deployments/${deployment.id}`)],
        relations: compact([
          relation("deploys", "job", deployment.jobId),
          ...(deployment.allowedDatasetIds ?? []).map((id) => relation("uses", "dataset", id)),
          ...(deployment.allowedPipelineIds ?? []).map((id) => relation("uses", "pipeline", id)),
        ]),
        health: healthFromLifecycle(lifecycle),
        governance: {
          dataClassification: deployment.accessPolicy === "public" ? "public" : "restricted",
          sensitive: deployment.accessPolicy === "password" || deployment.accessPolicy === "internal_only",
        },
        metadata: {
          slug: deployment.slug,
          accessPolicy: deployment.accessPolicy,
          allowedTools: deployment.allowedTools,
          allowedTopicIds: deployment.allowedTopicIds,
          maxFileSizeMb: deployment.maxFileSizeMb,
        },
      });
    });
  }

  private async collectAgentSessions(orgContext: OrgContext, limit: number, idFilter?: string | number): Promise<PlatformResource[]> {
    const where = whereAll(
      scopedOrgCondition(agentSessions.organizationId, orgContext),
      idCondition(agentSessions.id, idFilter),
    );
    const rows = await db.select().from(agentSessions).where(where).orderBy(desc(agentSessions.updatedAt)).limit(limit);

    return rows.map((session) => {
      const lifecycle = lifecycleFromStatus(session.status);
      return typedResource({
        type: "agent_session",
        id: String(session.id),
        name: session.goal,
        description: session.nextWakeUp ? `Next wake-up ${iso(session.nextWakeUp)}` : undefined,
        status: session.status,
        lifecycle,
        riskLevel: riskForLifecycle(lifecycle),
        organizationId: session.organizationId,
        ownerId: session.createdBy,
        createdAt: iso(session.createdAt),
        updatedAt: iso(session.updatedAt),
        url: `/agents/sessions/${session.sessionId}`,
        tags: compact([session.status]),
        capabilities: compact(["resumable_context", session.nextWakeUp ? "scheduled_wakeup" : undefined]),
        actions: [action("view", "View agent session", "GET", `/api/agent-sessions/${session.id}`)],
        relations: [],
        health: healthFromLifecycle(lifecycle),
        metadata: {
          sessionId: session.sessionId,
          progress: session.progress,
          nextWakeUp: iso(session.nextWakeUp),
        },
      });
    });
  }

  private async collectCrewRooms(orgContext: OrgContext, limit: number, idFilter?: string | number): Promise<PlatformResource[]> {
    // A room in a private Project Space is listed only to those who can read
    // that project — its title and session key are not org-wide metadata.
    const { projectService } = await import("@domain/projects/core/project.service.js");
    const visibleProjectIds = orgContext.organizationId == null ? [] : (await projectService.listProjects({
      organizationId: orgContext.organizationId, userId: orgContext.userId,
      isOrgAdmin: orgContext.isOrgAdmin, isSuperAdmin: orgContext.isSuperAdmin,
    } as any)).map((project) => project.id);
    const where = whereAll(
      scopedOrgCondition(crewSessions.organizationId, orgContext),
      idCondition(crewSessions.id, idFilter),
      visibleProjectIds.length
        ? or(isNull(crewSessions.projectId), inArray(crewSessions.projectId, visibleProjectIds))
        : isNull(crewSessions.projectId),
    );
    const rows = await db.select().from(crewSessions).where(where).orderBy(desc(crewSessions.updatedAt)).limit(limit);

    // Bound surface approvals carry the room's sessionKey inside toolArgs
    // (kind: "app_record_action"); group them per room for `contains` edges.
    const boundApprovals = await db
      .select({
        id: approvalRequests.id,
        sessionKey: sql<string>`${approvalRequests.toolArgs}->>'sessionKey'`,
      })
      .from(approvalRequests)
      .where(whereAll(
        scopedOrgCondition(approvalRequests.organizationId, orgContext),
        sql`${approvalRequests.toolArgs}->>'kind' = 'app_record_action'`,
      ))
      .limit(500);
    const approvalsByRoom = new Map<string, number[]>();
    for (const approval of boundApprovals) {
      if (!approval.sessionKey) continue;
      const list = approvalsByRoom.get(approval.sessionKey) ?? [];
      list.push(approval.id);
      approvalsByRoom.set(approval.sessionKey, list);
    }

    return rows.map((room) => {
      const lifecycle = lifecycleFromStatus(room.status);
      const boundIds = approvalsByRoom.get(room.sessionKey) ?? [];
      const relations = compact([
        relation("uses", "knowledge_topic", room.activeTopicId),
        relation("derived_from", "crew_room", room.parentSessionId),
        ...boundIds.map((id) => relation("contains", "approval_request", id)),
      ]);
      return typedResource({
        type: "crew_room",
        id: String(room.id),
        name: room.title ?? room.sessionKey,
        description: room.activeTopic ?? undefined,
        status: room.status,
        lifecycle,
        riskLevel: maxRisk(riskForLifecycle(lifecycle), boundIds.length ? "medium" : "low"),
        organizationId: room.organizationId,
        ownerId: room.createdBy,
        createdAt: iso(room.createdAt),
        updatedAt: iso(room.updatedAt),
        url: `/workspace/chat/${room.sessionKey}`,
        tags: compact([room.mode, room.cycleSlug ? `cycle:${room.cycleSlug}` : undefined]),
        capabilities: compact([
          "multi_agent_deliberation",
          boundIds.length ? "bound_surface_approvals" : undefined,
          room.cycleSlug ? "cycle_bound" : undefined,
          room.projectId != null ? "project_scoped" : undefined,
        ]),
        actions: [
          action("view", "View room", "GET", `/api/crew/${room.sessionKey}`),
        ],
        relations,
        health: healthFromLifecycle(lifecycle),
        metadata: {
          sessionKey: room.sessionKey,
          mode: room.mode,
          projectId: room.projectId,
          cycleSlug: room.cycleSlug,
          cycleStageId: room.cycleStageId,
          consensusLevel: room.consensusLevel,
          interrupting: room.interrupting,
          lastRoundCompletedAt: iso(room.lastRoundCompletedAt),
          boundApprovalCount: boundIds.length,
        },
      });
    });
  }

  private async collectAgentRuns(orgContext: OrgContext, limit: number, idFilter?: string | number): Promise<PlatformResource[]> {
    const where = whereAll(
      scopedOrgCondition(agentRunSteps.organizationId, orgContext),
      textIdCondition(agentRunSteps.runId, idFilter),
    );
    const rows = await db.select().from(agentRunSteps).where(where).orderBy(desc(agentRunSteps.createdAt)).limit(limit * 5);
    const byRun = new Map<string, typeof rows>();

    for (const row of rows) {
      if (!byRun.has(row.runId)) byRun.set(row.runId, []);
      byRun.get(row.runId)!.push(row);
      if (byRun.size >= limit && !idFilter) break;
    }

    return [...byRun.entries()].slice(0, limit).map(([runId, steps]) => {
      const latest = steps[0];
      const failed = steps.some((step) => step.type === "error" || step.action === "error");
      const final = steps.some((step) => step.type === "final_result");
      const lifecycle: ResourceLifecycle = failed ? "failed" : final ? "completed" : "active";
      return typedResource({
        type: "agent_run",
        id: runId,
        name: `Agent run ${runId}`,
        description: latest?.content?.slice(0, 240),
        status: failed ? "failed" : final ? "completed" : "running",
        lifecycle,
        riskLevel: failed ? "high" : riskForLifecycle(lifecycle),
        organizationId: latest?.organizationId,
        ownerId: latest?.userId,
        createdAt: iso(steps[steps.length - 1]?.createdAt),
        updatedAt: iso(latest?.createdAt),
        url: `/agents/runs/${runId}`,
        tags: compact([latest?.type, latest?.toolName, failed ? "has_error" : undefined]),
        capabilities: compact(["step_trace", steps.some((step) => step.toolName) ? "tool_use" : undefined]),
        actions: [action("view", "View agent run", "GET", `/api/agents/runs/${runId}`)],
        relations: compact([
          relation("uses", "job", latest?.jobId),
          relation("contained_by", "mission", latest?.missionId),
          relation("contained_by", "mission_run", latest?.missionRunId),
          ...steps.filter((step) => step.toolName).map((step) => relation("uses", "tool_call", step.id, step.toolName ?? undefined)),
        ]),
        health: healthFromLifecycle(lifecycle),
        metadata: {
          stepCount: steps.length,
          latestStepType: latest?.type,
          confidence: latest?.confidence,
        },
      });
    });
  }

  private async collectToolCalls(orgContext: OrgContext, limit: number, idFilter?: string | number): Promise<PlatformResource[]> {
    const usageWhere = whereAll(
      scopedOrgCondition(agentToolUsage.organizationId, orgContext),
      idCondition(agentToolUsage.id, idFilter),
    );
    const usageRows = await db.select().from(agentToolUsage).where(usageWhere).orderBy(desc(agentToolUsage.createdAt)).limit(limit);
    const remaining = Math.max(limit - usageRows.length, 0);
    const stepRows = remaining > 0 && idFilter == null
      ? await db
        .select()
        .from(agentRunSteps)
        .where(whereAll(scopedOrgCondition(agentRunSteps.organizationId, orgContext), isNotNull(agentRunSteps.toolName)))
        .orderBy(desc(agentRunSteps.createdAt))
        .limit(remaining)
      : [];

    return [
      ...usageRows.map((usage) => {
        const lifecycle = usage.status === "success" ? "completed" : usage.status === "error" || usage.status === "timeout" ? "failed" : "unknown";
        return typedResource({
          type: "tool_call",
          id: String(usage.id),
          name: usage.toolName,
          description: usage.taskDescription ?? usage.reasoning,
          status: usage.status,
          lifecycle,
          riskLevel: usage.status === "error" || usage.status === "timeout" ? "high" : "low",
          organizationId: usage.organizationId,
          createdAt: iso(usage.createdAt),
          updatedAt: iso(usage.createdAt),
          tags: compact([usage.taskType, usage.errorType]),
          capabilities: compact(["tool_invocation", usage.executionTimeMs != null ? "latency_tracked" : undefined]),
          actions: [action("view", "View tool call", "GET", `/api/resource-catalog/resources/${makeResourceKey("tool_call", usage.id)}`)],
          relations: compact([
            relation("executed_by", "agent_run", usage.agentRunId),
            relation("contained_by", "pipeline", usage.executionId),
          ]),
          health: healthFromLifecycle(lifecycle, usage.errorMessage),
          metadata: {
            inputParams: usage.inputParams,
            outputData: usage.outputData,
            executionTimeMs: usage.executionTimeMs,
            reasoning: usage.reasoning,
          },
        });
      }),
      ...stepRows.map((step) => typedResource({
        type: "tool_call",
        id: String(step.id),
        name: step.toolName ?? "Tool call",
        description: step.content,
        status: step.type,
        lifecycle: step.type === "final_result" ? "completed" : "active",
        riskLevel: "low",
        organizationId: step.organizationId,
        ownerId: step.userId,
        createdAt: iso(step.createdAt),
        updatedAt: iso(step.createdAt),
        tags: compact([step.type, step.action]),
        capabilities: ["tool_invocation", "agent_step"],
        actions: [action("view", "View tool call", "GET", `/api/resource-catalog/resources/${makeResourceKey("tool_call", step.id)}`)],
        relations: compact([
          relation("contained_by", "agent_run", step.runId),
          relation("uses", "job", step.jobId),
          relation("contained_by", "mission", step.missionId),
          relation("contained_by", "mission_run", step.missionRunId),
        ]),
        health: healthFromLifecycle("active"),
        metadata: {
          toolArgs: step.toolArgs,
          selector: step.selector,
          value: step.value,
          stepIndex: step.stepIndex,
          confidence: step.confidence,
        },
      })),
    ];
  }

  private async collectPipelines(orgContext: OrgContext, limit: number, idFilter?: string | number): Promise<PlatformResource[]> {
    const where = whereAll(
      scopedOrgCondition(pipelines.organizationId, orgContext),
      idCondition(pipelines.id, idFilter),
    );
    const rows = await db
      .select()
      .from(pipelines)
      .where(where)
      .orderBy(desc(pipelines.createdAt))
      .limit(limit);

    return rows.map((pipeline) => {
      const lifecycle = lifecycleFromStatus(pipeline.lifecycleStatus ?? (pipeline.isActive ? "active" : "paused"));
      return typedResource({
        type: "pipeline",
        id: String(pipeline.id),
        name: pipeline.name,
        description: pipeline.description,
        status: pipeline.lifecycleStatus,
        lifecycle,
        riskLevel: maxRisk(riskForLifecycle(lifecycle), pipeline.governorPolicyId ? "medium" : "low"),
        organizationId: pipeline.organizationId,
        ownerId: pipeline.createdBy,
        createdAt: iso(pipeline.createdAt),
        url: `/pipelines/${pipeline.id}`,
        tags: compact([
          pipeline.triggerType,
          pipeline.isActive ? "active" : "inactive",
          pipeline.enableKnowledgeGraph ? "knowledge_graph" : undefined,
          ...labelsFrom(pipeline.labels),
        ]),
        capabilities: compact([
          "versioned_execution",
          "step_orchestration",
          pipeline.selfHealingEnabled ? "self_healing" : undefined,
          pipeline.enableKnowledgeGraph ? "knowledge_graph" : undefined,
          pipeline.governorSettings ? "governor" : undefined,
        ]),
        actions: [
          action("view", "View pipeline", "GET", `/api/pipelines/${pipeline.id}`),
          action("run", "Run pipeline", "POST", `/api/pipelines/${pipeline.id}/execute`, {
            capability: "pipeline:execute",
            params: {
              location: "body",
              fields: [
                { name: "startStepId", type: "number", label: "Start at step" },
                { name: "workgroupId", type: "number", label: "Mission ID" },
                { name: "input", type: "json", label: "Additional pipeline input (forwarded as-is)" },
              ],
            },
          }),
          action("versions", "View versions", "GET", `/api/pipelines/${pipeline.id}/versions`),
        ],
        relations: compact([
          relation("uses", "credential", pipeline.triggerCredentialId, "Trigger credential"),
        ]),
        health: healthFromLifecycle(lifecycle),
        governance: {
          policyId: pipeline.governorPolicyId ? String(pipeline.governorPolicyId) : undefined,
        },
        metadata: {
          triggerType: pipeline.triggerType,
          currentVersion: pipeline.currentVersion,
          monthlyBudgetUsd: pipeline.monthlyBudgetUsd,
          baselineRunId: pipeline.baselineRunId,
        },
      });
    });
  }

  private async collectPipelineSteps(orgContext: OrgContext, limit: number, idFilter?: string | number): Promise<PlatformResource[]> {
    const where = whereAll(
      scopedOrgCondition(pipelines.organizationId, orgContext),
      isNotNull(pipelines.id),
      idCondition(pipelineSteps.id, idFilter),
    );
    const rows = await db
      .select({
        step: pipelineSteps,
        pipeline: {
          id: pipelines.id,
          name: pipelines.name,
          organizationId: pipelines.organizationId,
        },
      })
      .from(pipelineSteps)
      .leftJoin(pipelines, eq(pipelineSteps.pipelineId, pipelines.id))
      .where(where)
      .orderBy(desc(pipelineSteps.updatedAt))
      .limit(limit);

    return rows.map(({ step, pipeline }) => {
      const name = step.outputName || step.toolName || `Step ${step.order + 1}`;
      const lifecycle: ResourceLifecycle = "active";
      return typedResource({
        type: "pipeline_step",
        id: String(step.id),
        name,
        description: step.conditionExpression,
        status: step.runOnCondition,
        lifecycle,
        riskLevel: step.onFailureAction === "Stop Pipeline" ? "medium" : "low",
        organizationId: pipeline?.organizationId ?? null,
        createdAt: iso(step.createdAt),
        updatedAt: iso(step.updatedAt),
        url: `/pipelines/${step.pipelineId}`,
        tags: compact([
          `order:${step.order}`,
          step.runOnCondition,
          step.onFailureAction,
          step.parallelGroup ? `parallel:${step.parallelGroup}` : undefined,
          step.moduleType,
        ]),
        capabilities: compact([
          step.retryConfig ? "retry" : undefined,
          step.fallbackJobId ? "fallback" : undefined,
          step.conditionExpression ? "condition" : undefined,
          step.decisionNodeConfig ? "decision_node" : undefined,
          step.knowledgeGraphConfig ? "knowledge_graph" : undefined,
          step.toolName ? "tool_execution" : undefined,
          step.forgeConfig ? "jit_forge" : undefined,
        ]),
        actions: [
          action("view", "View pipeline step", "GET", `/api/pipelines/${step.pipelineId}`),
          action("edit", "Edit via parent pipeline", "PATCH", `/api/pipelines/${step.pipelineId}`),
        ],
        relations: compact([
          relation("contained_by", "pipeline", step.pipelineId, pipeline?.name),
          relation("uses", "job", step.jobId),
          relation("uses", "job", step.fallbackJobId, "Fallback job"),
          relation("depends_on", "pipeline_step", step.destinationStepId, "Destination step"),
        ]),
        schema: {
          input: step.expectedInputSchema,
          output: step.guaranteedOutputSchema,
        },
        health: healthFromLifecycle(lifecycle),
        metadata: {
          order: step.order,
          waitDurationSeconds: step.waitDurationSeconds,
          toolName: step.toolName,
        },
      });
    });
  }

  private async collectJobs(orgContext: OrgContext, limit: number, idFilter?: string | number): Promise<PlatformResource[]> {
    const where = whereAll(
      scopedOrgCondition(jobs.organizationId, orgContext),
      idCondition(jobs.id, idFilter),
    );
    const rows = await db
      .select()
      .from(jobs)
      .where(where)
      .orderBy(desc(jobs.updatedAt))
      .limit(limit);

    return rows.map((job) => {
      const lifecycle = lifecycleFromStatus(job.lifecycleStatus ?? (job.isActive ? "active" : "paused"));
      const testStatus = job.lastTestStatus === "failure" ? "Last test failed" : undefined;
      return typedResource({
        type: "job",
        id: String(job.id),
        name: job.name,
        description: job.description,
        status: job.lifecycleStatus,
        lifecycle,
        riskLevel: maxRisk(
          riskForLifecycle(lifecycle),
          job.governorPolicyId ? "medium" : "low",
          job.lastTestStatus === "failure" ? "high" : "low",
        ),
        organizationId: job.organizationId,
        ownerId: job.createdBy,
        createdAt: iso(job.createdAt),
        updatedAt: iso(job.updatedAt),
        url: `/jobs/${job.id}`,
        tags: compact([
          job.type,
          job.tool,
          job.isHidden ? "hidden" : undefined,
          job.priority ? `priority:${job.priority}` : undefined,
          ...tagsFrom(job.outputTags),
        ]),
        capabilities: compact([
          "executable",
          job.parameterSchema ? "parameter_schema" : undefined,
          job.inputSchema ? "input_schema" : undefined,
          job.outputSchema ? "output_schema" : undefined,
          job.outputStorageEnabled ? "output_storage" : undefined,
          job.enableKnowledgeStore ? "knowledge_store" : undefined,
          job.diffConfig ? "reactive_diff" : undefined,
        ]),
        actions: [
          action("view", "View job", "GET", `/api/jobs/${job.id}`),
          action("test", "Test job", "POST", `/api/jobs/${job.id}/test`, {
            capability: "job:test",
            params: {
              location: "body",
              fields: [{ name: "input", type: "json", label: "Input matching this job's own input schema" }],
            },
          }),
        ],
        relations: compact([
          relation("writes_to", "dataset", job.outputDatasetId, "Output dataset"),
          relation("writes_to", "knowledge_topic", job.outputKnowledgeTopicId, "Output knowledge topic"),
        ]),
        schema: {
          input: job.inputSchema ?? job.parameterSchema,
          output: job.outputSchema,
        },
        health: healthFromLifecycle(job.lastTestStatus === "failure" ? "failed" : lifecycle, testStatus),
        governance: {
          policyId: job.governorPolicyId ? String(job.governorPolicyId) : undefined,
        },
        metadata: {
          type: job.type,
          tool: job.tool,
          lastTestedAt: iso(job.lastTestedAt),
          lastTestStatus: job.lastTestStatus,
        },
      });
    });
  }

  private async collectDatasets(orgContext: OrgContext, limit: number, idFilter?: string | number): Promise<PlatformResource[]> {
    const where = whereAll(
      scopedOrgCondition(datasets.organizationId, orgContext),
      idCondition(datasets.id, idFilter),
    );
    const rows = await db
      .select()
      .from(datasets)
      .where(where)
      .orderBy(desc(datasets.updatedAt))
      .limit(limit);

    return rows.map((dataset) => typedResource({
      type: "dataset",
      id: String(dataset.id),
      name: dataset.name,
      description: dataset.description,
      status: "active",
      lifecycle: "active",
      riskLevel: hasContent(dataset.validationRules) ? "medium" : "low",
      organizationId: dataset.organizationId,
      createdAt: iso(dataset.createdAt),
      updatedAt: iso(dataset.updatedAt),
      url: `/datasets/${dataset.id}`,
      tags: tagsFrom(dataset.tags),
      capabilities: compact([
        "structured_records",
        dataset.schemaMapping ? "schema_mapping" : undefined,
        dataset.validationRules ? "validation_rules" : undefined,
        dataset.knowledgeConfig ? "knowledge_extraction" : undefined,
      ]),
      actions: [
        action("view", "View dataset", "GET", `/api/datasets/${dataset.id}`),
        action("export", "Export CSV", "GET", `/api/datasets/${dataset.id}/export`),
        action("validate", "Validate records", "POST", `/api/datasets/${dataset.id}/validate`),
        action("extract", "Extract knowledge", "POST", `/api/datasets/${dataset.id}/extract`),
      ],
      relations: [],
      schema: {
        fields: objectKeys(dataset.schemaMapping),
        validation: dataset.validationRules,
      },
      health: healthFromLifecycle("active"),
      metadata: {
        schemaMappingFields: objectKeys(dataset.schemaMapping),
        validationRuleFields: objectKeys(dataset.validationRules),
        hasKnowledgeConfig: hasContent(dataset.knowledgeConfig),
      },
    }));
  }

  private async collectMemories(orgContext: OrgContext, limit: number, idFilter?: string | number): Promise<PlatformResource[]> {
    const where = whereAll(
      scopedOrgCondition(agentLongTermMemories.organizationId, orgContext),
      idCondition(agentLongTermMemories.id, idFilter),
    );
    const rows = await db.select().from(agentLongTermMemories).where(where).orderBy(desc(agentLongTermMemories.updatedAt)).limit(limit);

    return rows.map((memory) => typedResource({
      type: "memory",
      id: String(memory.id),
      name: memory.key ?? `${memory.type} memory`,
      description: memory.content.slice(0, 240),
      status: memory.source,
      lifecycle: "active",
      riskLevel: (memory.confidence ?? 100) < 60 ? "medium" : "low",
      organizationId: memory.organizationId,
      ownerId: memory.userId,
      createdAt: iso(memory.createdAt),
      updatedAt: iso(memory.updatedAt),
      url: `/agents/memory/${memory.id}`,
      tags: compact([memory.type, memory.source]),
      capabilities: ["long_term_memory", "retrieval_context"],
      actions: [action("view", "View memory", "GET", `/api/resource-catalog/resources/${makeResourceKey("memory", memory.id)}`)],
      relations: compact([
        relation("owned_by", "user", memory.userId),
      ]),
      health: healthFromLifecycle("active", (memory.confidence ?? 100) < 60 ? "Low confidence memory" : undefined),
      metadata: {
        importance: memory.importance,
        confidence: memory.confidence,
        metadata: memory.metadata,
      },
    }));
  }

  private async collectMcpServers(orgContext: OrgContext, limit: number, idFilter?: string | number): Promise<PlatformResource[]> {
    const where = whereAll(
      scopedOrgCondition(mcpServers.organizationId, orgContext),
      idCondition(mcpServers.id, idFilter),
    );
    const rows = await db.select().from(mcpServers).where(where).orderBy(desc(mcpServers.updatedAt)).limit(limit);

    return rows.map((server) => {
      const lifecycle = lifecycleFromStatus(server.status);
      return typedResource({
        type: "mcp_server",
        id: String(server.id),
        name: server.name,
        description: server.description ?? server.error,
        status: server.status,
        lifecycle,
        riskLevel: server.status === "error" ? "high" : server.env ? "medium" : "low",
        organizationId: server.organizationId,
        createdAt: iso(server.createdAt),
        updatedAt: iso(server.updatedAt),
        url: `/mcp/servers/${server.id}`,
        tags: compact([server.transport, server.status]),
        capabilities: compact(["mcp_tools", server.url ? "remote_transport" : "stdio_transport"]),
        actions: [action("view", "View MCP server", "GET", `/api/mcp/servers/${server.id}`)],
        relations: [],
        health: healthFromLifecycle(lifecycle, server.error),
        metadata: {
          command: server.command,
          args: server.args,
          url: server.url,
          lastConnectedAt: iso(server.lastConnectedAt),
        },
      });
    });
  }

  private async collectTraces(orgContext: OrgContext, limit: number, idFilter?: string | number): Promise<PlatformResource[]> {
    const where = whereAll(
      scopedOrgCondition(hermesTraces.organizationId, orgContext, false),
      textIdCondition(hermesTraces.traceId, idFilter),
    );
    const rows = await db.select().from(hermesTraces).where(where).orderBy(desc(hermesTraces.updatedAt)).limit(limit);

    return rows.map((trace) => {
      const lifecycle: ResourceLifecycle = trace.actualOutcome === false ? "failed" : trace.actualOutcome === true ? "completed" : "active";
      return typedResource({
        type: "trace",
        id: trace.traceId,
        name: `Trace ${trace.traceId}`,
        description: trace.finalContent ?? trace.thoughtContent.slice(0, 240),
        status: trace.actualOutcome == null ? "unknown" : trace.actualOutcome ? "success" : "failed",
        lifecycle,
        riskLevel: trace.actualOutcome === false ? "high" : trace.isShadowRun ? "medium" : "low",
        organizationId: trace.organizationId,
        ownerId: trace.userId,
        createdAt: iso(trace.createdAt),
        updatedAt: iso(trace.updatedAt),
        url: `/observability/traces/${trace.traceId}`,
        tags: compact([trace.reasoningProtocol, trace.modelUsed, trace.isShadowRun ? "shadow" : undefined]),
        capabilities: compact(["reasoning_trace", trace.toolCalls ? "tool_calls" : undefined, trace.embedding ? "similarity_search" : undefined]),
        actions: [action("view", "View trace", "GET", `/api/observability/traces/${trace.traceId}`)],
        relations: compact([
          relation("contained_by", "mission", trace.missionId),
          relation("uses", "job", trace.jobId),
          relation("executed_by", "agent", trace.agentId),
        ]),
        health: healthFromLifecycle(lifecycle),
        metadata: {
          executionId: trace.executionId,
          predictedOutcome: trace.predictedOutcome,
          actualOutcome: trace.actualOutcome,
          executionTime: trace.executionTime,
          tokenUsage: trace.tokenUsage,
          skillId: trace.skillId,
          generation: trace.generation,
        },
      });
    });
  }

  private async collectTraceEvents(orgContext: OrgContext, limit: number, idFilter?: string | number): Promise<PlatformResource[]> {
    const where = whereAll(
      scopedOrgCondition(agentRunSteps.organizationId, orgContext),
      idCondition(agentRunSteps.id, idFilter),
    );
    const rows = await db.select().from(agentRunSteps).where(where).orderBy(desc(agentRunSteps.createdAt)).limit(limit);

    return rows.map((step) => typedResource({
      type: "trace_event",
      id: String(step.id),
      name: `${step.type} event`,
      description: step.content,
      status: step.type,
      lifecycle: step.type === "final_result" ? "completed" : "active",
      riskLevel: step.type === "error" ? "high" : "low",
      organizationId: step.organizationId,
      ownerId: step.userId,
      createdAt: iso(step.createdAt),
      updatedAt: iso(step.createdAt),
      url: `/agents/runs/${step.runId}`,
      tags: compact([step.type, step.toolName, step.action]),
      capabilities: ["canonical_trace_event"],
      actions: [action("view", "View trace event", "GET", `/api/resource-catalog/resources/${makeResourceKey("trace_event", step.id)}`)],
      relations: compact([
        relation("contained_by", "agent_run", step.runId),
        relation("uses", "job", step.jobId),
        relation("contained_by", "mission", step.missionId),
        relation("contained_by", "mission_run", step.missionRunId),
      ]),
      health: healthFromLifecycle(step.type === "error" ? "failed" : "active"),
      metadata: {
        toolArgs: step.toolArgs,
        metadata: step.metadata,
        stepIndex: step.stepIndex,
        confidence: step.confidence,
      },
    }));
  }

  private async collectEvalDatasets(orgContext: OrgContext, limit: number, idFilter?: string | number): Promise<PlatformResource[]> {
    const where = whereAll(
      scopedOrgCondition(evaluationTestSets.organizationId, orgContext, false),
      idCondition(evaluationTestSets.id, idFilter),
    );
    const rows = await db.select().from(evaluationTestSets).where(where).orderBy(desc(evaluationTestSets.updatedAt)).limit(limit);

    return rows.map((testSet) => typedResource({
      type: "eval_dataset",
      id: String(testSet.id),
      name: testSet.name,
      description: testSet.description,
      status: "active",
      lifecycle: "active",
      riskLevel: "low",
      organizationId: testSet.organizationId,
      createdAt: iso(testSet.createdAt),
      updatedAt: iso(testSet.updatedAt),
      url: `/evaluation/test-sets/${testSet.id}`,
      tags: ["eval_dataset"],
      capabilities: ["agent_evaluation", "test_cases"],
      actions: [action("view", "View eval dataset", "GET", `/api/evaluation/test-sets/${testSet.id}`)],
      relations: compact([relation("uses", "job", testSet.jobId)]),
      health: healthFromLifecycle("active"),
      metadata: { jobId: testSet.jobId },
    }));
  }

  private async collectEvalRuns(orgContext: OrgContext, limit: number, idFilter?: string | number): Promise<PlatformResource[]> {
    let scopedTestSetIds: number[] | undefined;
    if (!(orgContext.isSuperAdmin && orgContext.organizationId == null)) {
      const testSets = await db
        .select({ id: evaluationTestSets.id })
        .from(evaluationTestSets)
        .where(scopedOrgCondition(evaluationTestSets.organizationId, orgContext, false));
      scopedTestSetIds = testSets.map((testSet) => testSet.id);
      if (scopedTestSetIds.length === 0) return [];
    }

    const where = whereAll(
      idCondition(evaluationRuns.id, idFilter),
      scopedTestSetIds ? inArray(evaluationRuns.testSetId, scopedTestSetIds) : undefined,
    );
    const rows = await db.select().from(evaluationRuns).where(where).orderBy(desc(evaluationRuns.startedAt)).limit(limit);

    return rows.map((run) => {
      const lifecycle = lifecycleFromStatus(run.status);
      return typedResource({
        type: "eval_run",
        id: String(run.id),
        name: `Eval run ${run.id}`,
        description: run.completedAt ? `Completed ${iso(run.completedAt)}` : "Evaluation in progress",
        status: run.status,
        lifecycle,
        riskLevel: run.status === "failed" ? "high" : riskForLifecycle(lifecycle),
        createdAt: iso(run.startedAt),
        updatedAt: iso(run.completedAt ?? run.startedAt),
        url: `/evaluation/runs/${run.id}`,
        tags: compact([run.status]),
        capabilities: ["runtime_evaluation", "promotion_gate"],
        actions: [action("view", "View eval run", "GET", `/api/evaluation/runs/${run.id}`)],
        relations: compact([relation("uses", "eval_dataset", run.testSetId)]),
        health: healthFromLifecycle(lifecycle),
        metadata: { testSetId: run.testSetId },
      });
    });
  }

  private async collectKnowledgeTopics(orgContext: OrgContext, limit: number, idFilter?: string | number): Promise<PlatformResource[]> {
    const where = whereAll(
      scopedOrgCondition(knowledgeTopics.organizationId, orgContext),
      idCondition(knowledgeTopics.id, idFilter),
    );
    const rows = await db
      .select()
      .from(knowledgeTopics)
      .where(where)
      .orderBy(desc(knowledgeTopics.updatedAt))
      .limit(limit);

    return rows.map((topic) => typedResource({
      type: "knowledge_topic",
      id: String(topic.id),
      name: topic.name,
      description: topic.description,
      status: "active",
      lifecycle: "active",
      riskLevel: "low",
      organizationId: topic.organizationId,
      ownerId: topic.createdBy,
      createdAt: iso(topic.createdAt),
      updatedAt: iso(topic.updatedAt),
      url: `/knowledge/topics/${topic.id}`,
      tags: compact([topic.missionId ? "mission_context" : undefined]),
      capabilities: ["semantic_context", "document_grouping", "concept_linking"],
      actions: [
        // No domain-level single-topic GET route exists; fall back to the catalog's own get-by-key endpoint.
        action("view", "View topic", "GET", `/api/resource-catalog/resources/${makeResourceKey("knowledge_topic", topic.id)}`),
      ],
        relations: compact([
        relation("contained_by", "knowledge_topic", topic.parentTopicId, "Parent topic"),
        relation("uses", "mission", topic.missionId),
      ]),
      health: healthFromLifecycle("active"),
    }));
  }

  private async collectKnowledgeDocuments(orgContext: OrgContext, limit: number, idFilter?: string | number): Promise<PlatformResource[]> {
    const where = whereAll(
      scopedOrgCondition(knowledgeDocuments.organizationId, orgContext),
      idCondition(knowledgeDocuments.id, idFilter),
    );
    const rows = await db
      .select()
      .from(knowledgeDocuments)
      .where(where)
      .orderBy(desc(knowledgeDocuments.updatedAt))
      .limit(limit);

    return rows.map((document) => typedResource({
      type: "knowledge_document",
      id: String(document.id),
      name: document.title,
      description: document.summary,
      status: document.qdrantPointId ? "indexed" : "pending_index",
      lifecycle: "active",
      riskLevel: document.contentType?.includes("sensitive") ? "medium" : "low",
      organizationId: document.organizationId,
      ownerId: document.createdBy,
      createdAt: iso(document.createdAt),
      updatedAt: iso(document.updatedAt),
      url: `/knowledge/documents/${document.id}`,
      tags: compact([document.sourceType, document.contentType, document.externalId ? "external" : undefined]),
      capabilities: compact([
        "rag_source",
        document.qdrantPointId ? "vector_indexed" : undefined,
        document.datasetItemId ? "dataset_lineage" : undefined,
        document.integrationId ? "integration_source" : undefined,
      ]),
      actions: [
        // No domain-level single-document GET route exists; fall back to the catalog's own get-by-key endpoint.
        // No per-document reindex route exists either (only a bulk POST /api/knowledge/documents/reindex), so "index" was dropped.
        action("view", "View document", "GET", `/api/resource-catalog/resources/${makeResourceKey("knowledge_document", document.id)}`),
      ],
      relations: compact([
        relation("uses", "mission", document.missionId),
      ]),
      health: healthFromLifecycle("active", document.qdrantPointId ? undefined : "Not indexed"),
      metadata: {
        sourceType: document.sourceType,
        contentType: document.contentType,
        fileSize: document.fileSize,
        externalId: document.externalId,
        hasUrl: Boolean(document.url),
        datasetItemId: document.datasetItemId,
        workflowExecutionId: document.workflowExecutionId,
        workflowStepId: document.workflowStepId,
      },
    }));
  }

  private async collectDocumentTemplates(orgContext: OrgContext, limit: number, idFilter?: string | number): Promise<PlatformResource[]> {
    const where = whereAll(
      scopedOrgCondition(documentTemplates.organizationId, orgContext),
      idCondition(documentTemplates.id, idFilter),
    );
    const rows = await db
      .select()
      .from(documentTemplates)
      .where(where)
      .orderBy(desc(documentTemplates.updatedAt))
      .limit(limit);

    return rows.map((template) => typedResource({
      type: "document_template",
      id: String(template.id),
      name: template.name,
      description: template.description,
      status: template.source,
      lifecycle: "active",
      riskLevel: template.source === "knowledge" ? "medium" : "low",
      organizationId: template.organizationId,
      ownerId: template.createdBy,
      createdAt: iso(template.createdAt),
      updatedAt: iso(template.updatedAt),
      url: `/document-templates/${template.id}`,
      tags: compact([template.type, template.category, template.source]),
      capabilities: compact([
        "document_generation",
        template.source === "knowledge" ? "knowledge_backed" : undefined,
      ]),
      actions: [
        // No render/generate route exists for document templates yet ("render" was dropped).
        action("view", "View template", "GET", `/api/document-templates/${template.id}`),
      ],
      relations: compact([
        relation("uses", "knowledge_document", template.knowledgeDocumentId),
      ]),
      health: healthFromLifecycle("active"),
      metadata: {
        source: template.source,
        type: template.type,
        category: template.category,
      },
    }));
  }

  private async collectHilForms(orgContext: OrgContext, limit: number, idFilter?: string | number): Promise<PlatformResource[]> {
    const where = whereAll(
      scopedOrgCondition(hilForms.organizationId, orgContext),
      idCondition(hilForms.id, idFilter),
    );
    const rows = await db
      .select()
      .from(hilForms)
      .where(where)
      .orderBy(desc(hilForms.updatedAt))
      .limit(limit);

    return rows.map((form) => {
      const lifecycle = form.isArchived ? "archived" : lifecycleFromStatus(form.status);
      return typedResource({
        type: "hil_form",
        id: String(form.id),
        name: form.name,
        description: form.description,
        status: form.status,
        lifecycle,
        riskLevel: maxRisk(riskForLifecycle(lifecycle), hasContent(form.securityConfig) ? "medium" : "low"),
        organizationId: form.organizationId,
        ownerId: form.createdBy,
        createdAt: iso(form.createdAt),
        updatedAt: iso(form.updatedAt),
        url: `/hil/forms/${form.id}`,
        tags: compact([form.kind, form.isViewed ? "viewed" : "unviewed", form.isArchived ? "archived" : undefined]),
        capabilities: compact([
          "human_input",
          "schema_defined",
          form.securityConfig ? "security_config" : undefined,
          form.themeConfig ? "themed" : undefined,
        ]),
        actions: [
          action("view", "View form", "GET", `/api/forms/${form.id}`),
          // The scoped submit path: it only accepts pending requests and resumes the
          // waiting pipeline. The old PUT wrote `data` onto any form, in any org,
          // and never resumed anything.
          action("submit", "Submit form", "POST", `/api/forms/${form.id}/submit`, {
            capability: "hil:submit",
            params: {
              location: "body",
              fields: [{ name: "data", type: "json", label: "Submission data matching this form's own schema" }],
            },
          }),
        ],
        relations: [],
        schema: {
          input: form.schema,
          fields: objectKeys(form.schema),
        },
        health: healthFromLifecycle(lifecycle),
        metadata: {
          stepExecutionId: form.stepExecutionId,
          submittedBy: form.submittedBy,
          submittedAt: iso(form.submittedAt),
        },
      });
    });
  }

  private async collectApprovalRequests(orgContext: OrgContext, limit: number, idFilter?: string | number): Promise<PlatformResource[]> {
    const where = whereAll(
      scopedOrgCondition(approvalRequests.organizationId, orgContext),
      idCondition(approvalRequests.id, idFilter),
    );
    const rows = await db
      .select()
      .from(approvalRequests)
      .where(where)
      .orderBy(desc(approvalRequests.createdAt))
      .limit(limit);

    return rows.map((request) => {
      const lifecycle = lifecycleFromStatus(request.status);
      return typedResource({
        type: "approval_request",
        id: String(request.id),
        name: `Approval for execution ${request.executionId}`,
        description: request.comments,
        status: request.status,
        lifecycle,
        riskLevel: request.status === "pending" ? "medium" : riskForLifecycle(lifecycle),
        organizationId: request.organizationId,
        ownerId: request.approverId,
        createdAt: iso(request.createdAt),
        updatedAt: iso(request.decisionAt),
        url: `/assistant/workbench`,
        tags: compact([request.approverType, request.isEvolutionary ? "evolutionary" : undefined]),
        capabilities: compact([
          "human_approval",
          request.selectionList ? "multi_select" : undefined,
          request.modifiedOutput ? "edit_and_approve" : undefined,
          request.snoozedUntil ? "snoozed" : undefined,
        ]),
        actions: [
          action("view", "View approval request", "GET", `/api/approvals/${request.id}`),
          action("approve", "Approve", "POST", `/api/approvals/${request.id}/decision`, {
            capability: "approval:decide",
            params: {
              location: "body",
              fields: [
                { name: "decision", type: "enum", enumValues: ["approved"], required: true, defaultValue: "approved" },
                { name: "comments", type: "string" },
                { name: "modifiedOutput", type: "json", label: "Edited output to approve instead of the original" },
              ],
            },
          }),
          action("reject", "Reject", "POST", `/api/approvals/${request.id}/decision`, {
            capability: "approval:decide",
            params: {
              location: "body",
              fields: [
                { name: "decision", type: "enum", enumValues: ["rejected"], required: true, defaultValue: "rejected" },
                { name: "comments", type: "string" },
              ],
            },
          }),
        ],
        relations: compact([
          relation("approves", "job", request.jobId),
          relation("uses", "mission", request.missionId),
        ]),
        health: healthFromLifecycle(lifecycle, request.snoozedUntil ? `Snoozed until ${iso(request.snoozedUntil)}` : undefined),
        governance: {
          requiresApproval: true,
        },
        metadata: {
          executionId: request.executionId,
          approverType: request.approverType,
          approverEmailDomain: request.approverEmail.split("@")[1] ?? null,
          decisionAt: iso(request.decisionAt),
          snoozedUntil: iso(request.snoozedUntil),
        },
      });
    });
  }

  private async collectPolicies(orgContext: OrgContext, limit: number, idFilter?: string | number): Promise<PlatformResource[]> {
    const governorWhere = whereAll(
      scopedOrgCondition(governorPolicies.organizationId, orgContext),
      idCondition(governorPolicies.id, idFilter),
    );
    const governorRows = await db.select().from(governorPolicies).where(governorWhere).orderBy(desc(governorPolicies.updatedAt)).limit(limit);
    const remaining = Math.max(limit - governorRows.length, 0);
    const violationRows = remaining > 0 && idFilter == null
      ? await db.select().from(policyViolations).where(scopedOrgCondition(policyViolations.organizationId, orgContext, false)).orderBy(desc(policyViolations.occurredAt)).limit(remaining)
      : [];

    return [
      ...governorRows.map((policy) => {
        const lifecycle = policy.isActive ? "active" : "paused";
        return typedResource({
          type: "policy",
          id: String(policy.id),
          name: policy.name,
          description: policy.description,
          status: policy.isActive ? "active" : "inactive",
          lifecycle,
          riskLevel: policy.type === "system" || policy.type === "global" ? "medium" : "low",
          organizationId: policy.organizationId,
          ownerId: policy.createdBy,
          createdAt: iso(policy.createdAt),
          updatedAt: iso(policy.updatedAt),
          url: `/governor/policies/${policy.id}`,
          tags: compact([policy.type, policy.isActive ? "active" : "inactive"]),
          capabilities: ["governance_policy", "action_control"],
          actions: [action("view", "View policy", "GET", `/api/governor/policies/${policy.id}`)],
          relations: [],
          health: healthFromLifecycle(lifecycle),
          metadata: { type: policy.type },
        });
      }),
      ...violationRows.map((violation) => {
        const lifecycle = violation.resolved ? "completed" : violation.blocked ? "failed" : "waiting";
        return typedResource({
          type: "policy",
          id: `violation-${violation.id}`,
          name: `${violation.checkType} policy violation`,
          description: `${violation.enforcement} ${violation.checkType} check for ${violation.checkValue}`,
          status: violation.resolved ? "resolved" : violation.blocked ? "blocked" : "warned",
          lifecycle,
          riskLevel: violation.blocked ? "high" : "medium",
          organizationId: violation.organizationId,
          ownerId: violation.agentId ?? (violation.userId != null ? String(violation.userId) : undefined),
          createdAt: iso(violation.occurredAt),
          updatedAt: iso(violation.occurredAt),
          url: `/governor/policy-violations/${violation.id}`,
          tags: compact([violation.checkType, violation.enforcement, violation.blocked ? "blocked" : "warn"]),
          capabilities: ["policy_violation", "enforcement_audit"],
          actions: [action("view", "View policy violation", "GET", `/api/governor/policy-violations/${violation.id}`)],
          relations: compact([
            relation("blocked_by", "job", violation.jobId),
            relation("blocked_by", "mission", violation.missionId),
            relation("blocked_by", "pipeline", violation.pipelineId),
            relation("executed_by", "agent", violation.agentId),
          ]),
          health: healthFromLifecycle(lifecycle),
          metadata: {
            role: violation.role,
            checkType: violation.checkType,
            checkValue: violation.checkValue,
            enforcement: violation.enforcement,
          },
        });
      }),
    ];
  }

  private async collectApprovalPolicies(orgContext: OrgContext, limit: number, idFilter?: string | number): Promise<PlatformResource[]> {
    const where = whereAll(
      scopedOrgCondition(governanceApprovals.organizationId, orgContext, false),
      textIdCondition(governanceApprovals.id, idFilter),
    );
    const rows = await db.select().from(governanceApprovals).where(where).orderBy(desc(governanceApprovals.createdAt)).limit(limit);

    return rows.map((approval) => {
      const lifecycle = lifecycleFromStatus(approval.status);
      const riskLevel = approval.riskLevel === "critical" || approval.riskLevel === "high" || approval.riskLevel === "medium" || approval.riskLevel === "low"
        ? approval.riskLevel
        : riskForLifecycle(lifecycle);
      return typedResource({
        type: "approval_policy",
        id: approval.id,
        name: `${approval.type} approval`,
        description: approval.description,
        status: approval.status,
        lifecycle,
        riskLevel,
        organizationId: approval.organizationId,
        ownerId: approval.approvedBy ?? approval.requesterId,
        createdAt: iso(approval.createdAt),
        updatedAt: iso(approval.approvedAt ?? approval.createdAt),
        url: `/governance/approvals/${approval.id}`,
        tags: compact([approval.type, approval.status, approval.riskLevel]),
        capabilities: ["approval_policy", "budget_gate"],
        actions: [action("view", "View governance approval", "GET", `/api/governance/approvals/${approval.id}`)],
        relations: compact([
          relation("approves", "mission", approval.missionId),
          relation("authorized_by", "user", approval.approvedBy),
        ]),
        health: healthFromLifecycle(lifecycle, approval.rejectionReason),
        governance: {
          requiresApproval: approval.status === "pending",
        },
        metadata: {
          manifestId: approval.manifestId,
          projectedCost: approval.projectedCost,
          currentSpend: approval.currentSpend,
          budgetLimit: approval.budgetLimit,
          requiredBy: iso(approval.requiredBy),
        },
      });
    });
  }

  private async collectApps(orgContext: OrgContext, limit: number, idFilter?: string | number): Promise<PlatformResource[]> {
    const orgColumn = apps.organizationId;
    const orgWhere = orgContext.isSuperAdmin && orgContext.organizationId == null
      ? undefined
      : orgContext.organizationId == null
        ? or(eq(apps.isPublic, true), isNull(orgColumn))
        : or(eq(orgColumn, orgContext.organizationId), eq(apps.developerOrgId, orgContext.organizationId), eq(apps.isPublic, true));
    const where = whereAll(orgWhere, idCondition(apps.id, idFilter));

    const rows = await db
      .select()
      .from(apps)
      .where(where)
      .orderBy(desc(apps.updatedAt))
      .limit(limit);

    return rows.map((app) => {
      const lifecycle = lifecycleFromStatus(app.status);
      return typedResource({
        type: "app",
        id: String(app.id),
        name: app.name,
        description: app.description,
        status: app.status,
        lifecycle,
        riskLevel: maxRisk(riskForLifecycle(lifecycle), app.planReviewStatus === "pending" ? "medium" : "low"),
        organizationId: app.organizationId ?? app.developerOrgId,
        ownerId: app.createdBy,
        createdAt: iso(app.createdAt),
        updatedAt: iso(app.updatedAt),
        url: `/apps/${app.slug}`,
        tags: compact([
          app.slug,
          app.version,
          app.isPublic ? "public" : "private",
          app.isSystem ? "system" : undefined,
          app.blueprintSlug,
        ]),
        capabilities: compact([
          "app_forge",
          app.dockerImage ? "containerized" : undefined,
          app.vNextManifest ? "v_next_manifest" : undefined,
          app.developmentPlan ? "development_plan" : undefined,
          app.referenceAssetIds?.length ? "reference_assets" : undefined,
          app.oddjobMissionId ? "mission_backed" : undefined,
        ]),
        actions: [
          action("view", "View app", "GET", `/api/apps/${app.id}`),
          action("deploy", "Deploy app", "POST", `/api/apps/${app.id}/deploy`, {
            capability: "app:deploy",
            params: appDeploymentPublishParams(),
          }),
          action("audit", "Run app audit", "POST", `/api/apps/${app.id}/shadow-audit`, { capability: "app:audit" }),
        ],
        relations: compact([
          relation("derived_from", "mission", app.oddjobMissionId, "Forge mission"),
        ]),
        health: healthFromLifecycle(lifecycle, app.planReviewStatus === "pending" ? "Plan awaiting review" : undefined),
        metadata: {
          slug: app.slug,
          version: app.version,
          blueprint: app.blueprint,
          blueprintSlug: app.blueprintSlug,
          planReviewStatus: app.planReviewStatus,
          pricePerLaunchUsd: app.pricePerLaunchUsd,
          runtimeStatus: typeof app.runtimeMetadata === "object" && app.runtimeMetadata
            ? (app.runtimeMetadata as Record<string, unknown>).status
            : undefined,
        },
      });
    });
  }

  private async collectAppDeployments(orgContext: OrgContext, limit: number, idFilter?: string | number): Promise<PlatformResource[]> {
    const where = whereAll(
      scopedOrgCondition(appDeployments.organizationId, orgContext, false),
      idCondition(appDeployments.id, idFilter),
    );
    const rows = await db
      .select({
        id: appDeployments.id,
        appId: appDeployments.appId,
        organizationId: appDeployments.organizationId,
        status: appDeployments.status,
        publicSlug: appDeployments.publicSlug,
        url: appDeployments.url,
        isPublished: appDeployments.isPublished,
        title: appDeployments.title,
        description: appDeployments.description,
        accessPolicy: appDeployments.accessPolicy,
        budgetLimitUsd: appDeployments.budgetLimitUsd,
        currentSpendUsd: appDeployments.currentSpendUsd,
        appMemoryEnabled: appDeployments.appMemoryEnabled,
        webhookUrl: appDeployments.webhookUrl,
        nextPipelineId: appDeployments.nextPipelineId,
        oddjobMissionId: appDeployments.oddjobMissionId,
        hilEnabled: appDeployments.hilEnabled,
        expertiseJobId: appDeployments.expertiseJobId,
        allowedTopicIds: appDeployments.allowedTopicIds,
        allowedDatasetIds: appDeployments.allowedDatasetIds,
        allowedPipelineIds: appDeployments.allowedPipelineIds,
        intelligenceCategory: appDeployments.intelligenceCategory,
        deploymentMode: appDeployments.deploymentMode,
        minReplicas: appDeployments.minReplicas,
        maxReplicas: appDeployments.maxReplicas,
        targetConcurrency: appDeployments.targetConcurrency,
        appTokenCapabilities: appDeployments.appTokenCapabilities,
        installedAt: appDeployments.installedAt,
        updatedAt: appDeployments.updatedAt,
        // Defense in depth: never pull the raw secret/hash columns into JS memory, only whether they're set.
        hasAccessPassword: sql<boolean>`${appDeployments.accessPasswordHash} is not null`,
        hasWebhookSecret: sql<boolean>`${appDeployments.webhookSecret} is not null`,
        hasAppToken: sql<boolean>`${appDeployments.appTokenHash} is not null`,
      })
      .from(appDeployments)
      .where(where)
      .orderBy(desc(appDeployments.updatedAt))
      .limit(limit);

    return rows.map((deployment) => {
      const lifecycle = lifecycleFromStatus(deployment.status);
      return typedResource({
        type: "app_deployment",
        id: String(deployment.id),
        name: deployment.title || deployment.publicSlug || `Deployment ${deployment.id}`,
        description: deployment.description,
        status: deployment.status,
        lifecycle,
        riskLevel: maxRisk(
          riskForLifecycle(lifecycle),
          deployment.isPublished && deployment.accessPolicy === "public" ? "medium" : "low",
        ),
        organizationId: deployment.organizationId,
        createdAt: iso(deployment.installedAt),
        updatedAt: iso(deployment.updatedAt),
        url: deployment.url ?? (deployment.publicSlug ? `/forged/${deployment.publicSlug}` : undefined),
        tags: compact([
          deployment.isPublished ? "published" : "unpublished",
          deployment.accessPolicy,
          deployment.deploymentMode,
          deployment.intelligenceCategory,
        ]),
        capabilities: compact([
          "runtime_deployment",
          deployment.appMemoryEnabled ? "app_memory" : undefined,
          deployment.hilEnabled ? "hil" : undefined,
          deployment.nextPipelineId ? "app_chaining" : undefined,
          deployment.webhookUrl ? "webhook" : undefined,
          deployment.appTokenCapabilities?.length ? "platform_api_token" : undefined,
        ]),
        actions: [
          // No domain-level single-deployment GET route exists; fall back to the catalog's own get-by-key endpoint.
          action("view", "View deployment", "GET", `/api/resource-catalog/resources/${makeResourceKey("app_deployment", deployment.id)}`),
          // Publishing settings are configured through the parent app's deploy endpoint, keyed by appId not deployment.id.
          action("publish", "Publish deployment", "POST", `/api/apps/${deployment.appId}/deploy`, {
            capability: "app:publish",
            params: appDeploymentPublishParams(),
          }),
        ],
        relations: compact([
          relation("deploys", "app", deployment.appId),
          relation("triggers", "pipeline", deployment.nextPipelineId, "Next pipeline"),
          relation("uses", "mission", deployment.oddjobMissionId),
          relation("uses", "job", deployment.expertiseJobId, "Expertise job"),
          ...idsFrom(deployment.allowedDatasetIds).map((id) => relation("uses", "dataset", id, "Allowed dataset")),
          ...idsFrom(deployment.allowedTopicIds).map((id) => relation("uses", "knowledge_topic", id, "Allowed topic")),
          ...idsFrom(deployment.allowedPipelineIds).map((id) => relation("uses", "pipeline", id, "Allowed pipeline")),
        ]),
        health: healthFromLifecycle(lifecycle),
        governance: {
          dataClassification: deployment.accessPolicy ?? undefined,
          sensitive: Boolean(deployment.hasAccessPassword || deployment.hasWebhookSecret || deployment.hasAppToken),
        },
        metadata: {
          publicSlug: deployment.publicSlug,
          isPublished: deployment.isPublished,
          accessPolicy: deployment.accessPolicy,
          budgetLimitUsd: deployment.budgetLimitUsd,
          currentSpendUsd: deployment.currentSpendUsd,
          minReplicas: deployment.minReplicas,
          maxReplicas: deployment.maxReplicas,
          targetConcurrency: deployment.targetConcurrency,
          appTokenCapabilities: deployment.appTokenCapabilities,
        },
      });
    });
  }

  private async collectAppReleases(orgContext: OrgContext, limit: number, idFilter?: string | number): Promise<PlatformResource[]> {
    const where = whereAll(
      scopedOrgCondition(forgeReleases.organizationId, orgContext),
      idCondition(forgeReleases.id, idFilter),
    );
    const rows = await db.select().from(forgeReleases).where(where).orderBy(desc(forgeReleases.createdAt)).limit(limit);

    return rows.map((release) => {
      const lifecycle = release.status === "deployed" ? "active" : lifecycleFromStatus(release.status);
      return typedResource({
        type: "app_release",
        id: String(release.id),
        name: `Release ${release.version}`,
        description: release.artifactHash ? `Artifact ${release.artifactHash}` : undefined,
        status: release.status,
        lifecycle,
        riskLevel: release.status === "failed" ? "high" : release.approvalRequestId ? "medium" : "low",
        organizationId: release.organizationId,
        ownerId: release.deployedBy,
        createdAt: iso(release.createdAt),
        updatedAt: iso(release.deployedAt ?? release.createdAt),
        url: `/apps/${release.appId}/releases/${release.id}`,
        tags: compact([release.status, release.version, release.deployedAt ? "deployed" : undefined]),
        capabilities: ["app_release", "forge_artifact", "deployment_gate"],
        actions: [action("view", "View app release", "GET", `/api/apps/${release.appId}/releases/${release.id}`)],
        relations: compact([
          relation("version_of", "app", release.appId),
          relation("validated_by", "evidence_bundle", `release-${release.id}`),
          relation("authorized_by", "approval_request", release.approvalRequestId),
          relation("supersedes", "app_release", release.rollbackFromReleaseId),
        ]),
        health: healthFromLifecycle(lifecycle),
        metadata: {
          appId: release.appId,
          artifactHash: release.artifactHash,
          qaEvidence: release.qaEvidence,
          securityScanResult: release.securityScanResult,
        },
      });
    });
  }

  private async collectArtifacts(orgContext: OrgContext, limit: number, idFilter?: string | number): Promise<PlatformResource[]> {
    const deliverableWhere = whereAll(idCondition(missionDeliverables.id, idFilter));
    const deliverables = await db.select().from(missionDeliverables).where(deliverableWhere).orderBy(desc(missionDeliverables.updatedAt)).limit(limit);
    const remaining = Math.max(limit - deliverables.length, 0);
    const releaseRows = remaining > 0 && idFilter == null
      ? await db.select().from(forgeReleases).where(scopedOrgCondition(forgeReleases.organizationId, orgContext)).orderBy(desc(forgeReleases.createdAt)).limit(remaining)
      : [];

    return [
      ...deliverables.map((deliverable) => typedResource({
        type: "artifact",
        id: `deliverable-${deliverable.id}`,
        name: deliverable.name,
        description: deliverable.content.slice(0, 240),
        status: deliverable.isCritiqued ? "critiqued" : "generated",
        lifecycle: "completed",
        riskLevel: deliverable.isCritiqued ? "low" : "medium",
        createdAt: iso(deliverable.createdAt),
        updatedAt: iso(deliverable.updatedAt),
        url: `/missions/deliverables/${deliverable.id}`,
        tags: compact([deliverable.type, deliverable.isCritiqued ? "critiqued" : undefined]),
        capabilities: ["generated_artifact", "mission_deliverable"],
        actions: [action("view", "View artifact", "GET", `/api/mission-deliverables/${deliverable.id}`)],
        relations: compact([
          relation("produced", "mission", deliverable.missionId),
          relation("produced", "mission_run", deliverable.missionRunId),
          relation("derived_from", "artifact", deliverable.parentId),
        ]),
        health: healthFromLifecycle("completed"),
        metadata: {
          type: deliverable.type,
          metadata: deliverable.metadata,
          critiqueContent: deliverable.critiqueContent,
        },
      })),
      ...releaseRows.map((release) => typedResource({
        type: "artifact",
        id: `release-${release.id}`,
        name: `Release artifact ${release.version}`,
        description: release.artifactHash,
        status: release.status,
        lifecycle: release.status === "deployed" ? "active" : lifecycleFromStatus(release.status),
        riskLevel: release.securityScanResult ? "medium" : "low",
        organizationId: release.organizationId,
        ownerId: release.deployedBy,
        createdAt: iso(release.createdAt),
        updatedAt: iso(release.deployedAt ?? release.createdAt),
        url: `/apps/${release.appId}/releases/${release.id}`,
        tags: compact(["forge_release", release.status]),
        capabilities: ["build_artifact", "deployable_artifact"],
        actions: [action("view", "View release artifact", "GET", `/api/apps/${release.appId}/releases/${release.id}`)],
        relations: compact([
          relation("produced", "app_release", release.id),
          relation("version_of", "app", release.appId),
        ]),
        health: healthFromLifecycle(release.status === "failed" ? "failed" : "completed"),
        metadata: {
          artifactHash: release.artifactHash,
          securityScanResult: release.securityScanResult,
        },
      })),
    ];
  }

  private async collectReports(orgContext: OrgContext, limit: number, idFilter?: string | number): Promise<PlatformResource[]> {
    const where = whereAll(idCondition(missionDeliverables.id, idFilter));
    const rows = await db.select().from(missionDeliverables).where(where).orderBy(desc(missionDeliverables.updatedAt)).limit(limit);

    return rows
      .filter((deliverable) => ["report", "research", "specification", "capacity_plan"].includes(deliverable.type))
      .map((deliverable) => typedResource({
        type: "report",
        id: String(deliverable.id),
        name: deliverable.name,
        description: deliverable.content.slice(0, 240),
        status: deliverable.isCritiqued ? "reviewed" : "generated",
        lifecycle: "completed",
        riskLevel: deliverable.isCritiqued ? "low" : "medium",
        createdAt: iso(deliverable.createdAt),
        updatedAt: iso(deliverable.updatedAt),
        url: `/missions/deliverables/${deliverable.id}`,
        tags: compact([deliverable.type, deliverable.isCritiqued ? "reviewed" : undefined]),
        capabilities: ["generated_report", "audit_evidence"],
        actions: [action("view", "View report", "GET", `/api/mission-deliverables/${deliverable.id}`)],
        relations: compact([
          relation("produced", "mission", deliverable.missionId),
          relation("produced", "mission_run", deliverable.missionRunId),
          relation("derived_from", "report", deliverable.parentId),
        ]),
        health: healthFromLifecycle("completed"),
        metadata: {
          metadata: deliverable.metadata,
          critiqueContent: deliverable.critiqueContent,
        },
      }));
  }

  private async collectEvidenceBundles(orgContext: OrgContext, limit: number, idFilter?: string | number): Promise<PlatformResource[]> {
    const where = whereAll(
      scopedOrgCondition(forgeReleases.organizationId, orgContext),
      idFilter != null && String(idFilter).startsWith("release-") ? idCondition(forgeReleases.id, String(idFilter).replace(/^release-/, "")) : idCondition(forgeReleases.id, idFilter),
    );
    const rows = await db.select().from(forgeReleases).where(where).orderBy(desc(forgeReleases.createdAt)).limit(limit);

    return rows.map((release) => {
      const hasSecurityEvidence = hasContent(release.securityScanResult);
      const hasQaEvidence = hasContent(release.qaEvidence);
      const lifecycle = release.status === "failed" ? "failed" : hasQaEvidence || hasSecurityEvidence ? "completed" : "waiting";
      return typedResource({
        type: "evidence_bundle",
        id: `release-${release.id}`,
        name: `Evidence for release ${release.version}`,
        description: `QA and security evidence for app release ${release.version}`,
        status: release.status,
        lifecycle,
        riskLevel: hasSecurityEvidence ? "medium" : "low",
        organizationId: release.organizationId,
        ownerId: release.deployedBy,
        createdAt: iso(release.createdAt),
        updatedAt: iso(release.deployedAt ?? release.createdAt),
        url: `/apps/${release.appId}/releases/${release.id}/evidence`,
        tags: compact(["forge_release", hasQaEvidence ? "qa" : undefined, hasSecurityEvidence ? "security" : undefined]),
        capabilities: ["release_evidence", "qa_evidence", "security_scan"],
        actions: [action("view", "View evidence bundle", "GET", `/api/apps/${release.appId}/releases/${release.id}`)],
        relations: compact([
          relation("validated_by", "app_release", release.id),
          relation("contains", "artifact", `release-${release.id}`),
          relation("authorized_by", "approval_request", release.approvalRequestId),
        ]),
        health: healthFromLifecycle(lifecycle),
        metadata: {
          qaEvidence: release.qaEvidence,
          securityScanResult: release.securityScanResult,
        },
      });
    });
  }

  private async collectSchedules(orgContext: OrgContext, limit: number, idFilter?: string | number): Promise<PlatformResource[]> {
    const where = whereAll(
      scopedOrgCondition(schedules.organizationId, orgContext),
      idCondition(schedules.id, idFilter),
    );
    const rows = await db
      .select()
      .from(schedules)
      .where(where)
      .orderBy(desc(schedules.createdAt))
      .limit(limit);

    return rows.map((schedule) => {
      const lifecycle: ResourceLifecycle = schedule.isActive ? "active" : "paused";
      return typedResource({
        type: "schedule",
        id: String(schedule.id),
        name: schedule.name,
        description: schedule.description ?? schedule.patternLabel,
        status: schedule.isActive ? "active" : "inactive",
        lifecycle,
        riskLevel: schedule.isActive ? "low" : "medium",
        organizationId: schedule.organizationId,
        ownerId: schedule.createdBy,
        createdAt: iso(schedule.createdAt),
        url: `/schedules/${schedule.id}`,
        tags: compact([
          schedule.patternLabel,
          schedule.timezone,
          schedule.onHolidayBehavior,
        ]),
        capabilities: compact([
          "time_trigger",
          schedule.calendarId ? "calendar" : undefined,
          schedule.onHolidayBehavior ? "holiday_policy" : undefined,
        ]),
        actions: [
          action("view", "View schedule", "GET", `/api/schedules/${schedule.id}`),
          action("enable", "Enable schedule", "PUT", `/api/schedules/${schedule.id}`, {
            capability: "schedule:update",
            params: { location: "body", fields: [{ name: "isActive", type: "boolean", required: true, defaultValue: true }] },
          }),
          action("disable", "Disable schedule", "PUT", `/api/schedules/${schedule.id}`, {
            capability: "schedule:update",
            params: { location: "body", fields: [{ name: "isActive", type: "boolean", required: true, defaultValue: false }] },
          }),
        ],
        relations: [],
        health: healthFromLifecycle(lifecycle),
        metadata: {
          pattern: schedule.pattern,
          patternString: schedule.patternString,
          patternLabel: schedule.patternLabel,
          timezone: schedule.timezone,
        },
      });
    });
  }

  private async collectAlerts(orgContext: OrgContext, limit: number, idFilter?: string | number): Promise<PlatformResource[]> {
    const where = whereAll(
      scopedOrgCondition(alerts.organizationId, orgContext),
      idCondition(alerts.id, idFilter),
    );
    const rows = await db.select().from(alerts).where(where).orderBy(desc(alerts.createdAt)).limit(limit);

    return rows.map((alertRow) => {
      const lifecycle: ResourceLifecycle = alertRow.resolvedAt ? "completed" : alertRow.acknowledgedAt ? "waiting" : "active";
      const riskLevel: ResourceRiskLevel = alertRow.severity === "critical" ? "critical" : alertRow.severity === "high" ? "high" : alertRow.severity === "medium" ? "medium" : "low";
      return typedResource({
        type: "alert",
        id: String(alertRow.id),
        name: alertRow.message,
        description: alertRow.suppressedReason,
        status: alertRow.resolvedAt ? "resolved" : alertRow.acknowledgedAt ? "acknowledged" : "open",
        lifecycle,
        riskLevel,
        organizationId: alertRow.organizationId,
        ownerId: alertRow.ownerUserId,
        createdAt: iso(alertRow.createdAt),
        updatedAt: iso(alertRow.updatedAt ?? alertRow.resolvedAt ?? alertRow.acknowledgedAt ?? alertRow.createdAt),
        url: `/alerts/${alertRow.id}`,
        tags: compact([alertRow.severity, alertRow.category, alertRow.suppressed ? "suppressed" : undefined]),
        capabilities: ["operational_signal", "attention_routing"],
        actions: [action("view", "View alert", "GET", `/api/alerts/${alertRow.id}`)],
        relations: compact([
          relation("triggers", "schedule", alertRow.scheduledJobId),
          relation("observed", "job", alertRow.jobRunId),
          relation("observed", "pipeline", alertRow.pipelineRunId),
          relation("owned_by", "user", alertRow.ownerUserId),
        ]),
        health: healthFromLifecycle(lifecycle, alertRow.suppressedReason),
        metadata: {
          details: alertRow.details,
          firstSeenAt: iso(alertRow.firstSeenAt),
          acknowledgedAt: iso(alertRow.acknowledgedAt),
          resolvedAt: iso(alertRow.resolvedAt),
          suppressedUntil: iso(alertRow.suppressedUntil),
          ownerOrgId: alertRow.ownerOrgId,
        },
      });
    });
  }

  private async collectIncidents(orgContext: OrgContext, limit: number, idFilter?: string | number): Promise<PlatformResource[]> {
    const antigravityFilter = idFilter != null && String(idFilter).startsWith("antigravity-") ? String(idFilter).replace(/^antigravity-/, "") : idFilter;
    const antigravityRows = await db
      .select()
      .from(antigravityIncidents)
      .where(idCondition(antigravityIncidents.id, antigravityFilter))
      .orderBy(desc(antigravityIncidents.updatedAt))
      .limit(limit);
    const remaining = Math.max(limit - antigravityRows.length, 0);
    const failureFilter = idFilter != null && String(idFilter).startsWith("failure-") ? String(idFilter).replace(/^failure-/, "") : idFilter;
    const failureRows = remaining > 0
      ? await db
        .select()
        .from(failureIncidents)
        .where(whereAll(scopedOrgCondition(failureIncidents.organizationId, orgContext, false), idCondition(failureIncidents.id, failureFilter)))
        .orderBy(desc(failureIncidents.createdAt))
        .limit(remaining)
      : [];

    return [
      ...antigravityRows.map((incident) => {
        const lifecycle = lifecycleFromStatus(incident.status);
        return typedResource({
          type: "incident",
          id: `antigravity-${incident.id}`,
          name: `Antigravity incident ${incident.id}`,
          description: incident.description,
          status: incident.status,
          lifecycle,
          riskLevel: incident.status === "resolved" ? "medium" : "high",
          createdAt: iso(incident.createdAt),
          updatedAt: iso(incident.updatedAt),
          url: `/antigravity/incidents/${incident.id}`,
          tags: compact(["antigravity", incident.status]),
          capabilities: ["human_escalation", "mission_recovery"],
          actions: [action("view", "View incident", "GET", `/api/resource-catalog/resources/${makeResourceKey("incident", `antigravity-${incident.id}`)}`)],
          relations: compact([
            relation("failed_due_to", "mission_run", incident.missionRunId),
            relation("observed", "trace", incident.traceId),
          ]),
          health: healthFromLifecycle(lifecycle, incident.resolution),
          metadata: {
            context: incident.context,
            resolution: incident.resolution,
            resolvedAt: iso(incident.resolvedAt),
          },
        });
      }),
      ...failureRows.map((incident) => {
        const lifecycle: ResourceLifecycle = incident.wasResolved ? "completed" : "active";
        const riskLevel: ResourceRiskLevel = incident.severity === "critical" ? "critical" : incident.severity === "high" ? "high" : incident.severity === "low" || incident.severity === "info" ? "low" : "medium";
        return typedResource({
          type: "incident",
          id: `failure-${incident.id}`,
          name: incident.errorMessage ?? `${incident.domain} failure`,
          description: incident.subcategory ?? incident.errorCode,
          status: incident.wasResolved ? "resolved" : "open",
          lifecycle,
          riskLevel,
          organizationId: incident.organizationId,
          createdAt: iso(incident.createdAt),
          updatedAt: iso(incident.resolvedAt ?? incident.createdAt),
          url: `/failure-incidents/${incident.id}`,
          tags: compact([incident.domain, incident.severity, incident.subcategory]),
          capabilities: ["failure_record", "pattern_detection"],
          actions: [action("view", "View failure incident", "GET", `/api/resource-catalog/resources/${makeResourceKey("incident", `failure-${incident.id}`)}`)],
          relations: compact([
            relation("failed_due_to", "failure_pattern", incident.clusterId),
            relation("observed", "mission", incident.missionId),
            relation("observed", "app", incident.appId),
            relation("observed", "job", incident.jobId),
            relation("remediated_by", "remediation", incident.preventionRuleId),
          ]),
          health: healthFromLifecycle(lifecycle, incident.errorMessage),
          metadata: {
            incidentHash: incident.incidentHash,
            errorStack: incident.errorStack,
            errorCode: incident.errorCode,
            componentName: incident.componentName,
            filePath: incident.filePath,
            triggeringInput: incident.triggeringInput,
            resolutionMethod: incident.resolutionMethod,
            resolutionTimeMs: incident.resolutionTimeMs,
          },
        });
      }),
    ];
  }

  private async collectFailurePatterns(orgContext: OrgContext, limit: number, idFilter?: string | number): Promise<PlatformResource[]> {
    const clusterRows = await db
      .select()
      .from(failureClusters)
      .where(whereAll(scopedOrgCondition(failureClusters.organizationId, orgContext, false), idCondition(failureClusters.id, idFilter)))
      .orderBy(desc(failureClusters.lastSeenAt))
      .limit(limit);
    const remaining = Math.max(limit - clusterRows.length, 0);
    // The legacy fallback was completely unscoped: `failure_patterns` had no
    // organization column, so this returned every tenant's patterns into an
    // org-scoped catalog alongside the properly scoped `failureClusters` rows.
    const legacyRows = remaining > 0 && idFilter == null
      ? await db
          .select()
          .from(failurePatterns)
          .where(scopedOrgCondition(failurePatterns.organizationId, orgContext, false))
          .orderBy(desc(failurePatterns.id))
          .limit(remaining)
      : [];

    return [
      ...clusterRows.map((cluster) => {
        const lifecycle = lifecycleFromStatus(cluster.status);
        const riskLevel: ResourceRiskLevel = cluster.severity === "critical" ? "critical" : cluster.severity === "high" ? "high" : cluster.severity === "low" || cluster.severity === "info" ? "low" : "medium";
        return typedResource({
          type: "failure_pattern",
          id: String(cluster.id),
          name: cluster.name ?? `${cluster.domain} pattern`,
          description: cluster.description ?? cluster.likelyRootCause,
          status: cluster.status,
          lifecycle,
          riskLevel,
          organizationId: cluster.organizationId,
          createdAt: iso(cluster.firstSeenAt),
          updatedAt: iso(cluster.updatedAt),
          url: `/failure-patterns/${cluster.id}`,
          tags: compact([cluster.domain, cluster.severity, cluster.isIncreasing ? "increasing" : undefined]),
          capabilities: ["failure_clustering", "root_cause_analysis"],
          actions: [action("view", "View failure pattern", "GET", `/api/resource-catalog/resources/${makeResourceKey("failure_pattern", cluster.id)}`)],
          relations: compact([
            relation("remediated_by", "remediation", cluster.preventionRuleId),
          ]),
          health: healthFromLifecycle(lifecycle, cluster.likelyRootCause),
          metadata: {
            incidentCount: cluster.incidentCount,
            frequency7d: cluster.frequency7d,
            frequency30d: cluster.frequency30d,
            confidenceScore: cluster.confidenceScore,
            contributingFactors: cluster.contributingFactors,
            affectedApps: cluster.affectedApps,
            affectedMissions: cluster.affectedMissions,
            resolutionStrategy: cluster.resolutionStrategy,
          },
        });
      }),
      ...legacyRows.map((pattern) => typedResource({
        type: "failure_pattern",
        id: `legacy-${pattern.id}`,
        name: `Harness ${pattern.harnessId} failure pattern`,
        description: JSON.stringify(pattern.patternSignature),
        status: "active",
        lifecycle: "active",
        riskLevel: "medium",
        tags: compact([pattern.harnessId, pattern.harnessVersion]),
        capabilities: ["harness_failure_pattern"],
        actions: [action("view", "View failure pattern", "GET", `/api/resource-catalog/resources/${makeResourceKey("failure_pattern", `legacy-${pattern.id}`)}`)],
        relations: compact([
          ...(pattern.representativeTraces ?? []).map((traceId) => relation("cites", "trace", traceId)),
        ]),
        health: healthFromLifecycle("active"),
        metadata: {
          clusterSize: pattern.clusterSize,
          actionabilityScore: pattern.actionabilityScore,
          patternSignature: pattern.patternSignature,
        },
      })),
    ];
  }

  private async collectRemediations(orgContext: OrgContext, limit: number, idFilter?: string | number): Promise<PlatformResource[]> {
    const where = whereAll(
      scopedOrgCondition(preventionRules.organizationId, orgContext, false),
      idCondition(preventionRules.id, idFilter),
    );
    const rows = await db.select().from(preventionRules).where(where).orderBy(desc(preventionRules.updatedAt)).limit(limit);

    return rows.map((rule) => {
      const lifecycle = rule.isActive ? "active" : "paused";
      return typedResource({
        type: "remediation",
        id: String(rule.id),
        name: rule.name,
        description: rule.description,
        status: rule.isActive ? "active" : "inactive",
        lifecycle,
        riskLevel: rule.falsePositiveCount && rule.falsePositiveCount > 0 ? "medium" : "low",
        organizationId: rule.organizationId,
        ownerId: rule.createdBy,
        createdAt: iso(rule.createdAt),
        updatedAt: iso(rule.updatedAt),
        url: `/remediations/${rule.id}`,
        tags: compact([rule.ruleType, rule.isAutoGenerated ? "auto_generated" : undefined]),
        capabilities: ["prevention_rule", "automated_remediation"],
        actions: [action("view", "View remediation", "GET", `/api/resource-catalog/resources/${makeResourceKey("remediation", rule.id)}`)],
        relations: compact([
          relation("remediated_by", "failure_pattern", rule.matchesClusterId ?? rule.createdFromClusterId),
        ]),
        health: healthFromLifecycle(lifecycle),
        metadata: {
          matchesDomain: rule.matchesDomain,
          matchesPattern: rule.matchesPattern,
          matchesComponent: rule.matchesComponent,
          actionConfig: rule.actionConfig,
          timesTriggered: rule.timesTriggered,
          timesPrevented: rule.timesPrevented,
          falsePositiveCount: rule.falsePositiveCount,
          effectivenessScore: rule.effectivenessScore,
        },
      });
    });
  }

  private async collectRunbooks(orgContext: OrgContext, limit: number, idFilter?: string | number): Promise<PlatformResource[]> {
    const where = whereAll(
      scopedOrgCondition(knowledgeDocuments.organizationId, orgContext),
      idCondition(knowledgeDocuments.id, idFilter),
    );
    const rows = await db.select().from(knowledgeDocuments).where(where).orderBy(desc(knowledgeDocuments.updatedAt)).limit(limit * 2);

    return rows
      .filter((document) => {
        const haystack = [document.title, document.summary, document.sourceType, document.contentType].filter(Boolean).join(" ").toLowerCase();
        return haystack.includes("runbook") || haystack.includes("playbook") || haystack.includes("incident");
      })
      .slice(0, limit)
      .map((document) => typedResource({
        type: "runbook",
        id: String(document.id),
        name: document.title,
        description: document.summary,
        status: document.qdrantPointId ? "indexed" : "pending_index",
        lifecycle: "active",
        riskLevel: "low",
        organizationId: document.organizationId,
        ownerId: document.createdBy,
        createdAt: iso(document.createdAt),
        updatedAt: iso(document.updatedAt),
        url: `/knowledge/documents/${document.id}`,
        tags: compact(["runbook", document.sourceType, document.contentType]),
        capabilities: compact(["operational_procedure", document.qdrantPointId ? "retrievable" : undefined]),
        actions: [action("view", "View runbook", "GET", `/api/knowledge/documents/${document.id}`)],
        relations: compact([
          relation("derived_from", "knowledge_document", document.id),
          relation("uses", "mission", document.missionId),
        ]),
        health: healthFromLifecycle("active", document.qdrantPointId ? undefined : "Not indexed"),
        metadata: {
          sourceType: document.sourceType,
          contentType: document.contentType,
          externalId: document.externalId,
          workflowExecutionId: document.workflowExecutionId,
          workflowStepId: document.workflowStepId,
        },
      }));
  }

  private async collectCredentials(orgContext: OrgContext, limit: number, idFilter?: string | number): Promise<PlatformResource[]> {
    const where = whereAll(
      scopedOrgCondition(credentials.organizationId, orgContext, false),
      idCondition(credentials.id, idFilter),
    );
    const rows = await db
      .select({
        id: credentials.id,
        name: credentials.name,
        type: credentials.type,
        description: credentials.description,
        organizationId: credentials.organizationId,
        createdBy: credentials.createdBy,
        createdAt: credentials.createdAt,
      })
      .from(credentials)
      .where(where)
      .orderBy(desc(credentials.createdAt))
      .limit(limit);

    return rows.map((credential) => typedResource({
      type: "credential",
      id: String(credential.id),
      name: credential.name,
      description: credential.description,
      status: "configured",
      lifecycle: "active",
      riskLevel: "critical",
      organizationId: credential.organizationId,
      ownerId: credential.createdBy,
      createdAt: iso(credential.createdAt),
      url: `/credentials/${credential.id}`,
      tags: compact([credential.type, "sensitive"]),
      capabilities: ["secret_handle", "integration_auth"],
      actions: [
        // No domain-level single-credential GET route exists; fall back to the catalog's own get-by-key endpoint.
        action("view", "View credential handle", "GET", `/api/resource-catalog/resources/${makeResourceKey("credential", credential.id)}`),
        action("test", "Test credential", "POST", `/api/credentials/${credential.id}/test`, { capability: "credential:test" }),
      ],
      relations: [],
      health: healthFromLifecycle("active"),
      governance: {
        dataClassification: "secret",
        sensitive: true,
      },
      metadata: {
        type: credential.type,
        redacted: true,
      },
    }));
  }

  private async collectSlackWorkspaces(orgContext: OrgContext, limit: number, idFilter?: string | number): Promise<PlatformResource[]> {
    const where = whereAll(
      scopedOrgCondition(slackWorkspaces.organizationId, orgContext, false),
      idCondition(slackWorkspaces.id, idFilter),
    );
    const rows = await db
      .select({
        id: slackWorkspaces.id,
        organizationId: slackWorkspaces.organizationId,
        teamId: slackWorkspaces.teamId,
        teamName: slackWorkspaces.teamName,
        isActive: slackWorkspaces.isActive,
        defaultChannel: slackWorkspaces.defaultChannel,
        notifyOnMissionComplete: slackWorkspaces.notifyOnMissionComplete,
        notifyOnJobFailure: slackWorkspaces.notifyOnJobFailure,
        notifyOnApproval: slackWorkspaces.notifyOnApproval,
        notifyOnAppLaunched: slackWorkspaces.notifyOnAppLaunched,
        installedBy: slackWorkspaces.installedBy,
        installedAt: slackWorkspaces.installedAt,
        updatedAt: slackWorkspaces.updatedAt,
      })
      .from(slackWorkspaces)
      .where(where)
      .orderBy(desc(slackWorkspaces.installedAt))
      .limit(limit);

    return rows.map((workspace) => {
      const lifecycle: ResourceLifecycle = workspace.isActive ? "active" : "paused";
      return typedResource({
        type: "slack_workspace",
        id: String(workspace.id),
        name: workspace.teamName,
        description: `Slack workspace (team ${workspace.teamId})`,
        status: workspace.isActive ? "connected" : "disconnected",
        lifecycle,
        riskLevel: "medium",
        organizationId: workspace.organizationId,
        ownerId: workspace.installedBy != null ? String(workspace.installedBy) : null,
        createdAt: iso(workspace.installedAt),
        updatedAt: iso(workspace.updatedAt),
        url: `/integrations/slack/workspaces/${workspace.id}`,
        tags: compact(["slack", workspace.isActive ? "connected" : "disconnected"]),
        capabilities: ["notification_delivery", "slash_commands", "interactive_actions"],
        actions: [
          action("view", "View Slack workspace", "GET", `/api/integrations/slack/workspaces/${workspace.id}`),
          action("configure", "Update notification settings", "PUT", `/api/integrations/slack/workspaces/${workspace.id}/settings`, {
            params: {
              location: "body",
              fields: [
                { name: "isActive", type: "boolean" },
                { name: "defaultChannel", type: "string" },
                { name: "notifyOnMissionComplete", type: "boolean" },
                { name: "notifyOnJobFailure", type: "boolean" },
                { name: "notifyOnApproval", type: "boolean" },
                { name: "notifyOnAppLaunched", type: "boolean" },
              ],
            },
          }),
          action("disconnect", "Disconnect workspace", "DELETE", `/api/integrations/slack/workspaces/${workspace.id}`, {
            destructive: true,
          }),
        ],
        relations: [],
        health: healthFromLifecycle(lifecycle),
        governance: {
          sensitive: true,
        },
        metadata: {
          teamId: workspace.teamId,
          defaultChannel: workspace.defaultChannel,
          notifyOnMissionComplete: workspace.notifyOnMissionComplete,
          notifyOnJobFailure: workspace.notifyOnJobFailure,
          notifyOnApproval: workspace.notifyOnApproval,
          notifyOnAppLaunched: workspace.notifyOnAppLaunched,
          redacted: true,
        },
      });
    });
  }
}

export const resourceCatalogService = new ResourceCatalogService();
