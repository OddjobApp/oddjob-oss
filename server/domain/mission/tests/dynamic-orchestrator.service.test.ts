import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { dynamicOrchestratorService } from "../core/dynamic-orchestrator.service.js";
import { db } from "@server/database_service.js";
import { missionRunService } from "../core/mission-run.service.js";
import { createLogger } from "@server/utils/logger.js";

// Helper to create a chainable mock query
const createMockQuery = (result: any = []) => {
  const query = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(result),
    then: (onFulfilled: any) => Promise.resolve(result).then(onFulfilled),
    catch: (onRejected: any) => Promise.resolve(result).catch(onRejected),
  };
  return query;
};

// Mock pg globally to prevent any connection attempts
vi.mock("pg", () => {
  const mPool = {
    on: vi.fn(),
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    }),
    query: vi.fn().mockResolvedValue({ rows: [] }),
    end: vi.fn().mockResolvedValue(undefined),
    totalCount: 0,
    idleCount: 0,
    waitingCount: 0,
  };
  return {
    Pool: vi.fn(function() {
      return mPool;
    })
  };
});

vi.mock("ioredis", () => {
  const mockRedis = {
    rpush: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    lrange: vi.fn().mockResolvedValue([]),
    ltrim: vi.fn().mockResolvedValue('OK'),
    hset: vi.fn().mockResolvedValue(1),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    publish: vi.fn().mockResolvedValue(1),
    subscribe: vi.fn().mockResolvedValue(1),
    on: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn().mockResolvedValue('OK'),
  };
  const Redis = vi.fn(function() {
    return mockRedis;
  });
  return { Redis, default: Redis };
});

vi.mock("bullmq", () => {
  const createQueue = () => ({
    add: vi.fn().mockResolvedValue({ id: "mock-job" }),
    close: vi.fn().mockResolvedValue(undefined),
    getJob: vi.fn().mockResolvedValue(null),
    obliterate: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  });

  return {
    Queue: vi.fn(function() {
      return createQueue();
    }),
    Worker: vi.fn(function() {
      return { on: vi.fn(), close: vi.fn().mockResolvedValue(undefined) };
    }),
    QueueEvents: vi.fn(function() {
      return { on: vi.fn(), close: vi.fn().mockResolvedValue(undefined) };
    }),
  };
});

// Mock dependencies
vi.mock("@server/database_service.js", () => {
  return {
    db: {
      select: vi.fn(() => createMockQuery()),
      update: vi.fn(() => createMockQuery()),
    },
    pool: {
      on: vi.fn(),
      end: vi.fn(),
    }
  };
});

vi.mock("../infrastructure/dynamic-mission-queue.js", () => ({
  queueMissionCycle: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => {
  const mockRedis = {
    rpush: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    lrange: vi.fn().mockResolvedValue([]),
    ltrim: vi.fn().mockResolvedValue('OK'),
    hset: vi.fn().mockResolvedValue(1),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    on: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn().mockResolvedValue('OK'),
  };
  return {
    redis: mockRedis,
    subscriber: mockRedis,
    publisher: mockRedis,
    nodeRedisClient: mockRedis,
    getRedisClient: () => mockRedis,
    getRedisOptions: () => ({ host: 'localhost', port: 6379 }),
    redisService: { client: mockRedis, subscriber: mockRedis, publisher: mockRedis, getOptions: () => ({ host: 'localhost', port: 6379 }) },
    redisManager: { client: mockRedis, subscriber: mockRedis, publisher: mockRedis, getOptions: () => ({ host: 'localhost', port: 6379 }) },
  };
});

vi.mock("../../core/infrastructure/redis/redis-client.js", () => {
  const mockRedis = {
    rpush: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    lrange: vi.fn().mockResolvedValue([]),
    ltrim: vi.fn().mockResolvedValue('OK'),
    hset: vi.fn().mockResolvedValue(1),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    on: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn().mockResolvedValue('OK'),
  };
  return {
    redis: mockRedis,
    subscriber: mockRedis,
    publisher: mockRedis,
    nodeRedisClient: mockRedis,
    getRedisClient: () => mockRedis,
    getRedisOptions: () => ({ host: 'localhost', port: 6379 }),
    redisService: { client: mockRedis, subscriber: mockRedis, publisher: mockRedis, getOptions: () => ({ host: 'localhost', port: 6379 }) },
    redisManager: { client: mockRedis, subscriber: mockRedis, publisher: mockRedis, getOptions: () => ({ host: 'localhost', port: 6379 }) },
  };
});

vi.mock("@server/utils/auth-context.js", () => ({
  getSystemOrgContext: vi.fn((orgId) => ({
    organizationId: orgId,
    userId: "system-orchestrator",
    isAdmin: true,
  })),
}));

vi.mock("../core/mission-run.service.js", () => ({
  missionRunService: {
    create: vi.fn(),
    update: vi.fn(),
    heartbeat: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock("../../ai/core/system-ai.service.js", () => ({
  systemAiService: {
    getAiConfig: vi.fn().mockResolvedValue({ provider: 'google', model: 'gemini-2.0-flash', apiKey: 'test-key' }),
  },
}));

vi.mock("../core/orchestration/thinking.service.js", () => ({
  orchestrationThinkingService: {
    determineNextAction: vi.fn().mockResolvedValue({
      action: 'CONCLUDE',
      reasoning: 'Mission complete',
      params: { final_product: 'Done' },
      protocol: 'hermes',
      rawResponse: '<action>CONCLUDE</action>',
    }),
  },
}));

vi.mock("../core/orchestration/governance.service.js", () => ({
  orchestrationGovernanceService: {
    checkRisk: vi.fn().mockResolvedValue({ needsApproval: false }),
    requestApproval: vi.fn().mockResolvedValue({ approved: true }),
  },
}));

vi.mock("../core/orchestration/execution.service.js", () => ({
  orchestrationExecutionService: {
    executeAction: vi.fn().mockResolvedValue({ success: true, concluded: false }),
  },
}));

vi.mock("@domain/mission/core/mission.service.js", () => ({
  missionService: {
    getMissionDetail: vi.fn(),
    updateBlackboard: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("../../agents/core/skill-service.js", () => ({
  skillService: {
    listSkills: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../../ai/core/ai-client.service.js", () => ({
  AIClientFactory: {
    getClient: vi.fn(() => ({
      execute: vi.fn().mockResolvedValue({ success: true, output: JSON.stringify({ action: "CONCLUDE", action_details: { final_product: "Done" } }) }),
    })),
  },
}));

vi.mock("@domain/ai/core/ai-client.service.js", () => ({
  AIClientFactory: {
    getClient: vi.fn(() => ({
      execute: vi.fn().mockResolvedValue({ success: true, output: JSON.stringify({ action: "CONCLUDE", action_details: { final_product: "Done" } }) }),
    })),
  },
}));

vi.mock("../../agents/core/ml-strategy-predictor/strategy-ml.service.js", () => ({
  strategyMLService: {
    recordPerformance: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../learning/core/institutional-memory.service.js", () => ({
  institutionalMemoryService: {
    recordMissionOutcome: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../core/skill-synthesis.service.js", () => ({
  skillSynthesisService: {
    synthesizeSkillFromMission: vi.fn().mockResolvedValue({ success: false, error: "Skipped in unit test" }),
  },
}));

vi.mock("../../integrations/core/approval.service.js", () => ({
  approvalService: {
    createApprovalRequest: vi.fn().mockResolvedValue({ id: 123 }),
  },
}));

vi.mock("../../governor/core/decision-router.js", () => ({
  decisionRouter: {
    requestDecision: vi.fn().mockResolvedValue({ approved: true }),
  },
}));

vi.mock("../../../mcp/handlers.js", () => ({
  handleToolCall: vi.fn(),
}));

vi.mock("@domain/agents/core/hermes-protocol.service.js", () => ({
  HermesProtocolService: {
    buildInstruction: vi.fn(),
    parseResponse: vi.fn(),
  },
}));

vi.mock("@domain/audit/core/reasoning-audit.service.js", () => ({
  reasoningAuditService: {
    capture: vi.fn().mockResolvedValue({}),
  },
}));

describe("DynamicOrchestratorService", () => {
  beforeEach(async () => {
    vi.resetAllMocks();

    // Setup default mocks
    (db.select as Mock).mockImplementation(() =>
      createMockQuery([
        {
          id: 1,
          name: "Test Mission",
          objective: "Test Objective",
          blackboard: {},
        },
      ]),
    ); // For mission lookup

    (missionRunService.create as Mock).mockResolvedValue({ id: 99 });
    (missionRunService.update as Mock).mockResolvedValue({});
    (missionRunService.heartbeat as Mock).mockResolvedValue(undefined);

    // Re-setup orchestration service mocks after resetAllMocks
    const { orchestrationThinkingService } = await import("../core/orchestration/thinking.service.js");
    (orchestrationThinkingService.determineNextAction as Mock).mockResolvedValue({
      action: 'CONCLUDE',
      reasoning: 'Mission complete',
      params: { final_product: 'Done' },
      protocol: 'hermes',
      rawResponse: '',
    });
    const { orchestrationGovernanceService } = await import("../core/orchestration/governance.service.js");
    (orchestrationGovernanceService.checkRisk as Mock).mockResolvedValue({ needsApproval: false });
    const { orchestrationExecutionService } = await import("../core/orchestration/execution.service.js");
    (orchestrationExecutionService.executeAction as Mock).mockResolvedValue({ success: true, concluded: false });
  });

  describe("launchDynamicMission", () => {
    it("should create a new mission run with dynamic trace initialization", async () => {
      const result = await dynamicOrchestratorService.launchDynamicMission(
        1,
        "user-123",
        1,
      );

      expect(result.success).toBe(true);
      expect(result.missionRunId).toBe(99);

      // Verify mission run creation properties
      expect(missionRunService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          missionId: 1,
          organizationId: 1,
          name: "Mission: Test Mission",
          createdBy: "user-123",
          pipelineSequence: [],
          currentPipelineId: undefined,
          reasoningProtocol: undefined,
        }),
      );

      // Verify Golden State initialization
      expect(missionRunService.update).toHaveBeenCalledWith(
        99,
        expect.objectContaining({
          missionContext: expect.objectContaining({
            intent: "Test Objective",
            cycleCount: 0,
          }),
          dynamicTrace: expect.arrayContaining([
            expect.objectContaining({
              type: "system",
              event: "mission_launched",
            }),
          ]),
        }),
      );
    });

    it("should return false if mission is not found", async () => {
      (db.select as Mock).mockImplementationOnce(() => createMockQuery([]));

      const result = await dynamicOrchestratorService.launchDynamicMission(
        999,
        "user-123",
        1,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Mission not found");
    });
  });

  describe("processMissionCycle", () => {
    it("should append a trace and simulate completion", async () => {
      // Mock run lookup resolving to an active run (must match {run, mission} join shape)
      (db.select as Mock).mockImplementationOnce(() =>
        createMockQuery([
          {
            run: { id: 99, status: "active", dynamicTrace: [], missionContext: { cycleCount: 0, rulesOfEngagement: { maxCycles: 50 } }, createdBy: "user-123" },
            mission: { objective: "Test", hilNotificationChannels: [], hilStrictness: "moderate", allowedTools: [] },
          },
        ]),
      );

      // Prevent actual setTimeout delay to speed up test
      const sleepSpy = vi
        .spyOn(global, "setTimeout")
        .mockImplementation((cb: any) => cb());

      await dynamicOrchestratorService.processMissionCycle(99, "user-123", 1);

      // Verify cycle count was incremented
      expect(missionRunService.update).toHaveBeenCalledWith(99, expect.objectContaining({
        missionContext: expect.objectContaining({
          cycleCount: 1,
        }),
      }));

      // A concluded run completes. It used to park in "waiting_on_human" for a
      // deliverable review nothing ever requested, so it never finished.
      expect(missionRunService.update).toHaveBeenCalledWith(99, expect.objectContaining({
        status: "completed",
        isSuccess: true,
      }));
      expect(missionRunService.update).not.toHaveBeenCalledWith(99, expect.objectContaining({
        status: "waiting_on_human",
      }));

      sleepSpy.mockRestore();
    });

    it("should abort if run is no longer active", async () => {
      // Mock run lookup resolving to a completed run (must match {run, mission} join shape)
      (db.select as Mock).mockImplementationOnce(() =>
        createMockQuery([
          {
            run: { id: 99, status: "completed", dynamicTrace: [], missionContext: {}, createdBy: "user-123" },
            mission: { objective: "Test", hilNotificationChannels: [], hilStrictness: "moderate", allowedTools: [] },
          },
        ]),
      );

      await dynamicOrchestratorService.processMissionCycle(99, "user-123", 1);

      // Should not reach the completion step
      expect(missionRunService.update).not.toHaveBeenCalledWith(99, {
        status: "completed",
      });
    });
  });

  describe("buildExecutionTraceFromDynamicTrace", () => {
    it("pairs repeated actions by cycle instead of adjacent trace order", () => {
      const trace = [
        { type: "decision", cycle: 1, traceCycleId: "99:1", action: "FETCH", params: { page: 1 } },
        { type: "decision", cycle: 2, traceCycleId: "99:2", action: "FETCH", params: { page: 2 } },
        { type: "execution", cycle: 2, traceCycleId: "99:2", action: "FETCH", success: false, error: "timeout", latencyMs: 42 },
        { type: "execution", cycle: 1, traceCycleId: "99:1", action: "FETCH", success: true, result: "ok", latencyMs: 10 }
      ];

      const result = dynamicOrchestratorService.buildExecutionTraceFromDynamicTrace(trace);

      expect(result).toEqual([
        expect.objectContaining({ cycle: 1, action: "FETCH", result: "success", output: "ok", latencyMs: 10 }),
        expect.objectContaining({ cycle: 2, action: "FETCH", result: "failure", error: "timeout", latencyMs: 42 })
      ]);
    });
  });
});


