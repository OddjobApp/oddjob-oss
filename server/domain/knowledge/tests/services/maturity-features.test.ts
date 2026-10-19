
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DB - everything must be self-contained or use globals
vi.mock("@server/database_service.js", () => {
    const createMockQuery = (result: any = []) => ({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue(result),
        values: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
    });

    const db = {
        select: vi.fn(() => createMockQuery()),
        insert: vi.fn(() => createMockQuery()),
        update: vi.fn(() => createMockQuery()),
        transaction: vi.fn(async (fn) => fn(db)),
    };
    return { db };
});

// Mock mission module
vi.mock("../../server/domain/mission/index.js", () => ({
    missionService: {
        updateBlackboard: vi.fn().mockResolvedValue(undefined)
    }
}));

import { missionRunService } from "@domain/mission/core/mission-run.service.js";
import { RescueStrategyFactory } from "@domain/mission/utils/rescue-strategy-factory.js";
import { db } from "@server/database_service.js";

describe("Advanced Agentic Maturity Features", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("Sub-Agent Hierarchy", () => {
        it("should correctly handle parentId in missionRunService.create", async () => {
            const mockRun = { id: 10, parentId: 5 };
            // Since db is the mock, we can control its behavior here
            (db.insert as any).mockReturnValue({
                values: vi.fn().mockReturnThis(),
                returning: vi.fn().mockResolvedValue([mockRun])
            });

            const result = await missionRunService.create({
                missionId: 1,
                name: "Child Mission",
                pipelineSequence: [1],
                createdBy: "user-1",
                parentId: 5
            });

            expect(result.parentId).toBe(5);
        });
    });

    describe("JIT Tool Discovery Strategies", () => {
        it("should handle approve_tool strategy in RescueStrategyFactory", async () => {
            const missionRunId = 1;
            const mockMission = { id: 1, missionId: 10, organizationId: 1, missionContext: {} };
            
            vi.spyOn(missionRunService, "getByIdOrThrow").mockResolvedValue(mockMission as any);
            vi.spyOn(missionRunService, "update").mockResolvedValue(mockMission as any);
            vi.spyOn(missionRunService, "checkpoint").mockResolvedValue(undefined as any);

            await RescueStrategyFactory.apply(missionRunId, {
                strategy: "approve_tool",
                proposedAction: { toolName: "google_search" },
                userId: "user-1"
            });

            expect(missionRunService.checkpoint).toHaveBeenCalledWith(expect.objectContaining({
                reason: expect.stringContaining("capability_enrolled:google_search")
            }));
        });
    });
});
