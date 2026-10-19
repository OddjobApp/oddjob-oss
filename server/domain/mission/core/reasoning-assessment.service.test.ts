import { describe, expect, it } from "vitest";
import { assessReasoningRun } from "./reasoning-assessment.service.js";

describe("assessReasoningRun", () => {
  it("keeps unsupported launch-only trajectories behind the promotion gate", () => {
    const result = assessReasoningRun({
      id: 10,
      missionContext: { intent: "Investigate the issue" },
      dynamicTrace: [{ type: "system", event: "mission_launched" }],
      status: "active",
    });

    expect(result.overallScore).toBeLessThan(65);
    expect(result.promotionGate.eligible).toBe(false);
    expect(result.critic.recommendations.length).toBeGreaterThan(0);
  });

  it("recognizes evidenced, adaptive, and verified trajectories", () => {
    const result = assessReasoningRun({
      id: 11,
      isSuccess: true,
      missionContext: {
        intent: "Diagnose and repair",
        objective: "Restore the workflow",
        plan: { tasks: ["inspect", "repair", "verify"] },
        executionPlan: { steps: 3 },
        successCriteria: ["tests pass"],
        rulesOfEngagement: { maxCycles: 5 },
        allowedTools: ["shell", "tests"],
      },
      dynamicTrace: [
        { event: "plan_created", evidence: "task graph" },
        { event: "tool_completed", tool: "inspect", output: "root cause" },
        { event: "error_detected", error: "bad state", evidence: "log line" },
        { event: "replan_applied", result: "recovery" },
        { event: "test_passed", result: "success", evidence: "test output" },
        { event: "audit_verified", result: "completed", evidence: "audit bundle" },
      ],
    });

    expect(result.overallScore).toBeGreaterThanOrEqual(80);
    expect(result.promotionGate.eligible).toBe(true);
    expect(result.learningCandidates.some((candidate) => candidate.type === "anti_pattern")).toBe(true);
  });
});
