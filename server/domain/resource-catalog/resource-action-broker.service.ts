import { db } from "@server/database_service.js";
import type { OrgContext } from "@server/utils/auth-context.js";
import { BadRequestError, NotFoundError } from "@server/utils/errors.js";
import { auditEvents } from "@shared/schema/index.js";
import {
  type PlatformResource,
  type ResourceAction,
  type ResourceActionBrokerRequest,
  type ResourceActionBrokerResponse,
  type ResourceActionParamField,
} from "@shared/resource-catalog.js";

import { analyzeResourceImpact } from "./resource-impact.service.js";
import { resourceCatalogService } from "./resource-catalog.service.js";
import { enrichResourceActionContracts } from "./resource-action-contract.service.js";
import { routeResourceIntent } from "./resource-intent.service.js";

const AMBIGUOUS_DELTA = 0.08;

function confidence(resourceScore: number, actionScore: number): number {
  return Math.min(1, Math.max(0, resourceScore * 0.7 + actionScore * 0.3));
}

function missingRequiredFields(action: ResourceAction, input: Record<string, unknown>): ResourceActionParamField[] {
  return (action.params?.fields ?? []).filter((field) => {
    if (!field.required || field.defaultValue !== undefined) return false;
    const value = input[field.name];
    return value === undefined || value === null || value === "";
  });
}

function buildDecision(resource: PlatformResource, action: ResourceAction) {
  const contract = action.contract;
  const requirements = contract?.policyRequirements ?? [];
  const requiresApproval = requirements.some((requirement) => requirement.requiresApproval);
  const highRisk = contract?.risk === "high" || contract?.risk === "critical";
  const allowed = !action.destructive && !highRisk && !requiresApproval;
  return {
    allowed,
    requiresApproval: requiresApproval || highRisk || action.destructive === true,
    reason: allowed
      ? "Action is low-risk and has no approval requirement."
      : "Action requires confirmation or approval because of risk, policy, or destructive side effects.",
    policyRequirements: requirements,
  };
}

async function auditBrokerEvent(
  orgContext: OrgContext,
  resource: PlatformResource,
  action: ResourceAction,
  details: Record<string, unknown>,
): Promise<string | number | undefined> {
  try {
    const refId = Number.parseInt(resource.id, 10);
    const [row] = await db.insert(auditEvents).values({
      category: resource.type.slice(0, 40),
      action: action.id.slice(0, 40),
      actor: orgContext.userId ?? "resource-action-broker",
      refType: resource.type,
      refId: Number.isFinite(refId) ? refId : null,
      refName: resource.name,
      details: {
        resourceKey: resource.key,
        actionId: action.id,
        ...details,
      },
    }).returning({ id: auditEvents.id });
    return row?.id;
  } catch {
    return undefined;
  }
}

async function executeSupportedAction(
  orgContext: OrgContext,
  resource: PlatformResource,
  action: ResourceAction,
  input: Record<string, unknown>,
): Promise<ResourceActionBrokerResponse["execution"]> {
  if (resource.type === "pipeline" && action.id === "run") {
    const { pipelineExecutor } = await import("@server/core/pipeline-executor.js");
    const result = await pipelineExecutor.executePipeline(
      Number(resource.id),
      orgContext.userId ?? "resource-action-broker",
      null,
      null,
      input,
    );
    return {
      href: action.href,
      method: action.method,
      executionId: result.executionId,
      result,
    };
  }

  return {
    href: action.href,
    method: action.method,
    result: {
      message: "Action matched and authorized, but no generic executor is registered for this action yet.",
    },
  };
}

async function resolveRequestedAction(
  orgContext: OrgContext,
  request: ResourceActionBrokerRequest,
): Promise<{
  resource: PlatformResource;
  action: ResourceAction;
  confidence?: number;
  alternatives?: Array<{ resource: PlatformResource; action: ResourceAction; confidence: number }>;
}> {
  if (request.resourceKey) {
    const resource = enrichResourceActionContracts(await resourceCatalogService.getResourceByKey(request.resourceKey, orgContext));
    const action = resource.actions.find((candidate) => candidate.id === request.actionId) ??
      (request.actionId ? undefined : resource.actions.find((candidate) => candidate.id === "view") ?? resource.actions[0]);
    if (!action) throw new NotFoundError(`Action not found on resource ${request.resourceKey}`);
    return { resource, action, confidence: 1 };
  }

  if (!request.query?.trim()) {
    throw new BadRequestError("Either query or resourceKey is required");
  }

  const routed = await routeResourceIntent(orgContext, request.query, { limit: 5 });
  if (routed.matches.length === 0) {
    throw new NotFoundError("No matching resource action found");
  }

  const ranked = routed.matches.map((match) => ({
    resource: enrichResourceActionContracts(match.resource),
    actionId: match.action.id,
    confidence: confidence(match.resourceScore, match.actionScore),
  }))
    .map((match) => ({
      resource: match.resource,
      action: match.resource.actions.find((action) => action.id === match.actionId) ?? match.resource.actions[0],
      confidence: match.confidence,
    }))
    .filter((match): match is { resource: PlatformResource; action: ResourceAction; confidence: number } => Boolean(match.action))
    .sort((a, b) => b.confidence - a.confidence);

  if (ranked.length === 0) {
    throw new NotFoundError("No executable resource action found");
  }

  const [best, second] = ranked;
  const alternatives = ranked.slice(1);
  if (second && best.confidence - second.confidence < AMBIGUOUS_DELTA) {
    return { ...best, alternatives };
  }
  return { ...best, alternatives };
}

export async function brokerResourceAction(
  orgContext: OrgContext,
  request: ResourceActionBrokerRequest,
): Promise<ResourceActionBrokerResponse> {
  const input = request.input ?? {};
  const resolved = await resolveRequestedAction(orgContext, request);
  const { resource, action } = resolved;
  const generatedAt = new Date().toISOString();
  const decision = buildDecision(resource, action);
  const missingFields = missingRequiredFields(action, input);
  const impact = action.destructive || action.contract?.risk === "high" || action.contract?.risk === "critical"
    ? await analyzeResourceImpact(orgContext, resource.key, { maxDepth: 2 }).catch(() => null)
    : null;
  const blastRadius = impact ? { impactedCount: impact.nodes.length, truncated: impact.truncated } : undefined;

  const base = {
    query: request.query,
    resource,
    action,
    confidence: resolved.confidence,
    alternatives: resolved.alternatives,
    decision,
    blastRadius,
    generatedAt,
  };

  if (resolved.alternatives?.[0] && (resolved.confidence ?? 0) - resolved.alternatives[0].confidence < AMBIGUOUS_DELTA) {
    return { ...base, status: "ambiguous" };
  }

  if (missingFields.length > 0) {
    return { ...base, status: "needs_input", missingFields };
  }

  if (request.dryRun) {
    const eventId = await auditBrokerEvent(orgContext, resource, action, { mode: "dry_run", inputKeys: Object.keys(input) });
    return { ...base, status: "dry_run", audit: { eventId, generatedAt } };
  }

  if (!decision.allowed && !request.confirm) {
    return { ...base, status: decision.requiresApproval ? "needs_confirmation" : "blocked" };
  }

  const execution = await executeSupportedAction(orgContext, resource, action, input);
  const eventId = await auditBrokerEvent(orgContext, resource, action, {
    mode: "execute",
    surface: request.surface,
    surfaceId: request.surfaceId,
    executionId: execution?.executionId,
  });

  return {
    ...base,
    status: "executed",
    execution,
    audit: { eventId, generatedAt },
  };
}
