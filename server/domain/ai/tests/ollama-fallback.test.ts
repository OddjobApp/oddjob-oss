import { describe, it, expect, vi, beforeEach } from "vitest";
import { OllamaService } from "../core/ollama.service.js";
import { withResilience } from "../core/resilience-proxy.js";
import type { AIResponse } from "../core/ai-client.service.js";

describe("OllamaService & Local Model Fallback", () => {
    let service: OllamaService;

    beforeEach(() => {
        service = new OllamaService("http://127.0.0.1:11434");
    });

    describe("Remote Model Catalog & Task Selection", () => {
        it("should return curated popular models", () => {
            const allModels = service.searchRemoteModels("");
            expect(allModels.length).toBeGreaterThan(5);
            expect(allModels.some(m => m.name === "deepseek-r1")).toBe(true);
            expect(allModels.some(m => m.name === "llama3.2")).toBe(true);
        });

        it("should search models matching query keyword", () => {
            const codeModels = service.searchRemoteModels("code");
            expect(codeModels.length).toBeGreaterThan(0);
            expect(codeModels.every(m => m.name.includes("code") || m.description.toLowerCase().includes("code"))).toBe(true);
        });

        it("should select optimal model for task fallback when no local models listed", async () => {
            vi.spyOn(service, "listModels").mockRejectedValue(new Error("Daemon offline"));
            const codeModel = await service.selectModelForTask("code");
            expect(codeModel).toBe("llama3.2");
        });

        it("should select task-matched model from installed models", async () => {
            vi.spyOn(service, "listModels").mockResolvedValue([
                { name: "qwen2.5-coder:7b", size: 4000000000, modified_at: "", digest: "", details: { format: "", family: "", families: null, parameter_size: "7B", quantization_level: "q4" } },
                { name: "llama3.2:3b", size: 2000000000, modified_at: "", digest: "", details: { format: "", family: "", families: null, parameter_size: "3B", quantization_level: "q4" } }
            ]);

            const codeModel = await service.selectModelForTask("code");
            expect(codeModel).toBe("qwen2.5-coder:7b");

            const chatModel = await service.selectModelForTask("chat");
            expect(chatModel).toBe("llama3.2:3b");
        });
    });

    describe("withResilience Fallback Cascades", () => {
        it("should return successful AIResponse without retrying", async () => {
            const mockOp = vi.fn().mockResolvedValue({
                success: true,
                output: "Operational summary generated successfully.",
                metadata: { latencyMs: 45, model: "gemini-1.5-flash", provider: "google" }
            } as AIResponse);

            const result = await withResilience(mockOp, { maxRetries: 2, baseDelayMs: 10 });
            expect(result.success).toBe(true);
            expect(result.output).toContain("Operational summary");
            expect(mockOp).toHaveBeenCalledTimes(1);
        });

        it("should execute custom fallback operation when primary operations fail", async () => {
            const mockOp = vi.fn().mockResolvedValue({
                success: false,
                error: "429 Resource Exhausted: Rate limit exceeded",
                metadata: { latencyMs: 120, model: "claude-3-5-sonnet", provider: "anthropic" }
            } as AIResponse);

            const mockFallback = vi.fn().mockResolvedValue({
                success: true,
                output: "Recovered via local fallback model.",
                metadata: { latencyMs: 80, model: "llama3.2", provider: "ollama" }
            } as AIResponse);

            const result = await withResilience(mockOp, {
                maxRetries: 1,
                baseDelayMs: 10,
                fallbackOperation: mockFallback
            });

            expect(mockFallback).toHaveBeenCalledTimes(1);
            expect(result.success).toBe(true);
            expect(result.output).toBe("Recovered via local fallback model.");
            expect(result.metadata?.fallback).toBe("custom");
        });
    });
});
