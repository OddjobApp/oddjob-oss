/**
 * Quality Gate Service
 *
 * Evaluates whether all verifications pass before allowing PR generation.
 * Reads the Verification Report and Test Loop Result from the artifact registry,
 * checks that all incremental verifications have status "passed" (or "skipped"),
 * and that the final test loop completed with all relevant tests passing.
 *
 * Returns a QualityGateResult with `passed`, `checks`, and `blockingFailures`.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4
 */

import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { generationSessions } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { artifactRegistryService } from "../core/artifact-registry.service.js";
import { sessionLifecycleManager } from "../core/session-lifecycle-manager.js";
import type {
  QualityGateResult,
  QualityCheck,
  QualityFailure,
  VerificationReport,
  VerificationEvent,
  TestLoopResult,
  PipelineLifecycleEvent,
} from "../core/types.js";

const logger = createLogger("QualityGate");

// ─── Pure Evaluation Logic ──────────────────────────────────────────────────

/**
 * Pure function that evaluates quality gate from pre-fetched data.
 * Useful for direct testing without artifact registry dependency.
 *
 * Checks:
 *  1. All verification events in the report have status "passed" or "skipped"
 *  2. The test loop result has status "all_passed"
 *
 * Returns `passed: true` only if both checks pass.
 */
export function evaluateFromData(
  report: VerificationReport,
  testLoopResult: TestLoopResult
): QualityGateResult {
  const checks: QualityCheck[] = [];
  const blockingFailures: QualityFailure[] = [];

  // ─── Check 1: All incremental verifications passed (Requirement 8.1) ────
  const failedVerifications = report.timeline.filter(
    (event: VerificationEvent) => event.status !== "passed" && event.status !== "skipped"
  );

  const verificationCheckPassed = failedVerifications.length === 0;

  checks.push({
    name: "incremental_verifications",
    description: "All incremental verification events have status passed or skipped",
    passed: verificationCheckPassed,
    details: verificationCheckPassed
      ? `${report.timeline.length} verification events all passed/skipped`
      : `${failedVerifications.length} of ${report.timeline.length} verification events failed`,
  });

  if (!verificationCheckPassed) {
    for (const event of failedVerifications) {
      blockingFailures.push({
        check: "incremental_verifications",
        reason: `Verification event at ${event.timestamp} has status "${event.status}"`,
        operationId: event.operationId,
      });
    }
  }

  // ─── Check 2: Test loop completed with all tests passing (Requirement 8.3) ─
  const testLoopPassed = testLoopResult.status === "all_passed";

  checks.push({
    name: "test_loop_completion",
    description: "Final test loop completed with all relevant tests passing",
    passed: testLoopPassed,
    details: testLoopPassed
      ? `Test loop passed with ${testLoopResult.passingTests.length} tests passing`
      : `Test loop status: "${testLoopResult.status}" with ${testLoopResult.failingTests.length} failing test(s)`,
  });

  if (!testLoopPassed) {
    if (testLoopResult.failingTests.length > 0) {
      for (const testFile of testLoopResult.failingTests) {
        blockingFailures.push({
          check: "test_loop_completion",
          reason: `Test loop status "${testLoopResult.status}" — test still failing`,
          testFile,
        });
      }
    } else {
      // No specific failing tests enumerated, but the loop did not fully pass
      blockingFailures.push({
        check: "test_loop_completion",
        reason: `Test loop completed with status "${testLoopResult.status}" (not all_passed)`,
      });
    }
  }

  // ─── Final Decision ─────────────────────────────────────────────────────
  const passed = verificationCheckPassed && testLoopPassed;

  return {
    passed,
    evaluatedAt: new Date(),
    checks,
    blockingFailures,
  };
}

// ─── Service Method ─────────────────────────────────────────────────────────

/**
 * Evaluate the quality gate for a session.
 *
 * Reads the VerificationReport (phase: "apply_edits", name: "verification_report")
 * and TestLoopResult (phase: "test_loop", name: "test_loop_result") from the
 * artifact registry, then delegates to the pure `evaluateFromData` function.
 */
async function evaluate(sessionId: string): Promise<QualityGateResult> {
  logger.info(`Evaluating quality gate for session ${sessionId}`);

  // Fetch verification report from artifact registry
  const applyEditsArtifacts = await artifactRegistryService.getPhaseArtifacts(
    sessionId,
    "apply_edits"
  );
  const reportArtifact = applyEditsArtifacts.find((a) => a.name === "verification_report");

  if (!reportArtifact) {
    logger.warn(`No verification report found for session ${sessionId}`);
    return {
      passed: false,
      evaluatedAt: new Date(),
      checks: [
        {
          name: "incremental_verifications",
          description: "All incremental verification events have status passed or skipped",
          passed: false,
          details: "Verification report artifact not found in registry",
        },
      ],
      blockingFailures: [
        {
          check: "incremental_verifications",
          reason: "Verification report artifact not found — cannot evaluate gate",
        },
      ],
    };
  }

  // Fetch test loop result from artifact registry
  const testLoopArtifacts = await artifactRegistryService.getPhaseArtifacts(
    sessionId,
    "test_loop"
  );
  const testLoopArtifact = testLoopArtifacts.find((a) => a.name === "test_loop_result");

  if (!testLoopArtifact) {
    logger.warn(`No test loop result found for session ${sessionId}`);
    return {
      passed: false,
      evaluatedAt: new Date(),
      checks: [
        {
          name: "test_loop_completion",
          description: "Final test loop completed with all relevant tests passing",
          passed: false,
          details: "Test loop result artifact not found in registry",
        },
      ],
      blockingFailures: [
        {
          check: "test_loop_completion",
          reason: "Test loop result artifact not found — cannot evaluate gate",
        },
      ],
    };
  }

  const report = reportArtifact.content as unknown as VerificationReport;
  const testLoopResult = testLoopArtifact.content as unknown as TestLoopResult;

  const result = evaluateFromData(report, testLoopResult);

  logger.info(`Quality gate evaluation complete for session ${sessionId}`, {
    passed: result.passed,
    checkCount: result.checks.length,
    blockingFailureCount: result.blockingFailures.length,
  });

  return result;
}

// ─── Enforcement Method ─────────────────────────────────────────────────────

/**
 * Evaluate the quality gate and enforce the result.
 *
 * - Calls `evaluate(sessionId)` to get the gate result
 * - Persists the gate result as an artifact in the registry
 * - If gate passes: emits `quality_gate_passed` lifecycle event
 * - If gate fails: transitions session to `blocked` state, emits `quality_gate_blocked`
 *   lifecycle event with the list of failing verifications
 *
 * Requirements: 8.2, 8.4
 */
async function evaluateAndEnforce(sessionId: string, orgId: number): Promise<QualityGateResult> {
  logger.info(`Evaluating and enforcing quality gate for session ${sessionId}`);

  // 1. Evaluate the gate
  const result = await evaluate(sessionId);

  // 2. Persist the gate result artifact
  await artifactRegistryService.persist({
    sessionId,
    phase: "quality_gate",
    name: "gate_result",
    content: result,
    mimeType: "application/json",
    missionRunId: 0, // Quality gate runs outside of a mission
  });

  const now = new Date();

  if (result.passed) {
    // 3a. Gate passed — emit quality_gate_passed event
    logger.info(`Quality gate PASSED for session ${sessionId}`);

    const passedEvent: PipelineLifecycleEvent = {
      eventType: "quality_gate_passed",
      sessionId,
      orgId,
      timestamp: now,
      payload: {
        checks: result.checks,
        evaluatedAt: result.evaluatedAt,
      },
    };

    sessionLifecycleManager.emitEvent(passedEvent);
  } else {
    // 3b. Gate failed — block PR generation, transition to blocked state
    logger.warn(
      `Quality gate BLOCKED for session ${sessionId}: ${result.blockingFailures.length} blocking failure(s)`
    );

    // Transition session to blocked state
    await db
      .update(generationSessions)
      .set({ status: "blocked", updatedAt: now })
      .where(eq(generationSessions.id, sessionId));

    // Emit quality_gate_blocked event with failing verifications (Requirement 8.4)
    const blockedEvent: PipelineLifecycleEvent = {
      eventType: "quality_gate_blocked",
      sessionId,
      orgId,
      timestamp: now,
      payload: {
        blockingFailures: result.blockingFailures,
        checks: result.checks,
        evaluatedAt: result.evaluatedAt,
      },
    };

    sessionLifecycleManager.emitEvent(blockedEvent);
  }

  return result;
}

// ─── Exported Service ───────────────────────────────────────────────────────

export const qualityGateService = {
  evaluate,
  evaluateFromData,
  evaluateAndEnforce,
};
