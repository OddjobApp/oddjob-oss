import { describe, expect, it } from "vitest";
import { ODDJOB_CAPABILITIES } from "./oddjob-capability-manifest.js";
import {
    ODDJOB_EXECUTABLE_CAPABILITY_MANIFESTS,
    PRODUCT_TO_EXECUTABLE_CAPABILITY_ID,
} from "./oddjob-executable-capability-manifests.js";

describe("executable product capability manifests", () => {
    it("covers every canonical product capability exactly once", () => {
        expect(Object.keys(PRODUCT_TO_EXECUTABLE_CAPABILITY_ID).sort()).toEqual(
            ODDJOB_CAPABILITIES.map((capability) => capability.id).sort(),
        );
        expect(ODDJOB_EXECUTABLE_CAPABILITY_MANIFESTS.map((manifest) => manifest.capability_id).sort()).toEqual(
            Object.values(PRODUCT_TO_EXECUTABLE_CAPABILITY_ID).sort(),
        );
    });

    it("uses unique ids and non-empty contracts", () => {
        const ids = ODDJOB_EXECUTABLE_CAPABILITY_MANIFESTS.map((manifest) => manifest.capability_id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const manifest of ODDJOB_EXECUTABLE_CAPABILITY_MANIFESTS) {
            expect(Object.keys(manifest.technical_spec.inputs).length).toBeGreaterThan(0);
            expect(Object.keys(manifest.technical_spec.outputs).length).toBeGreaterThan(0);
            expect(manifest.documentation_meta.business_use_cases.length).toBeGreaterThan(0);
            expect(manifest.documentation_meta.guardrails.length).toBeGreaterThan(0);
        }
    });
});

