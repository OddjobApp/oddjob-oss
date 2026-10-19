import { describe, it, expect, vi, beforeEach } from "vitest";
import { dspyOptimizerService } from "../core/dspy-optimizer.service.js";
import { cycleHILCoordinatorService } from "../../mission/core/cycle-hil-coordinator.service.js";
import { db } from "@server/database_service.js";
import { hilForms, operationalCycles } from "@shared/schema/index.js";

vi.mock("@server/database_service.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => [{ status: "completed", data: { "milestone-1": { answer: "yes" } } }])
      }))
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([{}])
      }))
    }))
  }
}));

describe("Closed-Loop DSPy Alignment (HIL-as-Reward)", () => {
  beforeEach(() => {
    dspyOptimizerService.clear();
    vi.clearAllMocks();
  });

  it("should initialize variants and successfully update reward score", async () => {
    const task = "milestone-1";
    // Initialize optimizer with variants
    await dspyOptimizerService.optimizePrompt(task, "System prompt");

    // Retrieve initial successRate
    const initialBest = dspyOptimizerService.getBestPrompt(task);
    expect(initialBest).toBeDefined();

    // Record high reward
    dspyOptimizerService.recordReward(task, `${task}-base`, 1.0);

    // Record low reward on another variant
    dspyOptimizerService.recordReward(task, `${task}-role`, 0.0);

    const stats = dspyOptimizerService.getStats();
    expect(stats.totalTasks).toBe(1);
  });

  it("should trigger reward recording when HIL coordinator resolves a request", async () => {
    const task = "milestone-1";
    await dspyOptimizerService.optimizePrompt(task, "System prompt");

    const recordRewardSpy = vi.spyOn(dspyOptimizerService, "recordReward");

    // Process HIL completed form
    await cycleHILCoordinatorService.processIfCompleted(
      100,
      200,
      1,
      {
        pending_hil_form_id: 200,
        hil_context: task
      }
    );

    expect(recordRewardSpy).toHaveBeenCalledWith(task, `${task}-base`, 1.0);
  });
});
