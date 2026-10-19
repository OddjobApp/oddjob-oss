/**
 * LLM Router Integration Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { llmRouterService } from "@domain/ai/core/llm-router.service.js";
import { orgModelService } from "@domain/ai/core/org-model.service.js";
import { db } from "@server/database_service.js";
import { llmProviders, llmModels, llmRouterLogs, llmProviderHealth } from "@shared/schema/index.js";


describe("LLM Router Service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("selectModel", () => {
        it("should select by cost strategy", async () => {
            const mockProviders = [{ id: 1, name: "openai", priority: 100 }];
            const mockModels = [
                { id: 1, providerId: 1, modelId: "gpt-4", inputCostPer1k: 0.03, outputCostPer1k: 0.06, qualityScore: 95, isActive: true },
                { id: 2, providerId: 1, modelId: "gpt-3.5", inputCostPer1k: 0.001, outputCostPer1k: 0.002, qualityScore: 80, isActive: true },
            ];

            vi.spyOn(llmRouterService, "getActiveProviders").mockResolvedValue(mockProviders);
            vi.spyOn(llmRouterService, "getActiveModels").mockResolvedValue(mockModels);

            const result = await llmRouterService.selectModel({
                messages: [{ role: "user", content: "Test" }],
                routingStrategy: "cost",
            }, 1);

            expect(result.model.modelId).toBe("gpt-3.5"); // Cheaper model
            expect(result.strategy).toBe("cost");
        });

        it("should select by quality strategy", async () => {
            const mockProviders = [{ id: 1, name: "openai", priority: 100 }];
            const mockModels = [
                { id: 1, providerId: 1, modelId: "gpt-4", qualityScore: 95, isActive: true },
                { id: 2, providerId: 1, modelId: "gpt-3.5", qualityScore: 80, isActive: true },
            ];

            vi.spyOn(llmRouterService, "getActiveProviders").mockResolvedValue(mockProviders);
            vi.spyOn(llmRouterService, "getActiveModels").mockResolvedValue(mockModels);

            const result = await llmRouterService.selectModel({
                messages: [{ role: "user", content: "Test" }],
                routingStrategy: "quality",
            }, 1);

            expect(result.model.modelId).toBe("gpt-4"); // Higher quality
        });

        it("should use specific model when requested", async () => {
            const mockProvider = { id: 1, name: "openai" };
            const mockModel = { id: 1, providerId: 1, modelId: "gpt-4", isActive: true };

            vi.spyOn(llmRouterService, "getSpecificModel").mockResolvedValue({
                provider: mockProvider,
                model: mockModel,
            });

            const result = await llmRouterService.selectModel({
                messages: [{ role: "user", content: "Test" }],
                preferredProvider: "openai",
                preferredModel: "gpt-4",
            }, 1);

            expect(result.strategy).toBe("specific");
            expect(result.model.modelId).toBe("gpt-4");
        });

        it("should filter by capabilities", async () => {
            const mockProviders = [{ id: 1, name: "openai", priority: 100 }];
            const mockModels = [
                { id: 1, providerId: 1, modelId: "gpt-4", capabilities: ["vision", "code"], isActive: true },
                { id: 2, providerId: 1, modelId: "gpt-3.5", capabilities: ["code"], isActive: true },
            ];

            vi.spyOn(llmRouterService, "getActiveProviders").mockResolvedValue(mockProviders);
            vi.spyOn(llmRouterService, "getActiveModels").mockResolvedValue(mockModels);

            const result = await llmRouterService.selectModel({
                messages: [{ role: "user", content: "Test" }],
                capabilities: ["vision"],
            }, 1);

            expect(result.model.modelId).toBe("gpt-4"); // Only one with vision
        });

        it("should prefer MTP-capable models for long speed-oriented generations", async () => {
            const mockProviders = [{ id: 1, name: "local_openai", priority: 100 }];
            const mockModels = [
                { id: 1, providerId: 1, modelId: "fast-standard", speedScore: 95, capabilities: ["text"], isActive: true },
                { id: 2, providerId: 1, modelId: "vllm-mtp", speedScore: 75, capabilities: ["text", "mtp"], isActive: true },
            ];

            vi.spyOn(llmRouterService, "getActiveProviders").mockResolvedValue(mockProviders);
            vi.spyOn(llmRouterService, "getActiveModels").mockResolvedValue(mockModels);

            const result = await llmRouterService.selectModel({
                messages: [{ role: "user", content: "Generate a detailed implementation plan" }],
                routingStrategy: "speed",
                maxTokens: 2048,
            }, 1);

            expect(result.model.modelId).toBe("vllm-mtp");
        });

        it("should not force MTP preference for short speed-oriented generations", async () => {
            const mockProviders = [{ id: 1, name: "local_openai", priority: 100 }];
            const mockModels = [
                { id: 1, providerId: 1, modelId: "fast-standard", speedScore: 95, capabilities: ["text"], isActive: true },
                { id: 2, providerId: 1, modelId: "vllm-mtp", speedScore: 75, capabilities: ["text", "mtp"], isActive: true },
            ];

            vi.spyOn(llmRouterService, "getActiveProviders").mockResolvedValue(mockProviders);
            vi.spyOn(llmRouterService, "getActiveModels").mockResolvedValue(mockModels);

            const result = await llmRouterService.selectModel({
                messages: [{ role: "user", content: "Summarize this" }],
                routingStrategy: "speed",
                maxTokens: 128,
            }, 1);

            expect(result.model.modelId).toBe("fast-standard");
        });

        it("should allow callers to disable automatic MTP preference", async () => {
            const mockProviders = [{ id: 1, name: "local_openai", priority: 100 }];
            const mockModels = [
                { id: 1, providerId: 1, modelId: "fast-standard", speedScore: 95, capabilities: ["text"], isActive: true },
                { id: 2, providerId: 1, modelId: "vllm-mtp", speedScore: 75, capabilities: ["text", "mtp"], isActive: true },
            ];

            vi.spyOn(llmRouterService, "getActiveProviders").mockResolvedValue(mockProviders);
            vi.spyOn(llmRouterService, "getActiveModels").mockResolvedValue(mockModels);

            const result = await llmRouterService.selectModel({
                messages: [{ role: "user", content: "Generate a detailed implementation plan" }],
                routingStrategy: "speed",
                maxTokens: 2048,
                multiTokenPrediction: { preferred: false },
            }, 1);

            expect(result.model.modelId).toBe("fast-standard");
        });

        it("should honor explicit MTP requirements from model metadata", async () => {
            const mockProviders = [{ id: 1, name: "local_openai", priority: 100 }];
            const mockModels = [
                { id: 1, providerId: 1, modelId: "standard", capabilities: ["text"], isActive: true },
                {
                    id: 2,
                    providerId: 1,
                    modelId: "metadata-mtp",
                    capabilities: ["text"],
                    metadata: { multiTokenPrediction: { enabled: true } },
                    isActive: true,
                },
            ];

            vi.spyOn(llmRouterService, "getActiveProviders").mockResolvedValue(mockProviders);
            vi.spyOn(llmRouterService, "getActiveModels").mockResolvedValue(mockModels);

            const result = await llmRouterService.selectModel({
                messages: [{ role: "user", content: "Draft a long report" }],
                multiTokenPrediction: { required: true },
            }, 1);

            expect(result.model.modelId).toBe("metadata-mtp");
        });
    });

    describe("complete", () => {
        it("should complete request successfully", async () => {
            const mockProvider = { id: 1, name: "openai", apiKey: "test-key" };
            const mockModel = { id: 1, modelId: "gpt-3.5", providerId: 1, inputCostPer1k: 0.001, outputCostPer1k: 0.002 };

            vi.spyOn(llmRouterService, "selectModel").mockResolvedValue({
                provider: mockProvider,
                model: mockModel,
                strategy: "cost",
            });

            vi.spyOn(llmRouterService, "logRoutingDecision").mockResolvedValue();
            vi.spyOn(llmRouterService, "logSuccess").mockResolvedValue();
            vi.spyOn(llmRouterService, "updateProviderHealth").mockResolvedValue();

            // Mock adapter
            const mockResponse = {
                content: "Test response",
                model: "gpt-3.5",
                provider: "openai",
                usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, cost: 0.00005 },
                latency: { totalMs: 500 },
            };
            llmRouterService.registerAdapter("openai", {
                name: "openai",
                complete: vi.fn().mockResolvedValue(mockResponse),
            });

            const result = await llmRouterService.complete({
                messages: [{ role: "user", content: "Hello" }],
            }, 1);

            expect(result.content).toBe("Test response");
            expect(result.usage.totalTokens).toBe(30);
        });

        it("should attempt fallback on failure", async () => {
            const mockProvider1 = { id: 1, name: "openai", priority: 100 };
            const mockProvider2 = { id: 2, name: "anthropic", priority: 200 };
            const mockModel1 = { id: 1, modelId: "gpt-4", providerId: 1 };
            const mockModel2 = { id: 2, modelId: "claude-3", providerId: 2, isDefault: true };

            vi.spyOn(llmRouterService, "selectModel").mockResolvedValue({
                provider: mockProvider1,
                model: mockModel1,
                strategy: "quality",
            });

            vi.spyOn(llmRouterService, "logRoutingDecision").mockResolvedValue();
            vi.spyOn(llmRouterService, "logFailure").mockResolvedValue();
            vi.spyOn(llmRouterService, "updateProviderHealth").mockResolvedValue();
            vi.spyOn(llmRouterService, "logFallbackSuccess").mockResolvedValue();

            // Primary fails
            llmRouterService.registerAdapter("openai", {
                name: "openai",
                complete: vi.fn().mockRejectedValue(new Error("OpenAI error")),
            });

            // Fallback succeeds
            const fallbackResponse = {
                content: "Fallback response",
                model: "claude-3",
                provider: "anthropic",
                usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, cost: 0.001 },
                latency: { totalMs: 600 },
            };
            llmRouterService.registerAdapter("anthropic", {
                name: "anthropic",
                complete: vi.fn().mockResolvedValue(fallbackResponse),
            });

            vi.spyOn(llmRouterService, "getActiveProviders").mockResolvedValue([mockProvider1, mockProvider2]);

            // complete() now looks up the org's own Gemini key before routing, and
            // the blanket db.select mock below answers THAT query too — handing the
            // resolver a model row with no encryptedData, which threw "Failed to
            // decrypt data" before the fallback path was ever reached. No org in
            // this deployment has a per-org key; say so rather than letting an
            // over-broad mock stand in for one.
            vi.spyOn(orgModelService, "resolve").mockResolvedValue(null);

            vi.spyOn(db, "select").mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([mockModel2]),
                    }),
                }),
            } as any);

            const result = await llmRouterService.complete({
                messages: [{ role: "user", content: "Hello" }],
                fallbackEnabled: true,
            }, 1);

            expect(result.content).toBe("Fallback response");
            expect(result.provider).toBe("anthropic");
        });
    });

    describe("cost estimation", () => {
        it("should calculate cost correctly for GPT-4", () => {
            const inputTokens = 2000;
            const outputTokens = 500;
            const inputCostPer1k = 0.03;
            const outputCostPer1k = 0.06;

            const inputCost = (inputTokens / 1000) * inputCostPer1k;
            const outputCost = (outputTokens / 1000) * outputCostPer1k;

            expect(inputCost).toBe(0.06);
            expect(outputCost).toBe(0.03);
            expect(inputCost + outputCost).toBe(0.09);
        });

        it("should calculate cost correctly for GPT-3.5", () => {
            const inputTokens = 2000;
            const outputTokens = 500;
            const inputCostPer1k = 0.001;
            const outputCostPer1k = 0.002;

            const inputCost = (inputTokens / 1000) * inputCostPer1k;
            const outputCost = (outputTokens / 1000) * outputCostPer1k;

            expect(inputCost).toBe(0.002);
            expect(outputCost).toBe(0.001);
            expect(inputCost + outputCost).toBe(0.003);
        });
    });

    describe("provider health", () => {
        function healthRecord(overrides: Record<string, any> = {}) {
            return { id: 1, providerId: 1, successRate: 100, requestsCount: 10,
                consecutiveFailures: 0, avgLatencyMs: 0, errorsCount: 0, ...overrides };
        }
        function selectMock(record: any) {
            return vi.fn().mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([record]),
                    }),
                }),
            });
        }

        it("should update health on success", async () => {
            const setFn = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
            const updateFn = vi.fn().mockReturnValue({ set: setFn });
            vi.spyOn(llmRouterService, "updateProviderHealth").mockRestore();
            Object.assign(db, { select: selectMock(healthRecord()), update: updateFn, insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }) });
            await llmRouterService.updateProviderHealth(1, true, 500);
            expect(updateFn).toHaveBeenCalled();
        });

        it("should update health on failure", async () => {
            const setFn = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
            const updateFn = vi.fn().mockReturnValue({ set: setFn });
            vi.spyOn(llmRouterService, "updateProviderHealth").mockRestore();
            Object.assign(db, { select: selectMock(healthRecord()), update: updateFn, insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }) });
            await llmRouterService.updateProviderHealth(1, false, 0, "API error");
            expect(updateFn).toHaveBeenCalled();
        });

        it("should open circuit breaker after 5 consecutive failures", async () => {
            const setFn = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
            const updateFn = vi.fn().mockReturnValue({ set: setFn });
            vi.spyOn(llmRouterService, "updateProviderHealth").mockRestore();
            Object.assign(db, { select: selectMock(healthRecord({ consecutiveFailures: 4 })), update: updateFn, insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }) });
            await llmRouterService.updateProviderHealth(1, false, 0, "API error");
            const updatePayload = setFn.mock.calls[0]?.[0];
            expect(updatePayload?.circuitOpen).toBe(true);
            expect(updatePayload?.status).toBe("down");
        });
    });

    describe("getRoutingStats", () => {
        it("should calculate statistics correctly", async () => {
            const mockLogs = [
                { id: 1, success: true, cost: 0.01, latencyMs: 500, selectedProviderId: 1 },
                { id: 2, success: true, cost: 0.02, latencyMs: 600, selectedProviderId: 1 },
                { id: 3, success: false, cost: 0, latencyMs: 0, selectedProviderId: 2 },
                { id: 4, success: true, wasFallback: true, cost: 0.015, latencyMs: 700, selectedProviderId: 2 },
            ];

            vi.spyOn(db, "select").mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockResolvedValue(mockLogs),
                    }),
                }),
            } as any);

            const stats = await llmRouterService.getRoutingStats(1, 7);

            expect(stats.total).toBe(4);
            expect(stats.successful).toBe(3);
            expect(stats.failed).toBe(1);
            expect(stats.successRate).toBe(75);
            expect(stats.fallbackCount).toBe(1);
            expect(stats.totalCost).toBe(0.045);
            expect(stats.avgLatency).toBe(450); // (500 + 600 + 700) / 3
        });
    });
});
