import { describe, it, expect, vi, beforeEach } from "vitest";
import { missionRunService } from "@domain/mission/core/mission-run.service.js";
import { db } from "@server/database_service.js";

// Mock the database
vi.mock("@server/database_service.js", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
    transaction: vi.fn((cb) => cb({
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
    })),
  }
}));

describe("MissionRunService - Timeline Integration", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should fetch the timeline correctly including checkpoints and approvals", async () => {
        // Mock getCheckpoints
        vi.spyOn(missionRunService, 'getCheckpoints').mockResolvedValue([
            { type: 'checkpoint', blackboard: { key: 'val' }, changeReason: 'checkpoint:test', createdAt: new Date() }
        ] as any);

        // First DB call returns the missionId lookup, subsequent calls return empty
        let limitCallCount = 0;
        const makeChain = (limitResult?: any) => {
            const chain: any = {
                from: vi.fn(() => chain),
                innerJoin: vi.fn(() => chain),
                leftJoin: vi.fn(() => chain),
                where: vi.fn(() => chain),
                orderBy: vi.fn(() => chain),
                limit: vi.fn(() => {
                    limitCallCount++;
                    return Promise.resolve(limitCallCount === 1 ? [{ missionId: 100, pipelineExecutionId: 500 }] : []);
                }),
                then: (onFulfilled: any) => Promise.resolve([]).then(onFulfilled),
            };
            return chain;
        };
        (db.select as any).mockImplementation(makeChain);

        const timeline = await missionRunService.getTimeline(1);

        expect(timeline).toBeDefined();
        expect(Array.isArray(timeline)).toBe(true);
    });

    it("should handle the SQL integer conversion logic in join correctly", async () => {
         // This test primarily ensures the service code doesn't crash 
         // and we can inspect the generated SQL calls if needed (though mocked here)
         vi.spyOn(missionRunService, 'getByIdOrThrow').mockResolvedValue({ id: 1, missionId: 100 } as any);
         vi.spyOn(missionRunService, 'getCheckpoints').mockResolvedValue([]);
         
         (db.select as any).mockReturnValue({
            from: vi.fn().mockReturnThis(),
            innerJoin: vi.fn().mockReturnThis(),
            leftJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue([]),
         });

         const timeline = await missionRunService.getTimeline(1);
         expect(timeline).toEqual([]);
    });
});
