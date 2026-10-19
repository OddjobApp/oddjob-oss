import { describe, it, expect, vi, beforeEach } from "vitest";
import { crewSupervisorService } from "../core/crew-supervisor.service.js";
import { crewGenerationService } from "../core/crew-generation.service.js";

describe("Dynamic Supervisor Response Budget Expansion & User Deep-Dive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts and validates speakerBudgetOverride from supervisor output", async () => {
    const mockRawOutput = JSON.stringify({
      directive: "@LeadDeveloper write the complete Drizzle ORM schema",
      activeTopic: "Database Schema Architecture",
      nextSteps: "Scaffold tables",
      consensusLevel: 85,
      positions: [{ agent: "LeadDeveloper", proposition: "Postgres schema ready", confidence: 90 }],
      critique: "Solid approach",
      consensus: "Agreed on schema structure",
      summary: "Completed data modeling debate",
      notes: [],
      intents: [],
      plan: null,
      speakerBudgetOverride: {
        agentName: "LeadDeveloper",
        maxTokens: 2000,
        rationale: "code_scaffold"
      }
    });

    vi.spyOn(crewGenerationService, "generate").mockResolvedValue({ content: mockRawOutput } as any);

    const result = await crewSupervisorService.review(
      1,
      "Database Modeling",
      [{ speaker: "LeadDeveloper", speakerType: "agent", content: "I will provide the full schema." }],
      [{ id: 1, name: "LeadDeveloper" } as any],
      ""
    );

    expect(result).not.toBeNull();
    expect(result?.speakerBudgetOverride).toBeDefined();
    expect(result?.speakerBudgetOverride?.agentName).toBe("LeadDeveloper");
    expect(result?.speakerBudgetOverride?.maxTokens).toBe(2000);
    expect(result?.speakerBudgetOverride?.rationale).toBe("code_scaffold");
  });

  it("clamps out-of-bounds supervisor maxTokens to safe range [600, 2500]", async () => {
    const mockRawOutput = JSON.stringify({
      directive: "@StrategicOracle provide exhaustive synthesis",
      activeTopic: "Market Strategy",
      nextSteps: "Review trade-offs",
      consensusLevel: 60,
      positions: [{ agent: "StrategicOracle", proposition: "Evaluate 5 alternatives", confidence: 80 }],
      critique: "",
      consensus: "",
      summary: "",
      notes: [],
      intents: [],
      plan: null,
      speakerBudgetOverride: {
        agentName: "StrategicOracle",
        maxTokens: 9999, // Should be clamped to 2500
        rationale: "entropy_resolution"
      }
    });

    vi.spyOn(crewGenerationService, "generate").mockResolvedValue({ content: mockRawOutput } as any);

    const result = await crewSupervisorService.review(
      1,
      "Market Strategy",
      [{ speaker: "StrategicOracle", speakerType: "agent", content: "Let's resolve the split." }],
      [{ id: 2, name: "StrategicOracle" } as any],
      ""
    );

    expect(result?.speakerBudgetOverride?.maxTokens).toBe(2500);
    expect(result?.speakerBudgetOverride?.rationale).toBe("entropy_resolution");
  });

  it("returns null speakerBudgetOverride when supervisor deems normal turn sufficient", async () => {
    const mockRawOutput = JSON.stringify({
      directive: "@DataSentinel confirm test status",
      activeTopic: "QA Verification",
      nextSteps: "Run tests",
      consensusLevel: 90,
      positions: [{ agent: "DataSentinel", proposition: "All tests pass", confidence: 95 }],
      critique: "",
      consensus: "",
      summary: "",
      notes: [],
      intents: [],
      plan: null,
      speakerBudgetOverride: null
    });

    vi.spyOn(crewGenerationService, "generate").mockResolvedValue({ content: mockRawOutput } as any);

    const result = await crewSupervisorService.review(
      1,
      "QA Verification",
      [{ speaker: "DataSentinel", speakerType: "agent", content: "Tests are passing." }],
      [{ id: 3, name: "DataSentinel" } as any],
      ""
    );

    expect(result?.speakerBudgetOverride).toBeNull();
  });
});
