/**
 * Property-based tests for OCEAN Bayesian Update Invariants (Property 12).
 *
 * Uses fast-check for property-based testing with a minimum of 100 iterations.
 * Tag: Feature: theory-of-mind, Property 12: OCEAN Bayesian Update Invariants
 *
 * **Validates: Requirements 12.1, 12.3, 12.5**
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { updateOceanProfile } from "./tom-async-extractor.js";
import type { OceanProfile } from "@shared/schema/agent/theory-of-mind.js";

// ─── Generators ──────────────────────────────────────────────────────────────

/** Default OCEAN profile: neutral baseline per Requirement 12.2 */
function makeDefaultProfile(): OceanProfile {
    return {
        openness: 0.5,
        conscientiousness: 0.5,
        extraversion: 0.5,
        agreeableness: 0.5,
        neuroticism: 0.5,
        confidence: 0,
        observationCount: 0,
        lastCalibratedAt: null,
    };
}

/**
 * Generate a single OCEAN observation signal — a partial OceanProfile
 * with at least one trait value in [0.0, 1.0].
 */
const oceanObservationArb = fc.record({
    openness: fc.double({ min: 0, max: 1, noNaN: true }),
    conscientiousness: fc.double({ min: 0, max: 1, noNaN: true }),
    extraversion: fc.double({ min: 0, max: 1, noNaN: true }),
    agreeableness: fc.double({ min: 0, max: 1, noNaN: true }),
    neuroticism: fc.double({ min: 0, max: 1, noNaN: true }),
});

/** Generate a sequence of OCEAN observations (1 to 30 observations) */
const oceanObservationSequenceArb = fc.array(oceanObservationArb, { minLength: 1, maxLength: 30 });

// ─── Properties ──────────────────────────────────────────────────────────────

describe("Feature: theory-of-mind, Property 12: OCEAN Bayesian Update Invariants", () => {
    describe("Trait scores remain bounded in [0.0, 1.0] after every update", () => {
        /**
         * For any sequence of OCEAN observations applied via updateOceanProfile,
         * all five trait scores SHALL remain in the range [0.0, 1.0] after EVERY update.
         */
        it("all five trait scores stay in [0.0, 1.0] after each observation in a sequence", () => {
            fc.assert(
                fc.property(oceanObservationSequenceArb, (observations) => {
                    let profile = makeDefaultProfile();

                    for (const obs of observations) {
                        profile = updateOceanProfile(profile, obs);

                        // Assert all five traits are within bounds after each step
                        expect(profile.openness).toBeGreaterThanOrEqual(0.0);
                        expect(profile.openness).toBeLessThanOrEqual(1.0);
                        expect(profile.conscientiousness).toBeGreaterThanOrEqual(0.0);
                        expect(profile.conscientiousness).toBeLessThanOrEqual(1.0);
                        expect(profile.extraversion).toBeGreaterThanOrEqual(0.0);
                        expect(profile.extraversion).toBeLessThanOrEqual(1.0);
                        expect(profile.agreeableness).toBeGreaterThanOrEqual(0.0);
                        expect(profile.agreeableness).toBeLessThanOrEqual(1.0);
                        expect(profile.neuroticism).toBeGreaterThanOrEqual(0.0);
                        expect(profile.neuroticism).toBeLessThanOrEqual(1.0);
                    }
                }),
                { numRuns: 100 },
            );
        });
    });

    describe("observationCount increments correctly", () => {
        /**
         * After applying a sequence of N observations starting from default profile,
         * observationCount should equal N.
         */
        it("observationCount increments by 1 per observation", () => {
            fc.assert(
                fc.property(oceanObservationSequenceArb, (observations) => {
                    let profile = makeDefaultProfile();

                    for (let i = 0; i < observations.length; i++) {
                        profile = updateOceanProfile(profile, observations[i]);
                        expect(profile.observationCount).toBe(i + 1);
                    }
                }),
                { numRuns: 100 },
            );
        });
    });

    describe("Confidence bounded by observation count", () => {
        /**
         * The confidence field SHALL not exceed 60 when observationCount < 10.
         * Confidence is always in [0, 100].
         */
        it("confidence ≤ 60 when observationCount < 10", () => {
            fc.assert(
                fc.property(oceanObservationSequenceArb, (observations) => {
                    let profile = makeDefaultProfile();

                    for (const obs of observations) {
                        profile = updateOceanProfile(profile, obs);

                        // Confidence always in [0, 100]
                        expect(profile.confidence).toBeGreaterThanOrEqual(0);
                        expect(profile.confidence).toBeLessThanOrEqual(100);

                        // When observationCount < 10, confidence must not exceed 60
                        if (profile.observationCount < 10) {
                            expect(profile.confidence).toBeLessThanOrEqual(60);
                        }
                    }
                }),
                { numRuns: 100 },
            );
        });
    });

    describe("OCEAN context string inclusion rule", () => {
        /**
         * OCEAN traits SHALL appear in getContextString() output
         * if and only if confidence > 50.
         *
         * We test the condition directly on the profile:
         * - confidence > 50 → OCEAN section would be included
         * - confidence ≤ 50 → OCEAN section would NOT be included
         *
         * This tests the threshold logic by verifying that the confidence
         * formula used in updateOceanProfile produces values consistent with
         * the getContextString inclusion rule (confidence > 50 requires
         * sufficient observations).
         */
        it("confidence > 50 requires at least 10 observations (consistent with context inclusion rule)", () => {
            fc.assert(
                fc.property(oceanObservationSequenceArb, (observations) => {
                    let profile = makeDefaultProfile();

                    for (const obs of observations) {
                        profile = updateOceanProfile(profile, obs);

                        // If confidence > 50, observationCount must be >= 10
                        // This validates the design constraint that OCEAN only
                        // appears in context (confidence > 50) after sufficient observations
                        if (profile.confidence > 50) {
                            expect(profile.observationCount).toBeGreaterThanOrEqual(10);
                        }
                    }
                }),
                { numRuns: 100 },
            );
        });
    });

    describe("Bayesian update formula correctness", () => {
        /**
         * The update formula is: new = prior × 0.9 + observation × 0.1
         * Verify the formula produces the expected result for each trait.
         */
        it("each trait follows the dampening formula: new = prior * 0.9 + observation * 0.1", () => {
            fc.assert(
                fc.property(oceanObservationArb, (obs) => {
                    const profile = makeDefaultProfile();
                    const updated = updateOceanProfile(profile, obs);

                    const DAMPENING = 0.1;
                    const traits = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'] as const;

                    for (const trait of traits) {
                        const expected = profile[trait] * (1 - DAMPENING) + obs[trait] * DAMPENING;
                        const clamped = Math.max(0, Math.min(1, expected));
                        expect(updated[trait]).toBeCloseTo(clamped, 10);
                    }
                }),
                { numRuns: 100 },
            );
        });
    });

    describe("Partial observations (subset of traits)", () => {
        /**
         * When only a subset of traits are provided as signals,
         * only those traits should update and observationCount still increments.
         */
        it("partial signals only update provided traits, unchanged traits stay the same", () => {
            const partialObsArb = fc.oneof(
                fc.record({ openness: fc.double({ min: 0, max: 1, noNaN: true }) }),
                fc.record({ conscientiousness: fc.double({ min: 0, max: 1, noNaN: true }), neuroticism: fc.double({ min: 0, max: 1, noNaN: true }) }),
                fc.record({ extraversion: fc.double({ min: 0, max: 1, noNaN: true }), agreeableness: fc.double({ min: 0, max: 1, noNaN: true }) }),
            );

            fc.assert(
                fc.property(partialObsArb, (obs) => {
                    const profile = makeDefaultProfile();
                    const updated = updateOceanProfile(profile, obs as Partial<OceanProfile>);

                    const traits = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'] as const;

                    for (const trait of traits) {
                        if (trait in obs) {
                            // Updated trait should differ from prior (unless observation equals prior)
                            const DAMPENING = 0.1;
                            const expected = profile[trait] * (1 - DAMPENING) + (obs as any)[trait] * DAMPENING;
                            expect(updated[trait]).toBeCloseTo(Math.max(0, Math.min(1, expected)), 10);
                        } else {
                            // Unchanged trait stays the same
                            expect(updated[trait]).toBe(profile[trait]);
                        }
                    }

                    // observationCount still increments
                    expect(updated.observationCount).toBe(1);
                }),
                { numRuns: 100 },
            );
        });
    });
});
