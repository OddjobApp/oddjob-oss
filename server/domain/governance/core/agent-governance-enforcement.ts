import { createLogger } from "@server/utils/logger.js";
import { agentIdentityGovernanceService, type AgentActionRequest } from "./agent-identity-governance.service.js";
import { db } from "@server/database_service.js";
import { approvalRequests } from "@shared/schema/index.js";
import { and, eq } from "drizzle-orm";
import { decisionRouter } from "@domain/governor/core/decision-router.js";

const logger = createLogger("AgentGovernanceEnforcement");

export interface EnforcementContext {
  organizationId: number;
  userId?: string | number;
  agentId?: string | number;
  environment?: string;
  runId?: string | number;
  missionId?: number;
  missionRunId?: number;
  jobId?: number;
}

export interface EnforcementResult {
  allowed: boolean;
  decision: "allow" | "deny" | "require_approval" | "not_applicable";
  reason: string;
  approvalRequestId?: number;
}

/**
 * Runtime enforcement bridge for legacy execution paths.
 *
 * Fail-open when no agent identity is present so existing jobs continue to run
 * while identities are being backfilled. Once an agent identity is supplied,
 * decisions are enforced and audited by AgentIdentityGovernanceService.
 */
export async function enforceAgentGovernanceForTool(params: {
  toolName: string;
  action?: string;
  resource?: string;
  args?: unknown;
  intent?: string;
  context: EnforcementContext;
}): Promise<EnforcementResult> {
  const agentId = normalizeAgentId(params.context.agentId);
  if (!agentId) {
    return {
      allowed: true,
      decision: "not_applicable",
      reason: "No agent identity supplied; legacy execution path allowed.",
    };
  }

  const request: AgentActionRequest = {
    organizationId: params.context.organizationId,
    agentId,
    environment: params.context.environment ?? "prod",
    runId: normalizeRunId(params.context.runId ?? params.context.missionRunId),
    initiatedBy: params.context.userId != null ? String(params.context.userId) : undefined,
    tool: params.toolName,
    action: params.action ?? inferAction(params.toolName, params.args),
    resource: params.resource ?? inferResource(params.toolName, params.args),
    intent: params.intent,
    input: params.args,
    metadata: {
      missionId: params.context.missionId,
      missionRunId: params.context.missionRunId,
      jobId: params.context.jobId,
    },
  };

  const approvedRequestId = await findApprovedApprovalRequest(params, request);
  if (approvedRequestId) {
    return {
      allowed: true,
      decision: "allow",
      reason: `Allowed by approved governance request ${approvedRequestId}.`,
      approvalRequestId: approvedRequestId,
    };
  }

  const decision = await agentIdentityGovernanceService.decide(request);
  if (decision.decision === "allow") {
    return { allowed: true, decision: "allow", reason: decision.rationale };
  }

  if (decision.decision === "require_approval") {
    const routed = await decisionRouter.requestDecision({
      sessionId: `agent-governance-${agentId}-${Date.now()}`,
      jobId: params.context.jobId,
      executionId: request.runId ?? `agent-${agentId}`,
      tool: params.toolName,
      params: params.args ?? {},
      goal: params.intent ?? `Approve ${params.toolName}.${request.action} for agent ${agentId}`,
      description: decision.rationale,
      riskLevel: toDecisionRisk(decision.riskLevel),
      approverType: "internal",
      channels: ["inbox"],
      organizationId: params.context.organizationId,
      missionId: params.context.missionId,
      noWait: true,
      metadata: {
        source: "agent_governance",
        agentId,
        agentIdentityId: decision.identity?.id,
        tool: params.toolName,
        action: request.action,
        resource: request.resource,
        runId: request.runId,
        missionRunId: params.context.missionRunId,
        jobId: params.context.jobId,
        riskLevel: decision.riskLevel,
        policyCodes: decision.policyCodes,
        grantId: decision.matchedGrant?.id,
        rationale: decision.rationale,
      },
    });

    return {
      allowed: false,
      decision: "require_approval",
      reason: `Approval request ${routed.requestId ?? "pending"} created. ${decision.rationale}`,
      approvalRequestId: routed.requestId,
    };
  }

  logger.warn("Agent governance blocked or paused tool execution", {
    agentId,
    toolName: params.toolName,
    action: request.action,
    resource: request.resource,
    decision: decision.decision,
    reason: decision.rationale,
  });

  return {
    allowed: false,
    decision: decision.decision,
    reason: decision.rationale,
  };
}

async function findApprovedApprovalRequest(
  params: {
    toolName: string;
    args?: unknown;
    context: EnforcementContext;
  },
  request: AgentActionRequest,
): Promise<number | undefined> {
  const args = isRecord(params.args) ? params.args : {};
  const rawRequestId = args.approvalRequestId ?? args.approval_request_id ?? args.governanceApprovalRequestId;
  const requestId = typeof rawRequestId === "number" ? rawRequestId : typeof rawRequestId === "string" ? Number(rawRequestId) : NaN;
  if (!Number.isInteger(requestId) || requestId <= 0) return undefined;

  const token = args.approvalToken ?? args.approval_token;
  const [approval] = await db
    .select()
    .from(approvalRequests)
    .where(and(
      eq(approvalRequests.id, requestId),
      eq(approvalRequests.organizationId, params.context.organizationId),
      eq(approvalRequests.status, "approved"),
    ))
    .limit(1);

  if (!approval) return undefined;
  if (typeof token === "string" && token && token !== approval.token) return undefined;
  if (approval.toolName && approval.toolName !== params.toolName) return undefined;

  const governance = isRecord(approval.modifiedOutput) && isRecord(approval.modifiedOutput.governance)
    ? approval.modifiedOutput.governance
    : {};
  if (governance.source === "agent_governance") {
    if (governance.agentId && governance.agentId !== request.agentId) return undefined;
    if (governance.action && governance.action !== request.action) return undefined;
    if (governance.resource && governance.resource !== request.resource) return undefined;
  }

  return approval.id;
}

function toDecisionRisk(riskLevel: string): "low" | "medium" | "high" {
  if (riskLevel === "low") return "low";
  if (riskLevel === "medium") return "medium";
  return "high";
}

function normalizeAgentId(agentId: string | number | undefined): string | undefined {
  if (agentId == null) return undefined;
  const normalized = String(agentId).trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeRunId(runId: string | number | undefined): string | undefined {
  return runId == null ? undefined : String(runId);
}

function inferAction(toolName: string, args: unknown): string {
  const record = isRecord(args) ? args : {};
  const explicit = record.action ?? record.operation ?? record.method ?? record.type;
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim().toLowerCase();

  if (/delete|remove|purge|drop/i.test(toolName)) return "delete";
  if (/write|create|post|send|publish|deploy|merge|update/i.test(toolName)) return "write";
  return "read";
}

function inferResource(toolName: string, args: unknown): string {
  const record = isRecord(args) ? args : {};
  const candidate = record.resource ?? record.repo ?? record.projectKey ?? record.channelId ?? record.path ?? record.url ?? record.endpoint;
  if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  if (typeof candidate === "number") return String(candidate);
  return toolName;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
