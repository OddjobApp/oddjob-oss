import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@server/database_service.js";
import {
  agentGovernanceAuditEvents,
  agentIdentities,
  agentPermissionGrants,
  type AgentIdentity,
  type AgentPermissionGrant,
  type NewAgentGovernanceAuditEvent,
} from "@shared/schema/index.js";
import {
  evaluateAutonomyPolicy,
  type AutonomyPolicyEvaluation,
  type AutonomyRiskLevel,
} from "@shared/governance/autonomy-policy.js";

export type AgentGovernanceDecision = "allow" | "deny" | "require_approval";

export interface AgentActionRequest {
  organizationId: number;
  agentId: string;
  environment?: string;
  runId?: string;
  initiatedBy?: string;
  tool: string;
  action: string;
  resource?: string;
  intent?: string;
  input?: unknown;
  metadata?: Record<string, unknown>;
}

export interface AgentGovernanceDecisionResult {
  decision: AgentGovernanceDecision;
  riskLevel: AutonomyRiskLevel;
  rationale: string;
  policyCodes: string[];
  matchedGrant?: AgentPermissionGrant;
  identity?: AgentIdentity;
  autonomyPolicy: AutonomyPolicyEvaluation;
}

export interface AgentGovernanceRepository {
  findIdentity(params: {
    organizationId: number;
    agentId: string;
    environment: string;
  }): Promise<AgentIdentity | undefined>;
  listGrants(agentIdentityId: string, organizationId: number): Promise<AgentPermissionGrant[]>;
  recordAudit(event: NewAgentGovernanceAuditEvent): Promise<void>;
}

class DrizzleAgentGovernanceRepository implements AgentGovernanceRepository {
  async findIdentity(params: {
    organizationId: number;
    agentId: string;
    environment: string;
  }): Promise<AgentIdentity | undefined> {
    const [identity] = await db
      .select()
      .from(agentIdentities)
      .where(and(
        eq(agentIdentities.organizationId, params.organizationId),
        eq(agentIdentities.agentId, params.agentId),
        eq(agentIdentities.environment, params.environment),
      ))
      .limit(1);

    return identity;
  }

  async listGrants(agentIdentityId: string, organizationId: number): Promise<AgentPermissionGrant[]> {
    return db
      .select()
      .from(agentPermissionGrants)
      .where(and(
        eq(agentPermissionGrants.organizationId, organizationId),
        eq(agentPermissionGrants.agentIdentityId, agentIdentityId),
      ));
  }

  async recordAudit(event: NewAgentGovernanceAuditEvent): Promise<void> {
    await db.insert(agentGovernanceAuditEvents).values(event);
  }
}

export class AgentIdentityGovernanceService {
  constructor(private readonly repository: AgentGovernanceRepository = new DrizzleAgentGovernanceRepository()) {}

  async decide(request: AgentActionRequest): Promise<AgentGovernanceDecisionResult> {
    const environment = request.environment ?? "prod";
    const resource = request.resource ?? "*";
    const identity = await this.repository.findIdentity({
      organizationId: request.organizationId,
      agentId: request.agentId,
      environment,
    });

    const autonomyPolicy = evaluateAutonomyPolicy({
      domain: "tool",
      action: `${request.tool}.${request.action}`,
      targetLabel: resource,
      instruction: request.intent,
      metadata: request.metadata,
    });

    if (!identity) {
      const result = this.buildResult({
        decision: "deny",
        riskLevel: "high",
        rationale: `No active agent identity exists for ${request.agentId} in ${environment}.`,
        policyCodes: ["agent_identity_missing", ...autonomyPolicy.flags.map(flag => flag.code)],
        autonomyPolicy,
      });
      await this.audit(request, result, identity);
      return result;
    }

    if (identity.status !== "active") {
      const result = this.buildResult({
        decision: "deny",
        riskLevel: maxRisk(identity.riskLevel as AutonomyRiskLevel, "medium"),
        rationale: `Agent identity is ${identity.status}; only active identities may execute governed actions.`,
        policyCodes: ["agent_identity_inactive", ...autonomyPolicy.flags.map(flag => flag.code)],
        autonomyPolicy,
        identity,
      });
      await this.audit(request, result, identity);
      return result;
    }

    const grants = await this.repository.listGrants(identity.id, request.organizationId);
    const grant = selectBestGrant(grants, request.tool, request.action, resource);

    if (!grant) {
      const result = this.buildResult({
        decision: "deny",
        riskLevel: maxRisk(identity.riskLevel as AutonomyRiskLevel, "medium"),
        rationale: `No permission grant allows ${request.tool}.${request.action} on ${resource}.`,
        policyCodes: ["permission_grant_missing", ...autonomyPolicy.flags.map(flag => flag.code)],
        autonomyPolicy,
        identity,
      });
      await this.audit(request, result, identity);
      return result;
    }

    if (grant.effect === "deny") {
      const result = this.buildResult({
        decision: "deny",
        riskLevel: maxRisk(identity.riskLevel as AutonomyRiskLevel, "high"),
        rationale: `Permission grant explicitly denies ${request.tool}.${request.action} on ${resource}.`,
        policyCodes: ["permission_grant_denied", ...autonomyPolicy.flags.map(flag => flag.code)],
        matchedGrant: grant,
        autonomyPolicy,
        identity,
      });
      await this.audit(request, result, identity);
      return result;
    }

    if (grantExpired(grant)) {
      const result = this.buildResult({
        decision: "deny",
        riskLevel: "medium",
        rationale: `Permission grant for ${request.tool}.${request.action} has expired.`,
        policyCodes: ["permission_grant_expired", ...autonomyPolicy.flags.map(flag => flag.code)],
        matchedGrant: grant,
        autonomyPolicy,
        identity,
      });
      await this.audit(request, result, identity);
      return result;
    }

    const requiresApproval = grant.requiresApproval || autonomyPolicy.decision === "review";
    const blockedByAutonomyPolicy = autonomyPolicy.decision === "block";
    const decision: AgentGovernanceDecision = blockedByAutonomyPolicy
      ? "deny"
      : requiresApproval
        ? "require_approval"
        : "allow";

    const result = this.buildResult({
      decision,
      riskLevel: maxRisk(identity.riskLevel as AutonomyRiskLevel, autonomyPolicy.maxRiskLevel),
      rationale: buildDecisionRationale(decision, grant, autonomyPolicy),
      policyCodes: [
        decision === "allow" ? "permission_grant_allowed" : decision === "require_approval" ? "approval_required" : "autonomy_policy_blocked",
        ...autonomyPolicy.flags.map(flag => flag.code),
      ],
      matchedGrant: grant,
      autonomyPolicy,
      identity,
    });

    await this.audit(request, result, identity);
    return result;
  }

  private buildResult(result: AgentGovernanceDecisionResult): AgentGovernanceDecisionResult {
    return result;
  }

  private async audit(
    request: AgentActionRequest,
    result: AgentGovernanceDecisionResult,
    identity?: AgentIdentity,
  ): Promise<void> {
    await this.repository.recordAudit({
      organizationId: request.organizationId,
      agentIdentityId: identity?.id,
      agentId: request.agentId,
      runId: request.runId,
      initiatedBy: request.initiatedBy,
      tool: request.tool,
      action: request.action,
      resource: request.resource ?? "*",
      decision: result.decision,
      riskLevel: result.riskLevel,
      policyCodes: result.policyCodes,
      inputHash: stableHash(request.input),
      status: "recorded",
      metadata: {
        environment: request.environment ?? "prod",
        rationale: result.rationale,
        grantId: result.matchedGrant?.id,
        autonomyDecision: result.autonomyPolicy.decision,
        autonomyRationale: result.autonomyPolicy.rationale,
      },
    });
  }
}

export function selectBestGrant(
  grants: AgentPermissionGrant[],
  tool: string,
  action: string,
  resource: string,
): AgentPermissionGrant | undefined {
  const matches = grants.filter((grant) =>
    matchesPattern(grant.tool, tool)
    && matchesPattern(grant.action, action)
    && matchesPattern(grant.resource, resource)
  );

  const active = matches.filter((grant) => !grantExpired(grant));
  const denied = active.find((grant) => grant.effect === "deny");
  if (denied) return denied;

  return active.sort((a, b) => grantSpecificity(b) - grantSpecificity(a))[0];
}

function grantExpired(grant: AgentPermissionGrant): boolean {
  return !!grant.expiresAt && grant.expiresAt.getTime() <= Date.now();
}

function matchesPattern(pattern: string, value: string): boolean {
  return pattern === "*" || pattern === value || (pattern.endsWith("*") && value.startsWith(pattern.slice(0, -1)));
}

function grantSpecificity(grant: AgentPermissionGrant): number {
  return [grant.tool, grant.action, grant.resource].reduce((score, value) => {
    if (value === "*") return score;
    if (value.endsWith("*")) return score + 1;
    return score + 2;
  }, 0);
}

function buildDecisionRationale(
  decision: AgentGovernanceDecision,
  grant: AgentPermissionGrant,
  autonomyPolicy: AutonomyPolicyEvaluation,
): string {
  if (decision === "allow") {
    return `Allowed by permission grant ${grant.id}. ${autonomyPolicy.rationale}`;
  }

  if (decision === "require_approval") {
    return `Human approval is required by ${grant.requiresApproval ? `permission grant ${grant.id}` : "shared autonomy policy"}. ${autonomyPolicy.rationale}`;
  }

  return `Denied by shared autonomy policy. ${autonomyPolicy.rationale}`;
}

function stableHash(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return `sha256:${createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function maxRisk(a: AutonomyRiskLevel, b: AutonomyRiskLevel): AutonomyRiskLevel {
  const rank: Record<AutonomyRiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };
  return rank[a] >= rank[b] ? a : b;
}

export const agentIdentityGovernanceService = new AgentIdentityGovernanceService();
