/**
 * Unit Tests for Pre-Mission Briefing (Task 8.4)
 *
 * Tests getPreMissionBriefing() method on KnowledgeBaseQuestionEngineService.
 * Validates: Requirements 4.1, 4.2, 4.3, 4.5
 *
 * Mocking pattern follows rescue-strategy-tracker.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Hoisted mock references ---
const mockDbWhere = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const mockDbWhereWithOrderBy = vi.hoisted(() => vi.fn().mockResolvedValue([]));

const mockLoggerWarn = vi.hoisted(() => vi.fn());

// --- Mocks ---

vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => ({
  redis: {
    zadd: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    zcount: vi.fn().mockResolvedValue(0),
    zcard: vi.fn().mockResolvedValue(0),
    zrangebyscore: vi.fn().mockResolvedValue([]),
    incr: vi.fn().mockResolvedValue(1),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
  },
}));

vi.mock("@server/utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: mockLoggerWarn,
    error: vi.fn(),
  }),
}));

vi.mock("@domain/ai/core/system-ai.service.js", () => ({
  systemAiService: {
    getAiConfig: vi.fn().mockResolvedValue({ provider: "google", model: "gemini-1.5-pro" }),
    generateJson: vi.fn().mockResolvedValue({ questionText: "mock", proposedAnswer: "mock" }),
  },
}));

vi.mock("../../agent-memory-across-missions.service.js", () => ({
  agentMemoryAcrossMissionsService: {
    storeEntry: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../context-injection/reference-extractor.js", () => ({
  extractReferences: vi.fn().mockReturnValue({ filePaths: [] }),
}));

vi.mock("@server/database_service.js", () => ({
  db: {
    select: () => ({
      from: (table: any) => ({
        where: (...args: any[]) => {
          const result = mockDbWhere(...args);
          return Object.assign(Promise.resolve(result), {
            then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
            catch: (reject: any) => Promise.resolve(result).catch(reject),
            orderBy: (...orderArgs: any[]) => {
              return mockDbWhereWithOrderBy(...args, ...orderArgs);
            },
            limit: (...limitArgs: any[]) => {
              return mockDbWhere(...args);
            },
          });
        },
        innerJoin: () => ({
          where: (...args: any[]) => Promise.resolve([]),
          orderBy: () => ({
            limit: () => Promise.resolve([]),
          }),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([{ id: 1 }]),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => Promise.resolve(),
      }),
    }),
  },
}));

vi.mock("@shared/schema/index.js", () => ({
  knowledgeBaseQuestions: {
    id: "id",
    organizationId: "organization_id",
    repositoryId: "repository_id",
    triggerSource: "trigger_source",
    status: "status",
    contextData: "context_data",
    questionText: "question_text",
    createdAt: "created_at",
  },
  agentKnowledgeGraphEntries: {},
  orgs: { id: "id" },
  missionRuns: {
    id: "id",
    isSuccess: "is_success",
    status: "status",
    missionId: "mission_id",
    createdAt: "created_at",
  },
  missions: {
    id: "id",
    organizationId: "organization_id",
    workspacePath: "workspace_path",
    vcsConfig: "vcs_config",
  },
  agentRunSteps: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: any, b: any) => ({ type: "eq", a, b }),
  and: (...args: any[]) => ({ type: "and", args }),
  ne: (a: any, b: any) => ({ type: "ne", a, b }),
  sql: Object.assign((...args: any[]) => args, { join: (...args: any[]) => args }),
  desc: (a: any) => ({ type: "desc", a }),
  asc: (a: any) => ({ type: "asc", a }),
}));

// --- Import after mocks ---
import { KnowledgeBaseQuestionEngineService } from "../../knowledge-base-question-engine.service.js";

describe("getPreMissionBriefing", () => {
  let service: KnowledgeBaseQuestionEngineService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbWhere.mockResolvedValue([]);
    mockDbWhereWithOrderBy.mockResolvedValue([]);
    service = KnowledgeBaseQuestionEngineService.getInstance();
  });

  it("returns matching questions by file path overlap", async () => {
    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

    mockDbWhereWithOrderBy.mockResolvedValue([
      {
        id: 1,
        questionText: "Should we add input validation here?",
        triggerSource: "predictive_failure",
        status: "pending",
        contextData: { filePaths: ["server/routes/users.ts", "server/routes/auth.ts"] },
        createdAt: twoDaysAgo,
      },
      {
        id: 2,
        questionText: "Unrelated question with different file paths",
        triggerSource: "memory_contradiction",
        status: "pending",
        contextData: { filePaths: ["client/components/Header.tsx"] },
        createdAt: now,
      },
    ]);

    const briefing = await service.getPreMissionBriefing(1, ["server/routes/users.ts"]);

    // Only the first question has an overlapping file path
    expect(briefing).toHaveLength(1);
    expect(briefing[0].questionId).toBe(1);
    expect(briefing[0].questionText).toBe("Should we add input validation here?");
    expect(briefing[0].triggerSource).toBe("predictive_failure");
    expect(briefing[0].filePaths).toContain("server/routes/users.ts");
  });

  it("limits results to 5 items", async () => {
    const now = new Date();
    // Create 8 matching pending questions
    const questions = Array.from({ length: 8 }, (_, i) => ({
      id: i + 1,
      questionText: `Question ${i + 1}`,
      triggerSource: "predictive_failure",
      status: "pending",
      contextData: { filePaths: ["server/app.ts"] },
      createdAt: new Date(now.getTime() - (8 - i) * 24 * 60 * 60 * 1000),
    }));

    mockDbWhereWithOrderBy.mockResolvedValue(questions);

    const briefing = await service.getPreMissionBriefing(1, ["server/app.ts"]);

    expect(briefing).toHaveLength(5);
  });

  it("orders results oldest-first (ascending creation date)", async () => {
    const now = new Date();
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

    // DB already returns sorted by createdAt ASC (as per the query)
    mockDbWhereWithOrderBy.mockResolvedValue([
      {
        id: 1,
        questionText: "Oldest question",
        triggerSource: "rescue_pattern_detected",
        status: "pending",
        contextData: { filePaths: ["server/service.ts"] },
        createdAt: tenDaysAgo,
      },
      {
        id: 2,
        questionText: "Middle question",
        triggerSource: "hil_pattern_detected",
        status: "pending",
        contextData: { filePaths: ["server/service.ts"] },
        createdAt: fiveDaysAgo,
      },
      {
        id: 3,
        questionText: "Newest question",
        triggerSource: "predictive_failure",
        status: "pending",
        contextData: { filePaths: ["server/service.ts"] },
        createdAt: twoDaysAgo,
      },
    ]);

    const briefing = await service.getPreMissionBriefing(1, ["server/service.ts"]);

    expect(briefing).toHaveLength(3);
    // Oldest first — ageInDays should be descending
    expect(briefing[0].ageInDays).toBeGreaterThanOrEqual(briefing[1].ageInDays);
    expect(briefing[1].ageInDays).toBeGreaterThanOrEqual(briefing[2].ageInDays);
    expect(briefing[0].questionText).toBe("Oldest question");
    expect(briefing[2].questionText).toBe("Newest question");
  });

  it("returns empty array when no matches are found", async () => {
    // All pending questions have file paths that don't overlap
    mockDbWhereWithOrderBy.mockResolvedValue([
      {
        id: 1,
        questionText: "Some unrelated question",
        triggerSource: "predictive_failure",
        status: "pending",
        contextData: { filePaths: ["client/app.tsx"] },
        createdAt: new Date(),
      },
    ]);

    const briefing = await service.getPreMissionBriefing(1, ["server/routes/users.ts"]);

    expect(briefing).toEqual([]);
  });

  it("returns empty array on empty file paths input", async () => {
    const briefing = await service.getPreMissionBriefing(1, []);

    expect(briefing).toEqual([]);
    // Should not even query the DB
    expect(mockDbWhereWithOrderBy).not.toHaveBeenCalled();
  });

  it("handles DB failure gracefully — returns empty array and logs warning", async () => {
    mockDbWhereWithOrderBy.mockRejectedValue(new Error("Connection timeout"));

    const briefing = await service.getPreMissionBriefing(1, ["server/app.ts"]);

    expect(briefing).toEqual([]);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining("Pre-mission briefing query failed")
    );
  });

  it("each BriefingItem includes questionId, questionText, triggerSource, ageInDays, and filePaths", async () => {
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

    mockDbWhereWithOrderBy.mockResolvedValue([
      {
        id: 42,
        questionText: "How should we handle retries?",
        triggerSource: "rescue_pattern_detected",
        status: "pending",
        contextData: { filePaths: ["server/jobs/build.ts", "server/jobs/deploy.ts"] },
        createdAt: threeDaysAgo,
      },
    ]);

    const briefing = await service.getPreMissionBriefing(1, ["server/jobs/build.ts"]);

    expect(briefing).toHaveLength(1);
    const item = briefing[0];
    expect(item.questionId).toBe(42);
    expect(item.questionText).toBe("How should we handle retries?");
    expect(item.triggerSource).toBe("rescue_pattern_detected");
    expect(item.ageInDays).toBe(3);
    expect(item.filePaths).toEqual(["server/jobs/build.ts", "server/jobs/deploy.ts"]);
  });

  it("returns empty array when missionFilePaths is null/undefined", async () => {
    const briefing = await service.getPreMissionBriefing(1, null as any);

    expect(briefing).toEqual([]);
    expect(mockDbWhereWithOrderBy).not.toHaveBeenCalled();
  });
});
