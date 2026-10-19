import { describe, it, expect } from "vitest";
import { evaluateFromData } from "../autonomous/quality-gate.service.js";
import type {
  VerificationReport,
  VerificationEvent,
  TestLoopResult,
} from "../core/types.js";

// ─── Test Helpers ───────────────────────────────────────────────────────────

function makeVerificationReport(
  overrides: Partial<VerificationReport> = {}
): VerificationReport {
  return {
    sessionId: "test-session",
    verificationLevel: "full_test",
    timeline: [],
    summary: {
      totalChecks: 0,
      passed: 0,
      failed: 0,
      fixAttempts: 0,
      successfulFixes: 0,
      totalDuration: 0,
    },
    finalStatus: "all_passed",
    ...overrides,
  };
}

function makeVerificationEvent(
  overrides: Partial<VerificationEvent> = {}
): VerificationEvent {
  return {
    timestamp: new Date(),
    type: "step_check",
    status: "passed",
    details: {},
    duration: 100,
    ...overrides,
  };
}

function makeTestLoopResult(
  overrides: Partial<TestLoopResult> = {}
): TestLoopResult {
  return {
    status: "all_passed",
    totalAttempts: 1,
    fixAttempts: [],
    passingTests: ["test1.ts", "test2.ts"],
    failingTests: [],
    duration: 5000,
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("QualityGateService - evaluateFromData", () => {
  describe("passing scenarios", () => {
    it("should pass when all verifications passed and test loop status is all_passed", () => {
      const report = makeVerificationReport({
        timeline: [
          makeVerificationEvent({ status: "passed", operationId: "op-1" }),
          makeVerificationEvent({ status: "passed", operationId: "op-2" }),
        ],
      });
      const testLoop = makeTestLoopResult({ status: "all_passed" });

      const result = evaluateFromData(report, testLoop);

      expect(result.passed).toBe(true);
      expect(result.checks).toHaveLength(2);
      expect(result.checks.every((c) => c.passed)).toBe(true);
      expect(result.blockingFailures).toHaveLength(0);
      expect(result.evaluatedAt).toBeInstanceOf(Date);
    });

    it("should pass when verification events are skipped (not failed)", () => {
      const report = makeVerificationReport({
        timeline: [
          makeVerificationEvent({ status: "skipped", operationId: "op-1" }),
          makeVerificationEvent({ status: "passed", operationId: "op-2" }),
        ],
      });
      const testLoop = makeTestLoopResult({ status: "all_passed" });

      const result = evaluateFromData(report, testLoop);

      expect(result.passed).toBe(true);
      expect(result.blockingFailures).toHaveLength(0);
    });

    it("should pass with an empty timeline if test loop passed", () => {
      const report = makeVerificationReport({ timeline: [] });
      const testLoop = makeTestLoopResult({ status: "all_passed" });

      const result = evaluateFromData(report, testLoop);

      expect(result.passed).toBe(true);
    });
  });

  describe("failing scenarios - verification failures (Requirement 8.1, 8.2)", () => {
    it("should fail when any verification event has status 'failed'", () => {
      const report = makeVerificationReport({
        timeline: [
          makeVerificationEvent({ status: "passed", operationId: "op-1" }),
          makeVerificationEvent({ status: "failed", operationId: "op-2" }),
        ],
      });
      const testLoop = makeTestLoopResult({ status: "all_passed" });

      const result = evaluateFromData(report, testLoop);

      expect(result.passed).toBe(false);
      expect(result.blockingFailures.length).toBeGreaterThan(0);
      expect(result.blockingFailures[0].check).toBe("incremental_verifications");
      expect(result.blockingFailures[0].operationId).toBe("op-2");
    });

    it("should report all failed verifications as blocking failures", () => {
      const report = makeVerificationReport({
        timeline: [
          makeVerificationEvent({ status: "failed", operationId: "op-1" }),
          makeVerificationEvent({ status: "failed", operationId: "op-2" }),
          makeVerificationEvent({ status: "passed", operationId: "op-3" }),
        ],
      });
      const testLoop = makeTestLoopResult({ status: "all_passed" });

      const result = evaluateFromData(report, testLoop);

      expect(result.passed).toBe(false);
      const verificationFailures = result.blockingFailures.filter(
        (f) => f.check === "incremental_verifications"
      );
      expect(verificationFailures).toHaveLength(2);
    });
  });

  describe("failing scenarios - test loop failures (Requirement 8.3)", () => {
    it("should fail when test loop status is 'exhausted'", () => {
      const report = makeVerificationReport({
        timeline: [makeVerificationEvent({ status: "passed" })],
      });
      const testLoop = makeTestLoopResult({
        status: "exhausted",
        failingTests: ["failing.test.ts"],
      });

      const result = evaluateFromData(report, testLoop);

      expect(result.passed).toBe(false);
      const testFailures = result.blockingFailures.filter(
        (f) => f.check === "test_loop_completion"
      );
      expect(testFailures.length).toBeGreaterThan(0);
      expect(testFailures[0].testFile).toBe("failing.test.ts");
    });

    it("should fail when test loop status is 'partially_fixed'", () => {
      const report = makeVerificationReport({
        timeline: [makeVerificationEvent({ status: "passed" })],
      });
      const testLoop = makeTestLoopResult({
        status: "partially_fixed",
        failingTests: ["a.test.ts", "b.test.ts"],
      });

      const result = evaluateFromData(report, testLoop);

      expect(result.passed).toBe(false);
      const testFailures = result.blockingFailures.filter(
        (f) => f.check === "test_loop_completion"
      );
      expect(testFailures).toHaveLength(2);
    });

    it("should fail when test loop status is 'escalated'", () => {
      const report = makeVerificationReport({ timeline: [] });
      const testLoop = makeTestLoopResult({
        status: "escalated",
        failingTests: ["critical.test.ts"],
      });

      const result = evaluateFromData(report, testLoop);

      expect(result.passed).toBe(false);
    });
  });

  describe("combined failures", () => {
    it("should report both verification and test loop failures", () => {
      const report = makeVerificationReport({
        timeline: [
          makeVerificationEvent({ status: "failed", operationId: "op-1" }),
        ],
      });
      const testLoop = makeTestLoopResult({
        status: "exhausted",
        failingTests: ["failing.test.ts"],
      });

      const result = evaluateFromData(report, testLoop);

      expect(result.passed).toBe(false);
      expect(result.checks).toHaveLength(2);
      expect(result.checks.every((c) => !c.passed)).toBe(true);

      const verificationFailures = result.blockingFailures.filter(
        (f) => f.check === "incremental_verifications"
      );
      const testFailures = result.blockingFailures.filter(
        (f) => f.check === "test_loop_completion"
      );
      expect(verificationFailures.length).toBeGreaterThan(0);
      expect(testFailures.length).toBeGreaterThan(0);
    });
  });

  describe("result structure", () => {
    it("should always include evaluatedAt as a Date", () => {
      const report = makeVerificationReport();
      const testLoop = makeTestLoopResult();

      const result = evaluateFromData(report, testLoop);

      expect(result.evaluatedAt).toBeInstanceOf(Date);
    });

    it("should always have exactly two checks", () => {
      const report = makeVerificationReport();
      const testLoop = makeTestLoopResult();

      const result = evaluateFromData(report, testLoop);

      expect(result.checks).toHaveLength(2);
      expect(result.checks[0].name).toBe("incremental_verifications");
      expect(result.checks[1].name).toBe("test_loop_completion");
    });

    it("should include check descriptions", () => {
      const report = makeVerificationReport();
      const testLoop = makeTestLoopResult();

      const result = evaluateFromData(report, testLoop);

      for (const check of result.checks) {
        expect(check.description).toBeTruthy();
      }
    });

    it("should include details in each check", () => {
      const report = makeVerificationReport({
        timeline: [makeVerificationEvent({ status: "passed" })],
      });
      const testLoop = makeTestLoopResult({
        passingTests: ["a.test.ts"],
      });

      const result = evaluateFromData(report, testLoop);

      for (const check of result.checks) {
        expect(check.details).toBeTruthy();
      }
    });
  });
});
