import { describe, expect, it } from "vitest";
import { buildMissionEvaluationCase } from "./mission-evaluation-case.js";

describe("mission-driven evaluation case generation", () => {
  it("preserves successful mission objectives and measured outcomes", () => {
    const result = buildMissionEvaluationCase({
      id: 42, name: "Triage", objective: "Resolve the support queue", status: "completed",
      isSuccess: true, metricType: "resolution_rate", actualMetricValue: "0.93",
    });
    expect(result.inputPrompt).toBe("Resolve the support queue");
    expect(result.expectedCriteria).toContain("resolution_rate");
    expect(result.sourceMissionRunId).toBe(42);
  });

  it("turns mission failures into regression guards", () => {
    const result = buildMissionEvaluationCase({
      id: 7, name: "Import records", status: "failed", isSuccess: false, failureReason: "duplicate writes",
    });
    expect(result.expectedCriteria).toContain("avoid the prior failure: duplicate writes");
  });
});
