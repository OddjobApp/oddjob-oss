import { describe, expect, it } from "vitest";
import {
  classifyReadOnly,
  PROPOSAL_TOOLS,
  CrewToolsService,
} from "../crew-tools.service.js";
import { ASSEMBLY_TOOLS } from "@domain/tools/v1/capabilities/assembly-tools.js";

describe("CREW Proposal Tier & Inline Approval (Tier 3.5)", () => {
  it("defines all core proposal tools in PROPOSAL_TOOLS", () => {
    expect(PROPOSAL_TOOLS.has("propose_mission")).toBe(true);
    expect(PROPOSAL_TOOLS.has("propose_mission_synthesis")).toBe(true);
    expect(PROPOSAL_TOOLS.has("propose_research_mission")).toBe(true);
    expect(PROPOSAL_TOOLS.has("propose_cycle_draft")).toBe(true);
  });

  it("classifies proposal tools as 'proposal' reason in classifyReadOnly", () => {
    const fakeProposalDef: any = {
      name: "propose_mission",
      label: "Propose Mission",
      riskLevel: "low",
      idempotency: "read-safe",
    };
    const reason = classifyReadOnly(fakeProposalDef);
    expect(reason).toBe("proposal");
  });

  it("propose_cycle_draft creates a draft with requester attribution and pending status", async () => {
    const tool = ASSEMBLY_TOOLS.propose_cycle_draft;
    expect(tool).toBeDefined();

    const resultStr = await tool.execute(
      {
        name: "Incident Auto-Remediation",
        reason: "Automatically mitigate webhook alerts",
        scaffoldPacks: ["auth-jwt", "observability-otel"],
        stages: [
          { id: "ingest", name: "Ingest Alert" },
          { id: "hil_gate", name: "HIL Governance Gate" },
        ],
      },
      {
        organizationId: 42,
        userId: "sec_lead_01",
      } as any
    );

    const result = JSON.parse(resultStr);
    expect(result.type).toBe("approval_request");
    expect(result.kind).toBe("cycle_draft");
    expect(result.cycleName).toBe("Incident Auto-Remediation");
    expect(result.status).toBe("pending");
    expect(result.requestedBy).toBe("sec_lead_01");
    expect(result.organizationId).toBe(42);
    expect(result.scaffoldPacks).toEqual(["auth-jwt", "observability-otel"]);
  });

  it("resolves proposal tools for agent cards without domain restrictions", async () => {
    const service = new CrewToolsService();
    const fakeCard: any = {
      id: 101,
      name: "Software Architect",
      tools: ["list_blueprints"],
    };

    const resolved = await service.resolveForCard(fakeCard);
    const resolvedNames = resolved.map((r) => r.definition.name);

    expect(resolvedNames).toContain("propose_mission");
    expect(resolvedNames).toContain("propose_cycle_draft");
    expect(resolvedNames).toContain("propose_research_mission");
    // Saving a wave plan is approval-gated the same way, so every agent can
    // offer it — the tool was registered but reachable by no card before.
    expect(resolvedNames).toContain("commit_project_plan_to_cycle");
    expect(resolved.find((r) => r.definition.name === "commit_project_plan_to_cycle")?.reason).toBe("proposal");
  });
});
