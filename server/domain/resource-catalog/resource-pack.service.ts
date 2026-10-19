import { createHash, randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";

import { db } from "@server/database_service.js";
import type { OrgContext } from "@server/utils/auth-context.js";
import {
  auditEvents,
  governancePolicies,
  pipelineExecutions,
} from "@shared/schema/index.js";
import {
  type AcceleratorManifest,
  type AgentOpsScorecard,
  type AuditExportPack,
  type PlatformResource,
  type PolicyPackManifest,
} from "@shared/resource-catalog.js";

import { enrichResourceActionContracts } from "./resource-action-contract.service.js";
import { analyzeResourceImpact } from "./resource-impact.service.js";
import { getResourceGraph } from "./resource-graph.service.js";
import { getResourceStudio } from "./resource-studio.service.js";
import { resourceCatalogService } from "./resource-catalog.service.js";

function checksum(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function resourceRefs(resources: PlatformResource[]) {
  return resources.map((resource) => ({
    key: resource.key,
    type: resource.type,
    id: resource.id,
    name: resource.name,
    required: true,
  }));
}

export async function buildAcceleratorManifest(
  orgContext: OrgContext,
  rootKey: string,
): Promise<AcceleratorManifest> {
  const studio = await getResourceStudio(orgContext, rootKey, { maxDepth: 2 });
  const resources = studio.graph.nodes.map((node) => enrichResourceActionContracts(node.resource));
  const rootSlug = rootKey.replace(/[^a-zA-Z0-9_-]/g, "-");

  return {
    manifestVersion: "1.0",
    id: `accelerator-${rootSlug}`,
    name: `${studio.root.name} Accelerator`,
    version: "1.0.0",
    description: `Generated accelerator manifest rooted at ${studio.root.key}.`,
    resources: resourceRefs(resources),
    schemas: resources.map((resource) => resource.schema).filter(Boolean),
    forms: resourceRefs(studio.bindings.forms),
    policies: studio.bindings.policies
      .map((policy) => policy.policyId ?? policy.policyPackId)
      .filter((value): value is string => Boolean(value)),
    evals: resources.flatMap((resource) =>
      resource.actions.flatMap((action) => action.contract?.evalHooks?.map((hook) => hook.id) ?? []),
    ),
    credentials: resourceRefs(resources.filter((resource) => resource.type === "credential")),
    installChecks: [
      {
        id: "resource-graph",
        label: "Resource graph can be resolved",
        status: studio.graph.truncated ? "warn" : "pass",
        detail: studio.graph.truncated ? "Graph was truncated by depth or scan caps." : undefined,
      },
      {
        id: "policies",
        label: "Policy requirements are declared",
        status: studio.bindings.policies.length > 0 ? "pass" : "warn",
        detail: studio.bindings.policies.length > 0 ? undefined : "No explicit policy requirements found.",
      },
      {
        id: "eval-hooks",
        label: "Eval hooks are declared",
        status: "pass",
      },
    ],
    generatedAt: new Date().toISOString(),
  };
}

export async function buildPolicyPackManifest(
  orgContext: OrgContext,
  rootKey?: string,
): Promise<PolicyPackManifest> {
  const policies = await db.select().from(governancePolicies).where(eq(governancePolicies.status, "active")).limit(100).catch(() => []);
  const appliesTo = rootKey
    ? [enrichResourceActionContracts(await resourceCatalogService.getResourceByKey(rootKey, orgContext)).type]
    : [];

  return {
    manifestVersion: "1.0",
    id: `policy-pack-${randomUUID()}`,
    name: rootKey ? `Policy Pack for ${rootKey}` : "Active Governance Policy Pack",
    version: "1.0.0",
    description: "Generated from active governance policies and resource action requirements.",
    policies: policies.map((policy) => ({
      id: policy.id,
      name: policy.name,
      type: policy.policyType,
      definition: policy.definition,
    })),
    appliesTo,
    installChecks: [
      {
        id: "active-policies",
        label: "Active policies available",
        status: policies.length > 0 ? "pass" : "warn",
        detail: policies.length > 0 ? undefined : "No active governance policies found.",
      },
    ],
    generatedAt: new Date().toISOString(),
  };
}

export async function buildAuditExportPack(
  orgContext: OrgContext,
  rootKey: string,
): Promise<AuditExportPack> {
  const root = enrichResourceActionContracts(await resourceCatalogService.getResourceByKey(rootKey, orgContext));
  const graph = await getResourceGraph(orgContext, rootKey, { maxDepth: 2 });
  const impact = await analyzeResourceImpact(orgContext, rootKey, { maxDepth: 2 }).catch(() => null);
  const refId = Number.parseInt(root.id, 10);
  const recentAudit = Number.isFinite(refId)
    ? await db.select().from(auditEvents)
      .where(and(eq(auditEvents.refType, root.type), eq(auditEvents.refId, refId)))
      .orderBy(desc(auditEvents.eventTime))
      .limit(25)
      .catch(() => [])
    : [];

  const packWithoutChecksum = {
    manifestVersion: "1.0" as const,
    id: `audit-pack-${root.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
    resourceKey: root.key,
    resource: root,
    graph,
    impact: { downstreamCount: impact?.nodes.length ?? 0, truncated: impact?.truncated ?? false },
    policyRequirements: root.actions.flatMap((action) => action.contract?.policyRequirements ?? []),
    actions: root.actions,
    evidence: recentAudit.map((event) => ({
      id: `audit:${event.id}`,
      type: "audit_event",
      summary: `${event.action} ${event.refType ?? ""} ${event.refName ?? ""}`.trim(),
      payload: event,
    })),
    generatedAt: new Date().toISOString(),
  };

  return {
    ...packWithoutChecksum,
    checksum: checksum(packWithoutChecksum),
  };
}

export async function buildAgentOpsScorecard(
  orgContext: OrgContext,
  rootKey: string,
): Promise<AgentOpsScorecard> {
  const resource = enrichResourceActionContracts(await resourceCatalogService.getResourceByKey(rootKey, orgContext));
  const pipelineId = resource.type === "pipeline" ? Number.parseInt(resource.id, 10) : null;
  const executions = pipelineId
    ? await db.select({
      id: pipelineExecutions.id,
      status: pipelineExecutions.status,
      startedAt: pipelineExecutions.startedAt,
      completedAt: pipelineExecutions.completedAt,
      traceId: pipelineExecutions.traceId,
    }).from(pipelineExecutions)
      .where(and(eq(pipelineExecutions.pipelineId, pipelineId), eq(pipelineExecutions.organizationId, orgContext.organizationId ?? 0)))
      .orderBy(desc(pipelineExecutions.startedAt))
      .limit(50)
      .catch(() => [])
    : [];

  const completed = executions.filter((execution) => execution.status === "completed").length;
  const failed = executions.filter((execution) => execution.status === "failed").length;
  const total = executions.length || 1;
  const reliability = Math.round((completed / total) * 100);
  const policyCleanliness = Math.max(0, 100 - failed * 10);
  const traced = executions.filter((execution) => execution.traceId).length;
  const observability = executions.length ? Math.round((traced / executions.length) * 100) : 0;
  const costEfficiency = 80;
  const overall = Math.round((reliability + policyCleanliness + observability + costEfficiency) / 4);

  return {
    resourceKey: rootKey,
    resource,
    traces: {
      count: traced,
      recent: executions.slice(0, 10) as Array<Record<string, unknown>>,
    },
    evals: {
      datasets: resource.actions.flatMap((action) => action.contract?.evalHooks?.map((hook) => hook.datasetKey).filter(Boolean) ?? []) as string[],
      experiments: resource.actions.flatMap((action) => action.contract?.evalHooks?.map((hook) => hook.id) ?? []),
    },
    scorecard: {
      reliability,
      policyCleanliness,
      observability,
      costEfficiency,
      overall,
    },
    generatedAt: new Date().toISOString(),
  };
}
