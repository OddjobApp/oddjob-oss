/**
 * Property-based tests for Daily Question Cap Invariant.
 *
 * **Property 6: Daily Question Cap Invariant**
 * For any organization and any 24-hour window, the total number of questions
 * created across all trigger sources combined (including `rescue_pattern_detected`,
 * `hil_pattern_detected`, and `cross_repo_propagation`) SHALL never exceed 50.
 *
 * Since fast-check is not installable in this project (npm peer-dep conflicts),
 * these tests use manual randomization with 100 random cases per property
 * to achieve property-based testing coverage.
 *
 * **Validates: Requirements 1.4, 2.5, 3.5, 6.2**
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mock references ────────────────────────────────────────────────

const mockRedis = vi.hoisted(() => {
  // Simulate Redis counter for daily cap enforcement.
  // Each org gets its own counter, which auto-resets between test iterations.
  const counters = new Map<string, number>();
  return {
    incr: vi.fn(async (key: string) => {
      const current = (counters.get(key) || 0) + 1;
      counters.set(key, current);
      return current;
    }),
    expire: vi.fn().mockResolvedValue(1),
    // Expose helpers for test control
    _counters: counters,
    _reset: () => counters.clear(),
  };
});

const mockDbInsert = vi.hoisted(() => vi.fn());
const mockDbSelect = vi.hoisted(() => vi.fn());

// Track all questions actually inserted
const insertedQuestions = vi.hoisted(() => [] as any[]);

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => ({
  redis: mockRedis,
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
  // createQuestion chains `.where(...).limit(1)` for the org lookup but awaits
  // `.where(...)` directly for the duplicate scan. The previous mock returned the
  // result array straight out of `.where()`, so `.limit` was not a function and
  // every case threw. The builder is therefore both chainable and thenable:
  // keep chaining, or await at any point to get mockDbSelect()'s value.
  const makeBuilder = () => {
    const builder: any = {
      where: () => builder,
      limit: () => builder,
      orderBy: () => builder,
      then: (onFulfilled: any, onRejected: any) =>
        Promise.resolve(mockDbSelect()).then(onFulfilled, onRejected),
    };
    return builder;
  };

  return {
    db: {
      select: () => ({ from: () => makeBuilder() }),
      insert: () => ({
        values: (val: any) => {
          insertedQuestions.push(val);
          return {
            returning: () => [{ id: insertedQuestions.length }],
          };
        },
      }),
    },
  };
});

// Same allowlist hazard as the drizzle-orm mock below: this listed
// `organizations`, but the schema's actual export is `orgs`, so the service's
// import resolved to undefined and the suite died at module load. Spread the
// real schema so every table exists, and keep the lightweight column stubs the
// assertions were written against.
vi.mock("@shared/schema/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@shared/schema/index.js")>()),
  knowledgeBaseQuestions: {
    id: "id",
    organizationId: "organization_id",
    repositoryId: "repository_id",
    triggerSource: "trigger_source",
    status: "status",
    contextData: "context_data",
  },
}));

// Spread the real module rather than listing exports by hand — see the note in
// briefing-output-constraints.property.test.ts. An allowlist mock turns any new
// drizzle helper in the service under test into a module-load failure.
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: (a: any, b: any) => ({ type: "eq", a, b }),
  and: (...args: any[]) => ({ type: "and", args }),
  ne: (a: any, b: any) => ({ type: "ne", a, b }),
}));

// Path must match the service's own import (`@domain/ai/core/system-ai.service.js`).
// It previously pointed at `@server/services/system-ai.service.js`, which does not
// exist, so the mock never applied: the real AI client ran, threw, and
// createQuestion's catch-all turned every case into `null`. That read as "0
// questions created", which three of these five properties accept as vacuously
// true (0 <= cap) — so the suite looked healthy while asserting nothing.
vi.mock("@domain/ai/core/system-ai.service.js", () => ({
  systemAiService: {
    getAiConfig: vi.fn().mockResolvedValue({ provider: "google", model: "gemini-1.5-pro" }),
    generateJson: vi.fn().mockResolvedValue({
      questionText: "Generated question",
      proposedAnswer: "Generated answer",
    }),
  },
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
  const chars = "abcdefghijklmnopqrstuvwxyz";
  const len = randomInt(rng, minLen, maxLen);
  let result = "";
  for (let i = 0; i < len; i++) {
    result += chars[Math.floor(rng() * chars.length)];
  }
  return result;
}

/** Generate a random trigger source from the three extension sources */
function generateTriggerSource(rng: () => number): "rescue_pattern_detected" | "hil_pattern_detected" | "cross_repo_propagation" {
  const sources = [
    "rescue_pattern_detected",
    "hil_pattern_detected",
    "cross_repo_propagation",
  ] as const;
  return sources[randomInt(rng, 0, sources.length - 1)];
}

/** Generate a random context appropriate for the trigger source */
function generateContext(rng: () => number, triggerSource: string): Record<string, any> {
  switch (triggerSource) {
    case "rescue_pattern_detected":
      return {
        strategy: ["retry", "relax", "skip", "replan"][randomInt(rng, 0, 3)],
        jobType: randomString(rng, 5, 12),
        count: randomInt(rng, 3, 10),
        missionRunIds: Array.from({ length: randomInt(rng, 3, 6) }, () => randomInt(rng, 1, 9999)),
      };
    case "hil_pattern_detected":
      return {
        tool: randomString(rng, 4, 10),
        parameterKeys: Array.from({ length: randomInt(rng, 1, 5) }, () => randomString(rng, 3, 8)),
        approvalCount: randomInt(rng, 5, 15),
        repositoryId: `repo-${randomString(rng, 4, 8)}`,
        sampleParams: { key: "value" },
      };
    case "cross_repo_propagation":
      return {
        sourceQuestionId: randomInt(rng, 1, 9999),
        sourceRepositoryId: `repo-${randomString(rng, 4, 8)}`,
        sourceAnswer: `Answer ${randomString(rng, 10, 20)}`,
        matchReason: ["extension_overlap", "error_category_match", "keyword_similarity"][randomInt(rng, 0, 2)],
        filePaths: [`src/${randomString(rng, 4, 10)}.ts`],
      };
    default:
      return {};
  }
}

/** The daily cap constant (must match the service) */
const DAILY_QUESTION_CAP = 50;

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("Daily Question Cap Property Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis._reset();
    insertedQuestions.length = 0;
    // Default: org lookup returns a valid org
    mockDbSelect.mockResolvedValue([{ id: 1 }]);
  });

  /**
   * **Validates: Requirements 1.4, 2.5, 3.5, 6.2**
   *
   * Property 6: Daily Question Cap Invariant
   * Generate sequences of mixed-trigger question creation attempts (rescue + HIL + propagation).
   * Assert total created per organization per 24-hour window ≤ 50.
   */
  describe("Property 6: Daily Question Cap Invariant", () => {
    it("total questions created per org never exceeds 50 regardless of trigger mix (100 random cases)", async () => {
      const failures: string[] = [];

      for (let i = 0; i < 100; i++) {
        const rng = createRng(i * 8191 + 37);

        // Generate a random number of creation attempts (30–80) to test both below and above cap
        const attemptCount = randomInt(rng, 30, 80);
        const orgId = randomInt(rng, 1, 500);

        // Reset state for this iteration
        mockRedis._reset();
        insertedQuestions.length = 0;

        // No duplicate pending questions
        mockDbSelect.mockResolvedValue([{ id: orgId }]);

        let createdCount = 0;

        for (let a = 0; a < attemptCount; a++) {
          const triggerSource = generateTriggerSource(rng);
          const repoId = `repo-${randomString(rng, 4, 8)}`;
          const context = generateContext(rng, triggerSource);

          // Make each call have unique file paths to avoid dedup
          context.filePaths = [`unique/${randomString(rng, 8, 16)}.ts`];

          const result = await knowledgeBaseQuestionEngineService.createQuestion(
            orgId,
            repoId,
            triggerSource,
            context
          );

          if (result !== null) {
            createdCount++;
          }
        }

        // The invariant: total created ≤ DAILY_QUESTION_CAP (50)
        if (createdCount > DAILY_QUESTION_CAP) {
          failures.push(
            `Case ${i}: org=${orgId}, attempts=${attemptCount}, created=${createdCount} — exceeds cap of ${DAILY_QUESTION_CAP}`
          );
        }
      }

      expect(failures).toEqual([]);
    });

    it("cap is enforced uniformly across all trigger sources within a single org (100 random cases)", async () => {
      const failures: string[] = [];

      for (let i = 0; i < 100; i++) {
        const rng = createRng(i * 6553 + 89);

        const orgId = randomInt(rng, 1, 500);
        // Always exceed cap to verify enforcement
        const attemptCount = randomInt(rng, 55, 100);

        mockRedis._reset();
        insertedQuestions.length = 0;
        mockDbSelect.mockResolvedValue([{ id: orgId }]);

        // Track per-source creation counts
        const createdBySource: Record<string, number> = {
          rescue_pattern_detected: 0,
          hil_pattern_detected: 0,
          cross_repo_propagation: 0,
        };

        for (let a = 0; a < attemptCount; a++) {
          const triggerSource = generateTriggerSource(rng);
          const repoId = `repo-${randomString(rng, 4, 8)}`;
          const context = generateContext(rng, triggerSource);
          context.filePaths = [`unique/${randomString(rng, 8, 16)}.ts`];

          const result = await knowledgeBaseQuestionEngineService.createQuestion(
            orgId,
            repoId,
            triggerSource,
            context
          );

          if (result !== null) {
            createdBySource[triggerSource]++;
          }
        }

        const totalCreated = Object.values(createdBySource).reduce((s, c) => s + c, 0);

        if (totalCreated > DAILY_QUESTION_CAP) {
          failures.push(
            `Case ${i}: org=${orgId}, attempts=${attemptCount}, totalCreated=${totalCreated} ` +
            `(rescue=${createdBySource.rescue_pattern_detected}, ` +
            `hil=${createdBySource.hil_pattern_detected}, ` +
            `propagation=${createdBySource.cross_repo_propagation}) — exceeds cap`
          );
        }
      }

      expect(failures).toEqual([]);
    });

    it("separate organizations have independent caps (100 random cases)", async () => {
      const failures: string[] = [];

      for (let i = 0; i < 100; i++) {
        const rng = createRng(i * 4297 + 61);

        // Use 2-3 distinct organizations in each case
        const orgCount = randomInt(rng, 2, 3);
        const orgIds = Array.from({ length: orgCount }, () => randomInt(rng, 1, 9999));

        // Ensure unique org IDs
        const uniqueOrgs = [...new Set(orgIds)];

        mockRedis._reset();
        insertedQuestions.length = 0;
        mockDbSelect.mockImplementation(async () => [{ id: 1 }]);

        const createdPerOrg: Record<number, number> = {};
        for (const oid of uniqueOrgs) {
          createdPerOrg[oid] = 0;
        }

        // Generate attempts distributed across orgs, attempting > 50 per org
        const attemptsPerOrg = randomInt(rng, 45, 70);

        for (const oid of uniqueOrgs) {
          for (let a = 0; a < attemptsPerOrg; a++) {
            const triggerSource = generateTriggerSource(rng);
            const repoId = `repo-${randomString(rng, 4, 8)}`;
            const context = generateContext(rng, triggerSource);
            context.filePaths = [`unique/${randomString(rng, 8, 16)}.ts`];

            const result = await knowledgeBaseQuestionEngineService.createQuestion(
              oid,
              repoId,
              triggerSource,
              context
            );

            if (result !== null) {
              createdPerOrg[oid]++;
            }
          }
        }

        // Each org must independently be ≤ 50
        for (const oid of uniqueOrgs) {
          if (createdPerOrg[oid] > DAILY_QUESTION_CAP) {
            failures.push(
              `Case ${i}: org=${oid}, created=${createdPerOrg[oid]} — exceeds cap of ${DAILY_QUESTION_CAP}`
            );
          }
        }
      }

      expect(failures).toEqual([]);
    });

    it("exactly 50 questions can be created but 51st is rejected (100 random cases)", async () => {
      const failures: string[] = [];

      for (let i = 0; i < 100; i++) {
        const rng = createRng(i * 9311 + 23);

        const orgId = randomInt(rng, 1, 500);

        mockRedis._reset();
        insertedQuestions.length = 0;
        mockDbSelect.mockResolvedValue([{ id: orgId }]);

        let createdCount = 0;
        let rejectedAfterCap = false;

        // Attempt exactly 55 creations to go past cap
        for (let a = 0; a < 55; a++) {
          const triggerSource = generateTriggerSource(rng);
          const repoId = `repo-${randomString(rng, 4, 8)}`;
          const context = generateContext(rng, triggerSource);
          context.filePaths = [`unique/${randomString(rng, 8, 16)}.ts`];

          const result = await knowledgeBaseQuestionEngineService.createQuestion(
            orgId,
            repoId,
            triggerSource,
            context
          );

          if (result !== null) {
            createdCount++;
          } else if (createdCount >= DAILY_QUESTION_CAP) {
            rejectedAfterCap = true;
          }
        }

        // Verify exactly 50 were created
        if (createdCount !== DAILY_QUESTION_CAP) {
          failures.push(
            `Case ${i}: org=${orgId}, expected exactly ${DAILY_QUESTION_CAP} created, got ${createdCount}`
          );
        }

        // Verify at least one was rejected after cap
        if (!rejectedAfterCap) {
          failures.push(
            `Case ${i}: org=${orgId}, no rejection observed after cap was reached`
          );
        }
      }

      expect(failures).toEqual([]);
    });

    it("cap applies across all trigger sources combined, not per-source (100 random cases)", async () => {
      const failures: string[] = [];

      for (let i = 0; i < 100; i++) {
        const rng = createRng(i * 7649 + 47);

        const orgId = randomInt(rng, 1, 500);

        mockRedis._reset();
        insertedQuestions.length = 0;
        mockDbSelect.mockResolvedValue([{ id: orgId }]);

        // Use all trigger sources in a round-robin pattern to fill cap
        const sources: Array<"rescue_pattern_detected" | "hil_pattern_detected" | "cross_repo_propagation"> = [
          "rescue_pattern_detected",
          "hil_pattern_detected",
          "cross_repo_propagation",
        ];

        let totalCreated = 0;

        // Create exactly 60 attempts, rotating across sources
        for (let a = 0; a < 60; a++) {
          const triggerSource = sources[a % 3];
          const repoId = `repo-${randomString(rng, 4, 8)}`;
          const context = generateContext(rng, triggerSource);
          context.filePaths = [`unique/${randomString(rng, 8, 16)}.ts`];

          const result = await knowledgeBaseQuestionEngineService.createQuestion(
            orgId,
            repoId,
            triggerSource,
            context
          );

          if (result !== null) {
            totalCreated++;
          }
        }

        // The combined total must not exceed 50, proving the cap is shared
        if (totalCreated > DAILY_QUESTION_CAP) {
          failures.push(
            `Case ${i}: org=${orgId}, totalCreated=${totalCreated} across combined sources — exceeds cap of ${DAILY_QUESTION_CAP}`
          );
        }

        // Also verify it actually hit the cap (it should, with 60 attempts)
        if (totalCreated < DAILY_QUESTION_CAP) {
          failures.push(
            `Case ${i}: org=${orgId}, totalCreated=${totalCreated} — expected to reach cap with 60 attempts`
          );
        }
      }

      expect(failures).toEqual([]);
    });
  });
});
