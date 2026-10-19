/**
 * Property-based tests for Duplicate Suppression Across Trigger Sources.
 *
 * **Property 7: Duplicate Suppression Across Trigger Sources**
 * For any trigger source, if a pending question already exists matching the same
 * deduplication key (strategy+jobType for rescue, tool+repository for HIL),
 * the system SHALL skip creating a new question.
 *
 * Since fast-check is not installable in this project (npm peer-dep conflicts),
 * these tests use manual randomization with 100 random cases per property
 * to achieve property-based testing coverage.
 *
 * **Validates: Requirements 1.3, 2.6**
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mock references ────────────────────────────────────────────────

const mockRedis = vi.hoisted(() => ({
  zadd: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  zcount: vi.fn().mockResolvedValue(0),
  zcard: vi.fn().mockResolvedValue(0),
  zrangebyscore: vi.fn().mockResolvedValue([]),
}));

const mockCreateQuestion = vi.hoisted(() => vi.fn().mockResolvedValue(42));

const mockDbWhere = vi.hoisted(() => vi.fn().mockResolvedValue([]));

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

vi.mock("../../knowledge-base-question-engine.service.js", () => ({
  knowledgeBaseQuestionEngineService: {
    createQuestion: (...args: any[]) => mockCreateQuestion(...args),
  },
}));

vi.mock("@server/database_service.js", () => ({
  db: {
    select: (...args: any[]) => ({
      from: () => ({
        where: (...whereArgs: any[]) => mockDbWhere(...whereArgs),
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
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: any, b: any) => ({ type: "eq", a, b }),
  and: (...args: any[]) => ({ type: "and", args }),
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import { rescueStrategyTrackerService } from "../rescue-strategy-tracker.service.js";
import { hilPatternDetectorService } from "../hil-pattern-detector.service.js";

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

/** Generate a random rescue strategy */
function generateStrategy(rng: () => number): string {
  const strategies = ["retry", "relax", "skip", "replan"];
  return strategies[randomInt(rng, 0, strategies.length - 1)];
}

/** Generate a random job type */
function generateJobType(rng: () => number): string {
  const jobTypes = [
    "code_generation",
    "test_writing",
    "refactoring",
    "deployment",
    "schema_migration",
    "documentation",
    "api_integration",
    "bug_fix",
  ];
  return jobTypes[randomInt(rng, 0, jobTypes.length - 1)];
}

/** Generate a random tool name */
function generateToolName(rng: () => number): string {
  const tools = [
    "create_file",
    "write_file",
    "delete_file",
    "run_command",
    "deploy_service",
    "update_config",
    "modify_schema",
    "execute_migration",
    "install_package",
    "lint_code",
  ];
  return tools[randomInt(rng, 0, tools.length - 1)];
}

/** Generate random params with random keys */
function generateParams(rng: () => number): Record<string, any> {
  const keyCount = randomInt(rng, 1, 5);
  const params: Record<string, any> = {};
  for (let i = 0; i < keyCount; i++) {
    const key = randomString(rng, 3, 10);
    params[key] = randomString(rng, 5, 20);
  }
  return params;
}

/** 7-day window in milliseconds */
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const RESCUE_THRESHOLD = 3;
const APPROVAL_THRESHOLD = 5;

/**
 * Generate Redis sorted set members for events in the window.
 */
function generateWindowMembers(
  rng: () => number,
  count: number,
  now: number
): string[] {
  const members: string[] = [];
  for (let i = 0; i < count; i++) {
    const missionRunId = randomInt(rng, 1, 99999);
    const ts = now - randomInt(rng, 0, WINDOW_MS - 1);
    members.push(`${missionRunId}:${ts}`);
  }
  return members;
}

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("Duplicate Suppression Property Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis.zadd.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(1);
    mockRedis.zcount.mockResolvedValue(0);
    mockRedis.zcard.mockResolvedValue(0);
    mockRedis.zrangebyscore.mockResolvedValue([]);
    mockCreateQuestion.mockResolvedValue(42);
    mockDbWhere.mockResolvedValue([]);
  });

  /**
   * **Validates: Requirements 1.3, 2.6**
   *
   * Property 7: Duplicate Suppression Across Trigger Sources
   * Generate creation attempts with/without existing pending questions matching dedup key.
   * Assert no new question when pending question exists for same dedup key.
   * Assert question created when no pending duplicate exists.
   */
  describe("Property 7: Duplicate Suppression Across Trigger Sources", () => {
    describe("Rescue Tracker: strategy+jobType dedup key", () => {
      it("skips question creation when pending question exists for same strategy+jobType (100 random cases)", async () => {
        const failures: string[] = [];
        const now = Date.now();

        for (let i = 0; i < 100; i++) {
          const rng = createRng(i * 7919 + 101);

          const orgId = randomInt(rng, 1, 1000);
          const repoId = `repo-${randomString(rng, 4, 8)}`;
          const strategy = generateStrategy(rng);
          const jobType = generateJobType(rng);
          const missionRunId = randomInt(rng, 1, 99999);
          const timestamp = now - randomInt(rng, 0, WINDOW_MS - 1);

          // Threshold is met (count >= 3)
          const inWindowCount = randomInt(rng, RESCUE_THRESHOLD, 10);

          vi.clearAllMocks();
          mockRedis.zadd.mockResolvedValue(1);
          mockRedis.expire.mockResolvedValue(1);
          mockRedis.zcount.mockResolvedValue(inWindowCount);
          mockRedis.zrangebyscore.mockResolvedValue(
            generateWindowMembers(rng, inWindowCount, now)
          );
          mockCreateQuestion.mockResolvedValue(42);

          // Simulate pending question existing for the SAME strategy+jobType
          mockDbWhere.mockResolvedValue([
            {
              id: randomInt(rng, 1, 9999),
              contextData: { strategy, jobType },
            },
          ]);

          await rescueStrategyTrackerService.recordAndCheck(orgId, repoId, {
            strategy,
            jobType,
            missionRunId,
            timestamp,
          });

          if (mockCreateQuestion.mock.calls.length > 0) {
            failures.push(
              `Case ${i}: question created despite pending duplicate existing ` +
              `(strategy=${strategy}, jobType=${jobType}, org=${orgId})`
            );
          }
        }

        expect(failures).toEqual([]);
      });

      it("creates question when no pending duplicate exists and threshold is met (100 random cases)", async () => {
        const failures: string[] = [];
        const now = Date.now();

        for (let i = 0; i < 100; i++) {
          const rng = createRng(i * 4523 + 207);

          const orgId = randomInt(rng, 1, 1000);
          const repoId = `repo-${randomString(rng, 4, 8)}`;
          const strategy = generateStrategy(rng);
          const jobType = generateJobType(rng);
          const missionRunId = randomInt(rng, 1, 99999);
          const timestamp = now - randomInt(rng, 0, WINDOW_MS - 1);

          // Threshold is met (count >= 3)
          const inWindowCount = randomInt(rng, RESCUE_THRESHOLD, 10);

          vi.clearAllMocks();
          mockRedis.zadd.mockResolvedValue(1);
          mockRedis.expire.mockResolvedValue(1);
          mockRedis.zcount.mockResolvedValue(inWindowCount);
          mockRedis.zrangebyscore.mockResolvedValue(
            generateWindowMembers(rng, inWindowCount, now)
          );
          mockCreateQuestion.mockResolvedValue(42);

          // No pending duplicates
          mockDbWhere.mockResolvedValue([]);

          await rescueStrategyTrackerService.recordAndCheck(orgId, repoId, {
            strategy,
            jobType,
            missionRunId,
            timestamp,
          });

          if (mockCreateQuestion.mock.calls.length === 0) {
            failures.push(
              `Case ${i}: question NOT created when no duplicate exists and threshold met ` +
              `(strategy=${strategy}, jobType=${jobType}, count=${inWindowCount}, org=${orgId})`
            );
          }
        }

        expect(failures).toEqual([]);
      });

      it("does not suppress when pending question has different strategy or jobType (100 random cases)", async () => {
        const failures: string[] = [];
        const now = Date.now();

        for (let i = 0; i < 100; i++) {
          const rng = createRng(i * 6337 + 313);

          const orgId = randomInt(rng, 1, 1000);
          const repoId = `repo-${randomString(rng, 4, 8)}`;
          const strategy = generateStrategy(rng);
          const jobType = generateJobType(rng);
          const missionRunId = randomInt(rng, 1, 99999);
          const timestamp = now - randomInt(rng, 0, WINDOW_MS - 1);

          // Threshold is met
          const inWindowCount = randomInt(rng, RESCUE_THRESHOLD, 10);

          // Generate a DIFFERENT strategy or jobType for the existing pending question
          let differentStrategy = generateStrategy(rng);
          let differentJobType = generateJobType(rng);
          // Ensure at least one differs
          if (differentStrategy === strategy && differentJobType === jobType) {
            differentStrategy = strategy === "retry" ? "skip" : "retry";
          }

          vi.clearAllMocks();
          mockRedis.zadd.mockResolvedValue(1);
          mockRedis.expire.mockResolvedValue(1);
          mockRedis.zcount.mockResolvedValue(inWindowCount);
          mockRedis.zrangebyscore.mockResolvedValue(
            generateWindowMembers(rng, inWindowCount, now)
          );
          mockCreateQuestion.mockResolvedValue(42);

          // Simulate pending question with DIFFERENT dedup key
          mockDbWhere.mockResolvedValue([
            {
              id: randomInt(rng, 1, 9999),
              contextData: {
                strategy: differentStrategy,
                jobType: differentJobType,
              },
            },
          ]);

          await rescueStrategyTrackerService.recordAndCheck(orgId, repoId, {
            strategy,
            jobType,
            missionRunId,
            timestamp,
          });

          if (mockCreateQuestion.mock.calls.length === 0) {
            failures.push(
              `Case ${i}: question NOT created even though pending has different dedup key ` +
              `(current: ${strategy}/${jobType}, existing: ${differentStrategy}/${differentJobType})`
            );
          }
        }

        expect(failures).toEqual([]);
      });
    });

    describe("HIL Detector: tool+repository dedup key", () => {
      it("skips question creation when pending question exists for same tool+repository (100 random cases)", async () => {
        const failures: string[] = [];

        for (let i = 0; i < 100; i++) {
          const rng = createRng(i * 8831 + 419);

          const orgId = randomInt(rng, 1, 1000);
          const repoId = `repo-${randomString(rng, 4, 8)}`;
          const tool = generateToolName(rng);
          const params = generateParams(rng);

          // Threshold is met (count >= 5)
          const approvalCount = randomInt(rng, APPROVAL_THRESHOLD, 10);

          vi.clearAllMocks();
          mockRedis.zadd.mockResolvedValue(1);
          mockRedis.expire.mockResolvedValue(1);
          mockRedis.zcard.mockResolvedValue(approvalCount);
          mockCreateQuestion.mockResolvedValue(42);

          // Simulate pending question existing for the SAME tool+repository
          mockDbWhere.mockResolvedValue([
            {
              id: randomInt(rng, 1, 9999),
              contextData: { tool, repositoryId: repoId },
            },
          ]);

          await hilPatternDetectorService.onApproval(orgId, repoId, tool, params, randomInt(rng, 1, 9999));

          if (mockCreateQuestion.mock.calls.length > 0) {
            failures.push(
              `Case ${i}: question created despite pending duplicate existing ` +
              `(tool=${tool}, repo=${repoId}, org=${orgId})`
            );
          }
        }

        expect(failures).toEqual([]);
      });

      it("creates question when no pending duplicate exists and threshold is met (100 random cases)", async () => {
        const failures: string[] = [];

        for (let i = 0; i < 100; i++) {
          const rng = createRng(i * 2719 + 523);

          const orgId = randomInt(rng, 1, 1000);
          const repoId = `repo-${randomString(rng, 4, 8)}`;
          const tool = generateToolName(rng);
          const params = generateParams(rng);

          // Threshold is met (count >= 5)
          const approvalCount = randomInt(rng, APPROVAL_THRESHOLD, 10);

          vi.clearAllMocks();
          mockRedis.zadd.mockResolvedValue(1);
          mockRedis.expire.mockResolvedValue(1);
          mockRedis.zcard.mockResolvedValue(approvalCount);
          mockCreateQuestion.mockResolvedValue(42);

          // No pending duplicates
          mockDbWhere.mockResolvedValue([]);

          await hilPatternDetectorService.onApproval(orgId, repoId, tool, params, randomInt(rng, 1, 9999));

          if (mockCreateQuestion.mock.calls.length === 0) {
            failures.push(
              `Case ${i}: question NOT created when no duplicate exists and threshold met ` +
              `(tool=${tool}, repo=${repoId}, count=${approvalCount}, org=${orgId})`
            );
          }
        }

        expect(failures).toEqual([]);
      });

      it("does not suppress when pending question has different tool (100 random cases)", async () => {
        const failures: string[] = [];

        for (let i = 0; i < 100; i++) {
          const rng = createRng(i * 5471 + 631);

          const orgId = randomInt(rng, 1, 1000);
          const repoId = `repo-${randomString(rng, 4, 8)}`;
          const tool = generateToolName(rng);
          const params = generateParams(rng);

          // Threshold is met
          const approvalCount = randomInt(rng, APPROVAL_THRESHOLD, 10);

          // Generate a DIFFERENT tool for the existing pending question
          let differentTool = generateToolName(rng);
          if (differentTool === tool) {
            differentTool = tool === "create_file" ? "delete_file" : "create_file";
          }

          vi.clearAllMocks();
          mockRedis.zadd.mockResolvedValue(1);
          mockRedis.expire.mockResolvedValue(1);
          mockRedis.zcard.mockResolvedValue(approvalCount);
          mockCreateQuestion.mockResolvedValue(42);

          // Simulate pending question with DIFFERENT tool (same repo)
          mockDbWhere.mockResolvedValue([
            {
              id: randomInt(rng, 1, 9999),
              contextData: { tool: differentTool, repositoryId: repoId },
            },
          ]);

          await hilPatternDetectorService.onApproval(orgId, repoId, tool, params, randomInt(rng, 1, 9999));

          if (mockCreateQuestion.mock.calls.length === 0) {
            failures.push(
              `Case ${i}: question NOT created even though pending has different tool ` +
              `(current: ${tool}, existing: ${differentTool})`
            );
          }
        }

        expect(failures).toEqual([]);
      });

      it("dedup is per-trigger-source — suppression for rescue does not affect HIL and vice versa (100 random cases)", async () => {
        const failures: string[] = [];
        const now = Date.now();

        for (let i = 0; i < 100; i++) {
          const rng = createRng(i * 9311 + 739);

          const orgId = randomInt(rng, 1, 1000);
          const repoId = `repo-${randomString(rng, 4, 8)}`;
          const tool = generateToolName(rng);
          const params = generateParams(rng);
          const strategy = generateStrategy(rng);
          const jobType = generateJobType(rng);

          // Both thresholds met
          const rescueCount = randomInt(rng, RESCUE_THRESHOLD, 10);
          const approvalCount = randomInt(rng, APPROVAL_THRESHOLD, 10);

          // ─── Test: rescue pending should NOT block HIL creation ───
          vi.clearAllMocks();
          mockRedis.zadd.mockResolvedValue(1);
          mockRedis.expire.mockResolvedValue(1);
          mockRedis.zcard.mockResolvedValue(approvalCount);
          mockCreateQuestion.mockResolvedValue(42);

          // DB returns only rescue-type pending questions (not HIL)
          // Since HIL queries by repositoryId+triggerSource, and the mock
          // returns rescue entries, the hasPendingQuestion will check ctx.tool
          // which won't match since rescue entries have strategy/jobType not tool
          mockDbWhere.mockResolvedValue([
            {
              id: randomInt(rng, 1, 9999),
              contextData: { strategy, jobType },
            },
          ]);

          await hilPatternDetectorService.onApproval(orgId, repoId, tool, params, randomInt(rng, 1, 9999));

          // HIL detector should still create because the pending question
          // has a different context shape (strategy/jobType vs tool)
          if (mockCreateQuestion.mock.calls.length === 0) {
            failures.push(
              `Case ${i}: HIL question NOT created even though pending is rescue-type ` +
              `(rescue pending should not block HIL creation)`
            );
          }

          // ─── Test: HIL pending should NOT block rescue creation ───
          vi.clearAllMocks();
          mockRedis.zadd.mockResolvedValue(1);
          mockRedis.expire.mockResolvedValue(1);
          mockRedis.zcount.mockResolvedValue(rescueCount);
          mockRedis.zrangebyscore.mockResolvedValue(
            generateWindowMembers(rng, rescueCount, now)
          );
          mockCreateQuestion.mockResolvedValue(42);

          // DB returns only HIL-type pending questions (not rescue)
          // Rescue tracker checks ctx.strategy + ctx.jobType which won't match
          // since these entries have tool/repositoryId
          mockDbWhere.mockResolvedValue([
            {
              id: randomInt(rng, 1, 9999),
              contextData: { tool, repositoryId: repoId },
            },
          ]);

          await rescueStrategyTrackerService.recordAndCheck(orgId, repoId, {
            strategy,
            jobType,
            missionRunId: randomInt(rng, 1, 99999),
            timestamp: now - randomInt(rng, 0, WINDOW_MS - 1),
          });

          // Rescue tracker should still create because the pending question
          // has a different context shape (tool/repositoryId vs strategy/jobType)
          if (mockCreateQuestion.mock.calls.length === 0) {
            failures.push(
              `Case ${i}: rescue question NOT created even though pending is HIL-type ` +
              `(HIL pending should not block rescue creation)`
            );
          }
        }

        expect(failures).toEqual([]);
      });
    });
  });
});
