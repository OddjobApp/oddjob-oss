/**
 * Property-based test for Cognitive State Assessment Validity.
 *
 * **Property 5: Cognitive State Assessment Validity**
 *
 * For any user message string, the sync assessor SHALL produce a CognitiveState
 * where all dimensional scores (frustration, confusion, urgency, explorationVsGoal)
 * are integers in the range [0, 100] and assessedAt is a valid ISO 8601 timestamp
 * not in the future.
 *
 * **Validates: Requirements 5.1, 5.2**
 *
 * Uses fast-check for property-based testing with Vitest.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { extractCognitiveSignals } from "../tom-sync-assessor.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Validates that a string is a valid ISO 8601 timestamp.
 * A valid ISO 8601 string parses to a valid Date and round-trips through toISOString().
 */
function isValidISO8601(str: string): boolean {
    const date = new Date(str);
    if (isNaN(date.getTime())) return false;
    // Verify it's a well-formed ISO string (Date constructor is lenient)
    return date.toISOString() === str;
}

/**
 * Check that a timestamp is not in the future (with a small tolerance of 5 seconds
 * to account for test execution time).
 */
function isNotInFuture(isoStr: string): boolean {
    const timestamp = new Date(isoStr).getTime();
    const now = Date.now() + 5000; // 5s tolerance
    return timestamp <= now;
}

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("Property 5: Cognitive State Assessment Validity", () => {
    /**
     * **Validates: Requirements 5.1, 5.2**
     *
     * For any arbitrary message string and array of prior messages,
     * extractCognitiveSignals produces a CognitiveState where:
     * - frustration is an integer in [0, 100]
     * - confusion is an integer in [0, 100]
     * - urgency is an integer in [0, 100]
     * - explorationVsGoal is an integer in [0, 100]
     * - assessedAt is a valid ISO 8601 timestamp not in the future
     */
    it("produces valid CognitiveState scores in [0, 100] for any message input", () => {
        fc.assert(
            fc.property(
                fc.string(),
                fc.array(fc.string()),
                (message, priorMessages) => {
                    const result = extractCognitiveSignals(message, priorMessages);

                    // All dimensional scores must be integers in [0, 100]
                    expect(Number.isInteger(result.frustration)).toBe(true);
                    expect(result.frustration).toBeGreaterThanOrEqual(0);
                    expect(result.frustration).toBeLessThanOrEqual(100);

                    expect(Number.isInteger(result.confusion)).toBe(true);
                    expect(result.confusion).toBeGreaterThanOrEqual(0);
                    expect(result.confusion).toBeLessThanOrEqual(100);

                    expect(Number.isInteger(result.urgency)).toBe(true);
                    expect(result.urgency).toBeGreaterThanOrEqual(0);
                    expect(result.urgency).toBeLessThanOrEqual(100);

                    expect(Number.isInteger(result.explorationVsGoal)).toBe(true);
                    expect(result.explorationVsGoal).toBeGreaterThanOrEqual(0);
                    expect(result.explorationVsGoal).toBeLessThanOrEqual(100);
                },
            ),
            { numRuns: 200 },
        );
    });

    /**
     * **Validates: Requirements 5.1, 5.2**
     *
     * assessedAt is a valid ISO 8601 timestamp that is not in the future.
     */
    it("produces a valid ISO 8601 assessedAt timestamp not in the future", () => {
        fc.assert(
            fc.property(
                fc.string(),
                fc.array(fc.string()),
                (message, priorMessages) => {
                    const result = extractCognitiveSignals(message, priorMessages);

                    // assessedAt must be a non-null string
                    expect(result.assessedAt).not.toBeNull();
                    expect(typeof result.assessedAt).toBe("string");

                    // Must be valid ISO 8601
                    expect(isValidISO8601(result.assessedAt!)).toBe(true);

                    // Must not be in the future
                    expect(isNotInFuture(result.assessedAt!)).toBe(true);
                },
            ),
            { numRuns: 200 },
        );
    });

    /**
     * **Validates: Requirements 5.1, 5.2**
     *
     * Edge case: empty message and empty prior messages still produce valid output.
     */
    it("produces valid CognitiveState for empty inputs", () => {
        const result = extractCognitiveSignals("", []);

        expect(Number.isInteger(result.frustration)).toBe(true);
        expect(result.frustration).toBeGreaterThanOrEqual(0);
        expect(result.frustration).toBeLessThanOrEqual(100);

        expect(Number.isInteger(result.confusion)).toBe(true);
        expect(result.confusion).toBeGreaterThanOrEqual(0);
        expect(result.confusion).toBeLessThanOrEqual(100);

        expect(Number.isInteger(result.urgency)).toBe(true);
        expect(result.urgency).toBeGreaterThanOrEqual(0);
        expect(result.urgency).toBeLessThanOrEqual(100);

        expect(Number.isInteger(result.explorationVsGoal)).toBe(true);
        expect(result.explorationVsGoal).toBeGreaterThanOrEqual(0);
        expect(result.explorationVsGoal).toBeLessThanOrEqual(100);

        expect(result.assessedAt).not.toBeNull();
        expect(isValidISO8601(result.assessedAt!)).toBe(true);
        expect(isNotInFuture(result.assessedAt!)).toBe(true);
    });

    /**
     * **Validates: Requirements 5.1, 5.2**
     *
     * Stress test with adversarial strings: unicode, very long strings,
     * excessive punctuation, all-caps, etc.
     */
    it("handles adversarial message strings without violating bounds", () => {
        fc.assert(
            fc.property(
                fc.oneof(
                    fc.unicodeString({ minLength: 0, maxLength: 1000 }),
                    fc.string({ minLength: 500, maxLength: 2000 }),
                    // All caps messages
                    fc.string({ minLength: 1, maxLength: 200 }).map(s => s.toUpperCase()),
                    // Heavy punctuation
                    fc.string({ minLength: 1, maxLength: 100 }).map(s => s + "!!!???!!!"),
                ),
                fc.array(fc.string(), { minLength: 0, maxLength: 10 }),
                (message, priorMessages) => {
                    const result = extractCognitiveSignals(message, priorMessages);

                    expect(result.frustration).toBeGreaterThanOrEqual(0);
                    expect(result.frustration).toBeLessThanOrEqual(100);
                    expect(result.confusion).toBeGreaterThanOrEqual(0);
                    expect(result.confusion).toBeLessThanOrEqual(100);
                    expect(result.urgency).toBeGreaterThanOrEqual(0);
                    expect(result.urgency).toBeLessThanOrEqual(100);
                    expect(result.explorationVsGoal).toBeGreaterThanOrEqual(0);
                    expect(result.explorationVsGoal).toBeLessThanOrEqual(100);

                    expect(result.assessedAt).not.toBeNull();
                    expect(isValidISO8601(result.assessedAt!)).toBe(true);
                },
            ),
            { numRuns: 200 },
        );
    });
});
