/**
 * Property Test: Maximum fix attempt bound (Property 8)
 *
 * Feature: autonomous-codegen-pipelines, Property 8: Maximum fix attempt bound
 *
 * For any test loop execution with a configured `maxAttempts` value, the number
 * of `FixAttemptRecord` entries in the `TestLoopResult` SHALL never exceed
 * `maxAttempts`.
 *
 * **Validates: Requirements 3.5**
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";
import {
  testLoopControllerService,
  type TestRunner,
  type TestRunResult,
  type FailureDiagnoser,
  type FixGenerator,
  type FailingTest,
} from "../../autonomous/test-loop-controller.service.js";
import type { FailureDiagnosis, AppliedFix } from "../../core/types.js";

// ─── Arbitraries ────────────────────────────────────────────────────────────

/**
 * Generates a random maxAttempts value between 1 and 20.
 */
const maxAttemptsArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: 20 });

/**
 * Generates a random set of test file paths (1-5 test files).
 */
const testFilesArb: fc.Arbitrary<string[]> = fc.array(
  fc.stringMatching(/^tests\/[a-z]{2,8}\.test\.ts$/),
  { minLength: 1, maxLength: 5 }
);

// ─── Always-Failing Test Runner ─────────────────────────────────────────────

/**
 * Creates a test runner that always reports failures.
 * This ensures the loop always consumes all available attempts.
 */
function createAlwaysFailingTestRunner(testFiles: string[]): TestRunner {
  return {
    async run(files: string[], _sessionId: string): Promise<TestRunResult> {
      const failingTests: FailingTest[] = files.map((file) => ({
        testFile: file,
        testName: `test in ${file}`,
        errorMessage: `Assertion failed in ${file}`,
        stackTrace: `Error: Assertion failed\n    at ${file}:10:5`,
      }));

      return {
        passed: false,
        passingTests: [],
        failingTests,
        output: `FAIL: ${files.length} test(s) failed`,
        duration: 10,
      };
    },
  };
}

/**
 * Stub failure diagnoser that always produces a valid diagnosis.
 */
const alwaysFailDiagnoser: FailureDiagnoser = {
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
      rootCause: `Simulated root cause for ${failure.testFile}`,
      affectedFile: failure.testFile.replace(".test.", "."),
      suggestedApproach: "Apply a simulated fix",
    };
  },
};

/**
 * Stub fix generator that applies no-op fixes (tests remain failing).
 */
const noOpFixGenerator: FixGenerator = {
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
          newCode: `// fix attempt for: ${diagnosis.rootCause}`,
          contextLines: 0,
        },
      ],
      description: `No-op fix for ${diagnosis.rootCause}`,
    };
  },
  async applyFix(_fix: AppliedFix, _sessionId: string): Promise<void> {
    // No-op: fix does nothing, tests will still fail
  },
  async revertFix(_fix: AppliedFix, _sessionId: string): Promise<void> {
    // No-op
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

let sessionCounter = 0;
function uniqueSessionId(): string {
  return `prop8-${Date.now()}-${++sessionCounter}`;
}

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("Feature: autonomous-codegen-pipelines, Property 8: Maximum fix attempt bound", () => {
  beforeEach(() => {
    // Configure with always-failing test runner and no-op fix generator
    testLoopControllerService.configure({
      testRunner: createAlwaysFailingTestRunner([]),
      failureDiagnoser: alwaysFailDiagnoser,
      fixGenerator: noOpFixGenerator,
    });
  });

  it("fixAttempts.length never exceeds maxAttempts for any maxAttempts in [1, 20]", async () => {
    await fc.assert(
      fc.asyncProperty(maxAttemptsArb, testFilesArb, async (maxAttempts, testFiles) => {
        const sessionId = uniqueSessionId();

        // Configure the always-failing test runner with these test files
        testLoopControllerService.configure({
          testRunner: createAlwaysFailingTestRunner(testFiles),
          failureDiagnoser: alwaysFailDiagnoser,
          fixGenerator: noOpFixGenerator,
        });

        const result = await testLoopControllerService.executeLoop(
          sessionId,
          testFiles,
          maxAttempts
        );

        // Property: fix attempt count never exceeds maxAttempts
        expect(result.fixAttempts.length).toBeLessThanOrEqual(maxAttempts);
      }),
      { numRuns: 100 }
    );
  });

  it("totalAttempts never exceeds maxAttempts", async () => {
    await fc.assert(
      fc.asyncProperty(maxAttemptsArb, testFilesArb, async (maxAttempts, testFiles) => {
        const sessionId = uniqueSessionId();

        // Configure the always-failing test runner with these test files
        testLoopControllerService.configure({
          testRunner: createAlwaysFailingTestRunner(testFiles),
          failureDiagnoser: alwaysFailDiagnoser,
          fixGenerator: noOpFixGenerator,
        });

        const result = await testLoopControllerService.executeLoop(
          sessionId,
          testFiles,
          maxAttempts
        );

        // Property: totalAttempts reported never exceeds maxAttempts
        expect(result.totalAttempts).toBeLessThanOrEqual(maxAttempts);
      }),
      { numRuns: 100 }
    );
  });

  it("with always-failing tests, loop exhausts exactly maxAttempts and reports 'exhausted' status", async () => {
    await fc.assert(
      fc.asyncProperty(maxAttemptsArb, testFilesArb, async (maxAttempts, testFiles) => {
        const sessionId = uniqueSessionId();

        // Configure the always-failing test runner with these test files
        testLoopControllerService.configure({
          testRunner: createAlwaysFailingTestRunner(testFiles),
          failureDiagnoser: alwaysFailDiagnoser,
          fixGenerator: noOpFixGenerator,
        });

        const result = await testLoopControllerService.executeLoop(
          sessionId,
          testFiles,
          maxAttempts
        );

        // With always-failing tests and no-regression fixes, the loop should
        // exhaust all maxAttempts and report 'exhausted' status
        expect(result.fixAttempts.length).toBe(maxAttempts);
        expect(result.totalAttempts).toBe(maxAttempts);
        expect(result.status).toBe("exhausted");
      }),
      { numRuns: 100 }
    );
  });
});
