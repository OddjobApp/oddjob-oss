/**
 * Request History Service Tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { requestHistoryService } from "@domain/jobs/core/request-history.service.js";
import { db } from "@server/database_service.js";
import { jobRequestHistory } from "@shared/schema/index.js";

describe("Request History Service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("recordRequest", () => {
        it("should record a successful request", async () => {
            const mockRecord = {
                id: 1,
                jobId: 100,
                requestMethod: "POST",
                requestUrl: "https://api.example.com/test",
                responseStatus: 200,
                responseTimeMs: 150,
            };

            vi.spyOn(db, "insert").mockReturnValue({
                values: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([mockRecord]),
                }),
            } as any);

            const result = await requestHistoryService.recordRequest({
                jobId: 100,
                requestMethod: "POST",
                requestUrl: "https://api.example.com/test",
                responseStatus: 200,
                responseTimeMs: 150,
                triggeredBy: "manual",
            });

            expect(result).toEqual(mockRecord);
        });

        it("should handle replayable flag correctly", async () => {
            const mockRecord = { id: 1, jobId: 100, isReplayable: 1 };

            vi.spyOn(db, "insert").mockReturnValue({
                values: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([mockRecord]),
                }),
            } as any);

            await requestHistoryService.recordRequest({
                jobId: 100,
                isReplayable: true,
            });

            expect(db.insert).toHaveBeenCalledWith(jobRequestHistory);
        });
    });

    describe("getJobHistory", () => {
        it("should return paginated history", async () => {
            const mockHistory = [
                { id: 1, jobId: 100, createdAt: new Date() },
                { id: 2, jobId: 100, createdAt: new Date() },
            ];

            vi.spyOn(db, "select").mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({
                            limit: vi.fn().mockReturnValue({
                                offset: vi.fn().mockResolvedValue(mockHistory),
                            }),
                        }),
                    }),
                }),
            } as any);

            const result = await requestHistoryService.getJobHistory(100, { limit: 10, offset: 0 });
            expect(result).toHaveLength(2);
        });

        it("should filter by replayable only", async () => {
            const mockHistory = [{ id: 1, jobId: 100, isReplayable: 1 }];

            vi.spyOn(db, "select").mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({
                            limit: vi.fn().mockReturnValue({
                                offset: vi.fn().mockResolvedValue(mockHistory),
                            }),
                        }),
                    }),
                }),
            } as any);

            const result = await requestHistoryService.getJobHistory(100, { onlyReplayable: true });
            expect(result).toHaveLength(1);
        });
    });

    describe("compareRequests", () => {
        it("should identify differences between requests", async () => {
            const req1 = {
                id: 1,
                requestMethod: "POST",
                requestUrl: "https://api.example.com/v1",
                requestBody: { name: "test" },
                responseStatus: 200,
            };
            const req2 = {
                id: 2,
                requestMethod: "POST",
                requestUrl: "https://api.example.com/v2",
                requestBody: { name: "test", age: 25 },
                responseStatus: 404,
            };

            vi.spyOn(requestHistoryService, "getRequestById")
                .mockResolvedValueOnce(req1 as any)
                .mockResolvedValueOnce(req2 as any);

            const result = await requestHistoryService.compareRequests(1, 2);

            expect(result.requestComparison.url.different).toBe(true);
            expect(result.requestComparison.body.different).toBe(true);
            expect(result.responseComparison.status.different).toBe(true);
        });
    });

    describe("getRequestStats", () => {
        it("should calculate success rate correctly", async () => {
            const now = new Date();
            const mockHistory = [
                { id: 1, responseStatus: 200, createdAt: now },
                { id: 2, responseStatus: 200, createdAt: now },
                { id: 3, responseStatus: 500, createdAt: now },
            ];

            vi.spyOn(requestHistoryService, "getJobHistory").mockResolvedValue(mockHistory as any);

            const stats = await requestHistoryService.getRequestStats(100, 30);

            expect(stats.totalRequests).toBe(3);
            expect(stats.successfulRequests).toBe(2);
            expect(stats.failedRequests).toBe(1);
            expect(stats.successRate).toBe(67);
        });
    });
});
