/**
 * Property Test: Verification timeline chronological ordering (Property 18)
 *
 * Feature: autonomous-codegen-pipelines, Property 18: Verification timeline chronological ordering
 *
 * For any `VerificationReport`, verify all `VerificationEvent` entries in `timeline`
 * are ordered by `timestamp` in non-decreasing order (each event's timestamp >= the
 * previous event's timestamp).
 *
 * **Validates: Requirements 9.3**
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";
import { incrementalVerifierService } from "../../autonomous/incremental-verifier.service.js";
import type {
  VerificationEvent,
  VerificationReport,
  VerificationLevel,
  FileOperation,
  ImpactAnalysis,
} from "../../core/types.js";

// ─── Arbitraries ────────────────────────────────────────────────────────────

/**
 * Generates a random VerificationEvent with a given timestamp.
 */
function verificationEventArb(timestampArb: fc.Arbitrary<Date>): fc.Arbitrary<VerificationEvent> {
  return fc.record({
    timestamp: timestampArb,
    type: fc.constantFrom(
      "step_check" as const,
      "test_loop_iteration" as const,
      "fix_attempt" as const,
      "quality_gate" as const
    ),
    operationId: fc.option(fc.stringMatching(/^op-[a-z0-9]{3,10}$/), { nil: undefined }),
    status: fc.constantFrom("passed" as const, "failed" as const, "skipped" as const),
    details: fc.dictionary(
      fc.stringMatching(/^[a-z][a-zA-Z0-9]{1,10}$/),
      fc.oneof(fc.string(), fc.integer(), fc.boolean())
    ) as fc.Arbitrary<Record<string, unknown>>,
    duration: fc.integer({ min: 0, max: 60_000 }),
  });
}

/**
 * Generates an array of VerificationEvents with timestamps in non-decreasing order.
 * Uses a monotonically increasing base time to ensure ordering.
 */
const orderedTimelineArb: fc.Arbitrary<VerificationEvent[]> = fc
  .tuple(
    fc.integer({ min: 1_600_000_000_000, max: 1_700_000_000_000 }), // base epoch ms
    fc.array(
      fc.tuple(
        fc.integer({ min: 0, max: 10_000 }), // delta from the previous event
        verificationEventArb(fc.constant(new Date(0))), // timestamp replaced below
      ),
      { minLength: 1, maxLength: 50 },
    ),
  )
  .map(([baseTime, pairs]) => {
    let current = baseTime;
    return pairs.map(([delta, event]) => {
      current += delta;
      return { ...event, timestamp: new Date(current) };
    });
  });

/**
 * Generates a random array of VerificationEvents with potentially unordered timestamps.
 */
const randomTimelineArb: fc.Arbitrary<VerificationEvent[]> = fc.array(
  verificationEventArb(
    fc.integer({ min: 1_600_000_000_000, max: 1_700_000_000_000 }).map((ms) => new Date(ms))
  ),
  { minLength: 2, maxLength: 30 }
);

/**
 * Generates a valid FileOperation for use with the incremental verifier.
 */
function fileOperationArb(index: number): fc.Arbitrary<FileOperation> {
  return fc.record({
    id: fc.constant(`op-${index}`),
    type: fc.constantFrom("create" as const, "modify" as const, "delete" as const),
    filePath: fc.stringMatching(/^src\/[a-z][a-z0-9\-]{2,15}\.(ts|js)$/),
    dependsOn: fc.constant([] as string[]),
    rationale: fc.constant("Property test operation"),
    newContent: fc.constant("// generated"),
  });
}

/**
 * Generates a valid ImpactAnalysis stub.
 */
const impactAnalysisArb: fc.Arbitrary<ImpactAnalysis> = fc.constant({
  affectedTestFiles: [],
  affectedSourceFiles: [],
  traceDepth: 3,
  confidence: "high" as const,
  fullSuiteFallback: false,
});

/**
 * Generates a VerificationLevel that produces timeline entries (excludes 'none').
 */
const activeVerificationLevelArb: fc.Arbitrary<VerificationLevel> = fc.constantFrom(
  "lint_only" as const,
  "type_check" as const,
  "full_test" as const
);

// ─── Helper ─────────────────────────────────────────────────────────────────

/**
 * Asserts that timeline events are in non-decreasing timestamp order.
 */
function assertChronologicalOrder(timeline: VerificationEvent[]): void {
  for (let i = 1; i < timeline.length; i++) {
    const prev = timeline[i - 1].timestamp.getTime();
    const curr = timeline[i].timestamp.getTime();
    expect(curr).toBeGreaterThanOrEqual(prev);
  }
}

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("Feature: autonomous-codegen-pipelines, Property 18: Verification timeline chronological ordering", () => {
  beforeEach(() => {
    // Clear any session state before each test
    incrementalVerifierService.clearSession("prop-test-session");
  });

  it("timeline entries produced by sequential verifyStep calls are in non-decreasing timestamp order", () => {
    fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 10 }),
        activeVerificationLevelArb,
        async (stepCount, level) => {
          const sessionId = `prop-test-session-${Date.now()}-${Math.random().toString(36).slice(2)}`;

          try {
            // Call verifyStep sequentially multiple times
            for (let i = 0; i < stepCount; i++) {
              const operation: FileOperation = {
                id: `op-${i}`,
                type: "create",
                filePath: `src/file-${i}.ts`,
                dependsOn: [],
                rationale: "Property test operation",
                newContent: "// generated",
              };

              const impact: ImpactAnalysis = {
                affectedTestFiles: [],
                affectedSourceFiles: [],
                traceDepth: 3,
                confidence: "high",
                fullSuiteFallback: false,
              };

              await incrementalVerifierService.verifyStep(sessionId, operation, level, impact);
            }

            // Get cumulative report and verify timeline ordering
            const report = await incrementalVerifierService.getCumulativeReport(sessionId);

            expect(report.timeline.length).toBe(stepCount);
            assertChronologicalOrder(report.timeline);
          } finally {
            incrementalVerifierService.clearSession(sessionId);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("a pre-constructed ordered timeline satisfies the chronological ordering property", () => {
    fc.assert(
      fc.property(orderedTimelineArb, (timeline) => {
        // Verify the ordering invariant holds for correctly ordered timelines
        assertChronologicalOrder(timeline);
      }),
      { numRuns: 100 }
    );
  });

  it("random VerificationEvent arrays can be validated against the chronological ordering property", () => {
    fc.assert(
      fc.property(randomTimelineArb, (timeline) => {
        // Sort the timeline by timestamp (simulating correct report behavior)
        const sorted = [...timeline].sort(
          (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
        );

        // The sorted version should always satisfy the ordering property
        assertChronologicalOrder(sorted);

        // Check if original was already ordered
        let isOriginalOrdered = true;
        for (let i = 1; i < timeline.length; i++) {
          if (timeline[i].timestamp.getTime() < timeline[i - 1].timestamp.getTime()) {
            isOriginalOrdered = false;
            break;
          }
        }

        // If not ordered, the original should violate the property
        if (!isOriginalOrdered) {
          expect(() => assertChronologicalOrder(timeline)).toThrow();
        }
      }),
      { numRuns: 100 }
    );
  });

  it("getCumulativeReport produces a timeline that is always chronologically ordered", () => {
    fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 15 }),
        fc.constantFrom(
          "none" as VerificationLevel,
          "lint_only" as VerificationLevel,
          "type_check" as VerificationLevel,
          "full_test" as VerificationLevel
        ),
        async (stepCount, level) => {
          const sessionId = `prop-test-cumulative-${Date.now()}-${Math.random().toString(36).slice(2)}`;

          try {
            for (let i = 0; i < stepCount; i++) {
              const operation: FileOperation = {
                id: `op-${i}`,
                type: "modify",
                filePath: `src/module-${i}.ts`,
                dependsOn: [],
                rationale: "Cumulative report ordering test",
                changes: [
                  {
                    startLine: 1,
                    endLine: 3,
                    originalCode: "// old",
                    newCode: "// new",
                    contextLines: 2,
                  },
                ],
              };

              const impact: ImpactAnalysis = {
                affectedTestFiles: [],
                affectedSourceFiles: [],
                traceDepth: 3,
                confidence: "high",
                fullSuiteFallback: false,
              };

              await incrementalVerifierService.verifyStep(sessionId, operation, level, impact);
            }

            const report = await incrementalVerifierService.getCumulativeReport(sessionId);

            // For 'none' level, entries are skipped but still recorded
            // The timeline should still be chronologically ordered regardless
            if (report.timeline.length > 1) {
              assertChronologicalOrder(report.timeline);
            }
          } finally {
            incrementalVerifierService.clearSession(sessionId);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
