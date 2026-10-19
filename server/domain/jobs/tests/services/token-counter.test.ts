/**
 * Token Counter Service Tests — pure heuristic methods
 */

import { describe, it, expect } from "vitest";

import { tokenCounterService } from "@domain/core/infrastructure/token-counter.service.js";

describe("tokenCounterService", () => {

    // ─── countTokens ──────────────────────────────

    describe("countTokens", () => {
        it("returns 0 for empty string", () => {
            expect(tokenCounterService.countTokens("")).toBe(0);
        });

        it("returns 0 for null-ish input", () => {
            expect(tokenCounterService.countTokens(null as any)).toBe(0);
        });

        it("returns ~25 tokens for 100 chars of plain text (4 chars/token)", () => {
            const text = "a".repeat(100);
            expect(tokenCounterService.countTokens(text)).toBe(25);
        });

        it("uses 3.2 chars/token for JSON-like content", () => {
            const json = JSON.stringify({ key: "value", num: 42 });
            const expected = Math.ceil(json.length / 3.2);
            expect(tokenCounterService.countTokens(json)).toBe(expected);
        });

        it("uses 3.5 chars/token for long structured text (>1000 chars, >20 lines)", () => {
            // Must exceed 1000 chars and 20 lines to trigger this branch
            const lines = Array.from({ length: 50 }, (_, i) => `Line ${i}: some content here that is long enough to push us over the threshold`).join("\n");
            expect(lines.length).toBeGreaterThan(1000);
            expect(lines.split("\n").length).toBeGreaterThan(20);
            const expected = Math.ceil(lines.length / 3.5);
            expect(tokenCounterService.countTokens(lines)).toBe(expected);
        });

        it("adjusts for gpt-4 model (0.95x multiplier)", () => {
            const text = "a".repeat(100);
            const defaultResult = tokenCounterService.countTokens(text, "default");
            const gpt4Result = tokenCounterService.countTokens(text, "gpt-4o");
            // gpt-4 should give slightly more tokens (smaller charPerToken)
            expect(gpt4Result).toBeGreaterThanOrEqual(defaultResult);
        });

        it("adjusts for claude-3 model", () => {
            const text = "a".repeat(100);
            const defaultResult = tokenCounterService.countTokens(text);
            const claudeResult = tokenCounterService.countTokens(text, "claude-3-sonnet");
            expect(claudeResult).toBeGreaterThanOrEqual(defaultResult);
        });
    });

    // ─── estimateOutputTokens ──────────────────────

    describe("estimateOutputTokens", () => {
        it("uses 0.5 multiplier for general task", () => {
            const result = tokenCounterService.estimateOutputTokens("general", 1000);
            expect(result).toBe(500);
        });

        it("uses 1.2 multiplier for content_creation", () => {
            const result = tokenCounterService.estimateOutputTokens("content_creation", 1000);
            expect(result).toBe(1200);
        });

        it("uses 0.3 multiplier for debugging", () => {
            const result = tokenCounterService.estimateOutputTokens("debugging", 1000);
            expect(result).toBe(300);
        });

        it("caps output at 4096 for very large inputs", () => {
            const result = tokenCounterService.estimateOutputTokens("content_creation", 100000);
            expect(result).toBe(4096);
        });

        it("floors output at 50 for very small inputs", () => {
            const result = tokenCounterService.estimateOutputTokens("debugging", 10);
            expect(result).toBe(50);
        });

        it("defaults to 0.5 multiplier for unknown task type", () => {
            const result = tokenCounterService.estimateOutputTokens("totally_unknown", 1000);
            expect(result).toBe(500);
        });

        it("returns correct value for data_analysis", () => {
            expect(tokenCounterService.estimateOutputTokens("data_analysis", 1000)).toBe(400);
        });

        it("returns correct value for web_research", () => {
            expect(tokenCounterService.estimateOutputTokens("web_research", 1000)).toBe(500);
        });

        it("returns correct value for etl", () => {
            expect(tokenCounterService.estimateOutputTokens("etl", 1000)).toBe(800);
        });

        it("returns correct value for testing", () => {
            expect(tokenCounterService.estimateOutputTokens("testing", 1000)).toBe(400);
        });
    });
});
