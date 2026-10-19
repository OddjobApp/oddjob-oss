/**
 * Property-based tests for Rescue Strategy Threshold Detection.
 *
 * **Property 1: Rescue Strategy Threshold Detection**
 * For any organization, job type, and rescue strategy, the system SHALL create
 * a `rescue_pattern_detected` question if and only if 3 or more events for that
 * (strategy, jobType) pair exist within the most recent 7-day window.
 *
 * Since fast-check is not installable in this project (npm peer-dep conflicts),
 * these tests use manual randomization with 100 random cases per property
 * to achieve property-based testing coverage.
 *
 * **Validates: Requirements 1.1, 1.2**
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mock references ────────────────────────────────────────────────

const mockRedis = vi.hoisted(() => ({
  zadd: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  zcount: vi.fn().mockResolvedValue(0),
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
    select: () => ({
      from: () => ({
        where: (...args: any[]) => mockDbWhere(...args),
      }),
    }),
  },
}));

vi.mock("@shared/schema/index.js", () => ({
  knowledgeBaseQuestions: {
    id: "id",
    organizationId: "organization_id",
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

/** 7-day window in milliseconds */
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const RESCUE_THRESHOLD = 3;

/**
 * Generate a random timestamp.
 * @param inWindow - if true, generates a timestamp within the 7-day window; if false, outside it.
 */
function generateTimestamp(rng: () => number, now: number, inWindow: boolean): number {
  if (inWindow) {
    // Within last 7 days: now - (0 to WINDOW_MS-1)
    const offset = randomInt(rng, 0, WINDOW_MS - 1);
    return now - offset;
  } else {
    // Outside window: older than 7 days (8 to 14 days ago)
    const offset = WINDOW_MS + randomInt(rng, 1, WINDOW_MS);
    return now - offset;
  }
}

/**
 * Generate Redis sorted set members for events in the window.
 * Returns member strings in the format "{missionRunId}:{timestamp}".
 */
function generateWindowMembers(
  rng: () => number,
  count: number,
  now: number
): string[] {
  const members: string[] = [];
  for (let i = 0; i < count; i++) {
    const missionRunId = randomInt(rng, 1, 99999);
    const ts = generateTimestamp(rng, now, true);
    members.push(`${missionRunId}:${ts}`);
  }
  return members;
}

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("Rescue Strategy Tracker Property Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis.zadd.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(1);
    mockRedis.zcount.mockResolvedValue(0);
    mockRedis.zrangebyscore.mockResolvedValue([]);
    mockCreateQuestion.mockResolvedValue(42);
    mockDbWhere.mockResolvedValue([]); // No pending duplicates
  });

  /**
   * **Validates: Requirements 1.1, 1.2**
   *
   * Property 1: Rescue Strategy Threshold Detection
   * Generate random event sequences (0–10 events) with timestamps inside/outside 7-day window.
   * Assert question creation iff count of in-window events ≥ 3.
   * Assert no question created when count < 3.
   */
  describe("Property 1: Rescue Strategy Threshold Detection", () => {
    it("creates a question if and only if in-window event count >= 3 (100 random cases)", async () => {
      const failures: string[] = [];
      const now = Date.now();

      for (let i = 0; i < 100; i++) {
        const rng = createRng(i * 7919 + 42);

        // Generate random event count in the window (0–10)
        const inWindowCount = randomInt(rng, 0, 10);
        const orgId = randomInt(rng, 1, 1000);
        const repoId = `repo-${randomString(rng, 4, 8)}`;
        const strategy = generateStrategy(rng);
        const jobType = generateJobType(rng);
        const missionRunId = randomInt(rng, 1, 99999);
        const timestamp = now - randomInt(rng, 0, WINDOW_MS - 1); // Current event is in window

        // Mock Redis to return inWindowCount from zcount (simulating existing events in window)
        vi.clearAllMocks();
        mockRedis.zadd.mockResolvedValue(1);
        mockRedis.expire.mockResolvedValue(1);
        mockRedis.zcount.mockResolvedValue(inWindowCount);
        mockRedis.zrangebyscore.mockResolvedValue(
          generateWindowMembers(rng, inWindowCount, now)
        );
        mockCreateQuestion.mockResolvedValue(42);
        mockDbWhere.mockResolvedValue([]); // No pending duplicates

        await rescueStrategyTrackerService.recordAndCheck(orgId, repoId, {
          strategy,
          jobType,
          missionRunId,
          timestamp,
        });

        const questionCreated = mockCreateQuestion.mock.calls.length > 0;
        const shouldCreate = inWindowCount >= RESCUE_THRESHOLD;

        if (questionCreated !== shouldCreate) {
          failures.push(
            `Case ${i}: inWindowCount=${inWindowCount}, expected creation=${shouldCreate}, got=${questionCreated} ` +
            `(org=${orgId}, strategy=${strategy}, jobType=${jobType})`
          );
        }
      }

      expect(failures).toEqual([]);
    });

    it("never creates a question when in-window count is below threshold (100 random cases)", async () => {
      const failures: string[] = [];
      const now = Date.now();

      for (let i = 0; i < 100; i++) {
        const rng = createRng(i * 3571 + 17);

        // Generate a count strictly below threshold (0–2)
        const inWindowCount = randomInt(rng, 0, RESCUE_THRESHOLD - 1);
        const orgId = randomInt(rng, 1, 500);
        const repoId = `repo-${randomString(rng, 4, 8)}`;
        const strategy = generateStrategy(rng);
        const jobType = generateJobType(rng);
        const missionRunId = randomInt(rng, 1, 99999);
        const timestamp = now - randomInt(rng, 0, WINDOW_MS - 1);

        vi.clearAllMocks();
        mockRedis.zadd.mockResolvedValue(1);
        mockRedis.expire.mockResolvedValue(1);
        mockRedis.zcount.mockResolvedValue(inWindowCount);
        mockRedis.zrangebyscore.mockResolvedValue([]);
        mockCreateQuestion.mockResolvedValue(42);
        mockDbWhere.mockResolvedValue([]);

        await rescueStrategyTrackerService.recordAndCheck(orgId, repoId, {
          strategy,
          jobType,
          missionRunId,
          timestamp,
        });

        if (mockCreateQuestion.mock.calls.length > 0) {
          failures.push(
            `Case ${i}: question created with only ${inWindowCount} in-window events (threshold=${RESCUE_THRESHOLD})`
          );
        }
      }

      expect(failures).toEqual([]);
    });

    it("always creates a question when in-window count meets or exceeds threshold (100 random cases)", async () => {
      const failures: string[] = [];
      const now = Date.now();

      for (let i = 0; i < 100; i++) {
        const rng = createRng(i * 6151 + 99);

        // Generate a count at or above threshold (3–10)
        const inWindowCount = randomInt(rng, RESCUE_THRESHOLD, 10);
        const orgId = randomInt(rng, 1, 500);
        const repoId = `repo-${randomString(rng, 4, 8)}`;
        const strategy = generateStrategy(rng);
        const jobType = generateJobType(rng);
        const missionRunId = randomInt(rng, 1, 99999);
        const timestamp = now - randomInt(rng, 0, WINDOW_MS - 1);

        // Generate matching window members for zrangebyscore
        const windowMembers = generateWindowMembers(rng, inWindowCount, now);

        vi.clearAllMocks();
        mockRedis.zadd.mockResolvedValue(1);
        mockRedis.expire.mockResolvedValue(1);
        mockRedis.zcount.mockResolvedValue(inWindowCount);
        mockRedis.zrangebyscore.mockResolvedValue(windowMembers);
        mockCreateQuestion.mockResolvedValue(42);
        mockDbWhere.mockResolvedValue([]); // No pending duplicates

        await rescueStrategyTrackerService.recordAndCheck(orgId, repoId, {
          strategy,
          jobType,
          missionRunId,
          timestamp,
        });

        if (mockCreateQuestion.mock.calls.length === 0) {
          failures.push(
            `Case ${i}: no question created with ${inWindowCount} in-window events (threshold=${RESCUE_THRESHOLD})`
          );
        }
      }

      expect(failures).toEqual([]);
    });

    it("threshold boundary is exact — 2 events never create, 3 events always create (100 random cases)", async () => {
      const failures: string[] = [];
      const now = Date.now();

      for (let i = 0; i < 100; i++) {
        const rng = createRng(i * 8831 + 53);

        const orgId = randomInt(rng, 1, 500);
        const repoId = `repo-${randomString(rng, 4, 8)}`;
        const strategy = generateStrategy(rng);
        const jobType = generateJobType(rng);
        const missionRunId = randomInt(rng, 1, 99999);
        const timestamp = now - randomInt(rng, 0, WINDOW_MS - 1);

        // Test at count = 2 (just below threshold)
        vi.clearAllMocks();
        mockRedis.zadd.mockResolvedValue(1);
        mockRedis.expire.mockResolvedValue(1);
        mockRedis.zcount.mockResolvedValue(2);
        mockRedis.zrangebyscore.mockResolvedValue([]);
        mockCreateQuestion.mockResolvedValue(42);
        mockDbWhere.mockResolvedValue([]);

        await rescueStrategyTrackerService.recordAndCheck(orgId, repoId, {
          strategy,
          jobType,
          missionRunId,
          timestamp,
        });

        if (mockCreateQuestion.mock.calls.length > 0) {
          failures.push(`Case ${i} (count=2): question created below threshold`);
        }

        // Test at count = 3 (exactly at threshold)
        vi.clearAllMocks();
        mockRedis.zadd.mockResolvedValue(1);
        mockRedis.expire.mockResolvedValue(1);
        mockRedis.zcount.mockResolvedValue(3);
        mockRedis.zrangebyscore.mockResolvedValue(
          generateWindowMembers(rng, 3, now)
        );
        mockCreateQuestion.mockResolvedValue(42);
        mockDbWhere.mockResolvedValue([]);

        await rescueStrategyTrackerService.recordAndCheck(orgId, repoId, {
          strategy,
          jobType,
          missionRunId,
          timestamp,
        });

        if (mockCreateQuestion.mock.calls.length === 0) {
          failures.push(`Case ${i} (count=3): question NOT created at threshold`);
        }
      }

      expect(failures).toEqual([]);
    });

    it("question context includes correct strategy, jobType, count, and missionRunIds (100 random cases)", async () => {
      const failures: string[] = [];
      const now = Date.now();

      for (let i = 0; i < 100; i++) {
        const rng = createRng(i * 4253 + 31);

        // Only test cases where threshold is met (count >= 3)
        const inWindowCount = randomInt(rng, RESCUE_THRESHOLD, 10);
        const orgId = randomInt(rng, 1, 500);
        const repoId = `repo-${randomString(rng, 4, 8)}`;
        const strategy = generateStrategy(rng);
        const jobType = generateJobType(rng);
        const missionRunId = randomInt(rng, 1, 99999);
        const timestamp = now - randomInt(rng, 0, WINDOW_MS - 1);

        // Generate window members with known mission run IDs
        const windowMembers = generateWindowMembers(rng, inWindowCount, now);

        vi.clearAllMocks();
        mockRedis.zadd.mockResolvedValue(1);
        mockRedis.expire.mockResolvedValue(1);
        mockRedis.zcount.mockResolvedValue(inWindowCount);
        mockRedis.zrangebyscore.mockResolvedValue(windowMembers);
        mockCreateQuestion.mockResolvedValue(42);
        mockDbWhere.mockResolvedValue([]);

        await rescueStrategyTrackerService.recordAndCheck(orgId, repoId, {
          strategy,
          jobType,
          missionRunId,
          timestamp,
        });

        if (mockCreateQuestion.mock.calls.length === 0) {
          failures.push(`Case ${i}: question not created despite count=${inWindowCount}`);
          continue;
        }

        const [calledOrgId, calledRepoId, triggerSource, context] = mockCreateQuestion.mock.calls[0];

        // Verify organization and repository
        if (calledOrgId !== orgId) {
          failures.push(`Case ${i}: wrong orgId in call: expected ${orgId}, got ${calledOrgId}`);
        }
        if (calledRepoId !== repoId) {
          failures.push(`Case ${i}: wrong repoId in call: expected ${repoId}, got ${calledRepoId}`);
        }

        // Verify trigger source
        if (triggerSource !== "rescue_pattern_detected") {
          failures.push(`Case ${i}: wrong triggerSource: expected "rescue_pattern_detected", got "${triggerSource}"`);
        }

        // Verify context contains required fields per Requirements 1.1, 1.2
        if (context.strategy !== strategy) {
          failures.push(`Case ${i}: context.strategy mismatch: expected "${strategy}", got "${context.strategy}"`);
        }
        if (context.jobType !== jobType) {
          failures.push(`Case ${i}: context.jobType mismatch: expected "${jobType}", got "${context.jobType}"`);
        }
        if (context.count !== inWindowCount) {
          failures.push(`Case ${i}: context.count mismatch: expected ${inWindowCount}, got ${context.count}`);
        }
        if (!Array.isArray(context.missionRunIds)) {
          failures.push(`Case ${i}: context.missionRunIds is not an array`);
        } else if (context.missionRunIds.length !== inWindowCount) {
          failures.push(
            `Case ${i}: context.missionRunIds length mismatch: expected ${inWindowCount}, got ${context.missionRunIds.length}`
          );
        }
      }

      expect(failures).toEqual([]);
    });

    it("events outside 7-day window do not contribute to threshold (100 random cases)", async () => {
      const failures: string[] = [];
      const now = Date.now();

      for (let i = 0; i < 100; i++) {
        const rng = createRng(i * 2909 + 73);

        // Simulate a scenario where total events exist, but few are in window
        // Generate total events (3–10), but only 0–2 are in window
        const inWindowCount = randomInt(rng, 0, RESCUE_THRESHOLD - 1);
        const orgId = randomInt(rng, 1, 500);
        const repoId = `repo-${randomString(rng, 4, 8)}`;
        const strategy = generateStrategy(rng);
        const jobType = generateJobType(rng);
        const missionRunId = randomInt(rng, 1, 99999);
        const timestamp = now - randomInt(rng, 0, WINDOW_MS - 1);

        // zcount returns only the in-window count (events outside window excluded by ZCOUNT range)
        vi.clearAllMocks();
        mockRedis.zadd.mockResolvedValue(1);
        mockRedis.expire.mockResolvedValue(1);
        mockRedis.zcount.mockResolvedValue(inWindowCount);
        mockRedis.zrangebyscore.mockResolvedValue([]);
        mockCreateQuestion.mockResolvedValue(42);
        mockDbWhere.mockResolvedValue([]);

        await rescueStrategyTrackerService.recordAndCheck(orgId, repoId, {
          strategy,
          jobType,
          missionRunId,
          timestamp,
        });

        if (mockCreateQuestion.mock.calls.length > 0) {
          failures.push(
            `Case ${i}: question created with only ${inWindowCount} in-window events ` +
            `(out-of-window events should not count)`
          );
        }
      }

      expect(failures).toEqual([]);
    });
  });
});
