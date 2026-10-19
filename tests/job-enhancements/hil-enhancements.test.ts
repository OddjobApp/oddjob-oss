/**
 * HIL Enhancements Service Tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { hilEnhancementsService } from "@domain/integrations/core/hil-enhancements.service.js";
import { db } from "@server/database_service.js";
import { hilJobConfig, hilApprovalPatterns, hilEscalationLog, approvalRequests } from "@shared/schema/index.js";

describe("HIL Enhancements Service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("getOrCreateConfig", () => {
        it("should return existing config", async () => {
            const mockConfig = {
                id: 1,
                jobId: 100,
                escalationEnabled: 1,
                escalationTimeoutMinutes: 60,
            };

            vi.spyOn(db, "select").mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([mockConfig]),
                    }),
                }),
            } as any);

            const config = await hilEnhancementsService.getOrCreateConfig(100);
            expect(config).toEqual(mockConfig);
        });

        it("should create new config if none exists", async () => {
            vi.spyOn(db, "select").mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([]),
                    }),
                }),
            } as any);

            const mockNewConfig = { id: 1, jobId: 100 };
            vi.spyOn(db, "insert").mockReturnValue({
                values: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([mockNewConfig]),
                }),
            } as any);

            const config = await hilEnhancementsService.getOrCreateConfig(100, 1);
            expect(config).toEqual(mockNewConfig);
        });
    });

    describe("checkEscalation", () => {
        it("should escalate when timeout exceeded", async () => {
            const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
            const mockRequest = {
                id: 1,
                jobId: 100,
                createdAt: twoHoursAgo,
            };

            vi.spyOn(db, "select").mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([mockRequest]),
                    }),
                }),
            } as any);

            const mockConfig = {
                escalationEnabled: 1,
                escalationTimeoutMinutes: 60,
            };
            vi.spyOn(hilEnhancementsService, "getOrCreateConfig").mockResolvedValue(mockConfig as any);

            const check = await hilEnhancementsService.checkEscalation(1);

            expect(check.shouldEscalate).toBe(true);
            expect(check.reason).toContain("timeout");
        });

        it("should escalate outside business hours", async () => {
            // Fake the current time to Sunday at 10 PM (service uses new Date() for business hours check)
            const sundayNight = new Date();
            sundayNight.setDate(sundayNight.getDate() - sundayNight.getDay()); // rewind to this Sunday
            sundayNight.setHours(22, 0, 0, 0);
            vi.useFakeTimers();
            vi.setSystemTime(sundayNight);

            const mockRequest = {
                id: 1,
                jobId: 100,
                createdAt: new Date(sundayNight.getTime() - 60 * 60 * 1000), // 1 hour ago
            };

            vi.spyOn(db, "select").mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([mockRequest]),
                    }),
                }),
            } as any);

            const mockConfig = {
                escalationEnabled: 1,
                escalationTimeoutMinutes: 240,
                businessHoursOnly: 1,
            };
            vi.spyOn(hilEnhancementsService, "getOrCreateConfig").mockResolvedValue(mockConfig as any);

            const check = await hilEnhancementsService.checkEscalation(1);

            vi.useRealTimers();

            expect(check.shouldEscalate).toBe(true);
            expect(check.reason).toContain("business hours");
        });

        it("should not escalate when disabled", async () => {
            const mockRequest = { id: 1, jobId: 100, createdAt: new Date() };

            vi.spyOn(db, "select").mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([mockRequest]),
                    }),
                }),
            } as any);

            const mockConfig = { escalationEnabled: 0 };
            vi.spyOn(hilEnhancementsService, "getOrCreateConfig").mockResolvedValue(mockConfig as any);

            const check = await hilEnhancementsService.checkEscalation(1);

            expect(check.shouldEscalate).toBe(false);
        });
    });

    describe("checkAutoApproval", () => {
        it("should auto-approve reliable patterns", async () => {
            const mockRequest = {
                id: 1,
                jobId: 100,
                context: { type: "approval", amount: 100 },
            };

            const mockPattern = {
                isReliablePattern: 1,
                reliabilityScore: 95,
                totalRequests: 10,
                approvedCount: 10, // 100% approval rate
            };

            // First call → approvalRequests; second call → hilApprovalPatterns
            vi.spyOn(db, "select")
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([mockRequest]),
                        }),
                    }),
                } as any)
                .mockReturnValue({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([mockPattern]),
                        }),
                    }),
                } as any);

            const mockConfig = {
                autoApprovalEnabled: 1,
                similarityThreshold: 80,
            };
            vi.spyOn(hilEnhancementsService, "getOrCreateConfig").mockResolvedValue(mockConfig as any);

            const check = await hilEnhancementsService.checkAutoApproval(1);

            expect(check.canAutoApprove).toBe(true);
            expect(check.confidence).toBe(100);
        });

        it("should not auto-approve unreliable patterns", async () => {
            const mockRequest = { id: 1, jobId: 100 };

            const mockPattern = {
                isReliablePattern: 0,
                reliabilityScore: 50,
                totalRequests: 10,
                approvedCount: 5, // 50% approval rate
            };

            // First call → approvalRequests; second call → hilApprovalPatterns
            vi.spyOn(db, "select")
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([mockRequest]),
                        }),
                    }),
                } as any)
                .mockReturnValue({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([mockPattern]),
                        }),
                    }),
                } as any);

            const mockConfig = { autoApprovalEnabled: 1, similarityThreshold: 90 };
            vi.spyOn(hilEnhancementsService, "getOrCreateConfig").mockResolvedValue(mockConfig as any);

            const check = await hilEnhancementsService.checkAutoApproval(1);

            expect(check.canAutoApprove).toBe(false);
            expect(check.confidence).toBe(50);
        });

        it("should not auto-approve when disabled", async () => {
            const mockRequest = { id: 1, jobId: 100 };

            vi.spyOn(db, "select").mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([mockRequest]),
                    }),
                }),
            } as any);

            const mockConfig = { autoApprovalEnabled: 0 };
            vi.spyOn(hilEnhancementsService, "getOrCreateConfig").mockResolvedValue(mockConfig as any);

            const check = await hilEnhancementsService.checkAutoApproval(1);

            expect(check.canAutoApprove).toBe(false);
            expect(check.reason).toBe("Auto-approval disabled");
        });
    });

    describe("recordPattern", () => {
        it("should create new pattern for first occurrence", async () => {
            const mockRequest = {
                id: 1,
                jobId: 100,
                context: { type: "test" },
            };

            // First call → approvalRequests → [mockRequest]; second call → hilApprovalPatterns → []
            vi.spyOn(db, "select")
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([mockRequest]),
                        }),
                    }),
                } as any)
                .mockReturnValue({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([]),
                        }),
                    }),
                } as any);

            vi.spyOn(db, "insert").mockReturnValue({
                values: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([{ id: 1 }]),
                }),
            } as any);

            await hilEnhancementsService.recordPattern(1, "approved");

            expect(db.insert).toHaveBeenCalledWith(hilApprovalPatterns);
        });

        it("should update existing pattern with new decision", async () => {
            const mockRequest = {
                id: 1,
                jobId: 100,
                context: { type: "test" },
            };

            vi.spyOn(db, "select").mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([mockRequest]),
                    }),
                }),
            } as any);

            const existingPattern = {
                id: 1,
                totalRequests: 5,
                approvedCount: 4,
                rejectedCount: 1,
            };
            vi.spyOn(db, "select").mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([existingPattern]),
                    }),
                }),
            } as any);

            vi.spyOn(db, "update").mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        returning: vi.fn().mockResolvedValue([{ id: 1 }]),
                    }),
                }),
            } as any);

            await hilEnhancementsService.recordPattern(1, "approved");

            expect(db.update).toHaveBeenCalledWith(hilApprovalPatterns);
        });
    });

    describe("getJobApprovalAnalytics", () => {
        it("should return comprehensive analytics", async () => {
            const mockPatterns = [
                { id: 1, requestSummary: "Small purchase", totalRequests: 20, approvedCount: 19, rejectedCount: 1, reliabilityScore: 95, isReliablePattern: 1 },
                { id: 2, requestSummary: "Large purchase", totalRequests: 10, approvedCount: 5, rejectedCount: 5, reliabilityScore: 50, isReliablePattern: 0 },
            ];

            const mockEscalations = [
                { escalationType: "timeout" },
                { escalationType: "manual" },
            ];

            // patterns query uses .orderBy(); escalations query resolves directly from .where()
            vi.spyOn(db, "select")
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            orderBy: vi.fn().mockResolvedValue(mockPatterns),
                        }),
                    }),
                } as any)
                .mockReturnValue({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue(mockEscalations),
                    }),
                } as any);

            const mockConfig = {
                escalationEnabled: 1,
                escalationTimeoutMinutes: 60,
                autoApprovalEnabled: 0,
                similarityThreshold: 90,
                businessHoursOnly: 0,
            };
            vi.spyOn(hilEnhancementsService, "getOrCreateConfig").mockResolvedValue(mockConfig as any);

            const analytics = await hilEnhancementsService.getJobApprovalAnalytics(100);

            expect(analytics.totalPatterns).toBe(2);
            expect(analytics.reliablePatterns).toBe(1);
            expect(analytics.escalationStats.totalEscalations).toBe(2);
        });
    });
});
