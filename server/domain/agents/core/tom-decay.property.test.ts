/**
 * Property-based test: Temporal Decay Formula Correctness (Property 6)
 *
 * For any original confidence in [0,100], elapsed ≥ 0, halfLife > 0,
 * computeEffectiveConfidence returns original × 0.5^(elapsed/halfLife)
 * within ε=0.001. When halfLife is Infinity, returns original unchanged.
 * When elapsed is 0, returns original unchanged.
 * Result is always in [0, original].
 *
 * **Validates: Requirements 8.1, 8.3, 8.4**
 *
 * Uses fast-check for property-based testing with a minimum of 100 iterations.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import { computeEffectiveConfidence } from "./theory-of-mind.service.js";

// ─── fast-check Arbitraries ─────────────────────────────────────────────────

/** Original confidence in [0, 100] */
const confidenceArb = fc.double({ min: 0, max: 100, noNaN: true });

/** Elapsed time in ms, non-negative, up to ~31.7 years */
const elapsedArb = fc.double({ min: 0, max: 1e9, noNaN: true });

/** Half-life in ms, always > 0 (up to ~31.7 years) */
const halfLifeArb = fc.double({ min: 1, max: 1e9, noNaN: true });

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Property 6: Temporal Decay Formula Correctness", () => {
    it("result equals original × 0.5^(elapsed/halfLife) within ε=0.001", () => {
        fc.assert(
            fc.property(confidenceArb, elapsedArb, halfLifeArb, (original, elapsed, halfLife) => {
                const result = computeEffectiveConfidence(original, elapsed, halfLife);
                const expected = original * Math.pow(0.5, elapsed / halfLife);
                expect(Math.abs(result - expected)).toBeLessThan(0.001);
            }),
            { numRuns: 100 },
        );
    });

    it("when halfLife is Infinity, result === original (exact equality)", () => {
        fc.assert(
            fc.property(confidenceArb, elapsedArb, (original, elapsed) => {
                const result = computeEffectiveConfidence(original, elapsed, Infinity);
                expect(result).toBe(original);
            }),
            { numRuns: 100 },
        );
    });

    it("when elapsed is 0, result === original (exact equality)", () => {
        fc.assert(
            fc.property(confidenceArb, halfLifeArb, (original, halfLife) => {
                const result = computeEffectiveConfidence(original, 0, halfLife);
                expect(result).toBe(original);
            }),
            { numRuns: 100 },
        );
    });

    it("result is always in [0, original] (monotonically decreasing)", () => {
        fc.assert(
            fc.property(confidenceArb, elapsedArb, halfLifeArb, (original, elapsed, halfLife) => {
                const result = computeEffectiveConfidence(original, elapsed, halfLife);
                expect(result).toBeGreaterThanOrEqual(0);
                expect(result).toBeLessThanOrEqual(original);
            }),
            { numRuns: 100 },
        );
    });
});
