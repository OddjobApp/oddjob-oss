/**
 * Unit tests for getTechDebtCards service method.
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Hoisted mock references ---
const mockDbWhere = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const mockDbInnerJoinWhere = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const mockDbInsert = vi.hoisted(() => vi.fn());
const mockDbUpdate = vi.hoisted(() => vi.fn());
const mockDbDelete = vi.hoisted(() => vi.fn());

// --- Mocks ---

vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => ({
  redis: {
    zadd: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    zcount: vi.fn().mockResolvedValue(0),
    zcard: vi.fn().mockResolvedValue(0),
    zrangebyscore: vi.fn().mockResolvedValue([]),
    incr: vi.fn().mockResolvedValue(1),
  },
}));

vi.mock("@server/utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("../../knowledge-base-question-engine.service.js", async (importOriginal) => {
  const realModule = await importOriginal<any>();
  return {
    ...realModule,
  };
});

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
            orderBy: () => Promise.resolve(result),
            limit: () => Promise.resolve(result),
          });
        },
        innerJoin: () => ({
          where: (...args: any[]) => mockDbInnerJoinWhere(...args),
        }),
      }),
    }),
    insert: (...args: any[]) => {
      mockDbInsert(...args);
      return {
        values: () => ({
          returning: () => Promise.resolve([{ id: 1 }]),
        }),
      };
    },
    update: (...args: any[]) => {
      mockDbUpdate(...args);
      return {
        set: () => ({
          where: () => Promise.resolve(),
        }),
      };
    },
    delete: (...args: any[]) => {
      mockDbDelete(...args);
      return {
        where: () => Promise.resolve(),
      };
    },
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

describe("getTechDebtCards", () => {
  let service: KnowledgeBaseQuestionEngineService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbWhere.mockResolvedValue([]);
    mockDbInnerJoinWhere.mockResolvedValue([]);
    service = KnowledgeBaseQuestionEngineService.getInstance();
  });

  it("computes priority score correctly with known values: (failureFrequency*3) + (ageInDays*1) + (missionReferenceCount*2)", async () => {
    const now = new Date();
    // Question is 7 days old
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    mockDbWhere.mockResolvedValue([
      {
        id: 1,
        questionText: "Should we handle timeout errors?",
        triggerSource: "predictive_failure",
        status: "pending",
        contextData: { filePaths: ["server/api.ts"] },
        createdAt: sevenDaysAgo,
        repositoryId: "repo-alpha",
      },
    ]);

    // 4 failed out of 6 total mission runs
    mockDbInnerJoinWhere.mockResolvedValue([
      { id: 1, isSuccess: false, status: "failed" },
      { id: 2, isSuccess: false, status: "error" },
      { id: 3, isSuccess: false, status: "failed" },
      { id: 4, isSuccess: false, status: "failed" },
      { id: 5, isSuccess: true, status: "completed" },
      { id: 6, isSuccess: true, status: "completed" },
    ]);

    const cards = await service.getTechDebtCards({ organizationId: 1 });

    expect(cards.length).toBe(1);
    const card = cards[0];

    // failureFrequency=4, ageInDays=7, missionReferenceCount=6
    // Expected: (4*3) + (7*1) + (6*2) = 12 + 7 + 12 = 31
    const expectedScore = (4 * 3) + (7 * 1) + (6 * 2);
    expect(card.priorityScore).toBe(expectedScore);
  });

  it("filters by repository ID when repositoryId is provided in query", async () => {
    const now = new Date();

    // DB returns only repo-A questions when filtered
    mockDbWhere.mockResolvedValue([
      {
        id: 10,
        questionText: "Repo-A question",
        triggerSource: "rescue_pattern_detected",
        status: "pending",
        contextData: { filePaths: ["src/module.ts"] },
        createdAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
        repositoryId: "repo-A",
      },
    ]);

    mockDbInnerJoinWhere.mockResolvedValue([]);

    const cards = await service.getTechDebtCards({
      organizationId: 1,
      repositoryId: "repo-A",
    });

    expect(cards.length).toBe(1);
    expect(cards[0].repositoryId).toBe("repo-A");

    // Verify the where clause was called (filter applied at DB level)
    expect(mockDbWhere).toHaveBeenCalled();
  });

  it("sorts by priority score descending", async () => {
    const now = new Date();

    mockDbWhere.mockResolvedValue([
      {
        id: 1,
        questionText: "Low score item",
        triggerSource: "predictive_failure",
        status: "pending",
        contextData: { filePaths: ["a.ts"] },
        createdAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000), // 2 days old
        repositoryId: "repo-x",
      },
      {
        id: 2,
        questionText: "High score item",
        triggerSource: "rescue_pattern_detected",
        status: "pending",
        contextData: { filePaths: ["b.ts"] },
        createdAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), // 30 days old
        repositoryId: "repo-x",
      },
      {
        id: 3,
        questionText: "Medium score item",
        triggerSource: "hil_pattern_detected",
        status: "pending",
        contextData: { filePaths: ["c.ts"] },
        createdAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000), // 10 days old
        repositoryId: "repo-x",
      },
    ]);

    // Same mission runs for same repo (2 failed, 3 total)
    mockDbInnerJoinWhere.mockResolvedValue([
      { id: 1, isSuccess: false, status: "failed" },
      { id: 2, isSuccess: false, status: "error" },
      { id: 3, isSuccess: true, status: "completed" },
    ]);

    const cards = await service.getTechDebtCards({ organizationId: 1 });

    expect(cards.length).toBe(3);

    // Verify descending order
    for (let i = 0; i < cards.length - 1; i++) {
      expect(cards[i].priorityScore).toBeGreaterThanOrEqual(cards[i + 1].priorityScore);
    }

    // The 30-day-old question should have the highest score
    expect(cards[0].questionId).toBe(2);
  });

  it("limits to 50 results maximum", async () => {
    const now = new Date();

    // Generate 75 pending questions
    const questions = Array.from({ length: 75 }, (_, i) => ({
      id: i + 1,
      questionText: `Question number ${i + 1}`,
      triggerSource: "predictive_failure",
      status: "pending",
      contextData: { filePaths: [`file${i}.ts`] },
      createdAt: new Date(now.getTime() - i * 24 * 60 * 60 * 1000),
      repositoryId: "repo-bulk",
    }));

    mockDbWhere.mockResolvedValue(questions);
    mockDbInnerJoinWhere.mockResolvedValue([]);

    const cards = await service.getTechDebtCards({ organizationId: 1 });

    expect(cards.length).toBe(50);
  });

  it("limits to custom limit if less than 50", async () => {
    const now = new Date();

    const questions = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      questionText: `Question ${i + 1}`,
      triggerSource: "predictive_failure",
      status: "pending",
      contextData: { filePaths: [`file${i}.ts`] },
      createdAt: new Date(now.getTime() - i * 24 * 60 * 60 * 1000),
      repositoryId: "repo-custom",
    }));

    mockDbWhere.mockResolvedValue(questions);
    mockDbInnerJoinWhere.mockResolvedValue([]);

    const cards = await service.getTechDebtCards({ organizationId: 1, limit: 10 });

    expect(cards.length).toBe(10);
  });

  it("caps custom limit at 50 even if higher value provided", async () => {
    const now = new Date();

    const questions = Array.from({ length: 60 }, (_, i) => ({
      id: i + 1,
      questionText: `Question ${i + 1}`,
      triggerSource: "predictive_failure",
      status: "pending",
      contextData: { filePaths: [`file${i}.ts`] },
      createdAt: new Date(now.getTime() - i * 24 * 60 * 60 * 1000),
      repositoryId: "repo-over",
    }));

    mockDbWhere.mockResolvedValue(questions);
    mockDbInnerJoinWhere.mockResolvedValue([]);

    const cards = await service.getTechDebtCards({ organizationId: 1, limit: 100 });

    expect(cards.length).toBe(50);
  });

  it("returns all required fields: questionText, triggerSource, createdAt, ageInDays, filePaths, priorityScore, repositoryId", async () => {
    const now = new Date();
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

    mockDbWhere.mockResolvedValue([
      {
        id: 42,
        questionText: "Should we refactor this module?",
        triggerSource: "hil_pattern_detected",
        status: "pending",
        contextData: { filePaths: ["server/auth.ts", "server/middleware.ts"] },
        createdAt: fiveDaysAgo,
        repositoryId: "repo-frontend",
      },
    ]);

    mockDbInnerJoinWhere.mockResolvedValue([
      { id: 1, isSuccess: true, status: "completed" },
    ]);

    const cards = await service.getTechDebtCards({ organizationId: 1 });

    expect(cards.length).toBe(1);
    const card = cards[0];

    // Verify all required fields exist with correct types
    expect(card.questionId).toBe(42);
    expect(card.questionText).toBe("Should we refactor this module?");
    expect(card.triggerSource).toBe("hil_pattern_detected");
    expect(card.createdAt).toBeInstanceOf(Date);
    expect(card.createdAt.getTime()).toBe(fiveDaysAgo.getTime());
    expect(typeof card.ageInDays).toBe("number");
    expect(card.ageInDays).toBe(5);
    expect(Array.isArray(card.filePaths)).toBe(true);
    expect(card.filePaths).toEqual(["server/auth.ts", "server/middleware.ts"]);
    expect(typeof card.priorityScore).toBe("number");
    expect(card.repositoryId).toBe("repo-frontend");
  });

  it("does not modify any DB records (read-only operation)", async () => {
    const now = new Date();

    mockDbWhere.mockResolvedValue([
      {
        id: 100,
        questionText: "Read-only test",
        triggerSource: "predictive_failure",
        status: "pending",
        contextData: { filePaths: ["test.ts"] },
        createdAt: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000),
        repositoryId: "repo-readonly",
      },
    ]);

    mockDbInnerJoinWhere.mockResolvedValue([
      { id: 1, isSuccess: false, status: "failed" },
    ]);

    await service.getTechDebtCards({ organizationId: 1 });

    // Verify no insert, update, or delete operations were called
    expect(mockDbInsert).not.toHaveBeenCalled();
    expect(mockDbUpdate).not.toHaveBeenCalled();
    expect(mockDbDelete).not.toHaveBeenCalled();
  });

  it("returns empty array when no pending questions exist", async () => {
    mockDbWhere.mockResolvedValue([]);

    const cards = await service.getTechDebtCards({ organizationId: 1 });

    expect(cards).toEqual([]);
  });

  it("handles questions with empty filePaths gracefully", async () => {
    const now = new Date();

    mockDbWhere.mockResolvedValue([
      {
        id: 200,
        questionText: "Missing file paths",
        triggerSource: "memory_contradiction",
        status: "pending",
        contextData: {}, // No filePaths field
        createdAt: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000),
        repositoryId: "repo-sparse",
      },
    ]);

    mockDbInnerJoinWhere.mockResolvedValue([]);

    const cards = await service.getTechDebtCards({ organizationId: 1 });

    expect(cards.length).toBe(1);
    expect(cards[0].filePaths).toEqual([]);
  });

  it("computes ageInDays as floored integer days since creation", async () => {
    const now = new Date();
    // 3.7 days ago — should floor to 3
    const createdAt = new Date(now.getTime() - 3.7 * 24 * 60 * 60 * 1000);

    mockDbWhere.mockResolvedValue([
      {
        id: 300,
        questionText: "Age test",
        triggerSource: "predictive_failure",
        status: "pending",
        contextData: { filePaths: [] },
        createdAt,
        repositoryId: "repo-age",
      },
    ]);

    mockDbInnerJoinWhere.mockResolvedValue([]);

    const cards = await service.getTechDebtCards({ organizationId: 1 });

    expect(cards[0].ageInDays).toBe(3);
  });

  it("computes failureFrequency from mission runs that are not successful", async () => {
    const now = new Date();

    mockDbWhere.mockResolvedValue([
      {
        id: 400,
        questionText: "Failure count test",
        triggerSource: "predictive_failure",
        status: "pending",
        contextData: { filePaths: ["server/handler.ts"] },
        createdAt: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000),
        repositoryId: "repo-fail",
      },
    ]);

    // Mix of success and failure states
    mockDbInnerJoinWhere.mockResolvedValue([
      { id: 1, isSuccess: false, status: "failed" },
      { id: 2, isSuccess: false, status: "error" },
      { id: 3, isSuccess: true, status: "completed" },
      { id: 4, isSuccess: false, status: "cancelled" },
      { id: 5, isSuccess: true, status: "completed" },
    ]);

    const cards = await service.getTechDebtCards({ organizationId: 1 });

    // failureFrequency = 3 (items where isSuccess !== true AND status !== "completed")
    // missionReferenceCount = 5 (total)
    // ageInDays = 1
    // Expected: (3*3) + (1*1) + (5*2) = 9 + 1 + 10 = 20
    const expectedScore = (3 * 3) + (1 * 1) + (5 * 2);
    expect(cards[0].priorityScore).toBe(expectedScore);
  });

  it("handles zero mission runs (failureFrequency=0, missionReferenceCount=0)", async () => {
    const now = new Date();

    mockDbWhere.mockResolvedValue([
      {
        id: 500,
        questionText: "No missions",
        triggerSource: "low_confidence_compaction",
        status: "pending",
        contextData: { filePaths: ["util.ts"] },
        createdAt: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000), // 14 days old
        repositoryId: "repo-empty",
      },
    ]);

    mockDbInnerJoinWhere.mockResolvedValue([]); // No mission runs

    const cards = await service.getTechDebtCards({ organizationId: 1 });

    // Expected: (0*3) + (14*1) + (0*2) = 14
    expect(cards[0].priorityScore).toBe(14);
  });
});
