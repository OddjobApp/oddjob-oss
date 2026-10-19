import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

// Helper to create a chainable mock query
const createMockQuery = (result: any = []) => {
  const query: any = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnValue(Promise.resolve(result)),
    onConflictDoNothing: vi.fn().mockReturnThis(),
    for: vi.fn().mockReturnThis(),
    then: vi.fn(onFulfilled => Promise.resolve(result).then(onFulfilled)),
    catch: vi.fn(onRejected => Promise.resolve(result).catch(onRejected)),
  };
  return query;
};

// Mock database
vi.mock("@server/db/index", () => {
  return {
    db: {
      select: vi.fn(() => createMockQuery()),
      insert: vi.fn(() => createMockQuery()),
      update: vi.fn(() => createMockQuery()),
      delete: vi.fn(() => createMockQuery()),
      transaction: vi.fn((fn) => fn({
        select: vi.fn(() => createMockQuery()),
        insert: vi.fn(() => createMockQuery()),
        update: vi.fn(() => createMockQuery()),
        delete: vi.fn(() => createMockQuery()),
      })),
      execute: vi.fn().mockResolvedValue({ rows: [] }),
    },
    pool: {
      query: vi.fn().mockResolvedValue({ rows: [] })
    }
  };
});

// Mock dependencies
vi.mock("@server/domain/knowledge/core/graph/graph-service", () => ({
  graphService: {
    createNode: vi.fn().mockResolvedValue({ id: 1 }),
    searchNodes: vi.fn().mockResolvedValue({ nodes: [] }),
    createEdge: vi.fn().mockResolvedValue({ id: 1 })
  }
}));

vi.mock("@server/ai/ai-client", () => ({
  AIClientFactory: {
    getClient: vi.fn().mockReturnValue({
      execute: vi.fn().mockResolvedValue({ success: true, output: JSON.stringify({ name: "Test Mission", objective: "Test objective", members: [] }) })
    })
  }
}));

vi.mock("@server/domain/ai/core/system-ai.service", () => ({
  systemAiService: {
    getAiConfig: vi.fn().mockResolvedValue({ provider: "google", model: "gemini-pro", apiKey: "test-key" })
  }
}));

vi.mock("@server/utils/logger", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  })),
}));

// Mock dynamic imports
vi.mock("@server/domain/pipeline/core/pipeline.service", () => ({
  pipelineService: {
    getSystem: vi.fn().mockResolvedValue({ id: 1 }),
    listSteps: vi.fn().mockResolvedValue([{ id: 1 }]),
    createExecution: vi.fn().mockResolvedValue({ id: 1 }),
    createStepExecution: vi.fn().mockResolvedValue({ id: 1 }),
    updateExecution: vi.fn().mockResolvedValue({}),
    updateStepExecution: vi.fn().mockResolvedValue({}),
    getExecutionSystem: vi.fn().mockResolvedValue({ id: 1 })
  }
}));

vi.mock("@server/domain/mission/core/mission-query.service", () => ({
  missionQueryService: {
    getMissions: vi.fn(),
    getMissionDetail: vi.fn().mockResolvedValue({ id: 1, name: "Mock Mission" }),
    getMissionBySlug: vi.fn(),
    listMissionsWithStats: vi.fn().mockResolvedValue([]),
    getHealth: vi.fn().mockResolvedValue({ score: 100, factors: [] }),
    calculateTotalSpend: vi.fn().mockResolvedValue(0),
    listGlobalActivity: vi.fn().mockResolvedValue([]),
    listRagAssets: vi.fn().mockResolvedValue([]),
    listDocumentTemplates: vi.fn().mockResolvedValue([]),
    listFileAttachments: vi.fn().mockResolvedValue([]),
    getMissionRagContext: vi.fn().mockResolvedValue("")
  }
}));

vi.mock("@server/domain/mission/core/mission-lifecycle.service", () => ({
  missionLifecycleService: {
    createMission: vi.fn().mockResolvedValue({ id: 1 }),
    updateMission: vi.fn().mockResolvedValue({ id: 1 }),
    deleteMission: vi.fn().mockResolvedValue(undefined),
    updateBlackboard: vi.fn().mockResolvedValue(undefined),
    pauseMission: vi.fn().mockResolvedValue({ success: true }),
    resumeMission: vi.fn().mockResolvedValue({ success: true }),
    terminateMission: vi.fn().mockResolvedValue({ success: true }),
    syncDeliverablesToBlackboard: vi.fn().mockResolvedValue(undefined),
    attachRagAsset: vi.fn().mockResolvedValue({ id: 1 }),
    detachRagAsset: vi.fn().mockResolvedValue(true),
    attachDocumentTemplate: vi.fn().mockResolvedValue({ id: 1 }),
    detachDocumentTemplate: vi.fn().mockResolvedValue(true),
    attachFile: vi.fn().mockResolvedValue({ id: 1 }),
    detachFile: vi.fn().mockResolvedValue(true),
    promoteToMasterBlueprint: vi.fn().mockResolvedValue(1)
  }
}));

vi.mock("@server/domain/mission/core/mission-execution.service", () => ({
  missionExecutionService: {
    planMission: vi.fn().mockResolvedValue({ name: "Planned Mission", objective: "" }),
    launchMissionRun: vi.fn().mockResolvedValue({ id: 1 }),
    provisionJobAgent: vi.fn().mockResolvedValue({ id: 1 }),
    synchronizeHilParameters: vi.fn().mockResolvedValue(undefined)
  }
}));

import { missionService } from "@server/domain/mission/core/mission.service.js";
import { db } from "@server/db/index.js";

describe("MissionService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Delegation Tests", () => {
    it("should delegate getMissionDetail to MissionQueryService", async () => {
      const { missionQueryService } = await import("@server/domain/mission/core/mission-query.service.js");
      await missionService.getMissionDetail(1);
      expect(missionQueryService.getMissionDetail).toHaveBeenCalledWith(1);
    });

    it("should delegate createMission to MissionLifecycleService", async () => {
      const { missionLifecycleService } = await import("@server/domain/mission/core/mission-lifecycle.service.js");
      await missionService.createMission({ name: "Test" } as any, "user-1");
      expect(missionLifecycleService.createMission).toHaveBeenCalled();
    });

    it("should delegate planMission to MissionExecutionService", async () => {
      const { missionExecutionService } = await import("@server/domain/mission/core/mission-execution.service.js");
      await missionService.planMission("objective", "user-1", 1);
      expect(missionExecutionService.planMission).toHaveBeenCalled();
    });
  });
});
