/**
 * What a recorded cost says it paid for.
 *
 * cost_ledger.provider defaulted to "openai" and no caller ever passed one, so
 * all 132 rows in the live database claimed an OpenAI call with zero tokens —
 * on a platform whose stated policy is Gemini-first. The ledger was not empty,
 * which is what made it convincing: it reported a total ($3.43) that no row
 * could account for.
 *
 * These pin the derivation. A wrong vendor is worse than an absent one, because
 * a cost report reads as measurement.
 */

import { describe, it, expect } from "vitest";
import { calculateAiCost, providerForModel } from "./cost-registry.js";

describe("Claude on Bedrock", () => {
    it("is priced as the same Anthropic model", () => {
        expect(calculateAiCost("us.anthropic.claude-sonnet-4-6", 1_000_000, 1_000_000))
            .toBe(calculateAiCost("claude-sonnet-4-6", 1_000_000, 1_000_000));
        expect(calculateAiCost("global.anthropic.claude-sonnet-4-6", 1_000_000, 0)).toBe(3);
    });
    it("is attributed to Bedrock, which bills it", () => {
        expect(providerForModel("us.anthropic.claude-sonnet-4-6")).toBe("bedrock");
        expect(providerForModel("anthropic.claude-3-5-sonnet-20240620-v1:0")).toBe("bedrock");
        expect(providerForModel("claude-sonnet-4-6")).toBe("anthropic");
    });
});

describe("providerForModel", () => {
    it("attributes Gemini models to Google, not the old OpenAI default", () => {
        expect(providerForModel("gemini-2.0-flash")).toBe("google");
        expect(providerForModel("gemini-1.5-pro")).toBe("google");
        expect(providerForModel("gemini-flash-latest")).toBe("google");
    });

    it("attributes the OpenAI families", () => {
        expect(providerForModel("gpt-4o")).toBe("openai");
        expect(providerForModel("gpt-4o-mini")).toBe("openai");
        expect(providerForModel("o1-preview")).toBe("openai");
        expect(providerForModel("o3-mini")).toBe("openai");
    });

    it("attributes Claude to Anthropic", () => {
        expect(providerForModel("claude-3-5-sonnet-latest")).toBe("anthropic");
    });

    it("says unknown rather than guessing", () => {
        // The whole point: an unrecognised model must not inherit a vendor.
        expect(providerForModel("some-model-we-have-never-seen")).toBe("unknown");
        expect(providerForModel("")).toBe("unknown");
        expect(providerForModel(null)).toBe("unknown");
        expect(providerForModel(undefined)).toBe("unknown");
    });

    it("attributes Bedrock model and inference-profile IDs to Bedrock, whoever made the model", () => {
        expect(providerForModel("amazon.nova-lite-v1:0")).toBe("bedrock");
        expect(providerForModel("us.anthropic.claude-haiku-4-5-20251001-v1:0")).toBe("bedrock");
        expect(providerForModel("global.anthropic.claude-sonnet-5-5")).toBe("bedrock");
        expect(providerForModel("claude-sonnet-5-5")).toBe("anthropic");
    });

    it("is case-insensitive, since model ids arrive in both", () => {
        expect(providerForModel("GEMINI-2.0-FLASH")).toBe("google");
        expect(providerForModel("GPT-4o")).toBe("openai");
    });

    it("never returns openai for a model that is not OpenAI's", () => {
        for (const model of ["gemini-2.0-flash", "claude-3-5-sonnet-latest", "llama3", "mystery-model", ""]) {
            expect(providerForModel(model)).not.toBe("openai");
        }
    });
});

describe("calculateAiCost", () => {
    it("prices a known model from its token counts", () => {
        // gemini-2.0-flash: $0.10/1M in, $0.40/1M out
        expect(calculateAiCost("gemini-2.0-flash", 1_000_000, 0)).toBeCloseTo(0.10, 6);
        expect(calculateAiCost("gemini-2.0-flash", 0, 1_000_000)).toBeCloseTo(0.40, 6);
    });

    it("returns zero when there are no tokens to charge for", () => {
        // Every ledger row recorded zero tokens yet a non-zero cost, because the
        // cost was computed elsewhere and the tokens were never passed along.
        // With the real counts supplied, no tokens means no charge.
        expect(calculateAiCost("gemini-2.0-flash", 0, 0)).toBe(0);
    });

    it("prices the Claude 5 crew models at list price, not the default", () => {
        // Both were missing and fell to the $1/$3 default, under-reporting
        // Opus 5.5 four- to sevenfold.
        expect(calculateAiCost("claude-sonnet-5-5", 1_000_000, 1_000_000)).toBeCloseTo(12.0, 6);
        expect(calculateAiCost("claude-opus-5-5", 1_000_000, 1_000_000)).toBeCloseTo(24.0, 6);
    });

    it("prices Bedrock IDs as the model they run, not the default", () => {
        expect(calculateAiCost("amazon.nova-lite-v1:0", 1_000_000, 1_000_000)).toBeCloseTo(0.30, 6);
        expect(calculateAiCost("us.amazon.nova-lite-v1:0", 1_000_000, 1_000_000)).toBeCloseTo(0.30, 6);
        expect(calculateAiCost("us.anthropic.claude-haiku-4-5-20251001-v1:0", 1_000_000, 1_000_000)).toBeCloseTo(4.80, 6);
        expect(calculateAiCost("global.anthropic.claude-opus-5-5", 1_000_000, 1_000_000)).toBeCloseTo(24.0, 6);
    });

    it("falls back to default pricing for an unknown model rather than throwing", () => {
        expect(calculateAiCost("some-model-we-have-never-seen", 1_000_000, 0)).toBeGreaterThan(0);
    });
});
