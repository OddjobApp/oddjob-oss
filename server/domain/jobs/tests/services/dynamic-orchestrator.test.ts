
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dynamicOrchestratorService } from "@domain/mission/core/dynamic-orchestrator.service.js";
import { db } from "@server/database_service.js";
import { missions, missionRuns, approvalRequests } from "@shared/schema/index.js";
import { decisionRouter } from "@domain/governor/core/decision-router.js";

// Mock DB and Services
vi.mock("@server/database_service.js", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('@domain/governor/core/decision-router.js', () => ({
  decisionRouter: {
    requestDecision: vi.fn(),
  },
}));

const mockQueueMissionCycle = vi.fn().mockResolvedValue(undefined);
vi.mock('@domain/mission/infrastructure/dynamic-mission-queue.js', () => ({
  queueMissionCycle: (...args: unknown[]) => mockQueueMissionCycle(...args),
}));

describe('DynamicOrchestratorService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('launchDynamicMission', () => {
    it('should create a mission run and start the loop', async () => {
      const mockMission = {
        id: 1,
        name: 'Test Mission',
        objective: 'Test objective',
        budgetLimitUsd: '100.00',
        blackboard: {},
      };

      const mockRun = { id: 10 };

      // Setup DB mocks (chainable & thenable)
      const mockResult = {
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockMission]),
        then: vi.fn().mockImplementation((onFulfilled) => {
          return Promise.resolve([]).then(onFulfilled);
        }),
      };
      (db.select as any).mockReturnValue(mockResult);

      // Mock creation of run
      const { missionRunService } = await import("@domain/mission/core/mission-run.service.js");
      vi.spyOn(missionRunService, 'create').mockResolvedValue(mockRun as any);
      vi.spyOn(missionRunService, 'update').mockResolvedValue(undefined as any);

      const result = await dynamicOrchestratorService.launchDynamicMission(1, 'user-1', 1);

      expect(result.success).toBe(true);
      expect(result.missionRunId).toBe(10);
      expect(mockQueueMissionCycle).toHaveBeenCalledWith(
        expect.objectContaining({ missionRunId: 10, userId: 'user-1', orgId: 1 }),
        0
      );
    });
  });

  describe('Rules of Engagement Enforcement', () => {
    it('should correctly initialize mission context with RoE from mission config', async () => {
        // This is partially verified in launchDynamicMission above, 
        // but we want to ensure the rulesOfEngagement object is correctly mapped.
        
        const mockMission = {
            id: 2,
            name: 'RoE Test',
            objective: 'Test',
            budgetLimitUsd: '50.00',
            dynamicCycleBudgetLimitUsd: '10.00',
            hilStrictness: 'strict',
            blackboard: {},
        };

        const mockResult = {
            from: vi.fn().mockReturnThis(),
            innerJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue([mockMission]),
            then: vi.fn().mockImplementation((onFulfilled) => {
                return Promise.resolve([]).then(onFulfilled);
            }),
        };
        (db.select as any).mockReturnValue(mockResult);

        const { missionRunService } = await import("@domain/mission/core/mission-run.service.js");
        const createSpy = vi.spyOn(missionRunService, 'create').mockResolvedValue({ id: 20 } as any);
        const updateSpy = vi.spyOn(missionRunService, 'update').mockResolvedValue(undefined as any);
        vi.spyOn(dynamicOrchestratorService, 'processMissionCycle').mockResolvedValue(undefined as any);

        await dynamicOrchestratorService.launchDynamicMission(2, 'user-1', 1);

        // Check if update was called with correct context
        expect(updateSpy).toHaveBeenCalledWith(20, expect.objectContaining({
            missionContext: expect.objectContaining({
                rulesOfEngagement: expect.objectContaining({
                    maxBudgetUsd: 50.00,
                    maxCostPerCycleUsd: 10.00,
                    hilStrictness: 'strict'
                })
            })
        }));
    });
  });
});
