/**
 * Property-based tests for Tech Debt Read-Only Invariant.
 *
 * **Property 10: Tech Debt Read-Only Invariant**
 * For any call to `getTechDebtCards()`, the status of all KB questions in the
 * database SHALL remain unchanged after the call completes. The method SHALL
 * not create, update, or delete any records.
 *
 * Since fast-check is not installable in this project (npm peer-dep conflicts),
 * these tests use manual randomization with 100 random cases per property
 * to achieve property-based testing coverage.
 *
 * **Validates: Requirements 5.4, 6.5**
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mock references ────────────────────────────────────────────────

const mockDbInsert = vi.hoisted(() => vi.fn());
const mockDbUpdate = vi.hoisted(() => vi.fn());
const mockDbDelete = vi.hoisted(() => vi.fn());
const mockDbSelectResult = vi.hoisted(() => vi.fn().mockResolvedValue([]));

// Track all DB operations for read-only verification
const dbOperationLog = vi.hoisted(() => ({
  inserts: [] as any[],
  updates: [] as any[],
  deletes: [] as any[],
  selects: [] as any[],
  clear() {
    this.inserts = [];
    this.updates = [];
    this.deletes = [];
    this.selects = [];
  },
}));

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@server/database_service.js", () => ({
  db: {
    select: () => {
      dbOperationLog.selects.push({ type: "select" });
      return {
        from: () => ({
          where: (...args: any[]) => mockDbSelectResult(...args),
          innerJoin: () => ({
            where: (...args: any[]) => mockDbSelectResult(...args),
          }),
        }),
      };
    },
    insert: (...args: any[]) => {
      dbOperationLog.inserts.push({ type: "insert", args });
      mockDbInsert(...args);
      return {
        values: () => ({
          returning: () => mockDbInsert(),
        }),
      };
    },
    update: (...args: any[]) => {
      dbOperationLog.updates.push({ type: "update", args });
      mockDbUpdate(...args);
      return {
        set: () => ({
          where: () => mockDbUpdate(),
        }),
      };
    },
    delete: (...args: any[]) => {
      dbOperationLog.deletes.push({ type: "delete", args });
      mockDbDelete(...args);
      return {
        where: () => mockDbDelete(),
      };
    },
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

vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => ({
  redis: {
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
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
  missionRuns: {
    id: "id",
    missionId: "mission_id",
    isSuccess: "is_success",
    status: "status",
    createdAt: "created_at",
  },
  missions: {
    id: "id",
    organizationId: "organization_id",
    workspacePath: "workspace_path",
    vcsConfig: "vcs_config",
  },
  agentKnowledgeGraphEntries: {},
  orgs: {},
  agentRunSteps: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: any, b: any) => ({ type: "eq", a, b }),
  and: (...args: any[]) => ({ type: "and", args }),
  ne: (a: any, b: any) => ({ type: "ne", a, b }),
  sql: Object.assign((...args: any[]) => ({ type: "sql", args }), {
    join: (...args: any[]) => ({ type: "sql_join", args }),
  }),
  desc: (col: any) => ({ type: "desc", col }),
  asc: (col: any) => ({ type: "asc", col }),
}));

vi.mock("@domain/ai/core/system-ai.service.js", () => ({
  systemAiService: { getAiConfig: vi.fn(), generateJson: vi.fn() },
}));

vi.mock("../../agent-memory-across-missions.service.js", () => ({
  agentMemoryAcrossMissionsService: { storeEntry: vi.fn() },
}));

vi.mock("../../context-injection/reference-extractor.js", () => ({
  extractReferences: vi.fn().mockReturnValue({ filePaths: [] }),
}));

vi.mock("../keyword-similarity.js", () => ({
  computeJaccardSimilarity: vi.fn().mockReturnValue(0),
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import { KnowledgeBaseQuestionEngineService } from "../../knowledge-base-question-engine.service.js";

// ─── Random Generators ──────────────────────────────────────────────────────

/** Seeded pseudo-random number generator for reproducibility */
function createRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function randomInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function randomString(rng: () => number, minLen: number, maxLen: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz_";
  const len = randomInt(rng, minLen, maxLen);
  let result = "";
  for (let i = 0; i < len; i++) {
    result += chars[Math.floor(rng() * chars.length)];
  }
  return result;
}

/** Generate a random trigger source */
function generateTriggerSource(rng: () => number): string {
  const sources = [
    "predictive_failure",
    "memory_contradiction",
    "low_confidence_compaction",
    "rescue_pattern_detected",
    "hil_pattern_detected",
    "cross_repo_propagation",
  ];
  return sources[randomInt(rng, 0, sources.length - 1)];
}

/** Generate a random question status */
function generateStatus(rng: () => number): string {
  const statuses = ["pending", "answered", "ignored"];
  return statuses[randomInt(rng, 0, statuses.length - 1)];
}

/** Generate random file paths */
function generateFilePaths(rng: () => number): string[] {
  const count = randomInt(rng, 0, 5);
  const extensions = [".ts", ".tsx", ".js", ".py", ".go", ".rs", ".java"];
  const paths: string[] = [];
  for (let i = 0; i < count; i++) {
    const ext = extensions[randomInt(rng, 0, extensions.length - 1)];
    paths.push(`src/${randomString(rng, 3, 10)}/${randomString(rng, 3, 12)}${ext}`);
  }
  return paths;
}

/** Generate a mock pending KB question record */
function generatePendingQuestion(rng: () => number, orgId: number, repoId?: string) {
  const daysAgo = randomInt(rng, 0, 90);
  const createdAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return {
    id: randomInt(rng, 1, 99999),
    organizationId: orgId,
    repositoryId: repoId || `repo-${randomString(rng, 4, 8)}`,
    questionText: `Why does ${randomString(rng, 5, 15)} fail in ${randomString(rng, 3, 10)}?`,
    status: "pending",
    triggerSource: generateTriggerSource(rng),
    contextData: { filePaths: generateFilePaths(rng) },
    createdAt,
    updatedAt: createdAt,
    proposedAnswer: `Consider ${randomString(rng, 5, 20)} pattern.`,
    answerText: null,
    answeredBy: null,
    resolvedAt: null,
  };
}

/** Generate a random TechDebtQuery */
function generateQuery(rng: () => number): { organizationId: number; repositoryId?: string; limit?: number } {
  const orgId = randomInt(rng, 1, 1000);
  const hasRepoFilter = rng() > 0.5;
  const hasLimit = rng() > 0.5;

  const query: any = { organizationId: orgId };
  if (hasRepoFilter) {
    query.repositoryId = `repo-${randomString(rng, 4, 8)}`;
  }
  if (hasLimit) {
    query.limit = randomInt(rng, 1, 100); // getTechDebtCards clamps to max 50
  }
  return query;
}

/** Generate mock mission runs for a repo */
function generateMissionRuns(rng: () => number, count: number) {
  const runs: any[] = [];
  for (let i = 0; i < count; i++) {
    const isSuccess = rng() > 0.4;
    runs.push({
      id: randomInt(rng, 1, 99999),
      isSuccess,
      status: isSuccess ? "completed" : "failed",
    });
  }
  return runs;
}

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("Tech Debt Cards Property Tests", () => {
  let service: KnowledgeBaseQuestionEngineService;

  beforeEach(() => {
    vi.clearAllMocks();
    dbOperationLog.clear();
    service = KnowledgeBaseQuestionEngineService.getInstance();
  });

  /**
   * **Validates: Requirements 5.4, 6.5**
   *
   * Property 10: Tech Debt Read-Only Invariant
   * Generate calls to `getTechDebtCards()` with various queries.
   * Assert all KB question statuses remain unchanged after the call.
   * Assert no records created, updated, or deleted.
   */
  describe("Property 10: Tech Debt Read-Only Invariant", () => {
    it("never performs insert, update, or delete operations (100 random cases)", async () => {
      const failures: string[] = [];

      for (let i = 0; i < 100; i++) {
        const rng = createRng(i * 7919 + 42);

        const query = generateQuery(rng);
        const questionCount = randomInt(rng, 0, 20);
        const questions = Array.from({ length: questionCount }, () =>
          generatePendingQuestion(rng, query.organizationId, query.repositoryId)
        );

        // Generate mission run data
        const missionRunCount = randomInt(rng, 0, 15);
        const missionRuns = generateMissionRuns(rng, missionRunCount);

        // Clear operation log before each call
        dbOperationLog.clear();
        vi.clearAllMocks();

        // First select returns pending questions, subsequent selects return mission runs
        let selectCallCount = 0;
        mockDbSelectResult.mockImplementation(() => {
          selectCallCount++;
          if (selectCallCount === 1) {
            return Promise.resolve(questions);
          }
          return Promise.resolve(missionRuns);
        });

        await service.getTechDebtCards(query);

        // Assert no write operations occurred
        if (dbOperationLog.inserts.length > 0) {
          failures.push(
            `Case ${i}: INSERT operation detected (${dbOperationLog.inserts.length} insert(s)) — ` +
            `query: org=${query.organizationId}, repo=${query.repositoryId || "all"}, ` +
            `questions=${questionCount}`
          );
        }
        if (dbOperationLog.updates.length > 0) {
          failures.push(
            `Case ${i}: UPDATE operation detected (${dbOperationLog.updates.length} update(s)) — ` +
            `query: org=${query.organizationId}, repo=${query.repositoryId || "all"}, ` +
            `questions=${questionCount}`
          );
        }
        if (dbOperationLog.deletes.length > 0) {
          failures.push(
            `Case ${i}: DELETE operation detected (${dbOperationLog.deletes.length} delete(s)) — ` +
            `query: org=${query.organizationId}, repo=${query.repositoryId || "all"}, ` +
            `questions=${questionCount}`
          );
        }
      }

      expect(failures).toEqual([]);
    });

    it("question statuses remain unchanged after getTechDebtCards call (100 random cases)", async () => {
      const failures: string[] = [];

      for (let i = 0; i < 100; i++) {
        const rng = createRng(i * 3571 + 17);

        const query = generateQuery(rng);
        const questionCount = randomInt(rng, 0, 20);
        const questions = Array.from({ length: questionCount }, () =>
          generatePendingQuestion(rng, query.organizationId, query.repositoryId)
        );

        // Deep copy the original statuses to compare after the call
        const originalStatuses = questions.map((q) => ({
          id: q.id,
          status: q.status,
          updatedAt: q.updatedAt,
          answerText: q.answerText,
          answeredBy: q.answeredBy,
          resolvedAt: q.resolvedAt,
        }));

        const missionRuns = generateMissionRuns(rng, randomInt(rng, 0, 10));

        vi.clearAllMocks();
        let selectCallCount = 0;
        mockDbSelectResult.mockImplementation(() => {
          selectCallCount++;
          if (selectCallCount === 1) {
            return Promise.resolve(questions);
          }
          return Promise.resolve(missionRuns);
        });

        await service.getTechDebtCards(query);

        // Verify no question objects were mutated
        for (let j = 0; j < questions.length; j++) {
          const q = questions[j];
          const orig = originalStatuses[j];

          if (q.status !== orig.status) {
            failures.push(
              `Case ${i}, Q${j}: status changed from "${orig.status}" to "${q.status}"`
            );
          }
          if (q.answerText !== orig.answerText) {
            failures.push(
              `Case ${i}, Q${j}: answerText changed from "${orig.answerText}" to "${q.answerText}"`
            );
          }
          if (q.answeredBy !== orig.answeredBy) {
            failures.push(
              `Case ${i}, Q${j}: answeredBy changed from "${orig.answeredBy}" to "${q.answeredBy}"`
            );
          }
          if (q.resolvedAt !== orig.resolvedAt) {
            failures.push(
              `Case ${i}, Q${j}: resolvedAt changed from "${orig.resolvedAt}" to "${q.resolvedAt}"`
            );
          }
        }
      }

      expect(failures).toEqual([]);
    });

    it("only uses SELECT operations regardless of query parameters (100 random cases)", async () => {
      const failures: string[] = [];

      for (let i = 0; i < 100; i++) {
        const rng = createRng(i * 6151 + 99);

        // Generate queries with varying parameters to stress-test read-only behavior
        const orgId = randomInt(rng, 1, 1000);
        const hasRepoFilter = rng() > 0.3;
        const limit = randomInt(rng, 1, 150); // test beyond max limit too
        const query: any = {
          organizationId: orgId,
          limit,
          sortBy: "priority" as const,
        };
        if (hasRepoFilter) {
          query.repositoryId = `repo-${randomString(rng, 4, 8)}`;
        }

        const questionCount = randomInt(rng, 0, 60); // test above the 50-item limit
        const questions = Array.from({ length: questionCount }, () =>
          generatePendingQuestion(rng, orgId, query.repositoryId)
        );

        const missionRuns = generateMissionRuns(rng, randomInt(rng, 0, 20));

        dbOperationLog.clear();
        vi.clearAllMocks();
        let selectCallCount = 0;
        mockDbSelectResult.mockImplementation(() => {
          selectCallCount++;
          if (selectCallCount === 1) {
            return Promise.resolve(questions);
          }
          return Promise.resolve(missionRuns);
        });

        await service.getTechDebtCards(query);

        // Verify at least one select was performed (it should query the DB)
        if (questionCount > 0 && dbOperationLog.selects.length === 0) {
          failures.push(
            `Case ${i}: No SELECT operations performed with ${questionCount} questions`
          );
        }

        // Verify ONLY selects were performed (no writes)
        const totalWrites =
          dbOperationLog.inserts.length +
          dbOperationLog.updates.length +
          dbOperationLog.deletes.length;

        if (totalWrites > 0) {
          failures.push(
            `Case ${i}: ${totalWrites} write operation(s) detected ` +
            `(inserts=${dbOperationLog.inserts.length}, updates=${dbOperationLog.updates.length}, ` +
            `deletes=${dbOperationLog.deletes.length}) — ` +
            `query: org=${orgId}, repo=${query.repositoryId || "all"}, limit=${limit}`
          );
        }
      }

      expect(failures).toEqual([]);
    });

    it("empty results do not trigger any write operations (100 random cases)", async () => {
      const failures: string[] = [];

      for (let i = 0; i < 100; i++) {
        const rng = createRng(i * 8831 + 53);

        const query = generateQuery(rng);

        dbOperationLog.clear();
        vi.clearAllMocks();
        // Return empty for all queries — no pending questions
        mockDbSelectResult.mockResolvedValue([]);

        await service.getTechDebtCards(query);

        const totalWrites =
          dbOperationLog.inserts.length +
          dbOperationLog.updates.length +
          dbOperationLog.deletes.length;

        if (totalWrites > 0) {
          failures.push(
            `Case ${i}: Write operations detected on empty result set — ` +
            `inserts=${dbOperationLog.inserts.length}, updates=${dbOperationLog.updates.length}, ` +
            `deletes=${dbOperationLog.deletes.length}`
          );
        }
      }

      expect(failures).toEqual([]);
    });

    it("returned cards are a pure projection — source data is never modified (100 random cases)", async () => {
      const failures: string[] = [];

      for (let i = 0; i < 100; i++) {
        const rng = createRng(i * 4253 + 31);

        const query = generateQuery(rng);
        const questionCount = randomInt(rng, 1, 15);
        const questions = Array.from({ length: questionCount }, () =>
          generatePendingQuestion(rng, query.organizationId, query.repositoryId)
        );

        // Deep copy the original question data for comparison
        const originalData = JSON.parse(JSON.stringify(questions));

        const missionRuns = generateMissionRuns(rng, randomInt(rng, 0, 10));

        vi.clearAllMocks();
        let selectCallCount = 0;
        mockDbSelectResult.mockImplementation(() => {
          selectCallCount++;
          if (selectCallCount === 1) {
            return Promise.resolve(questions);
          }
          return Promise.resolve(missionRuns);
        });

        const cards = await service.getTechDebtCards(query);

        // Verify the original question objects were not mutated
        for (let j = 0; j < questions.length; j++) {
          const current = JSON.stringify(questions[j]);
          const original = originalData[j];
          // Compare key fields that must remain unchanged
          if (questions[j].id !== original.id) {
            failures.push(`Case ${i}, Q${j}: id mutated`);
          }
          if (questions[j].status !== original.status) {
            failures.push(`Case ${i}, Q${j}: status mutated from "${original.status}" to "${questions[j].status}"`);
          }
          if (questions[j].questionText !== original.questionText) {
            failures.push(`Case ${i}, Q${j}: questionText mutated`);
          }
          if (questions[j].triggerSource !== original.triggerSource) {
            failures.push(`Case ${i}, Q${j}: triggerSource mutated`);
          }
          if (questions[j].repositoryId !== original.repositoryId) {
            failures.push(`Case ${i}, Q${j}: repositoryId mutated`);
          }
          if (questions[j].organizationId !== original.organizationId) {
            failures.push(`Case ${i}, Q${j}: organizationId mutated`);
          }
        }

        // Also verify that returned cards don't have unexpected mutation methods
        for (const card of cards) {
          if (typeof (card as any).save === "function") {
            failures.push(`Case ${i}: card has a save() method — not a pure projection`);
          }
        }
      }

      expect(failures).toEqual([]);
    });
  });
});
