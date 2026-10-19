/**
 * CostCalculator — Pure Function Tests
 * extractTokenCounts and calculateCost are fully pure — no DB, no network.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@server/config/ai-pricing", () => ({
    getModelPricing: vi.fn((model: string) => {
        if (model === "gpt-4o") {
            return { model: "gpt-4o", provider: "openai", inputPricePerMillion: 2.50, outputPricePerMillion: 10.00 };
        }
        if (model === "gpt-4o-mini") {
            return { model: "gpt-4o-mini", provider: "openai", inputPricePerMillion: 0.15, outputPricePerMillion: 0.60 };
        }
        return null;
    })
}));

vi.mock("@domain/core/infrastructure/token-counter.service.js", () => ({
    tokenCounterService: {
        countTokens: vi.fn((prompt: string) => Math.ceil(prompt.length / 4)),
        estimateOutputTokens: vi.fn((taskType: string, inputTokens: number) => {
            if (taskType === "general") return Math.ceil(inputTokens * 0.5);
            return Math.ceil(inputTokens * 0.8);
        })
    }
}));

vi.mock("@domain/agents/core/tool-analytics.service.js", () => ({
    toolAnalyticsService: {
        inferTaskType: vi.fn().mockReturnValue("general")
    }
}));

import { extractTokenCounts, calculateCost } from "@domain/analytics/core/cost-calculator.service.js";

describe("extractTokenCounts", () => {
    it("should extract from OpenAI format (prompt_tokens / completion_tokens)", () => {
        const result = extractTokenCounts("openai", {
            usage: { prompt_tokens: 100, completion_tokens: 50 }
        });
        expect(result.promptTokens).toBe(100);
        expect(result.completionTokens).toBe(50);
    });

    it("should extract from Anthropic usage format (input_tokens / output_tokens)", () => {
        const result = extractTokenCounts("openai", {
            usage: { input_tokens: 200, output_tokens: 80 }
        });
        expect(result.promptTokens).toBe(200);
        expect(result.completionTokens).toBe(80);
    });

    it("should extract from Anthropic metadata format (top-level)", () => {
        const result = extractTokenCounts("anthropic", {
            input_tokens: 300,
            output_tokens: 120
        });
        expect(result.promptTokens).toBe(300);
        expect(result.completionTokens).toBe(120);
    });

    it("should extract from fallback format (prompt_tokens / completion_tokens props)", () => {
        const result = extractTokenCounts("unknown", {
            prompt_tokens: 50,
            completion_tokens: 25
        });
        expect(result.promptTokens).toBe(50);
        expect(result.completionTokens).toBe(25);
    });

    it("should return zeros when metadata is null", () => {
        const result = extractTokenCounts("openai", null);
        expect(result.promptTokens).toBe(0);
        expect(result.completionTokens).toBe(0);
    });

    it("should return zeros for empty metadata object", () => {
        const result = extractTokenCounts("anthropic", {});
        expect(result.promptTokens).toBe(0);
        expect(result.completionTokens).toBe(0);
    });
});

describe("calculateCost", () => {
    it("should calculate cost from known model pricing", () => {
        // gpt-4o: $2.50/M input, $10.00/M output
        // 1M input tokens → $2.50, 0.5M output → $5.00
        const cost = calculateCost("openai", "gpt-4o", 1_000_000, 500_000);
        expect(cost).toBeCloseTo(2.50 + 5.00, 5);
    });

    it("should use default pricing for unknown models", () => {
        // Default: $0.15/M input, $0.60/M output
        const cost = calculateCost("openai", "unknown-model", 1_000_000, 1_000_000);
        expect(cost).toBeCloseTo(0.15 + 0.60, 5);
    });

    it("should return 0 for zero tokens", () => {
        const cost = calculateCost("openai", "gpt-4o-mini", 0, 0);
        expect(cost).toBe(0);
    });

    it("should scale linearly with token count", () => {
        // gpt-4o-mini: $0.15/M input, $0.60/M output
        const cost1 = calculateCost("openai", "gpt-4o-mini", 100_000, 0);
        const cost2 = calculateCost("openai", "gpt-4o-mini", 200_000, 0);
        expect(cost2).toBeCloseTo(cost1 * 2, 8);
    });

    it("should handle very small token counts", () => {
        const cost = calculateCost("openai", "gpt-4o-mini", 100, 100);
        expect(cost).toBeGreaterThan(0);
        expect(cost).toBeLessThan(0.001);
    });
});
