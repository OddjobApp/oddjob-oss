/**
 * Property Test: Verification report aggregation consistency (Property 10)
 *
 * Feature: autonomous-codegen-pipelines, Property 10: Verification report aggregation consistency
 *
 * For any sequence of `StepVerificationResult` entries aggregated into a
 * `VerificationReport`, the `summary.totalChecks` SHALL equal the sum of all
 * individual check counts across all steps, AND `summary.passed + summary.failed`
 * SHALL equal `summary.totalChecks`.
 *
 * **Validates: Requirements 4.6**
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";
import {
  incrementalVerifierService,
  type CheckRunner,
  type CheckRunnerResult,
} from "../../autonomous/incremental-verifier.service.js";
import type {
  FileOperation,
  VerificationLevel,
  ImpactAnalysis,
} from "../../core/types.js";

// ─── Arbitraries ────────────────────────────────────────────────────────────

/**
 * Generates a random file operation for use in verifyStep calls.
 */
const fileOperationArb = (index: number): fc.Arbitrary<FileOperation> =>
  fc
    .tuple(
      fc.constantFrom("create" as const, "modify" as const, "delete" as const),
      fc.stringMatching(/^[a-z][a-z0-9\-]{1,10}$/),
      fc.constantFrom(".ts", ".js", ".tsx")
    )
    .map(([type, name, ext]) => ({
      id: `op-${index}`,
      type,
      filePath: `src/${name}${ext}`,
      dependsOn: [],
      rationale: "test operation",
    }));

/**
 * Generates a verification level that actually runs checks (excludes "none").
 */
const verificationLevelArb: fc.Arbitrary<VerificationLevel> = fc.constantFrom(
  "lint_only" as const,
  "type_check" as const,
  "full_test" as const
);

/**
 * Generates a random impact analysis stub.
 */
const impactAnalysisArb: fc.Arbitrary<ImpactAnalysis> = fc
  .array(fc.stringMatching(/^tests\/[a-z]{2,8}\.test\.ts$/), { minLength: 0, maxLength: 3 })
  .map((testFiles) => ({
    affectedTestFiles: testFiles,
    affectedSourceFiles: [],
    traceDepth: 3,
    confidence: "high" as const,
    fullSuiteFallback: false,
  }));

/**
 * Generates a random boolean for whether a check should pass or fail.
 */
const checkPassArb: fc.Arbitrary<boolean> = fc.boolean();

/**
 * Generates a sequence of operation configurations:
 * each element defines a verification level, impact analysis, and per-check pass/fail outcomes.
 */
const stepConfigArb: fc.Arbitrary<
  Array<{
    level: VerificationLevel;
    impact: ImpactAnalysis;
    lintPass: boolean;
    typeCheckPass: boolean;
    testPass: boolean;
  }>
> = fc.array(
  fc.tuple(
    verificationLevelArb,
    impactAnalysisArb,
    checkPassArb,
    checkPassArb,
    checkPassArb
  ).map(([level, impact, lintPass, typeCheckPass, testPass]) => ({
    level,
    impact,
    lintPass,
    typeCheckPass,
    testPass,
  })),
  { minLength: 1, maxLength: 10 }
);

// ─── Helpers ────────────────────────────────────────────────────────────────

let sessionCounter = 0;
function uniqueSessionId(): string {
  return `prop10-${Date.now()}-${++sessionCounter}`;
}

/**
 * Count how many checks a given verification level produces.
 */
function checksForLevel(level: VerificationLevel): number {
  switch (level) {
    case "none":
      return 0;
    case "lint_only":
      return 1;
    case "type_check":
      return 2;
    case "full_test":
      return 3;
  }
}

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("Feature: autonomous-codegen-pipelines, Property 10: Verification report aggregation consistency", () => {
  beforeEach(() => {
    // Reset runners to stubs between tests (will be reconfigured per property run)
    incrementalVerifierService.configure({
      lintRunner: { async run() { return { passed: true, errors: [], duration: 1 }; } },
      typeCheckRunner: { async run() { return { passed: true, errors: [], duration: 1 }; } },
      testRunner: { async run() { return { passed: true, errors: [], duration: 1 }; } },
    });
  });

  it("summary.totalChecks equals the sum of individual check counts across all steps", async () => {
    await fc.assert(
      fc.asyncProperty(stepConfigArb, async (steps) => {
        const sessionId = uniqueSessionId();

        // Track expected total checks based on verification levels
        let expectedTotalChecks = 0;

        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];

          // Configure runners with the pass/fail outcomes for this step
          const lintRunner: CheckRunner = {
            async run(): Promise<CheckRunnerResult> {
              return { passed: step.lintPass, errors: step.lintPass ? [] : [{ file: "test.ts", message: "lint error", severity: "error" }], duration: 1 };
            },
          };
          const typeCheckRunner: CheckRunner = {
            async run(): Promise<CheckRunnerResult> {
              return { passed: step.typeCheckPass, errors: step.typeCheckPass ? [] : [{ file: "test.ts", message: "type error", severity: "error" }], duration: 1 };
            },
          };
          const testRunner: CheckRunner = {
            async run(): Promise<CheckRunnerResult> {
              return { passed: step.testPass, errors: step.testPass ? [] : [{ file: "test.ts", message: "test failed", severity: "error" }], duration: 1 };
            },
          };

          incrementalVerifierService.configure({ lintRunner, typeCheckRunner, testRunner });

          const operation: FileOperation = {
            id: `op-${i}`,
            type: "create",
            filePath: `src/file-${i}.ts`,
            dependsOn: [],
            rationale: "test operation",
          };

          const impact: ImpactAnalysis = step.impact;

          await incrementalVerifierService.verifyStep(sessionId, operation, step.level, impact);

          expectedTotalChecks += checksForLevel(step.level);
        }

        // Get the cumulative report
        const report = await incrementalVerifierService.getCumulativeReport(sessionId);

        // Verify: summary.totalChecks equals sum of all individual check counts
        expect(report.summary.totalChecks).toBe(expectedTotalChecks);

        // Cleanup
        incrementalVerifierService.clearSession(sessionId);
      }),
      { numRuns: 100 }
    );
  });

  it("summary.passed + summary.failed === summary.totalChecks", async () => {
    await fc.assert(
      fc.asyncProperty(stepConfigArb, async (steps) => {
        const sessionId = uniqueSessionId();

        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];

          // Configure runners with the pass/fail outcomes for this step
          const lintRunner: CheckRunner = {
            async run(): Promise<CheckRunnerResult> {
              return { passed: step.lintPass, errors: step.lintPass ? [] : [{ file: "test.ts", message: "lint error", severity: "error" }], duration: 1 };
            },
          };
          const typeCheckRunner: CheckRunner = {
            async run(): Promise<CheckRunnerResult> {
              return { passed: step.typeCheckPass, errors: step.typeCheckPass ? [] : [{ file: "test.ts", message: "type error", severity: "error" }], duration: 1 };
            },
          };
          const testRunner: CheckRunner = {
            async run(): Promise<CheckRunnerResult> {
              return { passed: step.testPass, errors: step.testPass ? [] : [{ file: "test.ts", message: "test failed", severity: "error" }], duration: 1 };
            },
          };

          incrementalVerifierService.configure({ lintRunner, typeCheckRunner, testRunner });

          const operation: FileOperation = {
            id: `op-${i}`,
            type: "modify",
            filePath: `src/module-${i}.ts`,
            dependsOn: [],
            rationale: "test operation",
          };

          const impact: ImpactAnalysis = step.impact;

          await incrementalVerifierService.verifyStep(sessionId, operation, step.level, impact);
        }

        // Get the cumulative report
        const report = await incrementalVerifierService.getCumulativeReport(sessionId);

        // Verify: passed + failed === totalChecks
        expect(report.summary.passed + report.summary.failed).toBe(
          report.summary.totalChecks
        );

        // Cleanup
        incrementalVerifierService.clearSession(sessionId);
      }),
      { numRuns: 100 }
    );
  });

  it("both invariants hold simultaneously for any step sequence", async () => {
    await fc.assert(
      fc.asyncProperty(stepConfigArb, async (steps) => {
        const sessionId = uniqueSessionId();

        let expectedTotalChecks = 0;
        let expectedPassed = 0;
        let expectedFailed = 0;

        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];

          // Configure runners with the pass/fail outcomes for this step
          const lintRunner: CheckRunner = {
            async run(): Promise<CheckRunnerResult> {
              return { passed: step.lintPass, errors: step.lintPass ? [] : [{ file: "test.ts", message: "lint error", severity: "error" }], duration: 1 };
            },
          };
          const typeCheckRunner: CheckRunner = {
            async run(): Promise<CheckRunnerResult> {
              return { passed: step.typeCheckPass, errors: step.typeCheckPass ? [] : [{ file: "test.ts", message: "type error", severity: "error" }], duration: 1 };
            },
          };
          const testRunner: CheckRunner = {
            async run(): Promise<CheckRunnerResult> {
              return { passed: step.testPass, errors: step.testPass ? [] : [{ file: "test.ts", message: "test failed", severity: "error" }], duration: 1 };
            },
          };

          incrementalVerifierService.configure({ lintRunner, typeCheckRunner, testRunner });

          const operation: FileOperation = {
            id: `op-combined-${i}`,
            type: "create",
            filePath: `src/combined-${i}.ts`,
            dependsOn: [],
            rationale: "combined test operation",
          };

          const impact: ImpactAnalysis = step.impact;

          await incrementalVerifierService.verifyStep(sessionId, operation, step.level, impact);

          // Compute expected counts based on what checks run at this level
          const numChecks = checksForLevel(step.level);
          expectedTotalChecks += numChecks;

          // Determine which checks run and their pass/fail based on level
          if (numChecks >= 1) {
            // lint runs
            if (step.lintPass) expectedPassed++;
            else expectedFailed++;
          }
          if (numChecks >= 2) {
            // type_check runs
            if (step.typeCheckPass) expectedPassed++;
            else expectedFailed++;
          }
          if (numChecks >= 3) {
            // unit_test runs
            if (step.testPass) expectedPassed++;
            else expectedFailed++;
          }
        }

        // Get the cumulative report
        const report = await incrementalVerifierService.getCumulativeReport(sessionId);

        // Invariant 1: totalChecks equals sum of individual check counts
        expect(report.summary.totalChecks).toBe(expectedTotalChecks);

        // Invariant 2: passed + failed === totalChecks
        expect(report.summary.passed + report.summary.failed).toBe(
          report.summary.totalChecks
        );

        // Bonus: verify individual counts match expected
        expect(report.summary.passed).toBe(expectedPassed);
        expect(report.summary.failed).toBe(expectedFailed);

        // Cleanup
        incrementalVerifierService.clearSession(sessionId);
      }),
      { numRuns: 100 }
    );
  });
});
