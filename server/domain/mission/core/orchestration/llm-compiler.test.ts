import { describe, it, expect, vi } from "vitest";
import { LLMCompilerOrchestratorService, TaskStep } from "./llm-compiler-orchestrator.service.js";
import { systemAiService } from "@domain/ai/core/system-ai.service.js";

vi.mock("@domain/ai/core/system-ai.service.js", () => ({
  systemAiService: {
    generateJson: vi.fn(),
  },
}));

describe("LLMCompilerOrchestratorService", () => {
  describe("computeWaves", () => {
    it("should sort independent steps into wave 1 and dependent steps into subsequent waves", () => {
      const steps: TaskStep[] = [
        { id: "step-1", name: "A", agentId: "agent-1", description: "desc A", dependsOn: [] },
        { id: "step-2", name: "B", agentId: "agent-2", description: "desc B", dependsOn: ["step-1"] },
        { id: "step-3", name: "C", agentId: "agent-3", description: "desc C", dependsOn: ["step-1"] },
        { id: "step-4", name: "D", agentId: "agent-4", description: "desc D", dependsOn: ["step-2", "step-3"] },
        { id: "step-5", name: "E", agentId: "agent-1", description: "desc E", dependsOn: [] },
      ];

      const waves = LLMCompilerOrchestratorService.computeWaves(steps);

      expect(waves.length).toBe(3);
      
      // Wave 1: step-1 and step-5 (no dependencies)
      const wave1Ids = waves[0].map(s => s.id);
      expect(wave1Ids).toContain("step-1");
      expect(wave1Ids).toContain("step-5");

      // Wave 2: step-2 and step-3 (depend on step-1)
      const wave2Ids = waves[1].map(s => s.id);
      expect(wave2Ids).toContain("step-2");
      expect(wave2Ids).toContain("step-3");

      // Wave 3: step-4 (depends on step-2 and step-3)
      const wave3Ids = waves[2].map(s => s.id);
      expect(wave3Ids).toEqual(["step-4"]);
    });
  });

  describe("compilePlan", () => {
    it("should call system AI to compile plan and return the steps", async () => {
      const mockSteps = [
        { id: "step-1", name: "Scouting", agentId: "scout", description: "Scout code", dependsOn: [] }
      ];
      vi.mocked(systemAiService.generateJson).mockResolvedValue({ steps: mockSteps });

      const plan = await LLMCompilerOrchestratorService.compilePlan("Scout the codebase", [{ id: "scout", name: "Scouter" }]);
      expect(plan.steps).toEqual(mockSteps);
      expect(systemAiService.generateJson).toHaveBeenCalled();
    });
  });

  describe("executePlan", () => {
    it("should execute steps wave by wave in correct topological order", async () => {
      const mockSteps = [
        { id: "step-1", name: "A", agentId: "a", description: "desc A", dependsOn: [] },
        { id: "step-2", name: "B", agentId: "b", description: "desc B", dependsOn: ["step-1"] }
      ];
      vi.mocked(systemAiService.generateJson).mockResolvedValue({ steps: mockSteps });

      const executedSteps: string[] = [];
      const executeStepFn = async (step: TaskStep) => {
        executedSteps.push(step.id);
      };

      await LLMCompilerOrchestratorService.executePlan(
        100,
        "Run the dynamic workflow",
        [{ id: "a", name: "Agent A" }, { id: "b", name: "Agent B" }],
        executeStepFn
      );

      expect(executedSteps).toEqual(["step-1", "step-2"]);
    });
  });
});
