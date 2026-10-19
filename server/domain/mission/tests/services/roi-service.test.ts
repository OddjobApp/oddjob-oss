/**
 * ROIService Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { roiService } from "@domain/analytics/core/roi.service.js";
import { db } from "@server/database_service.js";

// Mock the database
vi.mock("@server/database_service.js", () => ({
    db: {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        execute: vi.fn()
    }
}));

/** The organization every figure on this page belongs to. */
const ORG = 291;

describe("ROIService", () => {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("getSystemROI", () => {
        it("calculates ROI correctly for given stats", async () => {
            // Mock execution stats (select count(*))
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockReturnThis(),
                innerJoin: vi.fn().mockReturnThis(),
                where: vi.fn().mockResolvedValueOnce([{ totalSteps: 100 }])
            });

            // Mock AI costs (select sum(costUsd))
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockResolvedValueOnce([{ totalCost: 10.50 }])
            });

            const result = await roiService.getSystemROI(ORG, 30);

            // Calculation check:
            // totalSteps = 100
            // automationCost = 10.50
            // humanHours = (100 * 15) / 60 = 25
            // humanCost = 25 * 50 = 1250
            // netSavings = 1250 - 10.50 = 1239.50
            // roiMultiplier = 1239.50 / 10.50 = 118.04... -> 118.0x (wait, 1239.5 / 10.5 = 118.047)

            expect(result.periodOps).toBe(100);
            expect(result.automationCost).toBe("10.50");
            expect(result.humanCostEquivalent).toBe("1250.00");
            expect(result.netSavings).toBe("1239.50");
            expect(result.hoursSaved).toBe("25.0");
            expect(result.roiMultiplier).toBe("118.0x");
        });

        it("does not claim infinite return when nothing was spent", async () => {
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockReturnThis(),
                innerJoin: vi.fn().mockReturnThis(),
                where: vi.fn().mockResolvedValueOnce([{ totalSteps: 10 }])
            });
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockResolvedValueOnce([{ totalCost: 0 }])
            });

            const result = await roiService.getSystemROI(ORG, 30);
            // Zero spend is not infinite return — there is no ratio to report.
            expect(result.roiMultiplier).toBe("N/A");
            expect(result.netSavings).toBe("125.00"); // 10 steps * 15 min / 60 * 50 = 125
        });

        it("handles zero executions", async () => {
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockReturnThis(),
                innerJoin: vi.fn().mockReturnThis(),
                where: vi.fn().mockResolvedValueOnce([{ totalSteps: 0 }])
            });
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockResolvedValueOnce([{ totalCost: 0 }])
            });

            const result = await roiService.getSystemROI(ORG, 30);
            expect(result.periodOps).toBe(0);
            expect(result.netSavings).toBe("0.00");
            // An empty period has no multiplier. This previously rendered as
            // "-1.0x" on screen whenever a little was spent and nothing ran.
            expect(result.roiMultiplier).toBe("N/A");
        });
    });

    describe("getTrendData", () => {
        it("maps DB rows to trend format", async () => {
            const mockDate = "2024-01-01";
            (db.execute as any).mockResolvedValueOnce({
                rows: [
                    { date: mockDate, count: 4 }
                ]
            });

            const result = await roiService.getTrendData(ORG, 7);

            expect(result).toHaveLength(1);
            expect(result[0].tasks).toBe(4);
            // 4 tasks * 15 min / 60 * 50 = 1 * 50 = 50.00
            expect(result[0].savings).toBe("50.00");
            expect(result[0].date).toBe(new Date(mockDate).toLocaleDateString());
        });
    });
});
