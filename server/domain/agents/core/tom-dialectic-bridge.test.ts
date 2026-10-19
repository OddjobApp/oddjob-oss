/**
 * Tests for the Theory of Mind — Dialectic Reconciliation Bridge.
 * Validates that communication style signals are correctly mapped to OCEAN traits.
 *
 * Requirements: 12.6, 13.2
 */
import { describe, it, expect } from "vitest";
import { mapStyleToOcean } from "./tom-dialectic-bridge.js";

describe("tom-dialectic-bridge: mapStyleToOcean", () => {
    it("returns null for empty or missing style", () => {
        expect(mapStyleToOcean({})).toBeNull();
        expect(mapStyleToOcean(null as any)).toBeNull();
        expect(mapStyleToOcean(undefined as any)).toBeNull();
    });

    it("maps high verbosity → high openness + high extraversion", () => {
        const signals = mapStyleToOcean({ verbosity: "high" });
        expect(signals).not.toBeNull();
        expect(signals!.openness).toBeGreaterThanOrEqual(0.7);
        expect(signals!.extraversion).toBeGreaterThanOrEqual(0.7);
    });

    it("maps low verbosity / concise → low openness + low extraversion", () => {
        const signals = mapStyleToOcean({ verbosity: "concise" });
        expect(signals).not.toBeNull();
        expect(signals!.openness).toBeLessThanOrEqual(0.5);
        expect(signals!.extraversion).toBeLessThanOrEqual(0.4);
    });

    it("maps formal tone → high conscientiousness", () => {
        const signals = mapStyleToOcean({ formality: "formal" });
        expect(signals).not.toBeNull();
        expect(signals!.conscientiousness).toBeGreaterThanOrEqual(0.7);
    });

    it("maps informal tone → low conscientiousness", () => {
        const signals = mapStyleToOcean({ formality: "casual" });
        expect(signals).not.toBeNull();
        expect(signals!.conscientiousness).toBeLessThanOrEqual(0.4);
    });

    it("maps friendly tone → high agreeableness + low neuroticism", () => {
        const signals = mapStyleToOcean({ tone: "friendly" });
        expect(signals).not.toBeNull();
        expect(signals!.agreeableness).toBeGreaterThanOrEqual(0.7);
        expect(signals!.neuroticism).toBeLessThanOrEqual(0.4);
    });

    it("maps direct/terse tone → low agreeableness", () => {
        const signals = mapStyleToOcean({ tone: "direct" });
        expect(signals).not.toBeNull();
        expect(signals!.agreeableness).toBeLessThanOrEqual(0.4);
    });

    it("maps varied vocabulary → high openness", () => {
        const signals = mapStyleToOcean({ vocabulary: "varied" });
        expect(signals).not.toBeNull();
        expect(signals!.openness).toBeGreaterThanOrEqual(0.7);
    });

    it("maps anxious tone → high neuroticism", () => {
        const signals = mapStyleToOcean({ tone: "anxious" });
        expect(signals).not.toBeNull();
        expect(signals!.neuroticism).toBeGreaterThanOrEqual(0.7);
    });

    it("handles combined style signals", () => {
        const signals = mapStyleToOcean({
            verbosity: "detailed",
            formality: "professional",
            tone: "warm",
            vocabulary: "rich",
        });
        expect(signals).not.toBeNull();
        expect(signals!.openness).toBeGreaterThanOrEqual(0.7);
        expect(signals!.conscientiousness).toBeGreaterThanOrEqual(0.7);
        expect(signals!.extraversion).toBeGreaterThanOrEqual(0.7);
        expect(signals!.agreeableness).toBeGreaterThanOrEqual(0.7);
    });

    it("handles numeric values (0-1 range) as style indicators", () => {
        const signals = mapStyleToOcean({ verbosity: 0.9, formality: 0.2 });
        expect(signals).not.toBeNull();
        // 0.9 → 'high' → high openness + extraversion
        expect(signals!.openness).toBeGreaterThanOrEqual(0.7);
        // 0.2 → 'low' → low conscientiousness
        expect(signals!.conscientiousness).toBeLessThanOrEqual(0.4);
    });

    it("ignores neutral numeric values (not strongly high or low)", () => {
        const signals = mapStyleToOcean({ verbosity: 0.5 });
        // 0.5 is neutral — no strong signal
        expect(signals).toBeNull();
    });

    it("handles boolean values as style indicators", () => {
        const signals = mapStyleToOcean({ verbose: true, formal: false });
        expect(signals).not.toBeNull();
        // true → 'high' → high verbosity → high openness + extraversion
        expect(signals!.openness).toBeGreaterThanOrEqual(0.7);
        // false → 'low' → informal → low conscientiousness
        expect(signals!.conscientiousness).toBeLessThanOrEqual(0.4);
    });

    it("all output values are between 0.0 and 1.0", () => {
        const styles = [
            { verbosity: "high", formality: "formal", tone: "friendly", vocabulary: "varied", directness: "direct" },
            { verbosity: "low", formality: "casual", tone: "anxious", vocabulary: "simple", directness: "indirect" },
        ];

        for (const style of styles) {
            const signals = mapStyleToOcean(style);
            if (signals) {
                for (const [key, value] of Object.entries(signals)) {
                    if (typeof value === 'number') {
                        expect(value, `${key} should be in [0, 1]`).toBeGreaterThanOrEqual(0);
                        expect(value, `${key} should be in [0, 1]`).toBeLessThanOrEqual(1);
                    }
                }
            }
        }
    });
});
