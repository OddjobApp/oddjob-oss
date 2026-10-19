import { beforeEach, describe, expect, it, vi } from "vitest";
import { enforceAgentGovernanceForTool } from "./agent-governance-enforcement.js";
import { agentIdentityGovernanceService } from "./agent-identity-governance.service.js";
import { decisionRouter } from "@domain/governor/core/decision-router.js";

vi.mock("./agent-identity-governance.service.js", () => ({
  agentIdentityGovernanceService: {
    decide: vi.fn(),
  },
}));

vi.mock("@domain/governor/core/decision-router.js", () => ({
  decisionRouter: {
    requestDecision: vi.fn(),
  },
}));

vi.mock("@server/database_service.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([])),
        })),
      })),
    })),
  },
}));

const decideMock = vi.mocked(agentIdentityGovernanceService.decide);
const requestDecisionMock = vi.mocked(decisionRouter.requestDecision);

describe("enforceAgentGovernanceForTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows legacy execution when no agent identity is supplied", async () => {
    const result = await enforceAgentGovernanceForTool({
      toolName: "jira_search",
      args: { query: "project = OPS" },
      context: { organizationId: 291, userId: "admin2" },
    });

    expect(result.allowed).toBe(true);
    expect(result.decision).toBe("not_applicable");
    expect(decideMock).not.toHaveBeenCalled();
  });

  it("allows execution when identity governance allows it", async () => {
    decideMock.mockResolvedValueOnce({
      decision: "allow",
      riskLevel: "low",
      rationale: "Allowed by grant.",
      policyCodes: ["permission_grant_allowed"],
      autonomyPolicy: {
        decision: "allow",
        maxRiskLevel: "low",
        flags: [],
        requiredReview: [],
        rationale: "No risks.",
      },
    });

    const result = await enforceAgentGovernanceForTool({
      toolName: "jira",
      args: { action: "create_issue", projectKey: "OPS" },
      context: { organizationId: 291, userId: "admin2", agentId: "incident-triage", missionRunId: 42 },
    });

    expect(result.allowed).toBe(true);
    expect(result.decision).toBe("allow");
    expect(decideMock).toHaveBeenCalledWith(expect.objectContaining({
      agentId: "incident-triage",
      action: "create_issue",
      resource: "OPS",
      runId: "42",
    }));
  });

  it("blocks execution when identity governance denies it", async () => {
    decideMock.mockResolvedValueOnce({
      decision: "deny",
      riskLevel: "high",
      rationale: "No permission grant allows slack.post_message.",
      policyCodes: ["permission_grant_missing"],
      autonomyPolicy: {
        decision: "allow",
        maxRiskLevel: "low",
        flags: [],
        requiredReview: [],
        rationale: "No risks.",
      },
    });

    const result = await enforceAgentGovernanceForTool({
      toolName: "slack",
      args: { action: "post_message", channelId: "external" },
      context: { organizationId: 291, userId: "admin2", agentId: "incident-triage" },
    });

    expect(result.allowed).toBe(false);
    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("No permission grant");
  });

  it("creates an approval request when identity governance requires approval", async () => {
    decideMock.mockResolvedValueOnce({
      decision: "require_approval",
      riskLevel: "high",
      rationale: "Human approval is required by permission grant grant-1.",
      policyCodes: ["approval_required"],
      matchedGrant: { id: "grant-1" } as any,
      identity: { id: "identity-1" } as any,
      autonomyPolicy: {
        decision: "allow",
        maxRiskLevel: "low",
        flags: [],
        requiredReview: [],
        rationale: "No risks.",
      },
    });
    requestDecisionMock.mockResolvedValueOnce({
      approved: false,
      source: "db",
      requestId: 77,
    });

    const result = await enforceAgentGovernanceForTool({
      toolName: "slack",
      args: { action: "post_message", channelId: "external" },
      context: { organizationId: 291, userId: "admin2", agentId: "incident-triage", missionId: 12, jobId: 34 },
    });

    expect(result.allowed).toBe(false);
    expect(result.decision).toBe("require_approval");
    expect(result.approvalRequestId).toBe(77);
    expect(requestDecisionMock).toHaveBeenCalledWith(expect.objectContaining({
      tool: "slack",
      noWait: true,
      organizationId: 291,
      metadata: expect.objectContaining({
        source: "agent_governance",
        agentId: "incident-triage",
        agentIdentityId: "identity-1",
        grantId: "grant-1",
      }),
    }));
  });
});
