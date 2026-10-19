import { describe, it, expect, beforeEach } from "vitest";
import {
  createCommandCheckRunner,
  incrementalVerifierService,
} from "../autonomous/incremental-verifier.service.js";
import type {
  FileOperation,
  ImpactAnalysis,
  VerificationLevel,
} from "../core/types.js";

// ─── Test Helpers ───────────────────────────────────────────────────────────

function makeOperation(overrides: Partial<FileOperation> = {}): FileOperation {
  return {
    id: overrides.id ?? "op-1",
    type: overrides.type ?? "modify",
    filePath: overrides.filePath ?? "src/example.ts",
    dependsOn: overrides.dependsOn ?? [],
    rationale: overrides.rationale ?? "test operation",
    changes: overrides.changes,
    newContent: overrides.newContent,
  };
}

function makeImpactAnalysis(overrides: Partial<ImpactAnalysis> = {}): ImpactAnalysis {
  return {
    affectedTestFiles: overrides.affectedTestFiles ?? ["src/example.test.ts"],
    affectedSourceFiles: overrides.affectedSourceFiles ?? ["src/example.ts"],
    traceDepth: overrides.traceDepth ?? 3,
    confidence: overrides.confidence ?? "high",
    fullSuiteFallback: overrides.fullSuiteFallback ?? false,
  };
}

describe("IncrementalVerifierService", () => {
  const sessionId = "test-session-" + Date.now();

  beforeEach(() => {
    // Clear session results between tests to avoid contamination
    incrementalVerifierService.clearSession(sessionId);
  });

  // ─── getCumulativeReport Tests ──────────────────────────────────────────

  describe("getCumulativeReport", () => {
    it("should return in_progress status with all zeros when no results exist", async () => {
      const report = await incrementalVerifierService.getCumulativeReport(sessionId);

      expect(report.sessionId).toBe(sessionId);
      expect(report.finalStatus).toBe("in_progress");
      expect(report.summary.totalChecks).toBe(0);
      expect(report.summary.passed).toBe(0);
      expect(report.summary.failed).toBe(0);
      expect(report.summary.fixAttempts).toBe(0);
      expect(report.summary.successfulFixes).toBe(0);
      expect(report.summary.totalDuration).toBe(0);
      expect(report.timeline).toHaveLength(0);
      expect(report.verificationLevel).toBe("none");
    });

    it("should correctly aggregate mixed pass/fail results", async () => {
      // Configure with runners that produce mixed results
      let callCount = 0;
      incrementalVerifierService.configure({
        lintRunner: {
          async run() {
            callCount++;
            // First call passes, second fails
            return callCount <= 1
              ? { passed: true, errors: [], duration: 10 }
              : { passed: false, errors: [{ file: "x.ts", message: "lint error", severity: "error" as const }], duration: 15 };
          },
        },
        typeCheckRunner: {
          async run() {
            return { passed: true, errors: [], duration: 20 };
          },
        },
        testRunner: {
          async run() {
            return { passed: true, errors: [], duration: 30 };
          },
        },
      });

      // First operation - lint passes
      await incrementalVerifierService.verifyStep(
        sessionId,
        makeOperation({ id: "op-1" }),
        "lint_only",
        makeImpactAnalysis()
      );

      // Second operation - lint fails
      await incrementalVerifierService.verifyStep(
        sessionId,
        makeOperation({ id: "op-2", filePath: "src/other.ts" }),
        "lint_only",
        makeImpactAnalysis()
      );

      const report = await incrementalVerifierService.getCumulativeReport(sessionId);

      expect(report.finalStatus).toBe("has_failures");
      expect(report.summary.totalChecks).toBe(2);
      expect(report.summary.passed).toBe(1);
      expect(report.summary.failed).toBe(1);
      expect(report.summary.passed + report.summary.failed).toBe(report.summary.totalChecks);

      // Reset to stubs
      incrementalVerifierService.configure({
        lintRunner: { async run() { return { passed: true, errors: [], duration: 0 }; } },
        typeCheckRunner: { async run() { return { passed: true, errors: [], duration: 0 }; } },
        testRunner: { async run() { return { passed: true, errors: [], duration: 0 }; } },
      });
    });

    it("should produce chronological timeline entries", async () => {
      // Use stub runners that always pass
      incrementalVerifierService.configure({
        lintRunner: { async run() { return { passed: true, errors: [], duration: 5 }; } },
        typeCheckRunner: { async run() { return { passed: true, errors: [], duration: 5 }; } },
        testRunner: { async run() { return { passed: true, errors: [], duration: 5 }; } },
      });

      await incrementalVerifierService.verifyStep(
        sessionId,
        makeOperation({ id: "op-1" }),
        "lint_only",
        makeImpactAnalysis()
      );

      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));

      await incrementalVerifierService.verifyStep(
        sessionId,
        makeOperation({ id: "op-2" }),
        "lint_only",
        makeImpactAnalysis()
      );

      const report = await incrementalVerifierService.getCumulativeReport(sessionId);

      expect(report.timeline).toHaveLength(2);
      // Verify chronological ordering
      const t0 = report.timeline[0].timestamp.getTime();
      const t1 = report.timeline[1].timestamp.getTime();
      expect(t1).toBeGreaterThanOrEqual(t0);

      // Verify timeline event structure
      expect(report.timeline[0].type).toBe("step_check");
      expect(report.timeline[0].operationId).toBe("op-1");
      expect(report.timeline[1].operationId).toBe("op-2");
    });

    it("should compute arithmetically correct summary totals (passed + failed = totalChecks)", async () => {
      let lintCallCount = 0;
      incrementalVerifierService.configure({
        lintRunner: {
          async run() {
            lintCallCount++;
            return { passed: lintCallCount % 2 === 1, errors: lintCallCount % 2 === 0 ? [{ file: "x.ts", message: "err", severity: "error" as const }] : [], duration: 5 };
          },
        },
        typeCheckRunner: {
          async run() { return { passed: true, errors: [], duration: 10 }; }
        },
        testRunner: {
          async run() { return { passed: true, errors: [], duration: 15 }; }
        },
      });

      // Run 3 steps at type_check level (lint + type_check = 2 checks per step)
      for (let i = 0; i < 3; i++) {
        await incrementalVerifierService.verifyStep(
          sessionId,
          makeOperation({ id: `op-${i}` }),
          "type_check",
          makeImpactAnalysis()
        );
      }

      const report = await incrementalVerifierService.getCumulativeReport(sessionId);

      // 3 steps × 2 checks each = 6 total checks
      expect(report.summary.totalChecks).toBe(6);
      expect(report.summary.passed + report.summary.failed).toBe(report.summary.totalChecks);
      expect(report.summary.totalDuration).toBeGreaterThanOrEqual(0);

      // Reset
      incrementalVerifierService.configure({
        lintRunner: { async run() { return { passed: true, errors: [], duration: 0 }; } },
        typeCheckRunner: { async run() { return { passed: true, errors: [], duration: 0 }; } },
        testRunner: { async run() { return { passed: true, errors: [], duration: 0 }; } },
      });
    });

    it("should return all_passed when all checks pass", async () => {
      incrementalVerifierService.configure({
        lintRunner: { async run() { return { passed: true, errors: [], duration: 5 }; } },
        typeCheckRunner: { async run() { return { passed: true, errors: [], duration: 5 }; } },
        testRunner: { async run() { return { passed: true, errors: [], duration: 5 }; } },
      });

      await incrementalVerifierService.verifyStep(
        sessionId,
        makeOperation({ id: "op-1" }),
        "full_test",
        makeImpactAnalysis()
      );

      const report = await incrementalVerifierService.getCumulativeReport(sessionId);

      expect(report.finalStatus).toBe("all_passed");
      expect(report.summary.failed).toBe(0);
      expect(report.summary.passed).toBe(3); // lint + type_check + unit_test
    });

    it("should detect verification level from step results", async () => {
      incrementalVerifierService.configure({
        lintRunner: { async run() { return { passed: true, errors: [], duration: 5 }; } },
        typeCheckRunner: { async run() { return { passed: true, errors: [], duration: 5 }; } },
        testRunner: { async run() { return { passed: true, errors: [], duration: 5 }; } },
      });

      await incrementalVerifierService.verifyStep(
        sessionId,
        makeOperation({ id: "op-1" }),
        "full_test",
        makeImpactAnalysis()
      );

      const report = await incrementalVerifierService.getCumulativeReport(sessionId);
      expect(report.verificationLevel).toBe("full_test");
    });
  });

  // ─── verifyStep Tests ───────────────────────────────────────────────────

  describe("verifyStep", () => {
    beforeEach(() => {
      // Reset to stubs that always pass
      incrementalVerifierService.configure({
        lintRunner: { async run() { return { passed: true, errors: [], duration: 5 }; } },
        typeCheckRunner: { async run() { return { passed: true, errors: [], duration: 10 }; } },
        testRunner: { async run() { return { passed: true, errors: [], duration: 20 }; } },
      });
    });

    it("should return skipped status when verification level is none", async () => {
      const result = await incrementalVerifierService.verifyStep(
        sessionId,
        makeOperation({ id: "op-skip" }),
        "none",
        makeImpactAnalysis()
      );

      expect(result.status).toBe("skipped");
      expect(result.checks).toHaveLength(0);
      expect(result.duration).toBe(0);
      expect(result.operationId).toBe("op-skip");
    });

    it("should run only lint check at lint_only level", async () => {
      const result = await incrementalVerifierService.verifyStep(
        sessionId,
        makeOperation({ id: "op-lint" }),
        "lint_only",
        makeImpactAnalysis()
      );

      expect(result.status).toBe("passed");
      expect(result.checks).toHaveLength(1);
      expect(result.checks[0].type).toBe("lint");
      expect(result.checks[0].passed).toBe(true);
    });

    it("should run lint + type_check at type_check level", async () => {
      const result = await incrementalVerifierService.verifyStep(
        sessionId,
        makeOperation({ id: "op-tc" }),
        "type_check",
        makeImpactAnalysis()
      );

      expect(result.status).toBe("passed");
      expect(result.checks).toHaveLength(2);
      expect(result.checks[0].type).toBe("lint");
      expect(result.checks[1].type).toBe("type_check");
      expect(result.checks.every((c) => c.passed)).toBe(true);
    });

    it("should run lint + type_check + unit_test at full_test level", async () => {
      const result = await incrementalVerifierService.verifyStep(
        sessionId,
        makeOperation({ id: "op-full" }),
        "full_test",
        makeImpactAnalysis()
      );

      expect(result.status).toBe("passed");
      expect(result.checks).toHaveLength(3);
      expect(result.checks[0].type).toBe("lint");
      expect(result.checks[1].type).toBe("type_check");
      expect(result.checks[2].type).toBe("unit_test");
      expect(result.checks.every((c) => c.passed)).toBe(true);
    });

    it("should report failed status when any check fails", async () => {
      incrementalVerifierService.configure({
        lintRunner: { async run() { return { passed: true, errors: [], duration: 5 }; } },
        typeCheckRunner: {
          async run() {
            return {
              passed: false,
              errors: [{ file: "src/example.ts", line: 10, message: "Type error", severity: "error" as const }],
              duration: 10,
            };
          },
        },
        testRunner: { async run() { return { passed: true, errors: [], duration: 20 }; } },
      });

      const result = await incrementalVerifierService.verifyStep(
        sessionId,
        makeOperation({ id: "op-fail" }),
        "type_check",
        makeImpactAnalysis()
      );

      expect(result.status).toBe("failed");
      expect(result.checks[0].passed).toBe(true); // lint passes
      expect(result.checks[1].passed).toBe(false); // type_check fails
      expect(result.checks[1].errors).toBeDefined();
      expect(result.checks[1].errors).toHaveLength(1);
    });

    it("should fail on a real verification command error instead of stubbed success", async () => {
      incrementalVerifierService.configure({
        lintRunner: createCommandCheckRunner(
          `node -e "console.error('real lint failure'); process.exit(1)"`,
          "lint"
        ),
        typeCheckRunner: { async run() { return { passed: true, errors: [], duration: 0 }; } },
        testRunner: { async run() { return { passed: true, errors: [], duration: 0 }; } },
      });

      const result = await incrementalVerifierService.verifyStep(
        sessionId,
        makeOperation({ id: "op-real-fail" }),
        "lint_only",
        makeImpactAnalysis()
      );

      expect(result.status).toBe("failed");
      expect(result.checks[0].passed).toBe(false);
      expect(result.checks[0].errors?.[0].message).toContain("real lint failure");
    });

    it("should record the correct filePath and operationId", async () => {
      const result = await incrementalVerifierService.verifyStep(
        sessionId,
        makeOperation({ id: "unique-op-id", filePath: "src/my-module.ts" }),
        "lint_only",
        makeImpactAnalysis()
      );

      expect(result.operationId).toBe("unique-op-id");
      expect(result.filePath).toBe("src/my-module.ts");
    });

    it("should record a timestamp on the result", async () => {
      const before = new Date();
      const result = await incrementalVerifierService.verifyStep(
        sessionId,
        makeOperation({ id: "op-ts" }),
        "lint_only",
        makeImpactAnalysis()
      );
      const after = new Date();

      expect(result.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(result.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });
});
