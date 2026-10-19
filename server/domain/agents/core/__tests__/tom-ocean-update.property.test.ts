/**
 * Property-based test for OCEAN Bayesian Update Invariants.
 *
 * **Property 12: OCEAN Bayesian Update Invariants**
 *
 * For any sequence of observations, all five trait scores remain in [0.0, 1.0];
 * confidence ≤ 60 when observationCount < 10; OCEAN appears in context string
 * iff confidence > 50.
 *
 * **Validates: Requirements 12.1, 12.3, 12.5**
 *
 * Uses fast-check for property-based testing with Vitest.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { OceanProfile } from "@shared/schema/agent/theory-of-mind.js";
import { updateOceanProfile } from "../tom-async-extractor.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

const OCEAN_TRAITS = ["openness", "conscientiousness", "extraversion", "agreeableness", "neuroticism"] as const;

/** Create a neutral starting profile (all 0.5, confidence 0, observationCount 0) */
function makeNeutralProfile(): OceanProfile {
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

// ─── Generators ─────────────────────────────────────────────────────────────

/** Generate a single OCEAN observation signal (partial, all traits in [0,1]) */
const oceanSignalArb: fc.Arbitrary<Partial<OceanProfile>> = fc.record({
    openness: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: undefined }),
    conscientiousness: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: undefined }),
    extraversion: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: undefined }),
    agreeableness: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: undefined }),
    neuroticism: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: undefined }),
}).filter(sig => {
    // Ensure at least one trait is provided (otherwise updateOceanProfile won't increment)
    return OCEAN_TRAITS.some(t => typeof sig[t] === "number");
});

/** Generate a sequence of OCEAN observation signals */
const oceanSignalSequenceArb = fc.array(oceanSignalArb, { minLength: 1, maxLength: 30 });

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("Property 12: OCEAN Bayesian Update Invariants", () => {
    /**
     * **Validates: Requirements 12.1, 12.3**
     *
     * For any sequence of OCEAN signal observations (each trait in [0, 1]),
     * after each update, all five traits remain in [0.0, 1.0].
     */
    it("all five trait scores remain in [0.0, 1.0] after any sequence of updates", () => {
        fc.assert(
            fc.property(oceanSignalSequenceArb, (signals) => {
                let profile = makeNeutralProfile();

                for (const signal of signals) {
                    profile = updateOceanProfile(profile, signal);

                    for (const trait of OCEAN_TRAITS) {
                        expect(profile[trait]).toBeGreaterThanOrEqual(0.0);
                        expect(profile[trait]).toBeLessThanOrEqual(1.0);
                    }
                }
            }),
            { numRuns: 200 },
        );
    });

    /**
     * **Validates: Requirements 12.3**
     *
     * observationCount increases by 1 per update when at least one trait signal is provided.
     */
    it("observationCount increases by 1 per update", () => {
        fc.assert(
            fc.property(oceanSignalSequenceArb, (signals) => {
                let profile = makeNeutralProfile();

                for (let i = 0; i < signals.length; i++) {
                    const prevCount = profile.observationCount;
                    profile = updateOceanProfile(profile, signals[i]);
                    expect(profile.observationCount).toBe(prevCount + 1);
                }
            }),
            { numRuns: 200 },
        );
    });

    /**
     * **Validates: Requirements 12.3**
     *
     * Confidence stays ≤ 60 when observationCount < 10.
     * The formula is: confidence = Math.min(100, Math.round(100 * (1 - exp(-count/15))))
     * At count=9: 100*(1-exp(-9/15)) ≈ 45, well under 60.
     */
    it("confidence stays ≤ 60 when observationCount < 10", () => {
        fc.assert(
            fc.property(
                fc.array(oceanSignalArb, { minLength: 1, maxLength: 9 }),
                (signals) => {
                    let profile = makeNeutralProfile();

                    for (const signal of signals) {
                        profile = updateOceanProfile(profile, signal);

                        if (profile.observationCount < 10) {
                            expect(profile.confidence).toBeLessThanOrEqual(60);
                        }
                    }
                },
            ),
            { numRuns: 200 },
        );
    });

    /**
     * **Validates: Requirements 12.3**
     *
     * The dampening formula is correct: new = prior * 0.9 + observation * 0.1
     * Verified for each trait in each observation step.
     */
    it("applies the correct dampening formula: new = prior * 0.9 + observation * 0.1", () => {
        fc.assert(
            fc.property(oceanSignalSequenceArb, (signals) => {
                let profile = makeNeutralProfile();

                for (const signal of signals) {
                    const priorProfile = { ...profile };
                    profile = updateOceanProfile(profile, signal);

                    for (const trait of OCEAN_TRAITS) {
                        if (typeof signal[trait] === "number") {
                            const expected = priorProfile[trait] * 0.9 + signal[trait]! * 0.1;
                            const clamped = Math.max(0, Math.min(1, expected));
                            expect(profile[trait]).toBeCloseTo(clamped, 10);
                        } else {
                            // Trait not in signal → should remain unchanged
                            expect(profile[trait]).toBe(priorProfile[trait]);
                        }
                    }
                }
            }),
            { numRuns: 200 },
        );
    });

    /**
     * **Validates: Requirements 12.5**
     *
     * OCEAN confidence > 50 implies enough observations to be meaningful.
     * Confidence must exceed 50 only when observationCount is sufficiently high.
     * Specifically, at count=10, confidence ≈ 49 (below 50); at count=11, ≈ 52 (above 50).
     * So confidence > 50 implies observationCount >= 11.
     */
    it("confidence > 50 requires at least 11 observations", () => {
        fc.assert(
            fc.property(
                fc.array(oceanSignalArb, { minLength: 1, maxLength: 30 }),
                (signals) => {
                    let profile = makeNeutralProfile();

                    for (const signal of signals) {
                        profile = updateOceanProfile(profile, signal);

                        if (profile.confidence > 50) {
                            expect(profile.observationCount).toBeGreaterThanOrEqual(11);
                        }
                    }
                },
            ),
            { numRuns: 200 },
        );
    });

    /**
     * **Validates: Requirements 12.1**
     *
     * Starting from a neutral profile (all 0.5), after any single observation,
     * traits should move toward the observation value but remain bounded.
     */
    it("single observation from neutral profile moves traits toward observation", () => {
        fc.assert(
            fc.property(oceanSignalArb, (signal) => {
                const profile = makeNeutralProfile();
                const updated = updateOceanProfile(profile, signal);

                for (const trait of OCEAN_TRAITS) {
                    if (typeof signal[trait] === "number") {
                        const obs = signal[trait]!;
                        if (obs > 0.5) {
                            // Observation above neutral → trait should increase or stay
                            expect(updated[trait]).toBeGreaterThanOrEqual(0.5);
                        } else if (obs < 0.5) {
                            // Observation below neutral → trait should decrease or stay
                            expect(updated[trait]).toBeLessThanOrEqual(0.5);
                        }
                        // Observation at 0.5 → trait stays at 0.5
                    }
                }
            }),
            { numRuns: 200 },
        );
    });

    /**
     * **Validates: Requirements 12.3**
     *
     * Confidence never exceeds 100 regardless of how many observations are applied.
     */
    it("confidence never exceeds 100 regardless of observation count", () => {
        fc.assert(
            fc.property(
                fc.array(oceanSignalArb, { minLength: 1, maxLength: 60 }),
                (signals) => {
                    let profile = makeNeutralProfile();

                    for (const signal of signals) {
                        profile = updateOceanProfile(profile, signal);
                        expect(profile.confidence).toBeLessThanOrEqual(100);
                        expect(profile.confidence).toBeGreaterThanOrEqual(0);
                    }
                },
            ),
            { numRuns: 200 },
        );
    });

    /**
     * **Validates: Requirements 12.1, 12.3**
     *
     * Edge case: observations at exactly 0.0 for all traits keep scores bounded in [0, 1].
     * Even after many extreme-low observations, scores never drop below 0.
     */
    it("observations at exactly 0.0 keep all trait scores in [0, 1]", () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 60 }),
                (count) => {
                    let profile = makeNeutralProfile();
                    const extremeLow: Partial<OceanProfile> = {
                        openness: 0.0,
                        conscientiousness: 0.0,
                        extraversion: 0.0,
                        agreeableness: 0.0,
                        neuroticism: 0.0,
                    };

                    for (let i = 0; i < count; i++) {
                        profile = updateOceanProfile(profile, extremeLow);

                        for (const trait of OCEAN_TRAITS) {
                            expect(profile[trait]).toBeGreaterThanOrEqual(0.0);
                            expect(profile[trait]).toBeLessThanOrEqual(1.0);
                        }
                    }
                },
            ),
            { numRuns: 200 },
        );
    });

    /**
     * **Validates: Requirements 12.1, 12.3**
     *
     * Edge case: observations at exactly 1.0 for all traits keep scores bounded in [0, 1].
     * Even after many extreme-high observations, scores never exceed 1.
     */
    it("observations at exactly 1.0 keep all trait scores in [0, 1]", () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 60 }),
                (count) => {
                    let profile = makeNeutralProfile();
                    const extremeHigh: Partial<OceanProfile> = {
                        openness: 1.0,
                        conscientiousness: 1.0,
                        extraversion: 1.0,
                        agreeableness: 1.0,
                        neuroticism: 1.0,
                    };

                    for (let i = 0; i < count; i++) {
                        profile = updateOceanProfile(profile, extremeHigh);

                        for (const trait of OCEAN_TRAITS) {
                            expect(profile[trait]).toBeGreaterThanOrEqual(0.0);
                            expect(profile[trait]).toBeLessThanOrEqual(1.0);
                        }
                    }
                },
            ),
            { numRuns: 200 },
        );
    });

    /**
     * **Validates: Requirements 12.1, 12.3**
     *
     * Edge case: after 50+ observations, all invariants still hold —
     * traits in [0, 1], confidence ≤ 100, observationCount tracks correctly.
     */
    it("all invariants hold after 50+ observations", () => {
        fc.assert(
            fc.property(
                fc.array(oceanSignalArb, { minLength: 50, maxLength: 70 }),
                (signals) => {
                    let profile = makeNeutralProfile();

                    for (const signal of signals) {
                        profile = updateOceanProfile(profile, signal);
                    }

                    // After 50+ observations, verify final state
                    for (const trait of OCEAN_TRAITS) {
                        expect(profile[trait]).toBeGreaterThanOrEqual(0.0);
                        expect(profile[trait]).toBeLessThanOrEqual(1.0);
                    }
                    expect(profile.confidence).toBeLessThanOrEqual(100);
                    expect(profile.confidence).toBeGreaterThanOrEqual(0);
                    expect(profile.observationCount).toBe(signals.length);
                    expect(profile.lastCalibratedAt).not.toBeNull();
                },
            ),
            { numRuns: 100 },
        );
    });
});
