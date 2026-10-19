/**
 * Cycle Chaining Integration Tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { CycleSynthesisService } from "../../server/domain/mission/core/cycle-synthesis.service.js";
import { db } from "../../server/database_service.js";
import { operationalCycles } from "@shared/schema/index.js";

// Mock the database service
const mockDbSelect = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbInsert = vi.fn();

vi.mock("@server/database_service.js", () => ({
    db: {
        select: (...args: any[]) => mockDbSelect(...args),
        update: (...args: any[]) => mockDbUpdate(...args),
        insert: (...args: any[]) => mockDbInsert(...args),
    },
}));

// Mock CycleManagerService
const mockLaunchCycle = vi.fn();
vi.mock("../../server/domain/mission/core/cycle-manager.service.js", () => ({
    CycleManagerService: {
        launchCycle: (...args: any[]) => mockLaunchCycle(...args),
    },
}));

describe("Cycle Chaining Integration", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockDbInsert.mockReturnValue({
            values: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{ id: 1 }]),
            }),
        });
    });

    it("should resolve template and launch follow-up cycle on completion", async () => {
        const mockParentCycle = {
            id: 1,
            name: "Parent Operation",
            description: "First step of sequence",
            objective: "Do step 1",
            createdBy: "user-123",
            organizationId: 99,
            metadata: {
                follow_up_cycle_template_id: 10,
            },
        };

        const mockTemplate = {
            id: 10,
            name: "Child Operation",
            description: "Second step of sequence",
            objective: "Do step 2",
            blueprints: [{ name: "Subtask 1", objective: "Run subtask 1" }],
            createdBy: "admin",
        };

        const mockChildCycle = {
            id: 2,
            name: "Child Operation",
            status: "active",
        };

        // Mock database select query flow
        mockDbSelect.mockImplementation((selectFields) => {
            const isSpendOrTokensQuery = selectFields && typeof selectFields === "object" && 
                (Object.keys(selectFields).includes("totalCost") || Object.keys(selectFields).includes("totalTokens"));

            return {
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        where: vi.fn().mockImplementation(async () => {
                            if (isSpendOrTokensQuery) {
                                return [{ totalCost: "10.00", totalTokens: 500 }];
                            }
                            return [];
                        })
                    }),
                    where: vi.fn().mockImplementation(() => {
                        const result: any = {
                            then: (onfulfilled: any, onrejected: any) => {
                                return Promise.resolve([]).then(onfulfilled, onrejected);
                            },
                            limit: vi.fn().mockImplementation(async () => {
                                // First select is the parent cycle (length == 1)
                                // Second select is the templates list or specific template
                                if (mockDbSelect.mock.calls.length > 3) {
                                    return [mockTemplate];
                                }
                                return [mockParentCycle];
                            })
                        };
                        return result;
                    })
                })
            };
        });

        // Mock update chain
        const mockUpdateWhere = vi.fn().mockResolvedValue([{ id: 1 }]);
        const mockUpdateSet = vi.fn().mockReturnValue({
            where: mockUpdateWhere,
        });
        mockDbUpdate.mockReturnValue({
            set: mockUpdateSet,
        });

        // Mock launchCycle
        mockLaunchCycle.mockResolvedValue(mockChildCycle);

        // Mock notify function
        const mockNotify = vi.fn().mockResolvedValue(undefined);

        // Execute synthesis (which completes parent and launches child)
        const result = await CycleSynthesisService.synthesize(1, 99, mockNotify);

        // Verify status and outcome metrics
        expect(result?.finalStatus).toBeDefined();

        // Verify that the template was retrieved
        expect(mockDbSelect).toHaveBeenCalled();

        // Verify that launchCycle was called with parent context injected
        expect(mockLaunchCycle).toHaveBeenCalledWith(
            expect.objectContaining({
                name: "Child Operation",
                description: "Second step of sequence",
                objective: "Do step 2",
                blueprints: expect.arrayContaining([
                    expect.objectContaining({ name: "Subtask 1" }),
                ]),
                priority: 5,
                budgetLimitUsd: "100.00",
                metadata: expect.objectContaining({
                    parent_cycle_id: 1,
                }),
            }),
            "user-123",
            99
        );

        // Verify that the parent cycle was updated with follow_up_cycle_id
        expect(mockDbUpdate).toHaveBeenCalledWith(operationalCycles);
        expect(mockUpdateSet).toHaveBeenCalledWith(
            expect.objectContaining({
                metadata: expect.objectContaining({
                    follow_up_cycle_template_id: 10,
                    follow_up_cycle_id: 2,
                }),
            })
        );
    });

    it("should do nothing if no follow-up template is configured", async () => {
        const mockParentCycle = {
            id: 1,
            name: "Parent Operation",
            objective: "Do step 1",
            createdBy: "user-123",
            organizationId: 99,
            metadata: {},
        };

        mockDbSelect.mockImplementation((selectFields) => {
            const isSpendOrTokensQuery = selectFields && typeof selectFields === "object" && 
                (Object.keys(selectFields).includes("totalCost") || Object.keys(selectFields).includes("totalTokens"));

            return {
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        where: vi.fn().mockImplementation(async () => {
                            if (isSpendOrTokensQuery) {
                                return [{ totalCost: "0.00", totalTokens: 0 }];
                            }
                            return [];
                        })
                    }),
                    where: vi.fn().mockImplementation(() => {
                        const result: any = {
                            then: (onfulfilled: any, onrejected: any) => {
                                return Promise.resolve([]).then(onfulfilled, onrejected);
                            },
                            limit: vi.fn().mockImplementation(async () => {
                                return [mockParentCycle];
                            })
                        };
                        return result;
                    })
                })
            };
        });

        // Mock update chain
        const mockUpdateWhere = vi.fn().mockResolvedValue([{ id: 1 }]);
        const mockUpdateSet = vi.fn().mockReturnValue({
            where: mockUpdateWhere,
        });
        mockDbUpdate.mockReturnValue({
            set: mockUpdateSet,
        });

        const mockNotify = vi.fn().mockResolvedValue(undefined);
        await CycleSynthesisService.synthesize(1, 99, mockNotify);

        expect(mockLaunchCycle).not.toHaveBeenCalled();
    });

    it("should launch inline follow-up cycle payload if configured", async () => {
        const mockParentCycle = {
            id: 1,
            name: "Parent Operation",
            objective: "Do step 1",
            createdBy: "user-123",
            organizationId: 99,
            metadata: {
                follow_up_cycle: {
                    name: "Inline Child Operation",
                    objective: "Do inline step 2",
                    blueprints: [{ name: "Inline Subtask 1", objective: "Run inline subtask 1" }]
                }
            },
        };

        mockDbSelect.mockImplementation((selectFields) => {
            const isSpendOrTokensQuery = selectFields && typeof selectFields === "object" && 
                (Object.keys(selectFields).includes("totalCost") || Object.keys(selectFields).includes("totalTokens"));

            return {
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        where: vi.fn().mockImplementation(async () => {
                            if (isSpendOrTokensQuery) {
                                return [{ totalCost: "0.00", totalTokens: 0 }];
                            }
                            return [];
                        })
                    }),
                    where: vi.fn().mockImplementation(() => {
                        const result: any = {
                            then: (onfulfilled: any, onrejected: any) => {
                                return Promise.resolve([]).then(onfulfilled, onrejected);
                            },
                            limit: vi.fn().mockImplementation(async () => {
                                return [mockParentCycle];
                            })
                        };
                        return result;
                    })
                })
            };
        });

        // Mock update chain
        const mockUpdateWhere = vi.fn().mockResolvedValue([{ id: 1 }]);
        const mockUpdateSet = vi.fn().mockReturnValue({
            where: mockUpdateWhere,
        });
        mockDbUpdate.mockReturnValue({
            set: mockUpdateSet,
        });

        const mockNotify = vi.fn().mockResolvedValue(undefined);
        await CycleSynthesisService.synthesize(1, 99, mockNotify);

        expect(mockLaunchCycle).toHaveBeenCalledWith(
            expect.objectContaining({
                name: "Inline Child Operation",
                objective: "Do inline step 2",
                blueprints: expect.arrayContaining([
                    expect.objectContaining({ name: "Inline Subtask 1" }),
                ]),
            }),
            "user-123",
            99
        );
    });

    it("should accumulate parent_cycle_context from completed mission runs and pass it to child cycle", async () => {
        const mockParentCycle = {
            id: 1,
            name: "Parent Operation",
            objective: "Do step 1",
            createdBy: "user-123",
            organizationId: 99,
            metadata: {
                follow_up_cycle: {
                    name: "Inline Child Operation",
                    objective: "Do inline step 2",
                    blueprints: [{ name: "Inline Subtask 1", objective: "Run inline subtask 1" }]
                }
            },
        };

        const mockRuns = [
            {
                id: 101,
                status: "completed",
                missionContext: {
                    triage_result: "disk_full",
                    blackboard: {
                        containment_strategy: "reboot_host"
                    }
                }
            },
            {
                id: 102,
                status: "failed",
                missionContext: {
                    ignored_key: "fail"
                }
            }
        ];

        // Custom db mock logic for this test
        mockDbSelect.mockImplementation((selectFields) => {
            const isSpendOrTokensQuery = selectFields && typeof selectFields === "object" && 
                (Object.keys(selectFields).includes("totalCost") || Object.keys(selectFields).includes("totalTokens"));

            return {
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        where: vi.fn().mockImplementation(async () => {
                            if (isSpendOrTokensQuery) {
                                return [{ totalCost: "5.00", totalTokens: 100 }];
                            }
                            return [];
                        })
                    }),
                    where: vi.fn().mockImplementation((whereCond) => {
                        const result: any = {
                            then: (onfulfilled: any, onrejected: any) => {
                                return Promise.resolve(mockRuns).then(onfulfilled, onrejected);
                            },
                            limit: vi.fn().mockImplementation(async () => {
                                return [mockParentCycle];
                            })
                        };
                        return result;
                    })
                })
            };
        });

        // Mock update chain
        const mockUpdateWhere = vi.fn().mockResolvedValue([{ id: 1 }]);
        const mockUpdateSet = vi.fn().mockReturnValue({
            where: mockUpdateWhere,
        });
        mockDbUpdate.mockReturnValue({
            set: mockUpdateSet,
        });

        mockLaunchCycle.mockResolvedValue({ id: 2, name: "Inline Child Operation", status: "active" });

        const mockNotify = vi.fn().mockResolvedValue(undefined);
        await CycleSynthesisService.synthesize(1, 99, mockNotify);

        expect(mockLaunchCycle).toHaveBeenCalledWith(
            expect.objectContaining({
                name: "Inline Child Operation",
                metadata: expect.objectContaining({
                    parent_cycle_id: 1,
                    parent_cycle_context: expect.objectContaining({
                        triage_result: "disk_full",
                        containment_strategy: "reboot_host"
                    })
                })
            }),
            "user-123",
            99
        );
        
        // Assert failed run's context keys are NOT included
        const lastCallArgs = mockLaunchCycle.mock.calls[0][0];
        expect(lastCallArgs.metadata.parent_cycle_context.ignored_key).toBeUndefined();
    });
});

