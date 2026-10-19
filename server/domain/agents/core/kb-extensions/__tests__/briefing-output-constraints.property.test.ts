/**
 * Property-based tests for Pre-Mission Briefing Output Constraints.
 *
 * **Property 8: Pre-Mission Briefing Output Constraints**
 * For any set of matching pending questions (regardless of total count),
 * the pre-mission briefing SHALL return at most 5 items, ordered by creation
 * date ascending (oldest first), and each item SHALL contain questionText,
 * triggerSource, and ageInDays.
 *
 * Since fast-check is not installable in this project (npm peer-dep conflicts),
 * these tests use manual randomization with 100 random cases per property
 * to achieve property-based testing coverage.
 *
 * **Validates: Requirements 4.2, 4.5**
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mock references ────────────────────────────────────────────────

const mockDbSelect = vi.hoisted(() => vi.fn());

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => ({
  redis: {
    zadd: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    zcount: vi.fn().mockResolvedValue(0),
    zcard: vi.fn().mockResolvedValue(0),
    zrangebyscore: vi.fn().mockResolvedValue([]),
    incr: vi.fn().mockResolvedValue(1),
    get: vi.fn().mockResolvedValue("0"),
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

vi.mock("@server/database_service.js", () => {
  // getPreMissionBriefing chains `.where(...).orderBy(...)` and awaits the
  // result. The previous mock returned mockDbSelect() straight out of `.where()`,
  // so `.orderBy` was not a function — the service caught that TypeError and
  // returned [], which every case then read as "0 briefing items". The builder
  // chains and is thenable, so await works at any point in the chain.
  const makeBuilder = () => {
    let whereArgs: any[] = [];
    const builder: any = {
      where: (...args: any[]) => {
        whereArgs = args;
        return builder;
      },
      orderBy: () => builder,
      limit: () => builder,
      then: (onFulfilled: any, onRejected: any) =>
        Promise.resolve(mockDbSelect(...whereArgs)).then(onFulfilled, onRejected),
    };
    return builder;
  };

  return {
    db: {
      select: () => ({ from: () => makeBuilder() }),
    },
  };
});

// Spread the real schema for the same reason as the drizzle-orm mock below: the
// service imports several tables (orgs, missions, missionRuns, ...) and an
// allowlist here becomes a hard failure the moment a code path touches one.
vi.mock("@shared/schema/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@shared/schema/index.js")>()),
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
}));

// Spread the real module rather than listing exports by hand. The service under
// test imports eq/and/ne/sql/desc/asc; an allowlist mock silently becomes a
// module-load failure ("No 'sql' export is defined on the drizzle-orm mock") the
// moment it starts using one more helper. Nothing here asserts on the stub
// shapes — they exist only to keep query building inert — so real
// implementations are fine for everything we don't explicitly override.
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: (a: any, b: any) => ({ type: "eq", a, b }),
  and: (...args: any[]) => ({ type: "and", args }),
  asc: (col: any) => ({ type: "asc", col }),
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import { knowledgeBaseQuestionEngineService } from "../../knowledge-base-question-engine.service.js";

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

/** Generate a random file path */
function generateFilePath(rng: () => number): string {
  const extensions = [".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs"];
  const dirs = ["src", "lib", "utils", "components", "services", "domain"];
  const dir = dirs[randomInt(rng, 0, dirs.length - 1)];
  const file = randomString(rng, 4, 12);
  const ext = extensions[randomInt(rng, 0, extensions.length - 1)];
  return `${dir}/${file}${ext}`;
}

/** Generate a random creation date within the last 60 days */
function generateCreationDate(rng: () => number, now: number): Date {
  const maxAgeMs = 60 * 24 * 60 * 60 * 1000; // 60 days
  const offset = randomInt(rng, 0, maxAgeMs);
  return new Date(now - offset);
}

/** Generate a mock pending question record */
function generatePendingQuestion(
  rng: () => number,
  id: number,
  filePaths: string[],
  createdAt: Date
) {
  return {
    id,
    organizationId: 1, // Same org for all in a test case
    repositoryId: `repo-${randomString(rng, 4, 8)}`,
    questionText: `Why does ${randomString(rng, 5, 15)} fail in ${randomString(rng, 3, 8)}?`,
    triggerSource: generateTriggerSource(rng),
    status: "pending",
    contextData: { filePaths },
    createdAt,
    updatedAt: createdAt,
  };
}

// ─── Property Tests ─────────────────────────────────────────────────────────

const MAX_BRIEFING_ITEMS = 5;

describe("Pre-Mission Briefing Output Constraints Property Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * **Validates: Requirements 4.2, 4.5**
   *
   * Property 8: Pre-Mission Briefing Output Constraints
   * Generate 0–20 matching pending questions with varying creation dates.
   * Assert output contains at most 5 items.
   * Assert items are ordered by creation date ascending (oldest first).
   * Assert each item contains questionText, triggerSource, and ageInDays.
   */
  describe("Property 8: Pre-Mission Briefing Output Constraints", () => {
    it("returns at most 5 items regardless of matching question count (100 random cases)", async () => {
      const failures: string[] = [];
      const now = Date.now();

      for (let i = 0; i < 100; i++) {
        const rng = createRng(i * 7919 + 42);

        // Generate 0–20 matching pending questions
        const questionCount = randomInt(rng, 0, 20);
        const sharedFilePath = generateFilePath(rng);
        const missionFilePaths = [sharedFilePath, generateFilePath(rng)];

        // Generate questions that all share a file path with the mission
        const questions = [];
        for (let q = 0; q < questionCount; q++) {
          const createdAt = generateCreationDate(rng, now);
          questions.push(
            generatePendingQuestion(rng, q + 1, [sharedFilePath], createdAt)
          );
        }

        // Sort by createdAt ascending (as the DB query would return)
        questions.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

        // Mock DB to return these questions
        vi.clearAllMocks();
        mockDbSelect.mockResolvedValue(questions);

        const result = await knowledgeBaseQuestionEngineService.getPreMissionBriefing(
          1,
          missionFilePaths
        );

        if (result.length > MAX_BRIEFING_ITEMS) {
          failures.push(
            `Case ${i}: returned ${result.length} items (max=${MAX_BRIEFING_ITEMS}), questionCount=${questionCount}`
          );
        }
      }

      expect(failures).toEqual([]);
    });

    it("items are ordered by creation date ascending — oldest first (100 random cases)", async () => {
      const failures: string[] = [];
      const now = Date.now();

      for (let i = 0; i < 100; i++) {
        const rng = createRng(i * 3571 + 17);

        // Generate 2–20 matching questions (need at least 2 for ordering check)
        const questionCount = randomInt(rng, 2, 20);
        const sharedFilePath = generateFilePath(rng);
        const missionFilePaths = [sharedFilePath];

        const questions = [];
        for (let q = 0; q < questionCount; q++) {
          const createdAt = generateCreationDate(rng, now);
          questions.push(
            generatePendingQuestion(rng, q + 1, [sharedFilePath], createdAt)
          );
        }

        // Sort by createdAt ascending (as the DB query would return via orderBy)
        questions.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

        vi.clearAllMocks();
        mockDbSelect.mockResolvedValue(questions);

        const result = await knowledgeBaseQuestionEngineService.getPreMissionBriefing(
          1,
          missionFilePaths
        );

        // Check ordering: each item's ageInDays should be >= the previous (oldest first = highest age first)
        for (let j = 1; j < result.length; j++) {
          if (result[j].ageInDays > result[j - 1].ageInDays) {
            // This looks reversed but ageInDays for older items is larger.
            // "Oldest first" means item[0] has the largest ageInDays.
            // Actually: oldest first means smallest createdAt first = largest ageInDays first.
            // So ageInDays should be DECREASING (or equal) as we go through the array.
            // Wait — ageInDays for oldest is largest. So if ordered oldest-first,
            // ageInDays[0] >= ageInDays[1] >= ... (non-increasing).
            // But if result[j].ageInDays > result[j-1].ageInDays, that's a VIOLATION.
            failures.push(
              `Case ${i}: ordering violation at index ${j}: ageInDays[${j - 1}]=${result[j - 1].ageInDays} < ageInDays[${j}]=${result[j].ageInDays} (should be non-increasing for oldest-first)`
            );
            break;
          }
        }
      }

      expect(failures).toEqual([]);
    });

    it("each item contains questionText, triggerSource, and ageInDays (100 random cases)", async () => {
      const failures: string[] = [];
      const now = Date.now();

      for (let i = 0; i < 100; i++) {
        const rng = createRng(i * 6151 + 99);

        // Generate 1–20 matching questions
        const questionCount = randomInt(rng, 1, 20);
        const sharedFilePath = generateFilePath(rng);
        const missionFilePaths = [sharedFilePath];

        const questions = [];
        for (let q = 0; q < questionCount; q++) {
          const createdAt = generateCreationDate(rng, now);
          questions.push(
            generatePendingQuestion(rng, q + 1, [sharedFilePath], createdAt)
          );
        }

        questions.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

        vi.clearAllMocks();
        mockDbSelect.mockResolvedValue(questions);

        const result = await knowledgeBaseQuestionEngineService.getPreMissionBriefing(
          1,
          missionFilePaths
        );

        for (let j = 0; j < result.length; j++) {
          const item = result[j];

          if (typeof item.questionText !== "string" || item.questionText.length === 0) {
            failures.push(
              `Case ${i}, item ${j}: questionText is missing or empty (got: ${JSON.stringify(item.questionText)})`
            );
          }

          if (typeof item.triggerSource !== "string" || item.triggerSource.length === 0) {
            failures.push(
              `Case ${i}, item ${j}: triggerSource is missing or empty (got: ${JSON.stringify(item.triggerSource)})`
            );
          }

          if (typeof item.ageInDays !== "number" || item.ageInDays < 0) {
            failures.push(
              `Case ${i}, item ${j}: ageInDays is missing or invalid (got: ${JSON.stringify(item.ageInDays)})`
            );
          }
        }
      }

      expect(failures).toEqual([]);
    });

    it("returns exactly min(matchCount, 5) items (100 random cases)", async () => {
      const failures: string[] = [];
      const now = Date.now();

      for (let i = 0; i < 100; i++) {
        const rng = createRng(i * 4253 + 31);

        const questionCount = randomInt(rng, 0, 20);
        const sharedFilePath = generateFilePath(rng);
        const missionFilePaths = [sharedFilePath];

        const questions = [];
        for (let q = 0; q < questionCount; q++) {
          const createdAt = generateCreationDate(rng, now);
          questions.push(
            generatePendingQuestion(rng, q + 1, [sharedFilePath], createdAt)
          );
        }

        questions.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

        vi.clearAllMocks();
        mockDbSelect.mockResolvedValue(questions);

        const result = await knowledgeBaseQuestionEngineService.getPreMissionBriefing(
          1,
          missionFilePaths
        );

        const expectedCount = Math.min(questionCount, MAX_BRIEFING_ITEMS);
        if (result.length !== expectedCount) {
          failures.push(
            `Case ${i}: expected ${expectedCount} items (min(${questionCount}, ${MAX_BRIEFING_ITEMS})), got ${result.length}`
          );
        }
      }

      expect(failures).toEqual([]);
    });

    it("ageInDays correctly reflects days since creation (100 random cases)", async () => {
      const failures: string[] = [];
      const now = Date.now();

      for (let i = 0; i < 100; i++) {
        const rng = createRng(i * 8831 + 53);

        // Generate 1–10 questions with known creation dates
        const questionCount = randomInt(rng, 1, 10);
        const sharedFilePath = generateFilePath(rng);
        const missionFilePaths = [sharedFilePath];

        const questions = [];
        for (let q = 0; q < questionCount; q++) {
          const createdAt = generateCreationDate(rng, now);
          questions.push(
            generatePendingQuestion(rng, q + 1, [sharedFilePath], createdAt)
          );
        }

        questions.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

        vi.clearAllMocks();
        mockDbSelect.mockResolvedValue(questions);

        const result = await knowledgeBaseQuestionEngineService.getPreMissionBriefing(
          1,
          missionFilePaths
        );

        // Verify ageInDays for each returned item
        const returnedCount = Math.min(questionCount, MAX_BRIEFING_ITEMS);
        for (let j = 0; j < returnedCount; j++) {
          const item = result[j];
          const sourceQuestion = questions[j];
          const expectedAge = Math.floor(
            (now - sourceQuestion.createdAt.getTime()) / (1000 * 60 * 60 * 24)
          );

          // Allow ±1 day tolerance due to timing during test execution
          if (Math.abs(item.ageInDays - expectedAge) > 1) {
            failures.push(
              `Case ${i}, item ${j}: ageInDays mismatch: expected ~${expectedAge}, got ${item.ageInDays}`
            );
          }
        }
      }

      expect(failures).toEqual([]);
    });

    it("returns empty array when no matching questions exist (100 random cases)", async () => {
      const failures: string[] = [];

      for (let i = 0; i < 100; i++) {
        const rng = createRng(i * 2909 + 73);

        // Generate questions with file paths that DON'T overlap mission paths
        const questionCount = randomInt(rng, 0, 20);
        const missionFilePaths = [generateFilePath(rng), generateFilePath(rng)];

        const questions = [];
        for (let q = 0; q < questionCount; q++) {
          // Use completely different file paths
          const nonOverlappingPath = `other/${randomString(rng, 8, 15)}.xyz`;
          const createdAt = generateCreationDate(rng, Date.now());
          questions.push(
            generatePendingQuestion(rng, q + 1, [nonOverlappingPath], createdAt)
          );
        }

        questions.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

        vi.clearAllMocks();
        mockDbSelect.mockResolvedValue(questions);

        const result = await knowledgeBaseQuestionEngineService.getPreMissionBriefing(
          1,
          missionFilePaths
        );

        if (result.length !== 0) {
          failures.push(
            `Case ${i}: expected empty array for non-overlapping paths, got ${result.length} items`
          );
        }
      }

      expect(failures).toEqual([]);
    });
  });
});
