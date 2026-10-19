/**
 * Property Test: Fix attempt observability completeness (Property 17)
 *
 * Feature: autonomous-codegen-pipelines, Property 17: Fix attempt observability completeness
 *
 * For any `FixAttemptRecord`, verify all fields non-null: sequential `attemptNumber`
 * starting from 1, valid `timestamp`, structurally complete `diagnosis`, valid `outcome`
 * enum, `duration >= 0`. Verify session metrics correctly aggregate fix attempt counts.
 *
 * **Validates: Requirements 9.1, 9.2**
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";
import {
  testLoopControllerService,
  type TestRunner,
  type TestRunResult,
  type FailingTest,
  type FailureDiagnoser,
  type FixGenerator,
} from "../../autonomous/test-loop-controller.service.js";
import type {
  FixAttemptRecord,
  FailureDiagnosis,
  AppliedFix,
  TestLoopResult,
} from "../../core/types.js";

// ─── Valid Outcome Values ───────────────────────────────────────────────────

const VALID_OUTCOMES: FixAttemptRecord["outcome"][] = [
  "resolved",
  "failed",
  "regression_detected",
  "reverted",
];

// ─── Arbitraries ────────────────────────────────────────────────────────────

/**
 * Generates a random maxAttempts value between 1 and 10.
 */
const maxAttemptsArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: 10 });

/**
 * Generates a random set of test file paths.
 */
const testFilesArb: fc.Arbitrary<string[]> = fc
  .array(fc.stringMatching(/^src\/[a-z][a-z0-9\-]{2,12}\.test\.ts$/), {
    minLength: 1,
    maxLength: 5,
  })
  .filter((arr) => new Set(arr).size === arr.length); // unique files

/**
 * Generates a random failing test entry.
 */
function failingTestArb(testFile: string): fc.Arbitrary<FailingTest> {
  return fc
    .tuple(
      fc.stringMatching(/^[a-z][a-zA-Z0-9 ]{3,20}$/),
      fc.stringMatching(/^[A-Z][a-zA-Z0-9: ]{5,30}$/)
    )
    .map(([testName, errorMessage]) => ({
      testFile,
      testName,
      errorMessage,
      stackTrace: `at ${testFile}:${Math.floor(Math.random() * 100)}`,
    }));
}

/**
 * Generates a fix behavior: whether the fix resolves the issue, fails, or introduces regression.
 */
const fixBehaviorArb: fc.Arbitrary<"resolve" | "fail" | "regress"> = fc.constantFrom(
  "resolve" as const,
  "fail" as const,
  "regress" as const
);

/**
 * Generates a sequence of fix behaviors for each attempt iteration.
 */
function fixBehaviorSequenceArb(maxAttempts: number): fc.Arbitrary<Array<"resolve" | "fail" | "regress">> {
  return fc.array(fixBehaviorArb, { minLength: maxAttempts, maxLength: maxAttempts });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

let sessionCounter = 0;
function uniqueSessionId(): string {
  return `prop17-${Date.now()}-${++sessionCounter}`;
}

/**
 * Creates a TestRunner that always returns failures until a "resolve" behavior is hit.
 */
function createControllableRunner(
  testFiles: string[],
  behaviors: Array<"resolve" | "fail" | "regress">
): TestRunner {
  let callCount = 0;
  const initialFailure: FailingTest = {
    testFile: testFiles[0],
    testName: "should work correctly",
    errorMessage: "Expected true but got false",
    stackTrace: `at ${testFiles[0]}:42`,
  };

  return {
    async run(files: string[], _sessionId: string): Promise<TestRunResult> {
      // First call is always the initial run (returns failures)
      if (callCount === 0) {
        callCount++;
        return {
          passed: false,
          passingTests: files.slice(1),
          failingTests: [initialFailure],
          output: `FAIL ${initialFailure.testFile}\n  ${initialFailure.errorMessage}`,
          duration: 10,
        };
      }

      // Subsequent calls are post-fix verification runs
      const attemptIndex = Math.min(callCount - 1, behaviors.length - 1);
      const behavior = behaviors[attemptIndex];
      callCount++;

      switch (behavior) {
        case "resolve":
          return {
            passed: true,
            passingTests: files,
            failingTests: [],
            output: "All tests passed.",
            duration: 5,
          };
        case "fail":
          return {
            passed: false,
            passingTests: files.slice(1),
            failingTests: [initialFailure],
            output: `FAIL ${initialFailure.testFile}\n  ${initialFailure.errorMessage}`,
            duration: 8,
          };
        case "regress":
          // Introduce a NEW failure (not present originally)
          return {
            passed: false,
            passingTests: [],
            failingTests: [
              initialFailure,
              {
                testFile: "src/regression-new.test.ts",
                testName: "unrelated regression",
                errorMessage: "New failure introduced by fix",
                stackTrace: "at src/regression-new.test.ts:10",
              },
            ],
            output: "FAIL src/regression-new.test.ts\n  New failure introduced by fix",
            duration: 12,
          };
      }
    },
  };
}

/**
 * Creates a FailureDiagnoser that produces structurally complete diagnoses.
 */
function createDiagnoser(): FailureDiagnoser {
  return {
    async diagnose(failure: FailingTest, _output: string, _sessionId: string): Promise<FailureDiagnosis> {
      return {
        testFile: failure.testFile,
        testName: failure.testName,
        errorMessage: failure.errorMessage,
        stackTrace: failure.stackTrace,
        rootCause: `Root cause for failure in ${failure.testFile}`,
        affectedFile: failure.testFile.replace(".test.", "."),
        suggestedApproach: "Fix the underlying implementation logic",
      };
    },
  };
}

/**
 * Creates a FixGenerator that produces valid fixes.
 */
function createFixGenerator(): FixGenerator {
  return {
    async generateFix(diagnosis: FailureDiagnosis, _sessionId: string): Promise<AppliedFix> {
      return {
        filePath: diagnosis.affectedFile,
        changes: [
          {
            startLine: 1,
            endLine: 2,
            originalCode: "// buggy code",
            newCode: `// fixed: ${diagnosis.rootCause}`,
            contextLines: 1,
          },
        ],
        description: `Fix for: ${diagnosis.rootCause}`,
      };
    },
    async applyFix(_fix: AppliedFix, _sessionId: string): Promise<void> {},
    async revertFix(_fix: AppliedFix, _sessionId: string): Promise<void> {},
  };
}

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("Feature: autonomous-codegen-pipelines, Property 17: Fix attempt observability completeness", () => {
  beforeEach(() => {
    // Reset to default stubs before each test
    testLoopControllerService.configure({
      testRunner: { async run() { return { passed: true, passingTests: [], failingTests: [], output: "", duration: 0 }; } },
      failureDiagnoser: createDiagnoser(),
      fixGenerator: createFixGenerator(),
    });
  });

  it("attemptNumber is sequential starting from 1 for all fix attempts", async () => {
    await fc.assert(
      fc.asyncProperty(
        maxAttemptsArb,
        testFilesArb,
        async (maxAttempts, testFiles) => {
          const sessionId = uniqueSessionId();

          // Use behaviors that always fail so we get maxAttempts records
          const behaviors: Array<"resolve" | "fail" | "regress"> = Array(maxAttempts).fill("fail");
          const runner = createControllableRunner(testFiles, behaviors);

          testLoopControllerService.configure({
            testRunner: runner,
            failureDiagnoser: createDiagnoser(),
            fixGenerator: createFixGenerator(),
          });

          const result = await testLoopControllerService.executeLoop(sessionId, testFiles, maxAttempts);

          // Verify attempt numbers are sequential starting from 1
          for (let i = 0; i < result.fixAttempts.length; i++) {
            expect(result.fixAttempts[i].attemptNumber).toBe(i + 1);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("every FixAttemptRecord has a valid timestamp (Date instance)", async () => {
    await fc.assert(
      fc.asyncProperty(
        maxAttemptsArb,
        testFilesArb,
        fixBehaviorArb,
        async (maxAttempts, testFiles, firstBehavior) => {
          const sessionId = uniqueSessionId();

          // Mix of behaviors to get varied results
          const behaviors: Array<"resolve" | "fail" | "regress"> = [
            firstBehavior,
            ...Array(maxAttempts - 1).fill("fail"),
          ];
          const runner = createControllableRunner(testFiles, behaviors);

          testLoopControllerService.configure({
            testRunner: runner,
            failureDiagnoser: createDiagnoser(),
            fixGenerator: createFixGenerator(),
          });

          const result = await testLoopControllerService.executeLoop(sessionId, testFiles, maxAttempts);

          for (const attempt of result.fixAttempts) {
            expect(attempt.timestamp).toBeInstanceOf(Date);
            expect(attempt.timestamp.getTime()).not.toBeNaN();
            // Timestamp should be recent (within the last minute)
            const now = Date.now();
            expect(attempt.timestamp.getTime()).toBeLessThanOrEqual(now);
            expect(attempt.timestamp.getTime()).toBeGreaterThan(now - 60_000);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("every FixAttemptRecord has a structurally complete diagnosis (non-empty rootCause, affectedFile, suggestedApproach)", async () => {
    await fc.assert(
      fc.asyncProperty(
        maxAttemptsArb,
        testFilesArb,
        async (maxAttempts, testFiles) => {
          const sessionId = uniqueSessionId();

          const behaviors: Array<"resolve" | "fail" | "regress"> = Array(maxAttempts).fill("fail");
          const runner = createControllableRunner(testFiles, behaviors);

          testLoopControllerService.configure({
            testRunner: runner,
            failureDiagnoser: createDiagnoser(),
            fixGenerator: createFixGenerator(),
          });

          const result = await testLoopControllerService.executeLoop(sessionId, testFiles, maxAttempts);

          for (const attempt of result.fixAttempts) {
            expect(attempt.diagnosis).not.toBeNull();
            expect(attempt.diagnosis).not.toBeUndefined();
            expect(attempt.diagnosis.rootCause).toBeTruthy();
            expect(attempt.diagnosis.rootCause.length).toBeGreaterThan(0);
            expect(attempt.diagnosis.affectedFile).toBeTruthy();
            expect(attempt.diagnosis.affectedFile.length).toBeGreaterThan(0);
            expect(attempt.diagnosis.suggestedApproach).toBeTruthy();
            expect(attempt.diagnosis.suggestedApproach.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("every FixAttemptRecord has a valid outcome enum value", async () => {
    await fc.assert(
      fc.asyncProperty(
        maxAttemptsArb,
        testFilesArb,
        fc.array(fixBehaviorArb, { minLength: 1, maxLength: 10 }),
        async (maxAttempts, testFiles, behaviors) => {
          const sessionId = uniqueSessionId();

          // Pad behaviors to cover maxAttempts
          const paddedBehaviors = [
            ...behaviors.slice(0, maxAttempts),
            ...Array(Math.max(0, maxAttempts - behaviors.length)).fill("fail" as const),
          ];

          const runner = createControllableRunner(testFiles, paddedBehaviors);

          testLoopControllerService.configure({
            testRunner: runner,
            failureDiagnoser: createDiagnoser(),
            fixGenerator: createFixGenerator(),
          });

          const result = await testLoopControllerService.executeLoop(sessionId, testFiles, maxAttempts);

          for (const attempt of result.fixAttempts) {
            expect(VALID_OUTCOMES).toContain(attempt.outcome);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("every FixAttemptRecord has duration >= 0", async () => {
    await fc.assert(
      fc.asyncProperty(
        maxAttemptsArb,
        testFilesArb,
        async (maxAttempts, testFiles) => {
          const sessionId = uniqueSessionId();

          const behaviors: Array<"resolve" | "fail" | "regress"> = Array(maxAttempts).fill("fail");
          const runner = createControllableRunner(testFiles, behaviors);

          testLoopControllerService.configure({
            testRunner: runner,
            failureDiagnoser: createDiagnoser(),
            fixGenerator: createFixGenerator(),
          });

          const result = await testLoopControllerService.executeLoop(sessionId, testFiles, maxAttempts);

          for (const attempt of result.fixAttempts) {
            expect(attempt.duration).toBeGreaterThanOrEqual(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("every FixAttemptRecord has newFailuresIntroduced as an array", async () => {
    await fc.assert(
      fc.asyncProperty(
        maxAttemptsArb,
        testFilesArb,
        fc.array(fixBehaviorArb, { minLength: 1, maxLength: 10 }),
        async (maxAttempts, testFiles, behaviors) => {
          const sessionId = uniqueSessionId();

          const paddedBehaviors = [
            ...behaviors.slice(0, maxAttempts),
            ...Array(Math.max(0, maxAttempts - behaviors.length)).fill("fail" as const),
          ];

          const runner = createControllableRunner(testFiles, paddedBehaviors);

          testLoopControllerService.configure({
            testRunner: runner,
            failureDiagnoser: createDiagnoser(),
            fixGenerator: createFixGenerator(),
          });

          const result = await testLoopControllerService.executeLoop(sessionId, testFiles, maxAttempts);

          for (const attempt of result.fixAttempts) {
            expect(Array.isArray(attempt.newFailuresIntroduced)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("total fixAttempts count in result matches fixAttempts.length (metrics aggregation)", async () => {
    await fc.assert(
      fc.asyncProperty(
        maxAttemptsArb,
        testFilesArb,
        fc.array(fixBehaviorArb, { minLength: 1, maxLength: 10 }),
        async (maxAttempts, testFiles, behaviors) => {
          const sessionId = uniqueSessionId();

          const paddedBehaviors = [
            ...behaviors.slice(0, maxAttempts),
            ...Array(Math.max(0, maxAttempts - behaviors.length)).fill("fail" as const),
          ];

          const runner = createControllableRunner(testFiles, paddedBehaviors);

          testLoopControllerService.configure({
            testRunner: runner,
            failureDiagnoser: createDiagnoser(),
            fixGenerator: createFixGenerator(),
          });

          const result = await testLoopControllerService.executeLoop(sessionId, testFiles, maxAttempts);

          // The totalAttempts field must equal fixAttempts array length
          expect(result.totalAttempts).toBe(result.fixAttempts.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("all observability invariants hold simultaneously for any execution", async () => {
    await fc.assert(
      fc.asyncProperty(
        maxAttemptsArb,
        testFilesArb,
        fc.array(fixBehaviorArb, { minLength: 1, maxLength: 10 }),
        async (maxAttempts, testFiles, behaviors) => {
          const sessionId = uniqueSessionId();

          const paddedBehaviors = [
            ...behaviors.slice(0, maxAttempts),
            ...Array(Math.max(0, maxAttempts - behaviors.length)).fill("fail" as const),
          ];

          const runner = createControllableRunner(testFiles, paddedBehaviors);

          testLoopControllerService.configure({
            testRunner: runner,
            failureDiagnoser: createDiagnoser(),
            fixGenerator: createFixGenerator(),
          });

          const result = await testLoopControllerService.executeLoop(sessionId, testFiles, maxAttempts);

          // Check all invariants together
          for (let i = 0; i < result.fixAttempts.length; i++) {
            const attempt = result.fixAttempts[i];

            // Sequential attempt number starting from 1
            expect(attempt.attemptNumber).toBe(i + 1);

            // Valid timestamp
            expect(attempt.timestamp).toBeInstanceOf(Date);
            expect(attempt.timestamp.getTime()).not.toBeNaN();

            // Structurally complete diagnosis
            expect(attempt.diagnosis).not.toBeNull();
            expect(attempt.diagnosis.rootCause.length).toBeGreaterThan(0);
            expect(attempt.diagnosis.affectedFile.length).toBeGreaterThan(0);
            expect(attempt.diagnosis.suggestedApproach.length).toBeGreaterThan(0);

            // Valid outcome enum
            expect(VALID_OUTCOMES).toContain(attempt.outcome);

            // Non-negative duration
            expect(attempt.duration).toBeGreaterThanOrEqual(0);

            // newFailuresIntroduced is an array
            expect(Array.isArray(attempt.newFailuresIntroduced)).toBe(true);
          }

          // Metrics aggregation: totalAttempts matches fixAttempts.length
          expect(result.totalAttempts).toBe(result.fixAttempts.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});
