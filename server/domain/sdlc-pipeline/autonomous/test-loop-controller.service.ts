/**
 * Test Loop Controller Service
 *
 * Orchestrates the self-healing test loop: run tests → diagnose failures →
 * apply targeted fix → re-run failing tests. Bounded by a configurable
 * maximum attempt count.
 *
 * The loop terminates when:
 *  - All tests pass → status: "all_passed"
 *  - Max attempts reached with some fixes applied → status: "partially_fixed" or "exhausted"
 *  - A fix introduces regressions that cannot be resolved → status: "escalated"
 *
 * Uses pluggable interfaces for:
 *  - Test runner (executes tests, returns pass/fail + output)
 *  - Failure diagnoser (analyzes test output → FailureDiagnosis)
 *  - Fix generator (produces fix from diagnosis → AppliedFix)
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */

import { createLogger } from "@server/utils/logger.js";
import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";
import { sessionLifecycleManager } from "../core/session-lifecycle-manager.js";
import type {
  TestLoopResult,
  FixAttemptRecord,
  FailureDiagnosis,
  AppliedFix,
  PipelineLifecycleEvent,
  VerificationLevel,
} from "../core/types.js";
import {
  runMutationTesting,
  killAllMutationRunner,
  type MutationRunner,
  type ChangedFileForMutation,
} from "./mutation-tester.js";

const logger = createLogger("TestLoopController");
const exec = promisify(execCallback);
const DEFAULT_TEST_TIMEOUT_MS = 120_000;
const MAX_TEST_OUTPUT = 20_000;

// ─── Pluggable Interfaces ───────────────────────────────────────────────────

/**
 * Executes a set of test files and returns structured results.
 */
export interface TestRunner {
  run(testFiles: string[], sessionId: string): Promise<TestRunResult>;
}

export interface TestRunResult {
  passed: boolean;
  passingTests: string[];
  failingTests: FailingTest[];
  output: string;
  duration: number;
}

export interface FailingTest {
  testFile: string;
  testName: string;
  errorMessage: string;
  stackTrace?: string;
}

/**
 * Analyzes test output and failure details to produce a structured diagnosis.
 */
export interface FailureDiagnoser {
  diagnose(failure: FailingTest, testOutput: string, sessionId: string): Promise<FailureDiagnosis>;
}

/**
 * Generates a targeted code fix from a diagnosis.
 */
export interface FixGenerator {
  generateFix(diagnosis: FailureDiagnosis, sessionId: string): Promise<AppliedFix>;
  applyFix(fix: AppliedFix, sessionId: string): Promise<void>;
  revertFix(fix: AppliedFix, sessionId: string): Promise<void>;
}

// ─── Repo-backed Defaults ───────────────────────────────────────────────────
function quoteArg(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function truncateOutput(output: string): string {
  if (output.length <= MAX_TEST_OUTPUT) return output;
  return `${output.slice(0, MAX_TEST_OUTPUT)}\n...(truncated, total ${output.length} chars)`;
}

function getRepoRoot(): string {
  return process.env.GIT_WORKSPACE_ROOT || process.cwd();
}

function parseVitestFailures(testFiles: string[], output: string): FailingTest[] {
  const lines = output.split(/\r?\n/);
  const targets = testFiles.length > 0 ? testFiles : ["test suite"];

  return targets.map((testFile) => {
    const matchingLine = lines.find((line) => line.includes(testFile) && /FAIL|failed|Error/i.test(line));
    return {
      testFile,
      testName: matchingLine?.trim() || "test run",
      errorMessage: truncateOutput(output.trim() || "Test command failed"),
    };
  });
}

export function createVitestRunner(timeoutMs = DEFAULT_TEST_TIMEOUT_MS): TestRunner {
  return {
    async run(testFiles: string[], _sessionId: string): Promise<TestRunResult> {
      const startTime = Date.now();
      const command = testFiles.length > 0
        ? `npx vitest run ${testFiles.map(quoteArg).join(" ")}`
        : "npm run test";

      try {
        const result = await exec(command, {
          cwd: getRepoRoot(),
          timeout: timeoutMs,
          maxBuffer: 1024 * 1024 * 10,
          env: { ...process.env, CI: "true", NODE_ENV: process.env.NODE_ENV || "test" },
        });
        return {
          passed: true,
          passingTests: testFiles,
          failingTests: [],
          output: truncateOutput([result.stdout, result.stderr].filter(Boolean).join("\n")),
          duration: Date.now() - startTime,
        };
      } catch (error: any) {
        const output = truncateOutput([error.stdout, error.stderr, error.message].filter(Boolean).join("\n"));
        return {
          passed: false,
          passingTests: [],
          failingTests: parseVitestFailures(testFiles, output),
          output,
          duration: Date.now() - startTime,
        };
      }
    },
  };
}

const defaultFailureDiagnoser: FailureDiagnoser = {
  async diagnose(failure: FailingTest, _testOutput: string, _sessionId: string): Promise<FailureDiagnosis> {
    return {
      testFile: failure.testFile,
      testName: failure.testName,
      errorMessage: failure.errorMessage,
      stackTrace: failure.stackTrace,
      rootCause: `Inferred root cause for failure in ${failure.testFile}`,
      affectedFile: failure.testFile.replace(".test.", "."),
      suggestedApproach: "Apply targeted fix to the affected source file",
    };
  },
};

const failClosedFixGenerator: FixGenerator = {
  async generateFix(diagnosis: FailureDiagnosis, _sessionId: string): Promise<AppliedFix> {
    throw new Error(
      `No autonomous fix generator configured for ${diagnosis.testFile}::${diagnosis.testName}`
    );
  },
  async applyFix(_fix: AppliedFix, _sessionId: string): Promise<void> {
    throw new Error("No autonomous fix applier configured.");
  },
  async revertFix(_fix: AppliedFix, _sessionId: string): Promise<void> {
    throw new Error("No autonomous fix reverter configured.");
  },
};

// ─── Configuration ──────────────────────────────────────────────────────────

interface TestLoopControllerConfig {
  testRunner: TestRunner;
  failureDiagnoser: FailureDiagnoser;
  fixGenerator: FixGenerator;
  mutationRunner: MutationRunner;
}

let config: TestLoopControllerConfig = {
  testRunner: createVitestRunner(),
  failureDiagnoser: defaultFailureDiagnoser,
  fixGenerator: failClosedFixGenerator,
  mutationRunner: killAllMutationRunner,
};

/**
 * Optional mutation-testing input. When provided at the `full_test` tier and the
 * loop reaches `all_passed`, minor mutations are injected into the changed code
 * and the suite is re-run; surviving mutations flag a weak assertion suite.
 */
export interface MutationInput {
  verificationLevel: VerificationLevel;
  changedFiles: ChangedFileForMutation[];
}

/**
 * Configure the Test Loop Controller with custom implementations.
 * Call at startup to inject real integrations.
 */
function configure(newConfig: Partial<TestLoopControllerConfig>): void {
  config = { ...config, ...newConfig };
  logger.info("Test loop controller configured with custom runners");
}

// ─── Core Loop Logic ────────────────────────────────────────────────────────

/**
 * Execute the self-healing test loop for a set of test files.
 *
 * Algorithm:
 * 1. Run the test suite
 * 2. If all pass → return "all_passed"
 * 3. If failures:
 *    a. Diagnose the first failing test
 *    b. Generate and apply a targeted fix
 *    c. Re-run failing tests to verify the fix
 *    d. If fix introduces regressions (new failures not present before):
 *       → Revert fix, record as "regression_detected"
 *    e. Repeat until all pass or maxAttempts exhausted
 * 4. Determine final status based on outcomes
 */
/**
 * Automated Mutation Testing pass (Extension 4). Runs only at the `full_test`
 * tier once the loop is green; a surviving mutant demotes the status to
 * `weak_assertion` and flags a forced refactor iteration.
 */
async function applyMutationTesting(
  result: TestLoopResult,
  testFiles: string[],
  sessionId: string,
  mutationInput?: MutationInput
): Promise<TestLoopResult> {
  if (
    !mutationInput ||
    mutationInput.verificationLevel !== "full_test" ||
    result.status !== "all_passed" ||
    mutationInput.changedFiles.length === 0
  ) {
    return result;
  }

  const mutationTesting = await runMutationTesting(
    mutationInput.changedFiles,
    config.mutationRunner,
    { testFiles, sessionId }
  );

  const withMutation: TestLoopResult = { ...result, mutationTesting };
  if (mutationTesting.weakAssertionDetected) {
    logger.warn(
      `Mutation testing found ${mutationTesting.survivedCount}/${mutationTesting.injectedCount} surviving mutant(s) for session ${sessionId} — weak assertion suite; forcing refactor iteration`
    );
    withMutation.status = "weak_assertion";
  } else {
    logger.info(
      `Mutation testing passed for session ${sessionId}: score=${mutationTesting.mutationScore} (${mutationTesting.killedCount}/${mutationTesting.injectedCount} killed)`
    );
  }
  return withMutation;
}

async function executeLoop(
  sessionId: string,
  testFiles: string[],
  maxAttempts: number,
  mutationInput?: MutationInput
): Promise<TestLoopResult> {
  const loopStartTime = Date.now();
  const fixAttempts: FixAttemptRecord[] = [];

  logger.info(`Starting test loop for session ${sessionId}`, {
    testFileCount: testFiles.length,
    maxAttempts,
  });

  const isE2E = testFiles.some(f => f.includes("playwright-test-repo") || f.includes("smoke/dashboard"));
  
  let currentRunner = config.testRunner;
  let currentFailureDiagnoser = config.failureDiagnoser;

  if (isE2E) {
    const { createPlaywrightRunner } = await import("./playwright-runner.js");
    const { createAiFailureDiagnoser } = await import("./ai-failure-diagnoser.js");
    const { e2eTestIndexerService } = await import("./e2e-test-indexer.service.js");
    try {
      await e2eTestIndexerService.indexTests();
    } catch (err: any) {
      logger.warn(`Could not index tests before starting E2E loop: ${err.message}`);
    }
    currentRunner = createPlaywrightRunner();
    currentFailureDiagnoser = createAiFailureDiagnoser();
    logger.info(`[TestLoopController] Scoped test files identified as E2E. Using PlaywrightRunner & AiFailureDiagnoser.`);
  }

  // Initial test run (Requirement 3.1)
  let currentRun = await currentRunner.run(testFiles, sessionId);

  // If all pass on first run, we're done
  if (currentRun.passed) {
    logger.info(`All tests passed on initial run for session ${sessionId}`);
    const passedResult: TestLoopResult = {
      status: "all_passed",
      totalAttempts: 0,
      fixAttempts: [],
      passingTests: currentRun.passingTests,
      failingTests: [],
      duration: Date.now() - loopStartTime,
    };
    return applyMutationTesting(passedResult, testFiles, sessionId, mutationInput);
  }

  // Track which tests were failing before each attempt for regression detection
  let previouslyFailingTestNames = new Set(
    currentRun.failingTests.map((f) => `${f.testFile}::${f.testName}`)
  );

  // Enter the fix loop
  let attemptNumber = 0;
  let escalated = false;

  while (attemptNumber < maxAttempts && currentRun.failingTests.length > 0) {
    attemptNumber++;
    const attemptStartTime = Date.now();

    logger.info(`Fix attempt ${attemptNumber}/${maxAttempts} for session ${sessionId}`, {
      failingTestCount: currentRun.failingTests.length,
    });

    // Emit fix_attempt_started event (Requirement 9.5)
    const fixStartedEvent: PipelineLifecycleEvent = {
      eventType: "fix_attempt_started",
      sessionId,
      orgId: 0,
      timestamp: new Date(),
      payload: {
        attemptNumber,
        testFile: currentRun.failingTests[0]?.testFile ?? "unknown",
        sessionId,
      },
    };
    sessionLifecycleManager.emitEvent(fixStartedEvent);

    // Pick the first failing test to diagnose (Requirement 3.2)
    const targetFailure = currentRun.failingTests[0];

    const diagnosis = await currentFailureDiagnoser.diagnose(
      targetFailure,
      currentRun.output,
      sessionId
    );

    logger.info(`Diagnosed failure in ${diagnosis.testFile}::${diagnosis.testName}`, {
      sessionId,
      rootCause: diagnosis.rootCause,
      affectedFile: diagnosis.affectedFile,
    });

    // Generate and apply the fix (Requirement 3.3)
    let appliedFix: AppliedFix;
    try {
      appliedFix = await config.fixGenerator.generateFix(diagnosis, sessionId);
      await config.fixGenerator.applyFix(appliedFix, sessionId);
    } catch (error: any) {
      logger.warn(`Fix attempt ${attemptNumber} could not be generated/applied`, {
        sessionId,
        error: error?.message || String(error),
      });

      return {
        status: "exhausted",
        totalAttempts: attemptNumber - 1,
        fixAttempts,
        passingTests: currentRun.passingTests,
        failingTests: currentRun.failingTests.map((f) => `${f.testFile}::${f.testName}`),
        duration: Date.now() - loopStartTime,
      };
    }

    // Re-run tests to verify the fix (Requirement 3.4)
    const postFixRun = await currentRunner.run(testFiles, sessionId);

    // Detect regressions: new failures not present before the fix
    const postFixFailingNames = new Set(
      postFixRun.failingTests.map((f) => `${f.testFile}::${f.testName}`)
    );

    const newFailures = [...postFixFailingNames].filter(
      (name) => !previouslyFailingTestNames.has(name)
    );

    let outcome: FixAttemptRecord["outcome"];

    if (newFailures.length > 0) {
      // Regression detected — revert the fix
      outcome = "regression_detected";
      await config.fixGenerator.revertFix(appliedFix, sessionId);

      logger.warn(`Fix attempt ${attemptNumber} introduced regressions, reverting`, {
        sessionId,
        newFailures,
      });

      // After revert, keep the pre-fix test state
      // (currentRun stays the same, don't update)
    } else if (postFixRun.passed) {
      // All tests now pass
      outcome = "resolved";
      currentRun = postFixRun;
    } else {
      // Fix didn't fully resolve the issue, but no regressions
      const fixedSome = postFixRun.failingTests.length < currentRun.failingTests.length;
      outcome = fixedSome ? "resolved" : "failed";

      // Update state for next iteration
      currentRun = postFixRun;
      previouslyFailingTestNames = postFixFailingNames;
    }

    const attemptDuration = Date.now() - attemptStartTime;

    // Stall warning: log when a fix attempt exceeds 60 seconds (Requirement 9.4)
    if (attemptDuration > 60_000) {
      logger.warn(`Fix attempt ${attemptNumber} exceeded 60 seconds (stall detected)`, {
        sessionId,
        attemptNumber,
        duration: attemptDuration,
      });
    }

    const record: FixAttemptRecord = {
      attemptNumber,
      timestamp: new Date(),
      diagnosis,
      appliedFix,
      outcome,
      duration: attemptDuration,
      newFailuresIntroduced: newFailures,
    };

    fixAttempts.push(record);

    // Emit fix_attempt_completed event (Requirement 9.5)
    const fixCompletedEvent: PipelineLifecycleEvent = {
      eventType: "fix_attempt_completed",
      sessionId,
      orgId: 0,
      timestamp: new Date(),
      payload: {
        attemptNumber,
        outcome,
        duration: attemptDuration,
        sessionId,
      },
    };
    sessionLifecycleManager.emitEvent(fixCompletedEvent);

    logger.info(`Fix attempt ${attemptNumber} outcome: ${outcome}`, {
      sessionId,
      duration: attemptDuration,
      remainingFailures: currentRun.failingTests.length,
    });

    // If all tests pass after fix, break out
    if (currentRun.passed) {
      break;
    }

    // If we've hit too many regressions in a row, escalate
    const recentAttempts = fixAttempts.slice(-3);
    const allRegressed = recentAttempts.length === 3 &&
      recentAttempts.every((a) => a.outcome === "regression_detected");

    if (allRegressed) {
      escalated = true;
      logger.warn(`Escalating session ${sessionId}: 3 consecutive regressions detected`);
      break;
    }
  }

  // Determine final status
  const totalDuration = Date.now() - loopStartTime;
  let status: TestLoopResult["status"];

  if (currentRun.passed) {
    status = "all_passed";
  } else if (escalated) {
    status = "escalated";
  } else if (fixAttempts.some((a) => a.outcome === "resolved")) {
    // Some fixes were successful but failures remain
    status = "partially_fixed";
  } else if (attemptNumber >= maxAttempts && currentRun.failingTests.length > 0) {
    // Max attempts exhausted with no successful fixes — escalate to rescue strategy (Requirement 3.5)
    status = "exhausted";
    logger.warn(`Test loop exhausted for session ${sessionId}: escalating to rescue strategy`, {
      sessionId,
      maxAttempts,
      remainingFailures: currentRun.failingTests.length,
    });

    // Emit test_loop_exhausted event (Requirement 3.8)
    const exhaustedEvent: PipelineLifecycleEvent = {
      eventType: "test_loop_exhausted",
      sessionId,
      orgId: 0,
      timestamp: new Date(),
      payload: {
        totalAttempts: attemptNumber,
        remainingFailures: currentRun.failingTests.length,
        sessionId,
      },
    };
    sessionLifecycleManager.emitEvent(exhaustedEvent);
  } else {
    status = "exhausted";
  }

  const result: TestLoopResult = {
    status,
    totalAttempts: attemptNumber,
    fixAttempts,
    passingTests: currentRun.passingTests,
    failingTests: currentRun.failingTests.map((f) => `${f.testFile}::${f.testName}`),
    duration: totalDuration,
  };

  logger.info(`Test loop completed for session ${sessionId}`, {
    status: result.status,
    totalAttempts: result.totalAttempts,
    passingTestCount: result.passingTests.length,
    failingTestCount: result.failingTests.length,
    duration: totalDuration,
  });

  return applyMutationTesting(result, testFiles, sessionId, mutationInput);
}

// ─── Exported Service ───────────────────────────────────────────────────────

export const testLoopControllerService = {
  executeLoop,
  configure,
};
