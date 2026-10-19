/**
 * Property-based tests for HIL Approval Pattern Threshold Detection.
 *
 * **Property 2: HIL Approval Pattern Threshold Detection**
 * For any organization, repository, and tool+parameterKeys combination,
 * the system SHALL create a `hil_pattern_detected` question if and only if
 * 5 or more approvals matching that pattern exist for the same repository.
 *
 * Since fast-check is not installable in this project (npm peer-dep conflicts),
 * these tests use manual randomization with 100 random cases per property
 * to achieve property-based testing coverage.
 *
 * **Validates: Requirements 2.1, 2.2**
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mock references ────────────────────────────────────────────────

const mockRedis = vi.hoisted(() => ({
  zadd: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  zcard: vi.fn().mockResolvedValue(0),
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

// ─── Property Tests ─────────────────────────────────────────────────────────

const APPROVAL_THRESHOLD = 5;

describe("HIL Pattern Detector Property Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis.zadd.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(1);
    mockRedis.zcard.mockResolvedValue(0);
    mockCreateQuestion.mockResolvedValue(42);
    mockDbWhere.mockResolvedValue([]); // No pending duplicates
  });

  /**
   * **Validates: Requirements 2.1, 2.2**
   *
   * Property 2: HIL Approval Pattern Threshold Detection
   * Generate approval sequences (0–10) for the same pattern.
   * Assert question creation iff count ≥ 5.
   */
  describe("Property 2: HIL Approval Pattern Threshold Detection", () => {
    it("creates a question if and only if approval count >= 5 (100 random cases)", async () => {
      const failures: string[] = [];

      for (let i = 0; i < 100; i++) {
        const rng = createRng(i * 7919 + 42);

        // Generate a random approval count (0–10)
        const approvalCount = randomInt(rng, 0, 10);
        const orgId = randomInt(rng, 1, 1000);
        const repoId = `repo-${randomString(rng, 4, 8)}`;
        const tool = generateToolName(rng);
        const params = generateParams(rng);

        // Reset mocks for this iteration
        vi.clearAllMocks();
        mockRedis.zadd.mockResolvedValue(1);
        mockRedis.expire.mockResolvedValue(1);
        mockRedis.zcard.mockResolvedValue(approvalCount);
        mockCreateQuestion.mockResolvedValue(42);
        mockDbWhere.mockResolvedValue([]); // No pending duplicates

        // Call onApproval once (simulating the Nth approval that brings count to approvalCount)
        await hilPatternDetectorService.onApproval(orgId, repoId, tool, params, randomInt(rng, 1, 9999));

        const questionCreated = mockCreateQuestion.mock.calls.length > 0;
        const shouldCreate = approvalCount >= APPROVAL_THRESHOLD;

        if (questionCreated !== shouldCreate) {
          failures.push(
            `Case ${i}: approvalCount=${approvalCount}, expected creation=${shouldCreate}, got=${questionCreated} ` +
            `(org=${orgId}, repo=${repoId}, tool=${tool})`
          );
        }
      }

      expect(failures).toEqual([]);
    });

    it("never creates a question when approval count is below threshold (100 random cases)", async () => {
      const failures: string[] = [];

      for (let i = 0; i < 100; i++) {
        const rng = createRng(i * 3571 + 17);

        // Generate a count strictly below threshold (0–4)
        const approvalCount = randomInt(rng, 0, APPROVAL_THRESHOLD - 1);
        const orgId = randomInt(rng, 1, 500);
        const repoId = `repo-${randomString(rng, 4, 8)}`;
        const tool = generateToolName(rng);
        const params = generateParams(rng);

        vi.clearAllMocks();
        mockRedis.zadd.mockResolvedValue(1);
        mockRedis.expire.mockResolvedValue(1);
        mockRedis.zcard.mockResolvedValue(approvalCount);
        mockCreateQuestion.mockResolvedValue(42);
        mockDbWhere.mockResolvedValue([]);

        await hilPatternDetectorService.onApproval(orgId, repoId, tool, params);

        if (mockCreateQuestion.mock.calls.length > 0) {
          failures.push(
            `Case ${i}: question created with only ${approvalCount} approvals (threshold=${APPROVAL_THRESHOLD})`
          );
        }
      }

      expect(failures).toEqual([]);
    });

    it("always creates a question when approval count meets or exceeds threshold (100 random cases)", async () => {
      const failures: string[] = [];

      for (let i = 0; i < 100; i++) {
        const rng = createRng(i * 6151 + 99);

        // Generate a count at or above threshold (5–10)
        const approvalCount = randomInt(rng, APPROVAL_THRESHOLD, 10);
        const orgId = randomInt(rng, 1, 500);
        const repoId = `repo-${randomString(rng, 4, 8)}`;
        const tool = generateToolName(rng);
        const params = generateParams(rng);

        vi.clearAllMocks();
        mockRedis.zadd.mockResolvedValue(1);
        mockRedis.expire.mockResolvedValue(1);
        mockRedis.zcard.mockResolvedValue(approvalCount);
        mockCreateQuestion.mockResolvedValue(42);
        mockDbWhere.mockResolvedValue([]); // No pending duplicates

        await hilPatternDetectorService.onApproval(orgId, repoId, tool, params, randomInt(rng, 1, 9999));

        if (mockCreateQuestion.mock.calls.length === 0) {
          failures.push(
            `Case ${i}: no question created with ${approvalCount} approvals (threshold=${APPROVAL_THRESHOLD})`
          );
        }
      }

      expect(failures).toEqual([]);
    });

    it("question context includes correct tool, parameterKeys, approvalCount, and repositoryId (100 random cases)", async () => {
      const failures: string[] = [];

      for (let i = 0; i < 100; i++) {
        const rng = createRng(i * 4253 + 31);

        // Only test cases where threshold is met (count >= 5)
        const approvalCount = randomInt(rng, APPROVAL_THRESHOLD, 10);
        const orgId = randomInt(rng, 1, 500);
        const repoId = `repo-${randomString(rng, 4, 8)}`;
        const tool = generateToolName(rng);
        const params = generateParams(rng);
        const expectedKeys = Object.keys(params).sort();

        vi.clearAllMocks();
        mockRedis.zadd.mockResolvedValue(1);
        mockRedis.expire.mockResolvedValue(1);
        mockRedis.zcard.mockResolvedValue(approvalCount);
        mockCreateQuestion.mockResolvedValue(42);
        mockDbWhere.mockResolvedValue([]);

        await hilPatternDetectorService.onApproval(orgId, repoId, tool, params, randomInt(rng, 1, 9999));

        if (mockCreateQuestion.mock.calls.length === 0) {
          failures.push(`Case ${i}: question not created despite count=${approvalCount}`);
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
        if (triggerSource !== "hil_pattern_detected") {
          failures.push(`Case ${i}: wrong triggerSource: expected "hil_pattern_detected", got "${triggerSource}"`);
        }

        // Verify context contains required fields per Requirement 2.2
        if (context.tool !== tool) {
          failures.push(`Case ${i}: context.tool mismatch: expected "${tool}", got "${context.tool}"`);
        }
        if (JSON.stringify(context.parameterKeys) !== JSON.stringify(expectedKeys)) {
          failures.push(
            `Case ${i}: context.parameterKeys mismatch: expected ${JSON.stringify(expectedKeys)}, got ${JSON.stringify(context.parameterKeys)}`
          );
        }
        if (context.approvalCount !== approvalCount) {
          failures.push(`Case ${i}: context.approvalCount mismatch: expected ${approvalCount}, got ${context.approvalCount}`);
        }
        if (context.repositoryId !== repoId) {
          failures.push(`Case ${i}: context.repositoryId mismatch: expected "${repoId}", got "${context.repositoryId}"`);
        }
      }

      expect(failures).toEqual([]);
    });

    it("threshold boundary is exact — 4 approvals never create, 5 approvals always create (100 random cases)", async () => {
      const failures: string[] = [];

      for (let i = 0; i < 100; i++) {
        const rng = createRng(i * 8831 + 53);

        const orgId = randomInt(rng, 1, 500);
        const repoId = `repo-${randomString(rng, 4, 8)}`;
        const tool = generateToolName(rng);
        const params = generateParams(rng);

        // Test at count = 4 (just below threshold)
        vi.clearAllMocks();
        mockRedis.zadd.mockResolvedValue(1);
        mockRedis.expire.mockResolvedValue(1);
        mockRedis.zcard.mockResolvedValue(4);
        mockCreateQuestion.mockResolvedValue(42);
        mockDbWhere.mockResolvedValue([]);

        await hilPatternDetectorService.onApproval(orgId, repoId, tool, params);

        if (mockCreateQuestion.mock.calls.length > 0) {
          failures.push(`Case ${i} (count=4): question created below threshold`);
        }

        // Test at count = 5 (exactly at threshold)
        vi.clearAllMocks();
        mockRedis.zadd.mockResolvedValue(1);
        mockRedis.expire.mockResolvedValue(1);
        mockRedis.zcard.mockResolvedValue(5);
        mockCreateQuestion.mockResolvedValue(42);
        mockDbWhere.mockResolvedValue([]);

        await hilPatternDetectorService.onApproval(orgId, repoId, tool, params);

        if (mockCreateQuestion.mock.calls.length === 0) {
          failures.push(`Case ${i} (count=5): question NOT created at threshold`);
        }
      }

      expect(failures).toEqual([]);
    });
  });
});
