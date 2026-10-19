/**
 * Property Test: Regression detection triggers revert (Property 9)
 *
 * Feature: autonomous-codegen-pipelines, Property 9: Regression detection triggers revert
 *
 * For any `FixAttemptRecord` where `newFailuresIntroduced` is non-empty
 * (contains at least one test name not failing before the fix), the record's
 * `outcome` SHALL be `'regression_detected'`.
 *
 * **Validates: Requirements 3.6**
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { testLoopControllerService } from "../../autonomous/test-loop-controller.service.js";
import type {
  TestRunner,
  TestRunResult,
  FailureDiagnoser,
  FixGenerator,
  FailingTest,
} from "../../autonomous/test-loop-controller.service.js";
import type {
  FixAttemptRecord,
  FailureDiagnosis,
  AppliedFix,
} from "../../core/types.js";

// ─── Arbitraries ────────────────────────────────────────────────────────────

/**
 * Generates a non-empty array of test file names that will initially fail.
 */
const failingTestNamesArb: fc.Arbitrary<string[]> = fc.array(
  fc.stringMatching(/^[a-z][a-z0-9\-]{1,12}\.test\.ts$/).map(
    (name) => `tests/${name}`
  ),
  { minLength: 1, maxLength: 5 }
);

/**
 * Generates a non-empty array of NEW test names introduced as regressions.
 * These must be distinct from the initially failing tests.
 */
const regressionTestNamesArb: fc.Arbitrary<string[]> = fc.array(
  fc.stringMatching(/^[a-z][a-z0-9\-]{1,12}\.regression\.test\.ts$/).map(
    (name) => `tests/${name}`
  ),
  { minLength: 1, maxLength: 3 }
);

/**
 * Generates a maxAttempts value (bounded to keep tests fast).
 */
const maxAttemptsArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: 5 });

// ─── Helpers ────────────────────────────────────────────────────────────────

let sessionCounter = 0;
function uniqueSessionId(): string {
  return `prop9-${Date.now()}-${++sessionCounter}`;
}

/**
 * Creates a test runner that:
 * - First call: reports `initialFailures` as failing
 * - Second call (post-fix): reports the original failures resolved but `regressionTests` as new failures
 * - Subsequent calls: same as second (regressions persist after revert since the fix is reverted)
 */
function createRegressionTestRunner(
  allTestFiles: string[],
  initialFailures: string[],
  regressionTests: string[]
): TestRunner {
  let callCount = 0;

  return {
    async run(testFiles: string[], _sessionId: string): Promise<TestRunResult> {
      callCount++;

      if (callCount === 1) {
        // Initial run: some tests fail
        const failingTests: FailingTest[] = initialFailures.map((tf) => ({
          testFile: tf,
          testName: `test in ${tf}`,
          errorMessage: `Assertion failed in ${tf}`,
          stackTrace: `at ${tf}:10:5`,
        }));
        const passingTests = allTestFiles.filter(
          (f) => !initialFailures.includes(f)
        );
        return {
          passed: false,
          passingTests,
          failingTests,
          output: "Some tests failed",
          duration: 10,
        };
      }

      // Post-fix run: original failures "fixed" but regressions introduced
      const failingTests: FailingTest[] = regressionTests.map((tf) => ({
        testFile: tf,
        testName: `test in ${tf}`,
        errorMessage: `Regression in ${tf}`,
        stackTrace: `at ${tf}:5:3`,
      }));
      const passingTests = allTestFiles.filter(
        (f) => !regressionTests.includes(f)
      );
      return {
        passed: failingTests.length === 0,
        passingTests,
        failingTests,
        output: "Regressions detected",
        duration: 10,
      };
    },
  };
}

/**
 * Simple diagnoser stub that produces a valid diagnosis.
 */
const stubDiagnoser: FailureDiagnoser = {
  async diagnose(
    failure: FailingTest,
    _testOutput: string,
    _sessionId: string
  ): Promise<FailureDiagnosis> {
    return {
      testFile: failure.testFile,
      testName: failure.testName,
      errorMessage: failure.errorMessage,
      stackTrace: failure.stackTrace,
      rootCause: `Root cause for ${failure.testFile}`,
      affectedFile: failure.testFile.replace(".test.", "."),
      suggestedApproach: "Apply targeted fix",
    };
  },
};

/**
 * Simple fix generator stub.
 */
const stubFixGenerator: FixGenerator = {
  async generateFix(
    diagnosis: FailureDiagnosis,
    _sessionId: string
  ): Promise<AppliedFix> {
    return {
      filePath: diagnosis.affectedFile,
      changes: [
        {
          startLine: 1,
          endLine: 1,
          originalCode: "",
          newCode: `// Fix for: ${diagnosis.rootCause}`,
          contextLines: 0,
        },
      ],
      description: `Fix targeting ${diagnosis.rootCause}`,
    };
  },
  async applyFix(_fix: AppliedFix, _sessionId: string): Promise<void> {},
  async revertFix(_fix: AppliedFix, _sessionId: string): Promise<void> {},
};

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("Feature: autonomous-codegen-pipelines, Property 9: Regression detection triggers revert", () => {
  it("for any FixAttemptRecord where newFailuresIntroduced is non-empty, outcome is 'regression_detected'", async () => {
    await fc.assert(
      fc.asyncProperty(
        failingTestNamesArb,
        regressionTestNamesArb,
        maxAttemptsArb,
        async (initialFailures, regressionTests, maxAttempts) => {
          const sessionId = uniqueSessionId();

          // Ensure regressions are distinct from initial failures
          const uniqueRegressions = regressionTests.filter(
            (r) => !initialFailures.includes(r)
          );
          if (uniqueRegressions.length === 0) {
            // Skip this case — regressions must be genuinely new
            return;
          }

          const allTestFiles = [
            ...new Set([...initialFailures, ...uniqueRegressions]),
          ];

          // Configure the test loop controller with a runner that introduces regressions
          const testRunner = createRegressionTestRunner(
            allTestFiles,
            initialFailures,
            uniqueRegressions
          );

          testLoopControllerService.configure({
            testRunner,
            failureDiagnoser: stubDiagnoser,
            fixGenerator: stubFixGenerator,
          });

          // Execute the loop
          const result = await testLoopControllerService.executeLoop(
            sessionId,
            allTestFiles,
            maxAttempts
          );

          // Property: every FixAttemptRecord with non-empty newFailuresIntroduced
          // must have outcome === 'regression_detected'
          for (const attempt of result.fixAttempts) {
            if (attempt.newFailuresIntroduced.length > 0) {
              expect(attempt.outcome).toBe("regression_detected");
            }
          }

          // Additionally verify that at least one regression was detected
          // (since our test runner always introduces regressions)
          const regressionAttempts = result.fixAttempts.filter(
            (a) => a.newFailuresIntroduced.length > 0
          );
          expect(regressionAttempts.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("regression detection implies the fix is reverted (revert handler is invoked)", async () => {
    await fc.assert(
      fc.asyncProperty(
        failingTestNamesArb,
        regressionTestNamesArb,
        async (initialFailures, regressionTests) => {
          const sessionId = uniqueSessionId();

          // Ensure regressions are distinct from initial failures
          const uniqueRegressions = regressionTests.filter(
            (r) => !initialFailures.includes(r)
          );
          if (uniqueRegressions.length === 0) {
            return;
          }

          const allTestFiles = [
            ...new Set([...initialFailures, ...uniqueRegressions]),
          ];

          // Track revert calls
          let revertCallCount = 0;

          const testRunner = createRegressionTestRunner(
            allTestFiles,
            initialFailures,
            uniqueRegressions
          );

          const trackingFixGenerator: FixGenerator = {
            async generateFix(
              diagnosis: FailureDiagnosis,
              _sessionId: string
            ): Promise<AppliedFix> {
              return {
                filePath: diagnosis.affectedFile,
                changes: [
                  {
                    startLine: 1,
                    endLine: 1,
                    originalCode: "",
                    newCode: `// Fix for: ${diagnosis.rootCause}`,
                    contextLines: 0,
                  },
                ],
                description: `Fix targeting ${diagnosis.rootCause}`,
              };
            },
            async applyFix(
              _fix: AppliedFix,
              _sessionId: string
            ): Promise<void> {},
            async revertFix(
              _fix: AppliedFix,
              _sessionId: string
            ): Promise<void> {
              revertCallCount++;
            },
          };

          testLoopControllerService.configure({
            testRunner,
            failureDiagnoser: stubDiagnoser,
            fixGenerator: trackingFixGenerator,
          });

          const result = await testLoopControllerService.executeLoop(
            sessionId,
            allTestFiles,
            3 // Use small maxAttempts to keep test fast
          );

          // Every regression detection must have triggered a revert
          const regressionCount = result.fixAttempts.filter(
            (a) => a.outcome === "regression_detected"
          ).length;

          expect(revertCallCount).toBe(regressionCount);
          expect(revertCallCount).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("non-empty newFailuresIntroduced always correlates with regression_detected (never 'resolved' or 'failed')", async () => {
    await fc.assert(
      fc.asyncProperty(
        failingTestNamesArb,
        regressionTestNamesArb,
        maxAttemptsArb,
        async (initialFailures, regressionTests, maxAttempts) => {
          const sessionId = uniqueSessionId();

          const uniqueRegressions = regressionTests.filter(
            (r) => !initialFailures.includes(r)
          );
          if (uniqueRegressions.length === 0) {
            return;
          }

          const allTestFiles = [
            ...new Set([...initialFailures, ...uniqueRegressions]),
          ];

          const testRunner = createRegressionTestRunner(
            allTestFiles,
            initialFailures,
            uniqueRegressions
          );

          testLoopControllerService.configure({
            testRunner,
            failureDiagnoser: stubDiagnoser,
            fixGenerator: stubFixGenerator,
          });

          const result = await testLoopControllerService.executeLoop(
            sessionId,
            allTestFiles,
            maxAttempts
          );

          // The core property: newFailuresIntroduced.length > 0 ⟹ outcome === 'regression_detected'
          for (const attempt of result.fixAttempts) {
            if (attempt.newFailuresIntroduced.length > 0) {
              expect(attempt.outcome).not.toBe("resolved");
              expect(attempt.outcome).not.toBe("failed");
              expect(attempt.outcome).not.toBe("reverted");
              expect(attempt.outcome).toBe("regression_detected");
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
