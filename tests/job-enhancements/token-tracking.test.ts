/**
 * Token Tracking Service Tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { tokenTrackingService, TOKEN_PRICING } from "@domain/jobs/core/token-tracking.service.js";
import { db } from "@server/database_service.js";
import { aiTokenUsage, aiTokenDailyAggregation } from "@shared/schema/index.js";

describe("Token Tracking Service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("recordUsage", () => {
        it("should record token usage with correct cost calculation", async () => {
            const mockRecord = {
                id: 1,
                jobId: 100,
                modelName: "gpt-4",
                inputTokens: 1000,
                outputTokens: 500,
                totalTokens: 1500,
                inputCost: 0.03,
                outputCost: 0.03,
                totalCost: 0.06,
            };

            vi.spyOn(db, "insert").mockReturnValue({
                values: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([mockRecord]),
                }),
            } as any);

            vi.spyOn(tokenTrackingService, "updateDailyAggregation").mockResolvedValue();

            const result = await tokenTrackingService.recordUsage({
                jobId: 100,
                modelProvider: "openai",
                modelName: "gpt-4",
                inputTokens: 1000,
                outputTokens: 500,
            });

            expect(result.totalCost).toBe(0.06);
            expect(result.inputCost).toBe(0.03);
            expect(result.outputCost).toBe(0.03);
        });

        it("should handle unknown models with default pricing", async () => {
            const mockRecord = {
                id: 1,
                modelName: "unknown-model",
                inputTokens: 1000,
                outputTokens: 500,
                totalCost: 0.003, // Default pricing
            };

            vi.spyOn(db, "insert").mockReturnValue({
                values: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([mockRecord]),
                }),
            } as any);

            vi.spyOn(tokenTrackingService, "updateDailyAggregation").mockResolvedValue();

            const result = await tokenTrackingService.recordUsage({
                jobId: 100,
                modelProvider: "unknown",
                modelName: "unknown-model",
                inputTokens: 1000,
                outputTokens: 500,
            });

            expect(result.totalCost).toBeGreaterThan(0);
        });
    });

    describe("getCostEstimate", () => {
        it("should calculate accurate cost estimates", () => {
            // gpt-4o: $2.50/1M input = $0.0025/1K, $10.00/1M output = $0.01/1K
            const estimate = tokenTrackingService.getCostEstimate("gpt-4o", 2000, 1000);

            expect(estimate.inputCost).toBe(0.005); // 2000/1000 * 0.0025
            expect(estimate.outputCost).toBe(0.01);  // 1000/1000 * 0.01
            expect(estimate.totalCost).toBe(0.015);
        });

        it("should use default pricing for unknown models", () => {
            const estimate = tokenTrackingService.getCostEstimate("custom-model", 1000, 1000);

            expect(estimate.totalCost).toBeGreaterThan(0);
        });
    });

    describe("getJobTokenUsage", () => {
        it("should aggregate usage by model", async () => {
            const now = new Date();
            const mockUsage = [
                { id: 1, modelName: "gpt-4o", totalTokens: 1000, totalCost: 0.05, requestTimestamp: now },
                { id: 2, modelName: "gpt-4o", totalTokens: 2000, totalCost: 0.10, requestTimestamp: now },
                { id: 3, modelName: "gemini-2.0-flash", totalTokens: 3000, totalCost: 0.01, requestTimestamp: now },
            ];

            vi.spyOn(db, "select").mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockResolvedValue(mockUsage),
                    }),
                }),
            } as any);

            const result = await tokenTrackingService.getJobTokenUsage(100, 30);

            expect(result.totalRequests).toBe(3);
            expect(result.byModel["gpt-4o"].requests).toBe(2);
            expect(result.byModel["gemini-2.0-flash"].requests).toBe(1);
        });

        it("should calculate daily trends", async () => {
            const mockUsage = [
                { id: 1, requestTimestamp: new Date("2024-01-01"), totalTokens: 1000, totalCost: 0.05 },
                { id: 2, requestTimestamp: new Date("2024-01-02"), totalTokens: 2000, totalCost: 0.10 },
            ];

            vi.spyOn(db, "select").mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockResolvedValue(mockUsage),
                    }),
                }),
            } as any);

            const result = await tokenTrackingService.getJobTokenUsage(100, 30);

            expect(result.byDay).toHaveLength(2);
            expect(result.byDay[0].tokens).toBe(1000);
            expect(result.byDay[1].tokens).toBe(2000);
        });
    });

    describe("getOrgTokenUsage", () => {
        it("should return organization-wide summary", async () => {
            const mockAggregations = [
                { date: new Date("2024-01-01"), totalRequests: 10, totalCost: 0.50, modelBreakdown: { "gpt-4": { tokens: 5000, cost: 0.30 } } },
                { date: new Date("2024-01-02"), totalRequests: 15, totalCost: 0.75, modelBreakdown: { "gpt-4": { tokens: 8000, cost: 0.50 } } },
            ];

            vi.spyOn(db, "select").mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockResolvedValue(mockAggregations),
                    }),
                }),
            } as any);

            const result = await tokenTrackingService.getOrgTokenUsage(1, 30);

            expect(result.totalRequests).toBe(25);
            expect(result.totalCost).toBe(1.25);
            expect(result.dailyTrend).toHaveLength(2);
        });
    });

    describe("TOKEN_PRICING", () => {
        it("should have pricing for all major models", () => {
            expect(TOKEN_PRICING["gemini-2.0-flash"]).toBeDefined();
            expect(TOKEN_PRICING["gpt-4o"]).toBeDefined();
            expect(TOKEN_PRICING["claude-3-5-sonnet-latest"]).toBeDefined();
            expect(TOKEN_PRICING["default"]).toBeDefined();
        });

        it("should have valid pricing values", () => {
            for (const [model, pricing] of Object.entries(TOKEN_PRICING)) {
                expect(pricing.input).toBeGreaterThanOrEqual(0);
                expect(pricing.output).toBeGreaterThanOrEqual(0);
            }
        });
    });
});
