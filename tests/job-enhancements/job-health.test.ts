/**
 * Job Health Service Tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { jobHealthService } from "@domain/jobs/core/job-health.service.js";
import { db } from "@server/database_service.js";
import { jobRequestHistory, jobs } from "@shared/schema/index.js";

describe("Job Health Service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("calculateHealthScore", () => {
        it("should calculate perfect health for 100% success rate", async () => {
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            // Service orders DESC; first element is most recent; recencyScore=100 → overall=100
            const mockRuns = Array(10).fill(null).map((_, i) => ({
                id: i,
                jobId: 100,
                responseStatus: 200,
                responseTimeMs: 500,
                createdAt: i === 0 ? new Date() : new Date(thirtyDaysAgo.getTime() + i * 24 * 60 * 60 * 1000),
            }));

            vi.spyOn(db, "select").mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockResolvedValue(mockRuns),
                    }),
                }),
            } as any);

            const health = await jobHealthService.calculateHealthScore(100);

            expect(health.successRate).toBe(100);
            expect(health.overall).toBeGreaterThanOrEqual(90);
        });

        it("should calculate poor health for failing job", async () => {
            const mockRuns = Array(10).fill(null).map((_, i) => ({
                id: i,
                jobId: 100,
                responseStatus: 500,
                responseTimeMs: 100,
                createdAt: new Date(),
            }));

            vi.spyOn(db, "select").mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockResolvedValue(mockRuns),
                    }),
                }),
            } as any);

            const health = await jobHealthService.calculateHealthScore(100);

            expect(health.successRate).toBe(0);
            expect(health.overall).toBeLessThan(50);
        });

        it("should return zero scores for job with no history", async () => {
            vi.spyOn(db, "select").mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockResolvedValue([]),
                    }),
                }),
            } as any);

            const health = await jobHealthService.calculateHealthScore(100);

            expect(health.successRate).toBe(0);
            expect(health.overall).toBe(0);
        });

        it("should factor in response time", async () => {
            const mockRuns = [
                { id: 1, jobId: 100, responseStatus: 200, responseTimeMs: 100 },
                { id: 2, jobId: 100, responseStatus: 200, responseTimeMs: 100 },
            ];

            vi.spyOn(db, "select").mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockResolvedValue(mockRuns),
                    }),
                }),
            } as any);

            const health = await jobHealthService.calculateHealthScore(100);

            // Fast response time should give max score
            expect(health.avgResponseTimeScore).toBe(100);
        });

        it("should penalize slow response times", async () => {
            const mockRuns = [
                { id: 1, jobId: 100, responseStatus: 200, responseTimeMs: 5000 },
                { id: 2, jobId: 100, responseStatus: 200, responseTimeMs: 6000 },
            ];

            vi.spyOn(db, "select").mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockResolvedValue(mockRuns),
                    }),
                }),
            } as any);

            const health = await jobHealthService.calculateHealthScore(100);

            expect(health.avgResponseTimeScore).toBe(60);
        });
    });

    describe("getHealthTrend", () => {
        it("should detect improving trend", async () => {
            // First half: 50% success, Second half: 100% success
            const now = new Date();
            const firstHalfRuns = [
                { responseStatus: 200 },
                { responseStatus: 500 },
            ];
            const secondHalfRuns = [
                { responseStatus: 200 },
                { responseStatus: 200 },
            ];

            vi.spyOn(jobHealthService, "calculatePeriodScore")
                .mockResolvedValueOnce(50)  // First half
                .mockResolvedValueOnce(100); // Second half

            const trend = await jobHealthService.getHealthTrend(100, 14);

            expect(trend.direction).toBe("improving");
            expect(trend.changePercent).toBeGreaterThan(0);
        });

        it("should detect declining trend", async () => {
            vi.spyOn(jobHealthService, "calculatePeriodScore")
                .mockResolvedValueOnce(100) // First half
                .mockResolvedValueOnce(50);  // Second half

            const trend = await jobHealthService.getHealthTrend(100, 14);

            expect(trend.direction).toBe("declining");
            expect(trend.changePercent).toBeLessThan(0);
        });
    });

    describe("getHealthStatus", () => {
        it("should return correct status for excellent health", () => {
            const status = jobHealthService.getHealthStatus(95);
            expect(status.label).toBe("Excellent");
            expect(status.color).toBe("#22c55e");
        });

        it("should return correct status for good health", () => {
            const status = jobHealthService.getHealthStatus(80);
            expect(status.label).toBe("Good");
            expect(status.color).toBe("#84cc16");
        });

        it("should return correct status for fair health", () => {
            const status = jobHealthService.getHealthStatus(65);
            expect(status.label).toBe("Fair");
            expect(status.color).toBe("#eab308");
        });

        it("should return correct status for poor health", () => {
            const status = jobHealthService.getHealthStatus(50);
            expect(status.label).toBe("Poor");
            expect(status.color).toBe("#f97316");
        });

        it("should return correct status for critical health", () => {
            const status = jobHealthService.getHealthStatus(30);
            expect(status.label).toBe("Critical");
            expect(status.color).toBe("#ef4444");
        });
    });

    describe("getOrgHealthSummary", () => {
        it("should calculate organization-wide summary", async () => {
            const mockJobs = [
                { id: 1 },
                { id: 2 },
                { id: 3 },
            ];

            vi.spyOn(db, "select").mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(mockJobs),
                }),
            } as any);

            vi.spyOn(jobHealthService, "calculateHealthScore")
                .mockResolvedValueOnce({ overall: 95, successRate: 100, avgResponseTimeScore: 100, errorRateTrend: 100, recencyScore: 100 })
                .mockResolvedValueOnce({ overall: 70, successRate: 80, avgResponseTimeScore: 80, errorRateTrend: 80, recencyScore: 80 })
                .mockResolvedValueOnce({ overall: 30, successRate: 40, avgResponseTimeScore: 40, errorRateTrend: 40, recencyScore: 40 });

            const summary = await jobHealthService.getOrgHealthSummary(1);

            expect(summary.totalJobs).toBe(3);
            expect(summary.healthyJobs).toBe(1);
            expect(summary.atRiskJobs).toBe(1);
            expect(summary.criticalJobs).toBe(1);
            expect(summary.averageHealthScore).toBe(65); // (95 + 70 + 30) / 3
        });
    });
});
