import { describe, expect, it } from "vitest";
import { calculateReliabilityEvidence, type ReliabilityRunInput } from "../core/mission-reliability-evidence.service.js";

function run(overrides: Partial<ReliabilityRunInput>): ReliabilityRunInput {
  return {
    id: 1,
    status: "completed",
    isSuccess: true,
    isShadow: false,
    missionContext: { environment: "production" },
    name: "Production mission",
    costUsd: "1.50",
    createdAt: new Date("2026-08-08T10:00:00.000Z"),
    updatedAt: new Date("2026-08-08T10:01:00.000Z"),
    approvalCount: 0,
    recoveryAttempted: false,
    ...overrides,
  };
}

describe("mission reliability evidence", () => {
  it("keeps demo and shadow runs out of production metrics", () => {
    const result = calculateReliabilityEvidence([
      run({ id: 1 }),
      run({ id: 2, name: "Golden Path demo", missionContext: { goldenPathFixture: "demo" } }),
      run({ id: 3, isShadow: true }),
    ], 9, 30);

    expect(result.cohorts.production.sampleSize).toBe(1);
    expect(result.cohorts.integration.sampleSize).toBe(2);
    expect(result.productionSampleSize).toBe(1);
  });

  it("reports separate completion, outcome, intervention, and recovery rates", () => {
    const result = calculateReliabilityEvidence([
      run({ id: 1 }),
      run({ id: 2, approvalCount: 1, recoveryAttempted: true }),
      run({ id: 3, status: "failed", isSuccess: false, recoveryAttempted: true }),
    ], 9, 30);
    const metrics = result.cohorts.production;

    expect(metrics.technicalCompletionRate).toBe(0.6667);
    expect(metrics.outcomeSuccessRate).toBe(0.6667);
    expect(metrics.autonomousSuccessRate).toBe(0.5);
    expect(metrics.humanInterventionRate).toBe(0.3333);
    expect(metrics.recoverySuccessRate).toBe(0.5);
    expect(metrics.averageCostPerCompletedRunUsd).toBe(1.5);
  });

  it("does not emit misleading percentages for empty samples", () => {
    const result = calculateReliabilityEvidence([], 9, 30);
    const metrics = result.cohorts.production;

    expect(metrics.technicalCompletionRate).toBeNull();
    expect(metrics.outcomeSuccessRate).toBeNull();
    expect(result.productionClaimsAllowed).toBe(false);
    expect(result.warnings).toContain("No production evidence exists in this reporting window.");
  });
});
