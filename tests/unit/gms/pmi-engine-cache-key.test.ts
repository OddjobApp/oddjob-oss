/**
 * PMIEngine result-cache keying.
 *
 * gms_synthesize_missions exposes a per-request topK. The engine caches
 * synthesis results, so topK has to be part of the cache identity — otherwise a
 * request for topK=10 is served the candidate list cached for topK=5 and the
 * parameter appears to work on a cold cache and silently stop working after.
 *
 * getCacheKey only reads `request` and `this.config`, so no initialize() call is
 * needed here.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from "vitest";
import { PMIEngine } from "@server/core/gms/pmi/pmi-engine.js";
import type { SynthesizeRequest } from "@server/core/gms/common/types.js";

const verifier = {} as any;

function keyFor(request: SynthesizeRequest, config: Record<string, unknown> = {}) {
    const engine = new PMIEngine(verifier, { topK: 5, nCandidates: 20, ...config } as any);
    return (engine as any).getCacheKey(request) as string;
}

const base: SynthesizeRequest = { request: "build me a triage mission" };

describe("PMIEngine.getCacheKey", () => {
    it("distinguishes requests that differ only by topK", () => {
        const five = keyFor({ ...base, options: { topK: 5 } });
        const ten = keyFor({ ...base, options: { topK: 10 } });
        expect(five).not.toBe(ten);
    });

    it("treats an explicit topK equal to the engine default as the default", () => {
        expect(keyFor({ ...base, options: { topK: 5 } })).toBe(keyFor(base));
    });

    it("falls back to the configured topK when the override is absent or invalid", () => {
        const fallback = keyFor(base);
        expect(keyFor({ ...base, options: {} })).toBe(fallback);
        expect(keyFor({ ...base, options: { topK: 0 } })).toBe(fallback);
        expect(keyFor({ ...base, options: { topK: -3 } })).toBe(fallback);
        expect(keyFor({ ...base, options: { topK: 2.5 } })).toBe(fallback);
    });

    it("distinguishes requests that differ only by nCandidates", () => {
        const few = keyFor({ ...base, options: { nCandidates: 5 } });
        const many = keyFor({ ...base, options: { nCandidates: 30 } });
        expect(few).not.toBe(many);
    });

    it("falls back to the configured nCandidates when the override is absent or invalid", () => {
        const fallback = keyFor(base);
        expect(keyFor({ ...base, options: { nCandidates: 20 } })).toBe(fallback);
        expect(keyFor({ ...base, options: { nCandidates: 0 } })).toBe(fallback);
        expect(keyFor({ ...base, options: { nCandidates: -2 } })).toBe(fallback);
    });

    it("distinguishes the two options independently", () => {
        const both = keyFor({ ...base, options: { nCandidates: 30, topK: 10 } });
        expect(both).not.toBe(keyFor({ ...base, options: { nCandidates: 30 } }));
        expect(both).not.toBe(keyFor({ ...base, options: { topK: 10 } }));
    });

    it("still distinguishes different request text", () => {
        expect(keyFor(base)).not.toBe(keyFor({ request: "something else entirely" }));
    });
});
