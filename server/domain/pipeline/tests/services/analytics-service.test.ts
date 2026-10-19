/**
 * Pipeline Analytics Service tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSelect, mockGetById } = vi.hoisted(() => {
    const chain = (r: unknown[] = []) => ({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockReturnThis(),
        then: (fn: (v: unknown) => unknown) => Promise.resolve(r).then(fn),
    });
    return {
        mockSelect: vi.fn(() => chain([])),
        mockGetById: vi.fn(),
    };
});

vi.mock("@server/database_service.js", () => ({
    db: { select: mockSelect },
}));

vi.mock("@domain/pipeline/core/pipeline-engine.js", () => ({
    pipelineEngine: {
        getById: mockGetById,
    },
}));

vi.mock("@domain/knowledge/core/query-monitor.service.js", () => ({
    withQueryTracking: vi.fn((_name: string, fn: () => unknown) => fn()),
}));

vi.mock("@domain/admin/core/analytics.service.js", () => ({
    getPipelineCurrentMonthSpend: vi.fn().mockResolvedValue(10.5),
    getPipelineDailySpend: vi.fn().mockResolvedValue([{ date: "2025-01-01", spend: 0.5 }]),
}));

vi.mock("@server/utils/logger.js", () => ({
    createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

import { pipelineAnalytics as analyticsService } from "../../core/pipeline-analytics.js";

describe("Analytics Service", () => {
    const orgContext = { 
        userId: "u1", 
        organizationId: 1, 
        isAdmin: false, 
        isSuperAdmin: false, 
        isOrgAdmin: false 
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockGetById.mockResolvedValue({ id: 1, name: "Test Pipeline" });
    });

    describe("getStats", () => {
        it("returns empty stats when no executions", async () => {
            mockSelect.mockReturnValue({
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                groupBy: vi.fn().mockReturnThis(),
                then: (fn: (v: unknown) => unknown) => Promise.resolve([]).then(fn),
            });
            const result = await analyticsService.getStats(1, orgContext);
            expect(result).toEqual({
                runCount: 0,
                averageTotalDuration: null,
                stepAverages: {},
            });
        });

        it("returns run count and average duration", async () => {
            const now = new Date();
            const completed = new Date(now.getTime() + 5000);
            const chain = (r: unknown[]) => ({
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                groupBy: vi.fn().mockReturnThis(),
                then: (fn: (v: unknown) => unknown) => Promise.resolve(r).then(fn),
            });
            mockSelect
                .mockReturnValueOnce(
                    chain([
                        { id: 1, startedAt: now, completedAt: completed },
                        { id: 2, startedAt: now, completedAt: completed },
                    ])
                )
                .mockReturnValueOnce(chain([{ stepOrder: 0, avgDuration: 2.5 }]));
            const result = await analyticsService.getStats(1, orgContext);
            expect(result.runCount).toBe(2);
            expect(result.averageTotalDuration).toBe(5);
            expect(result.stepAverages).toEqual({ 0: 3 });
        });
    });

    describe("getCostAnalytics", () => {
        it("returns cost analytics with budget", async () => {
            mockGetById.mockResolvedValue({ id: 1, monthlyBudgetUsd: "100" });
            const result = await analyticsService.getCostAnalytics(1, orgContext);
            expect(result).toMatchObject({
                pipelineId: 1,
                currentMonthSpend: 10.5,
                budget: 100,
                budgetRemaining: 89.5,
                budgetPercentage: 10.5,
            });
        });

        it("returns null budget fields when no budget set", async () => {
            mockGetById.mockResolvedValue({ id: 1, monthlyBudgetUsd: null });
            const result = await analyticsService.getCostAnalytics(1, orgContext);
            expect(result.budget).toBeNull();
            expect(result.budgetRemaining).toBeNull();
            expect(result.budgetPercentage).toBeNull();
        });
    });
});
