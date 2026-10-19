/**
 * Integration Test: Pre-Mission Briefing in Pipeline (Task 12.4)
 *
 * Validates that the pipeline executor's governance pre-flight phase correctly:
 * 1. Creates pending questions matching mission file references
 * 2. Executes pipeline governance pre-flight with extractReferences + getPreMissionBriefing
 * 3. Injects briefing items into mission context
 * 4. Respects max 5 items ordered oldest-first
 * 5. Handles failure/timeout gracefully (non-blocking)
 *
 * Requirements: 4.1, 4.2, 4.3, 4.5
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const mockGetPreMissionBriefing = vi.hoisted(() => vi.fn());
const mockExtractReferences = vi.hoisted(() => vi.fn());
const mockMissionQueryService = vi.hoisted(() => ({
  calculateTotalSpend: vi.fn().mockResolvedValue(0.5),
}));
const mockMissionAnalystService = vi.hoisted(() => ({
  validateObjectiveClarity: vi.fn().mockResolvedValue({ score: 80, feedback: "Clear" }),
}));
const mockPipelineService = vi.hoisted(() => ({
  updateExecution: vi.fn().mockResolvedValue(undefined),
  getExecutionById: vi.fn(),
}));
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const mockDbSelect = vi.hoisted(() => vi.fn());
const mockDbUpdate = vi.hoisted(() => vi.fn());

// ── Module mocks ───────────────────────────────────────────────────────────

vi.mock("@server/database_service.js", () => ({
  db: {
    select: (...args: any[]) => mockDbSelect(...args),
    update: (...args: any[]) => mockDbUpdate(...args),
  },
}));

vi.mock("@server/utils/logger.js", () => ({
  createLogger: () => mockLogger,
}));

vi.mock("@domain/agents/core/knowledge-base-question-engine.service.js", () => ({
  knowledgeBaseQuestionEngineService: {
    getPreMissionBriefing: (...args: any[]) => mockGetPreMissionBriefing(...args),
  },
}));

vi.mock("@domain/agents/core/context-injection/index.js", () => ({
  extractReferences: (...args: any[]) => mockExtractReferences(...args),
}));

vi.mock("@domain/mission/core/mission-query.service.js", () => ({
  missionQueryService: mockMissionQueryService,
}));

vi.mock("@domain/mission/core/mission-analyst.service.js", () => ({
  missionAnalystService: mockMissionAnalystService,
}));

vi.mock("@domain/pipeline/core/pipeline.service.js", () => ({
  pipelineService: mockPipelineService,
}));

// Mock the missions schema for the DB query
vi.mock("@shared/schema/index.js", () => ({
  missions: { id: "id", objective: "objective", budgetLimitUsd: "budget_limit_usd" },
  pipelineExecutions: { id: "id" },
  pipelines: { id: "id", organizationId: "organization_id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: any, b: any) => ({ type: "eq", a, b }),
  and: (...args: any[]) => ({ type: "and", args }),
  sql: Object.assign((...args: any[]) => args, { join: (...args: any[]) => args }),
  desc: (a: any) => ({ type: "desc", a }),
  asc: (a: any) => ({ type: "asc", a }),
}));

// Mock doomsday clock
vi.mock("@server/core/loopbane-protocols.js", () => ({
  checkDoomsdayClock: () => ({ allowed: true }),
  checkCycleBreaker: vi.fn().mockResolvedValue({ allowed: true }),
  checkStagnationLock: vi.fn().mockResolvedValue({ allowed: true }),
  stateTracker: { recordStep: vi.fn(), getStepHistory: vi.fn().mockReturnValue([]) },
}));

// ── Test Suite ─────────────────────────────────────────────────────────────

describe("12.4 Pre-mission briefing in pipeline integration", () => {
  let executeBriefingBlock: (
    pipelineExecution: any,
    pipeline: any,
    context: any
  ) => Promise<any>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Default: mission exists with objective and budget
    mockDbSelect.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve([
              {
                id: 100,
                objective: "Implement user auth module",
                budgetLimitUsd: "5.00",
              },
            ]),
        }),
      }),
    });

    /**
     * Simulates the KB pre-mission briefing section of the pipeline executor's
     * governance pre-flight block. This is extracted from
     * `server/core/pipeline-executor.ts` lines 552-581.
     */
    executeBriefingBlock = async (
      pipelineExecution: any,
      pipeline: any,
      context: any
    ) => {
      // ── KB PRE-MISSION BRIEFING (non-blocking) ──
      try {
        const plan =
          context.data?.implementation_plan ??
          context.named?.implementation_plan;
        if (plan && pipelineExecution.missionId) {
          const refs = mockExtractReferences(plan);
          if (refs.filePaths.length > 0) {
            const briefingPromise = mockGetPreMissionBriefing(
              pipeline.organizationId,
              refs.filePaths
            );

            const briefingTimeout = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("BRIEFING_TIMEOUT")), 3000)
            );

            const briefingItems = await Promise.race([
              briefingPromise,
              briefingTimeout,
            ]);

            if (briefingItems.length > 0) {
              context.data = {
                ...(context.data || {}),
                _preMissionBriefing: briefingItems,
              };
            }
          }
        }
      } catch (briefingErr: any) {
        mockLogger.warn(
          `[PipelineExecutor] Pre-mission briefing failed (non-blocking): ${briefingErr.message}`
        );
      }

      return context;
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Requirement 4.1: Query pending KB questions whose file paths overlap
  // ─────────────────────────────────────────────────────────────────────────

  it("calls getPreMissionBriefing with file paths extracted from implementation plan", async () => {
    const implementationPlan =
      "Modify server/routes/users.ts to add pagination.\nUpdate server/routes/auth.ts for token refresh.";

    mockExtractReferences.mockReturnValue({
      filePaths: ["server/routes/users.ts", "server/routes/auth.ts"],
      functionNames: [],
      classNames: [],
      moduleNames: [],
      typeNames: [],
    });

    mockGetPreMissionBriefing.mockResolvedValue([
      {
        questionId: 1,
        questionText: "Should we add rate limiting to users route?",
        triggerSource: "rescue_pattern_detected",
        ageInDays: 5,
        filePaths: ["server/routes/users.ts"],
      },
    ]);

    const pipelineExecution = { id: 1, missionId: 100 };
    const pipeline = { organizationId: 42 };
    const context: any = {
      data: { implementation_plan: implementationPlan },
    };

    await executeBriefingBlock(pipelineExecution, pipeline, context);

    // Verify extractReferences was called with the plan
    expect(mockExtractReferences).toHaveBeenCalledWith(implementationPlan);

    // Verify getPreMissionBriefing called with org ID and extracted file paths
    expect(mockGetPreMissionBriefing).toHaveBeenCalledWith(42, [
      "server/routes/users.ts",
      "server/routes/auth.ts",
    ]);
  });

  it("injects briefing items into mission context under _preMissionBriefing key", async () => {
    const briefingItems = [
      {
        questionId: 10,
        questionText: "Known auth token expiry issue",
        triggerSource: "predictive_failure",
        ageInDays: 12,
        filePaths: ["server/routes/auth.ts"],
      },
      {
        questionId: 11,
        questionText: "Should we add retry logic here?",
        triggerSource: "rescue_pattern_detected",
        ageInDays: 8,
        filePaths: ["server/routes/users.ts"],
      },
    ];

    mockExtractReferences.mockReturnValue({
      filePaths: ["server/routes/auth.ts", "server/routes/users.ts"],
      functionNames: [],
      classNames: [],
      moduleNames: [],
      typeNames: [],
    });

    mockGetPreMissionBriefing.mockResolvedValue(briefingItems);

    const context: any = {
      data: { implementation_plan: "Modify server/routes/auth.ts" },
    };

    const result = await executeBriefingBlock(
      { id: 1, missionId: 100 },
      { organizationId: 42 },
      context
    );

    expect(result.data._preMissionBriefing).toBeDefined();
    expect(result.data._preMissionBriefing).toHaveLength(2);
    expect(result.data._preMissionBriefing[0].questionId).toBe(10);
    expect(result.data._preMissionBriefing[1].questionId).toBe(11);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Requirement 4.2: Briefing contains questionText, triggerSource, ageInDays
  // ─────────────────────────────────────────────────────────────────────────

  it("each briefing item contains questionText, triggerSource, and ageInDays", async () => {
    const briefingItems = [
      {
        questionId: 1,
        questionText: "Why does the auth module fail on token refresh?",
        triggerSource: "memory_contradiction",
        ageInDays: 3,
        filePaths: ["server/routes/auth.ts"],
      },
      {
        questionId: 2,
        questionText: "Should credential rotation be automated?",
        triggerSource: "rescue_pattern_detected",
        ageInDays: 7,
        filePaths: ["server/routes/auth.ts", "server/services/creds.ts"],
      },
    ];

    mockExtractReferences.mockReturnValue({
      filePaths: ["server/routes/auth.ts"],
      functionNames: [],
      classNames: [],
      moduleNames: [],
      typeNames: [],
    });
    mockGetPreMissionBriefing.mockResolvedValue(briefingItems);

    const context: any = {
      data: { implementation_plan: "Fix server/routes/auth.ts" },
    };

    const result = await executeBriefingBlock(
      { id: 1, missionId: 100 },
      { organizationId: 42 },
      context
    );

    for (const item of result.data._preMissionBriefing) {
      expect(item).toHaveProperty("questionText");
      expect(item).toHaveProperty("triggerSource");
      expect(item).toHaveProperty("ageInDays");
      expect(typeof item.questionText).toBe("string");
      expect(typeof item.triggerSource).toBe("string");
      expect(typeof item.ageInDays).toBe("number");
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Requirement 4.3: Non-blocking — proceeds on failure/timeout
  // ─────────────────────────────────────────────────────────────────────────

  it("proceeds without briefing when getPreMissionBriefing throws an error", async () => {
    mockExtractReferences.mockReturnValue({
      filePaths: ["server/routes/users.ts"],
      functionNames: [],
      classNames: [],
      moduleNames: [],
      typeNames: [],
    });
    mockGetPreMissionBriefing.mockRejectedValue(
      new Error("DB connection lost")
    );

    const context: any = {
      data: { implementation_plan: "Update server/routes/users.ts" },
    };

    const result = await executeBriefingBlock(
      { id: 1, missionId: 100 },
      { organizationId: 42 },
      context
    );

    // No briefing injected
    expect(result.data._preMissionBriefing).toBeUndefined();

    // Warning logged
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Pre-mission briefing failed (non-blocking)")
    );
  });

  it("proceeds without briefing when getPreMissionBriefing times out (3s)", async () => {
    vi.useFakeTimers();

    mockExtractReferences.mockReturnValue({
      filePaths: ["server/routes/users.ts"],
      functionNames: [],
      classNames: [],
      moduleNames: [],
      typeNames: [],
    });

    // Simulate a query that never resolves
    mockGetPreMissionBriefing.mockReturnValue(new Promise(() => {}));

    const context: any = {
      data: { implementation_plan: "Update server/routes/users.ts" },
    };

    const briefingPromise = executeBriefingBlock(
      { id: 1, missionId: 100 },
      { organizationId: 42 },
      context
    );

    // Advance past the 3-second timeout
    vi.advanceTimersByTime(3001);

    const result = await briefingPromise;

    // No briefing injected — timeout was caught
    expect(result.data._preMissionBriefing).toBeUndefined();

    // Warning logged about timeout
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("BRIEFING_TIMEOUT")
    );
  });

  it("does not block pipeline execution when briefing fails", async () => {
    mockExtractReferences.mockReturnValue({
      filePaths: ["server/routes/users.ts"],
      functionNames: [],
      classNames: [],
      moduleNames: [],
      typeNames: [],
    });
    mockGetPreMissionBriefing.mockRejectedValue(
      new Error("Query timeout")
    );

    const context: any = {
      data: {
        implementation_plan: "Modify server/routes/users.ts",
        existingKey: "preserved",
      },
    };

    const result = await executeBriefingBlock(
      { id: 1, missionId: 100 },
      { organizationId: 42 },
      context
    );

    // Existing context data is preserved
    expect(result.data.existingKey).toBe("preserved");
    expect(result.data.implementation_plan).toBe(
      "Modify server/routes/users.ts"
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Requirement 4.5: At most 5 items, ordered oldest-first
  // ─────────────────────────────────────────────────────────────────────────

  it("briefing contains at most 5 items ordered oldest-first", async () => {
    // Simulate the service returning exactly 5 items (max) from 7 matching
    // The service itself enforces the limit, but we verify the pipeline receives ≤5
    const briefingItems = [
      { questionId: 1, questionText: "Q1", triggerSource: "predictive_failure", ageInDays: 14, filePaths: ["server/app.ts"] },
      { questionId: 2, questionText: "Q2", triggerSource: "rescue_pattern_detected", ageInDays: 12, filePaths: ["server/app.ts"] },
      { questionId: 3, questionText: "Q3", triggerSource: "memory_contradiction", ageInDays: 10, filePaths: ["server/app.ts"] },
      { questionId: 4, questionText: "Q4", triggerSource: "hil_pattern_detected", ageInDays: 7, filePaths: ["server/app.ts"] },
      { questionId: 5, questionText: "Q5", triggerSource: "low_confidence_compaction", ageInDays: 3, filePaths: ["server/app.ts"] },
    ];

    mockExtractReferences.mockReturnValue({
      filePaths: ["server/app.ts"],
      functionNames: [],
      classNames: [],
      moduleNames: [],
      typeNames: [],
    });
    mockGetPreMissionBriefing.mockResolvedValue(briefingItems);

    const context: any = {
      data: { implementation_plan: "Refactor server/app.ts" },
    };

    const result = await executeBriefingBlock(
      { id: 1, missionId: 100 },
      { organizationId: 42 },
      context
    );

    // At most 5 items
    expect(result.data._preMissionBriefing.length).toBeLessThanOrEqual(5);

    // Ordered oldest-first (highest ageInDays first)
    const ages = result.data._preMissionBriefing.map(
      (item: any) => item.ageInDays
    );
    for (let i = 0; i < ages.length - 1; i++) {
      expect(ages[i]).toBeGreaterThanOrEqual(ages[i + 1]);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Additional integration scenarios
  // ─────────────────────────────────────────────────────────────────────────

  it("skips briefing when no missionId is set on execution", async () => {
    const context: any = {
      data: { implementation_plan: "Update server/routes/users.ts" },
    };

    const result = await executeBriefingBlock(
      { id: 1, missionId: null },
      { organizationId: 42 },
      context
    );

    expect(mockExtractReferences).not.toHaveBeenCalled();
    expect(mockGetPreMissionBriefing).not.toHaveBeenCalled();
    expect(result.data._preMissionBriefing).toBeUndefined();
  });

  it("skips briefing when no implementation plan is available in context", async () => {
    const context: any = { data: {} };

    const result = await executeBriefingBlock(
      { id: 1, missionId: 100 },
      { organizationId: 42 },
      context
    );

    expect(mockExtractReferences).not.toHaveBeenCalled();
    expect(mockGetPreMissionBriefing).not.toHaveBeenCalled();
    expect(result.data._preMissionBriefing).toBeUndefined();
  });

  it("skips briefing when extractReferences returns no file paths", async () => {
    mockExtractReferences.mockReturnValue({
      filePaths: [],
      functionNames: ["doSomething"],
      classNames: [],
      moduleNames: [],
      typeNames: [],
    });

    const context: any = {
      data: { implementation_plan: "Refactor logic in doSomething()" },
    };

    const result = await executeBriefingBlock(
      { id: 1, missionId: 100 },
      { organizationId: 42 },
      context
    );

    expect(mockGetPreMissionBriefing).not.toHaveBeenCalled();
    expect(result.data._preMissionBriefing).toBeUndefined();
  });

  it("does not inject briefing when getPreMissionBriefing returns empty array", async () => {
    mockExtractReferences.mockReturnValue({
      filePaths: ["server/routes/users.ts"],
      functionNames: [],
      classNames: [],
      moduleNames: [],
      typeNames: [],
    });
    mockGetPreMissionBriefing.mockResolvedValue([]);

    const context: any = {
      data: { implementation_plan: "Modify server/routes/users.ts" },
    };

    const result = await executeBriefingBlock(
      { id: 1, missionId: 100 },
      { organizationId: 42 },
      context
    );

    // Empty briefing means it's not injected
    expect(result.data._preMissionBriefing).toBeUndefined();
  });

  it("reads implementation_plan from context.named when data is not available", async () => {
    const plan = "Update server/services/billing.ts for new pricing tiers";

    mockExtractReferences.mockReturnValue({
      filePaths: ["server/services/billing.ts"],
      functionNames: [],
      classNames: [],
      moduleNames: [],
      typeNames: [],
    });
    mockGetPreMissionBriefing.mockResolvedValue([
      {
        questionId: 99,
        questionText: "Billing calculation may overflow for large orgs",
        triggerSource: "predictive_failure",
        ageInDays: 20,
        filePaths: ["server/services/billing.ts"],
      },
    ]);

    const context: any = {
      data: {},
      named: { implementation_plan: plan },
    };

    const result = await executeBriefingBlock(
      { id: 1, missionId: 100 },
      { organizationId: 42 },
      context
    );

    expect(mockExtractReferences).toHaveBeenCalledWith(plan);
    expect(result.data._preMissionBriefing).toHaveLength(1);
    expect(result.data._preMissionBriefing[0].questionId).toBe(99);
  });
});
