/**
 * Property Test: Quality gate decision consistency (Property 16)
 *
 * Feature: autonomous-codegen-pipelines, Property 16: Quality gate decision consistency
 *
 * For any `VerificationReport`, the `QualityGateResult.passed` SHALL be `true`
 * if and only if every `VerificationEvent` in the report has `status === 'passed'`
 * or `status === 'skipped'` AND the final test loop result has `status === 'all_passed'`.
 * Otherwise, `passed` SHALL be `false` with non-empty `blockingFailures`.
 *
 * **Validates: Requirements 8.1, 8.2, 8.3**
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { evaluateFromData } from "../../autonomous/quality-gate.service.js";
import type {
  VerificationReport,
  VerificationEvent,
  TestLoopResult,
  VerificationLevel,
} from "../../core/types.js";

// ─── Arbitraries ────────────────────────────────────────────────────────────

/**
 * Generates a random verification level.
 */
const verificationLevelArb: fc.Arbitrary<VerificationLevel> = fc.constantFrom(
  "none" as const,
  "lint_only" as const,
  "type_check" as const,
  "full_test" as const
);

/**
 * Generates a verification event status.
 */
const eventStatusArb: fc.Arbitrary<"passed" | "failed" | "skipped"> =
  fc.constantFrom("passed" as const, "failed" as const, "skipped" as const);

/**
 * Generates a "passing" event status (passed or skipped).
 */
const passingEventStatusArb: fc.Arbitrary<"passed" | "skipped"> =
  fc.constantFrom("passed" as const, "skipped" as const);

/**
 * Generates a verification event type.
 */
const eventTypeArb: fc.Arbitrary<VerificationEvent["type"]> = fc.constantFrom(
  "step_check" as const,
  "test_loop_iteration" as const,
  "fix_attempt" as const,
  "quality_gate" as const
);

/**
 * Generates a single VerificationEvent with a given status.
 */
function verificationEventArb(
  statusArb: fc.Arbitrary<"passed" | "failed" | "skipped">
): fc.Arbitrary<VerificationEvent> {
  return fc
    .tuple(
      fc.date({ min: new Date("2024-01-01"), max: new Date("2025-12-31") }),
      eventTypeArb,
      statusArb,
      fc.nat({ max: 10000 })
    )
    .map(([timestamp, type, status, duration]) => ({
      timestamp,
      type,
      operationId: `op-${duration}`,
      status,
      details: {},
      duration,
    }));
}

/**
 * Generates a VerificationReport timeline where all events have passing status.
 */
const allPassingTimelineArb: fc.Arbitrary<VerificationEvent[]> = fc.array(
  verificationEventArb(passingEventStatusArb),
  { minLength: 0, maxLength: 15 }
);

/**
 * Generates a VerificationReport timeline with at least one failing event.
 */
const timelineWithFailureArb: fc.Arbitrary<VerificationEvent[]> = fc
  .tuple(
    fc.array(verificationEventArb(eventStatusArb), { minLength: 0, maxLength: 7 }),
    verificationEventArb(fc.constant("failed" as const)),
    fc.array(verificationEventArb(eventStatusArb), { minLength: 0, maxLength: 7 })
  )
  .map(([before, failedEvent, after]) => [...before, failedEvent, ...after]);

/**
 * Generates a VerificationReport timeline with mixed statuses (may or may not have failures).
 */
const mixedTimelineArb: fc.Arbitrary<VerificationEvent[]> = fc.array(
  verificationEventArb(eventStatusArb),
  { minLength: 0, maxLength: 15 }
);

/**
 * Generates a TestLoopResult status.
 */
const testLoopStatusArb: fc.Arbitrary<TestLoopResult["status"]> = fc.constantFrom(
  "all_passed" as const,
  "partially_fixed" as const,
  "exhausted" as const,
  "escalated" as const
);

/**
 * Generates a non-passing TestLoopResult status.
 */
const failingTestLoopStatusArb: fc.Arbitrary<TestLoopResult["status"]> = fc.constantFrom(
  "partially_fixed" as const,
  "exhausted" as const,
  "escalated" as const
);

/**
 * Generates a TestLoopResult with a given status.
 */
function testLoopResultArb(
  statusArb: fc.Arbitrary<TestLoopResult["status"]>
): fc.Arbitrary<TestLoopResult> {
  return fc
    .tuple(
      statusArb,
      fc.nat({ max: 10 }),
      fc.array(fc.stringMatching(/^tests\/[a-z]{2,8}\.test\.ts$/), { minLength: 0, maxLength: 5 }),
      fc.array(fc.stringMatching(/^tests\/[a-z]{2,8}\.test\.ts$/), { minLength: 0, maxLength: 5 }),
      fc.nat({ max: 60000 })
    )
    .map(([status, totalAttempts, passingTests, failingTests, duration]) => ({
      status,
      totalAttempts,
      fixAttempts: [],
      passingTests,
      failingTests,
      duration,
    }));
}

/**
 * Generates a full VerificationReport from a timeline.
 */
function verificationReportArb(
  timelineArb: fc.Arbitrary<VerificationEvent[]>
): fc.Arbitrary<VerificationReport> {
  return fc
    .tuple(
      fc.stringMatching(/^session-[a-z0-9]{4,8}$/),
      verificationLevelArb,
      timelineArb
    )
    .map(([sessionId, verificationLevel, timeline]) => {
      const passed = timeline.filter((e) => e.status === "passed").length;
      const failed = timeline.filter((e) => e.status === "failed").length;
      const totalDuration = timeline.reduce((sum, e) => sum + e.duration, 0);
      return {
        sessionId,
        verificationLevel,
        timeline,
        summary: {
          totalChecks: timeline.length,
          passed,
          failed,
          fixAttempts: 0,
          successfulFixes: 0,
          totalDuration,
        },
        finalStatus: failed > 0 ? ("has_failures" as const) : ("all_passed" as const),
      };
    });
}

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("Feature: autonomous-codegen-pipelines, Property 16: Quality gate decision consistency", () => {
  it("passed === true when all verification events are passed/skipped AND test loop is all_passed", () => {
    fc.assert(
      fc.property(
        verificationReportArb(allPassingTimelineArb),
        testLoopResultArb(fc.constant("all_passed" as const)),
        (report, testLoopResult) => {
          const result = evaluateFromData(report, testLoopResult);

          // Gate should pass
          expect(result.passed).toBe(true);
          // No blocking failures
          expect(result.blockingFailures).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("passed === false with non-empty blockingFailures when any verification event has status 'failed'", () => {
    fc.assert(
      fc.property(
        verificationReportArb(timelineWithFailureArb),
        testLoopResultArb(fc.constant("all_passed" as const)),
        (report, testLoopResult) => {
          const result = evaluateFromData(report, testLoopResult);

          // Gate should fail because of failed verification events
          expect(result.passed).toBe(false);
          // Must have non-empty blocking failures
          expect(result.blockingFailures.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("passed === false with non-empty blockingFailures when test loop status is not 'all_passed'", () => {
    fc.assert(
      fc.property(
        verificationReportArb(allPassingTimelineArb),
        testLoopResultArb(failingTestLoopStatusArb),
        (report, testLoopResult) => {
          const result = evaluateFromData(report, testLoopResult);

          // Gate should fail because test loop did not pass
          expect(result.passed).toBe(false);
          // Must have non-empty blocking failures
          expect(result.blockingFailures.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("decision is consistent for any combination of report and test loop result", () => {
    fc.assert(
      fc.property(
        verificationReportArb(mixedTimelineArb),
        testLoopResultArb(testLoopStatusArb),
        (report, testLoopResult) => {
          const result = evaluateFromData(report, testLoopResult);

          // Compute expected outcome
          const allEventsPass = report.timeline.every(
            (e) => e.status === "passed" || e.status === "skipped"
          );
          const testLoopPassed = testLoopResult.status === "all_passed";
          const shouldPass = allEventsPass && testLoopPassed;

          // Verify decision matches expected
          expect(result.passed).toBe(shouldPass);

          // Verify blockingFailures is non-empty iff gate failed
          if (shouldPass) {
            expect(result.blockingFailures).toHaveLength(0);
          } else {
            expect(result.blockingFailures.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
