/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";

// The module pulls in the database and the provider adapters at import time; the
// cost helper itself touches neither.
vi.mock("@server/database_service.js", () => ({ db: {} }));

import { routedCallCost } from "./llm-router.service.js";
import { calculateAiCost } from "./cost-registry.js";

const flash = { modelId: "gemini-flash-latest", inputCostPer1k: null, outputCostPer1k: null };

describe("routedCallCost", () => {
    // The regression: a fallback of $0.01/$0.03 per 1k (GPT-4-era OpenAI list price)
    // was charged for every routed call, because no llm_models row carries a price.
    it("prices an unpriced model from the registry, not at GPT-4 list price", () => {
        const { inputCost, outputCost } = routedCallCost(flash, 38_128, 600);
        expect(inputCost + outputCost).toBeCloseTo(calculateAiCost("gemini-flash-latest", 38_128, 600), 10);

        const oldFallback = 38_128 / 1000 * 0.01 + 600 / 1000 * 0.03;
        expect(oldFallback / (inputCost + outputCost)).toBeGreaterThan(20);
    });

    it("uses the price configured on the model when there is one", () => {
        const priced = { modelId: "gemini-flash-latest", inputCostPer1k: 0.002, outputCostPer1k: 0.006 };
        const { inputCost, outputCost } = routedCallCost(priced, 1000, 1000);
        expect(inputCost).toBeCloseTo(0.002, 10);
        expect(outputCost).toBeCloseTo(0.006, 10);
    });

    it("charges nothing for a model the registry prices at zero", () => {
        const free = { modelId: "gemini-2.0-flash-exp", inputCostPer1k: null, outputCostPer1k: null };
        const { inputCost, outputCost } = routedCallCost(free, 10_000, 10_000);
        expect(inputCost + outputCost).toBe(0);
    });
});
