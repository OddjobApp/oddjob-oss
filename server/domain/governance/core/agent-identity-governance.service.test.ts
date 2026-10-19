import { describe, expect, it, vi } from "vitest";
import {
  AgentIdentityGovernanceService,
  selectBestGrant,
  type AgentGovernanceRepository,
} from "./agent-identity-governance.service.js";
import type { AgentIdentity, AgentPermissionGrant, NewAgentGovernanceAuditEvent } from "@shared/schema/index.js";

const identity: AgentIdentity = {
  id: "identity-1",
  organizationId: 291,
  agentId: "incident-triage",
  displayName: "Incident Triage",
  ownerId: "platform-ops",
  environment: "prod",
  status: "active",
  riskLevel: "medium",
  policyBundleId: "ops-default",
  metadata: {},
  createdBy: "admin2",
  lastReviewedAt: null,
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
};

function grant(overrides: Partial<AgentPermissionGrant> = {}): AgentPermissionGrant {
  return {
    id: "grant-1",
    organizationId: 291,
    agentIdentityId: "identity-1",
    tool: "jira",
    action: "create_issue",
    resource: "project:OPS",
    effect: "allow",
    requiresApproval: false,
    conditions: {},
    expiresAt: null,
    createdBy: "admin2",
    createdAt: new Date("2026-07-01T00:00:00Z"),
    ...overrides,
  };
}

function serviceWith(params: {
  foundIdentity?: AgentIdentity;
  grants?: AgentPermissionGrant[];
}) {
  const auditEvents: NewAgentGovernanceAuditEvent[] = [];
  const repository: AgentGovernanceRepository = {
    findIdentity: vi.fn(async () => params.foundIdentity),
    listGrants: vi.fn(async () => params.grants ?? []),
    recordAudit: vi.fn(async (event) => {
      auditEvents.push(event);
    }),
  };

  return {
    service: new AgentIdentityGovernanceService(repository),
    repository,
    auditEvents,
  };
}

const baseRequest = {
  organizationId: 291,
  agentId: "incident-triage",
  environment: "prod",
  runId: "run-123",
  initiatedBy: "admin2",
  tool: "jira",
  action: "create_issue",
  resource: "project:OPS",
  intent: "Create an internal incident ticket",
  input: { title: "Database latency" },
};

describe("AgentIdentityGovernanceService", () => {
  it("denies actions when the agent identity is missing", async () => {
    const { service, auditEvents } = serviceWith({});

    const result = await service.decide(baseRequest);

    expect(result.decision).toBe("deny");
    expect(result.policyCodes).toContain("agent_identity_missing");
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0].decision).toBe("deny");
    expect(auditEvents[0].inputHash).toMatch(/^sha256:/);
  });

  it("denies actions when the identity is not active", async () => {
    const { service } = serviceWith({
      foundIdentity: { ...identity, status: "suspended" },
      grants: [grant()],
    });

    const result = await service.decide(baseRequest);

    expect(result.decision).toBe("deny");
    expect(result.policyCodes).toContain("agent_identity_inactive");
  });

  it("allows explicitly granted low-risk actions", async () => {
    const { service, auditEvents } = serviceWith({
      foundIdentity: identity,
      grants: [grant()],
    });

    const result = await service.decide(baseRequest);

    expect(result.decision).toBe("allow");
    expect(result.policyCodes).toContain("permission_grant_allowed");
    expect(result.matchedGrant?.id).toBe("grant-1");
    expect(auditEvents[0].metadata).toMatchObject({
      grantId: "grant-1",
      autonomyDecision: "allow",
    });
  });

  it("requires approval when a matching grant requires approval", async () => {
    const { service } = serviceWith({
      foundIdentity: identity,
      grants: [grant({ requiresApproval: true })],
    });

    const result = await service.decide(baseRequest);

    expect(result.decision).toBe("require_approval");
    expect(result.policyCodes).toContain("approval_required");
  });

  it("requires approval for autonomy policy review actions", async () => {
    const { service } = serviceWith({
      foundIdentity: identity,
      grants: [grant({ tool: "slack", action: "post_message", resource: "channel:external-support" })],
    });

    const result = await service.decide({
      ...baseRequest,
      tool: "slack",
      action: "post_message",
      resource: "channel:external-support",
      intent: "Send message to external support channel",
    });

    expect(result.decision).toBe("require_approval");
    expect(result.policyCodes).toContain("external_commitment");
  });

  it("gives deny grants precedence over broad allow grants", () => {
    const selected = selectBestGrant([
      grant({ id: "allow-all", tool: "github", action: "*", resource: "*" }),
      grant({ id: "deny-merge", tool: "github", action: "merge_pr", resource: "repo:core", effect: "deny" }),
    ], "github", "merge_pr", "repo:core");

    expect(selected?.id).toBe("deny-merge");
  });
});
