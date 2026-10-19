/**
 * extractTokenCounts and calculateCost Tests — pure function coverage
 */

import { describe, it, expect, vi } from "vitest";

// Mock the pricing config so calculateCost is deterministic
vi.mock("@server/config/ai-pricing", () => ({
    getModelPricing: vi.fn((model: string) => {
        if (model === "gpt-4o") return { model: "gpt-4o", provider: "openai", inputPricePerMillion: 5.0, outputPricePerMillion: 15.0 };
        if (model === "gpt-4o-mini") return { model: "gpt-4o-mini", provider: "openai", inputPricePerMillion: 0.15, outputPricePerMillion: 0.60 };
        return null;
    })
}));
vi.mock("@domain/core/infrastructure/token-counter.service.js", () => ({ tokenCounterService: {} }));
vi.mock("@domain/agents/core/tool-analytics.service.js", () => ({ toolAnalyticsService: {} }));

import { extractTokenCounts, calculateCost } from "@domain/analytics/core/cost-calculator.service.js";

describe("extractTokenCounts", () => {
    it("returns zeros for null metadata", () => {
        expect(extractTokenCounts("openai", null)).toEqual({ promptTokens: 0, completionTokens: 0 });
    });

    it("returns zeros for undefined metadata", () => {
        expect(extractTokenCounts("openai", undefined)).toEqual({ promptTokens: 0, completionTokens: 0 });
    });

    it("extracts from OpenAI standard usage format", () => {
        const meta = { usage: { prompt_tokens: 100, completion_tokens: 50 } };
        expect(extractTokenCounts("openai", meta)).toEqual({ promptTokens: 100, completionTokens: 50 });
    });

    it("extracts from alternative usage format (input_tokens/output_tokens)", () => {
        const meta = { usage: { input_tokens: 200, output_tokens: 75 } };
        expect(extractTokenCounts("openai", meta)).toEqual({ promptTokens: 200, completionTokens: 75 });
    });

    it("extracts from Anthropic format (top-level input_tokens/output_tokens)", () => {
        const meta = { input_tokens: 300, output_tokens: 120 };
        expect(extractTokenCounts("anthropic", meta)).toEqual({ promptTokens: 300, completionTokens: 120 });
    });

    it("falls back to direct properties (prompt_tokens, completionTokens)", () => {
        const meta = { promptTokens: 400, completionTokens: 160 };
        expect(extractTokenCounts("custom", meta)).toEqual({ promptTokens: 400, completionTokens: 160 });
    });

    it("returns zeros when metadata has no matching fields", () => {
        expect(extractTokenCounts("openai", { unrelated: true })).toEqual({ promptTokens: 0, completionTokens: 0 });
    });
});

describe("calculateCost", () => {
    it("uses model pricing when available (gpt-4o)", () => {
        const cost = calculateCost("openai", "gpt-4o", 1_000_000, 1_000_000);
        // 1M tokens * $5/M input + 1M tokens * $15/M output = $20
        expect(cost).toBeCloseTo(20.0, 5);
    });

    it("uses model pricing for gpt-4o-mini", () => {
        const cost = calculateCost("openai", "gpt-4o-mini", 1_000_000, 1_000_000);
        // 1M * $0.15 + 1M * $0.60 = $0.75
        expect(cost).toBeCloseTo(0.75, 5);
    });

    it("falls back to default pricing for unknown model", () => {
        const cost = calculateCost("custom", "unknown-model", 1_000_000, 1_000_000);
        // 1M * $0.15 + 1M * $0.60 = $0.75
        expect(cost).toBeCloseTo(0.75, 5);
    });

    it("returns 0 for zero tokens", () => {
        expect(calculateCost("openai", "gpt-4o", 0, 0)).toBe(0);
    });

    it("handles fractional tokens correctly", () => {
        const cost = calculateCost("openai", "gpt-4o", 500, 1000);
        // 500/1M * $5 + 1000/1M * $15 = 0.0025 + 0.015 = 0.0175
        expect(cost).toBeCloseTo(0.0175, 6);
    });
});
