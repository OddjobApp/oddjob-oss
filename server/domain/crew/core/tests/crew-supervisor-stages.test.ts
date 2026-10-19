import { describe, expect, it, vi } from "vitest";
import { crewSupervisorService } from "../crew-supervisor.service.js";
import { crewGenerationService } from "../crew-generation.service.js";

describe("CrewSupervisorService Stage Gating & Lineage (Phase 4)", () => {
  it("includes active stage context in supervisor review prompt", async () => {
    let capturedUserPrompt = "";

    vi.spyOn(crewGenerationService, "generate").mockImplementation(async (_card, _orgId, messages) => {
      const userMsg = messages.find(m => m.role === "user");
      capturedUserPrompt = userMsg?.content || "";
      return {
        content: JSON.stringify({
          directive: "@Copilot, let's configure the Scaffold & Feature Pack Architecture first before discussing downstream pipelines.",
          activeTopic: "Foundational Scaffold Selection",
          nextSteps: "Select core host, DB ORM, and Auth packs",
          consensusLevel: 85,
          positions: [{ agent: "Copilot", proposition: "Configure Node Express and JWT", confidence: 90 }],
          critique: "Prematurely debating pipeline triggers without defining database schema.",
          consensus: "Agree on Postgres Drizzle ORM.",
          summary: "Team converged on foundational runtime stack.",
          notes: ["Node Express + Postgres Drizzle chosen."],
          intents: ["Verify Auth token expiration SLA."],
          plan: null,
          stageGating: {
            status: "redirect_needed",
            activeStageId: "stage-scaffold",
            redirectReason: "Focus required on foundational host and auth before pipeline triggers."
          }
        }),
        latencyMs: 120,
        modelName: "test-model",
        providerId: 1,
        modelId: 1,
        modelIdentifier: "test-model",
        isFallback: false,
        toolCalls: []
      };
    });

    const result = await crewSupervisorService.review(
      1,
      "Creation Studio Architecture Assembly",
      [
        { speaker: "Copilot", speakerType: "agent", content: "Should we add a webhook trigger for Step 4?" },
        { speaker: "Sentinel", speakerType: "agent", content: "We haven't chosen our database or auth packs yet." }
      ],
      [{ name: "Copilot", description: "Workflow Architect" }, { name: "Sentinel", description: "Security Guard" }],
      "",
      {
        blueprintId: "bp-incident-response",
        activeStageId: "stage-scaffold",
        activeStageName: "Scaffold & Feature Pack Architecture",
        verifiedStages: [],
        blockedStages: ["stage-pipeline", "stage-hil-governance"]
      }
    );

    expect(capturedUserPrompt).toContain("ACTIVE ASSEMBLY BLUEPRINT STAGE CONTEXT:");
    expect(capturedUserPrompt).toContain("Scaffold & Feature Pack Architecture (UNBLOCKED & ACTIVE)");
    expect(capturedUserPrompt).toContain("Blocked Downstream Stages: stage-pipeline, stage-hil-governance");

    expect(result).not.toBeNull();
    expect(result?.stageGating).toBeDefined();
    expect(result?.stageGating?.status).toBe("redirect_needed");
    expect(result?.stageGating?.activeStageId).toBe("stage-scaffold");
    expect(result?.directive).toContain("@Copilot");
  });

  it("handles standard review without stageContext backwards-compatibly", async () => {
    vi.spyOn(crewGenerationService, "generate").mockImplementation(async () => ({
      content: JSON.stringify({
        directive: "@Sentinel, please confirm the risk posture.",
        activeTopic: "General Discussion",
        nextSteps: "Proceed to review",
        consensusLevel: 90,
        positions: [],
        critique: "None",
        consensus: "Full consensus",
        summary: "General debate complete.",
        notes: [],
        intents: [],
        plan: null
      }),
      latencyMs: 80,
      modelName: "test-model",
      providerId: 1,
      modelId: 1,
      modelIdentifier: "test-model",
      isFallback: false,
      toolCalls: []
    }));

    const result = await crewSupervisorService.review(
      1,
      "General Working Group",
      [{ speaker: "Sentinel", speakerType: "agent", content: "All clear.", toolsUsed: [{ name: 'scaffold_multistep_app', ok: false, error: 'invalid arguments' }] }],
      [{ name: "Sentinel", description: "Security Lead" }]
    );

    expect(result).not.toBeNull();
    expect(result?.directive).toContain("@Sentinel");
    expect(result?.stageGating).toBeNull();
    const prompt = vi.mocked(crewGenerationService.generate).mock.calls.at(-1)?.[2].find(m => m.role === 'user')?.content;
    expect(prompt).toContain('scaffold_multistep_app: FAILED (invalid arguments)');
    expect(prompt).toContain('Agreement about an error is not successful progress');
  });
});
