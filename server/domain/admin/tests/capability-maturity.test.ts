/**
 * Capability maturity derivation — see docs/CAPABILITY_MATURITY_RUBRIC.md.
 *
 * `maturity` was a hand-typed literal that nothing computed, nothing consumed
 * beyond a badge colour, and no document defined. These tests exist so it stays
 * a readout of artifacts rather than drifting back into an assertion.
 */
import { describe, it, expect } from "vitest";
import { deriveCapabilityMaturity } from "../infrastructure/capability-facts.js";

const base = {
    hasExecutableContract: true,
    demoCount: 1,
    executableReadinessCheckCount: 1,
    declared: "advanced",
} as const;

describe("deriveCapabilityMaturity", () => {
    it("awards advanced for contract + demo + executable readiness check", () => {
        expect(deriveCapabilityMaturity({ ...base }).earned).toBe("advanced");
    });

    it("stops at maturing when the pillar has no executable readiness check", () => {
        expect(deriveCapabilityMaturity({ ...base, executableReadinessCheckCount: 0 }).earned).toBe("maturing");
    });

    it("stops at foundation when nothing demonstrates it end to end", () => {
        expect(deriveCapabilityMaturity({ ...base, demoCount: 0 }).earned).toBe("foundation");
    });

    it("is experimental without an executable contract, whatever else exists", () => {
        const r = deriveCapabilityMaturity({ ...base, hasExecutableContract: false, demoCount: 9, executableReadinessCheckCount: 9 });
        expect(r.earned).toBe("experimental");
    });

    describe("the declared value is a ceiling, never a floor", () => {
        it("cannot raise a level the evidence does not support", () => {
            // The whole point: this is what "just set them all to advanced" used to do.
            const r = deriveCapabilityMaturity({
                hasExecutableContract: false,
                demoCount: 0,
                executableReadinessCheckCount: 0,
                declared: "advanced",
            });
            expect(r.maturity).toBe("experimental");
            expect(r.cappedByDeclaration).toBe(false);
        });

        it("lowers a level when the manifest declares a smaller ceiling", () => {
            const r = deriveCapabilityMaturity({ ...base, declared: "experimental" });
            expect(r.earned).toBe("advanced");
            expect(r.maturity).toBe("experimental");
            expect(r.cappedByDeclaration).toBe(true);
        });

        it("says in the rationale when a ceiling was applied", () => {
            const r = deriveCapabilityMaturity({ ...base, declared: "foundation" });
            expect(r.rationale).toMatch(/declared ceiling|declares that lower ceiling/i);
        });
    });

    it("names the artifacts behind every level rather than asserting one", () => {
        expect(deriveCapabilityMaturity({ ...base }).rationale).toContain("canonical demo");
        expect(deriveCapabilityMaturity({ ...base, demoCount: 0 }).rationale).toContain("no canonical demo");
        expect(deriveCapabilityMaturity({ ...base, hasExecutableContract: false }).rationale).toContain("No executable capability manifest");
    });
});
