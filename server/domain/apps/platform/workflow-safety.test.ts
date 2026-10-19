import { describe, expect, it } from "vitest";
import { evaluateQualityEvidence, requireLaunchedMission, validateReleaseEvidence } from "../../../blueprints/apps/sdlc-workbench/lib/workflow-safety";

const sha = "a".repeat(40);
const suite = { status: "passed", evidenceKind: "runner", commitSha: sha, runId: "build-32", resultUrl: "https://ci.example.test/build/32", passCount: 8, failCount: 0, coveragePercent: 83 };
describe("SDLC workflow trust checks", () => {
  it("fails closed for empty, synthetic, mismatched and invalid coverage evidence", () => {
    expect(evaluateQualityEvidence([], [], sha).passed).toBe(false);
    for (const change of [{ evidenceKind: undefined }, { commitSha: "b".repeat(40) }, { resultUrl: undefined }, { passCount: 0 }, { coveragePercent: NaN }, { coveragePercent: 150 }]) {
      expect(evaluateQualityEvidence([{ ...suite, ...change }], [], sha).passed).toBe(false);
    }
    expect(evaluateQualityEvidence([suite], [{ status: "open", severity: "Critical" }], sha).passed).toBe(false);
    expect(evaluateQualityEvidence([suite], [], sha).passed).toBe(true);
  });
  it("never reports a queued or malformed receipt as a launched mission", () => {
    expect(() => requireLaunchedMission({ status: "queued", runId: null, outboxRecordId: "op-1" })).toThrow(/op-1/);
    expect(() => requireLaunchedMission({ status: "launched", runId: null })).toThrow();
    expect(requireLaunchedMission({ status: "launched", runId: 13 })).toBe(13);
  });
  it("requires saved approvals linked to the same tested release revision", () => {
    const ctx = { commitSha: sha, uatSignoffId: "uat-1", qualityGateId: "gate-1" };
    const cab = { decision: "approve", ...ctx };
    const uat = { status: "approved", commitSha: sha };
    const gate = { result: "pass", commitSha: sha, evidenceKind: "runner", suiteCount: 1 };
    expect(validateReleaseEvidence(ctx, cab, uat, gate)).toBeNull();
    expect(validateReleaseEvidence(ctx, null, uat, gate)).toMatch(/CAB/);
    expect(validateReleaseEvidence(ctx, cab, { ...uat, commitSha: "b".repeat(40) }, gate)).toMatch(/UAT/);
    expect(validateReleaseEvidence(ctx, cab, uat, { ...gate, suiteCount: 0 })).toMatch(/quality gate/);
  });
});
