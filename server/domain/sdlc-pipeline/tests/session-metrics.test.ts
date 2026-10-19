import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TestLoopResult, FixAttemptRecord, SessionMetadataExtension } from "../core/types.js";

/**
 * Unit tests for getAutonomousMetrics() and updateSessionMetrics()
 * in pipeline-orchestrator.service.ts.
 *
 * These functions read/write the `metrics` block from session metadata.
 * We mock the database layer to isolate the logic.
 */

// ─── Mocks ──────────────────────────────────────────────────────────────────

// We need to properly mock the full Drizzle fluent query chain:
// db.select().from().where().limit() and db.update().set().where()

let mockSessionRows: any[] = [];
let lastSetArgs: any = null;

vi.mock("@server/database_service.js", () => {
  const createSelectChain = (rows: () => any[]) => ({
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockImplementation(() => Promise.resolve(rows())),
    orderBy: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
  });

  const createUpdateChain = (onSet: (args: any) => void) => ({
    set: vi.fn().mockImplementation((args: any) => {
      onSet(args);
      return {
        where: vi.fn().mockResolvedValue(undefined),
      };
    }),
  });

  return {
    db: {
      select: vi.fn().mockImplementation(() => createSelectChain(() => mockSessionRows)),
      update: vi.fn().mockImplementation(() => createUpdateChain((args) => { lastSetArgs = args; })),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    },
  };
});

vi.mock("@shared/schema/index.js", () => ({
  generationSessions: { id: "id", metadata: "metadata" },
  cycleBlueprints: {},
  missionRuns: {},
}));

vi.mock("@server/utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("@server/domain/mission/core/cycle-manager.service.js", () => ({
  CycleManagerService: { launchCycle: vi.fn(), terminateFleet: vi.fn() },
}));

vi.mock("../core/session-lifecycle-manager.js", () => ({
  sessionLifecycleManager: { transition: vi.fn(), emitEvent: vi.fn() },
}));

vi.mock("../core/artifact-contract-validator.js", () => ({
  artifactContractValidator: { validate: vi.fn() },
}));

vi.mock("../core/artifact-registry.service.js", () => ({
  artifactRegistryService: { persist: vi.fn() },
}));

vi.mock("../core/cost-rollup-aggregator.js", () => ({
  costRollupAggregator: { calculateSessionCost: vi.fn() },
}));

vi.mock("@domain/governor/core/decision-router.js", () => ({
  decisionRouter: { requestDecision: vi.fn() },
}));

// Need to also mock drizzle-orm operators
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
  and: vi.fn((...args: any[]) => args),
  desc: vi.fn((col: any) => col),
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeTestLoopResult(overrides: Partial<TestLoopResult> = {}): TestLoopResult {
  return {
    status: overrides.status ?? "all_passed",
    totalAttempts: overrides.totalAttempts ?? 3,
    fixAttempts: overrides.fixAttempts ?? [],
    passingTests: overrides.passingTests ?? ["test1.ts", "test2.ts"],
    failingTests: overrides.failingTests ?? [],
    duration: overrides.duration ?? 5000,
  };
}

function makeFixAttemptRecord(overrides: Partial<FixAttemptRecord> = {}): FixAttemptRecord {
  return {
    attemptNumber: overrides.attemptNumber ?? 1,
    timestamp: overrides.timestamp ?? new Date(),
    diagnosis: overrides.diagnosis ?? {
      testFile: "src/foo.test.ts",
      testName: "should work",
      errorMessage: "Expected true",
      rootCause: "wrong return value",
      affectedFile: "src/foo.ts",
      suggestedApproach: "fix the return",
    },
    appliedFix: overrides.appliedFix ?? {
      filePath: "src/foo.ts",
      changes: [],
      description: "Fixed return value",
    },
    outcome: overrides.outcome ?? "resolved",
    duration: overrides.duration ?? 1200,
    newFailuresIntroduced: overrides.newFailuresIntroduced ?? [],
  };
}

function makeSessionRow(metadata: Record<string, unknown> = {}) {
  return {
    id: "session-123",
    templateId: "test-template",
    cycleId: 1,
    organizationId: 1,
    status: "active",
    currentPhase: "test_loop",
    phaseSequence: ["context_load", "change_plan", "test_loop"],
    metadata,
    budgetLimitUsd: null,
    startedAt: new Date("2024-01-01"),
    completedAt: null,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("pipelineOrchestratorService - autonomous metrics", () => {
  let pipelineOrchestratorService: typeof import("../core/pipeline-orchestrator.service.js").pipelineOrchestratorService;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSessionRows = [];
    lastSetArgs = null;

    // Dynamic import to get fresh module with mocks
    const mod = await import("../core/pipeline-orchestrator.service.js");
    pipelineOrchestratorService = mod.pipelineOrchestratorService;
  });

  describe("getAutonomousMetrics", () => {
    it("returns zeroed metrics when session has no metrics in metadata", async () => {
      mockSessionRows = [makeSessionRow({})];

      const metrics = await pipelineOrchestratorService.getAutonomousMetrics("session-123");

      expect(metrics).toEqual({
        fixAttempts: 0,
        successfulFixes: 0,
        failedFixes: 0,
        totalVerificationTime: 0,
        testLoopIterations: 0,
      });
    });

    it("returns stored metrics from session metadata", async () => {
      const storedMetrics: SessionMetadataExtension["metrics"] = {
        fixAttempts: 7,
        successfulFixes: 5,
        failedFixes: 2,
        totalVerificationTime: 15000,
        testLoopIterations: 3,
      };
      mockSessionRows = [makeSessionRow({ metrics: storedMetrics })];

      const metrics = await pipelineOrchestratorService.getAutonomousMetrics("session-123");

      expect(metrics).toEqual({
        fixAttempts: 7,
        successfulFixes: 5,
        failedFixes: 2,
        totalVerificationTime: 15000,
        testLoopIterations: 3,
      });
    });

    it("handles partial metrics gracefully with defaults", async () => {
      mockSessionRows = [makeSessionRow({ metrics: { fixAttempts: 2 } })];

      const metrics = await pipelineOrchestratorService.getAutonomousMetrics("session-123");

      expect(metrics.fixAttempts).toBe(2);
      expect(metrics.successfulFixes).toBe(0);
      expect(metrics.failedFixes).toBe(0);
      expect(metrics.totalVerificationTime).toBe(0);
      expect(metrics.testLoopIterations).toBe(0);
    });
  });

  describe("updateSessionMetrics", () => {
    it("accumulates metrics from a TestLoopResult with resolved fixes", async () => {
      const existingMetrics: SessionMetadataExtension["metrics"] = {
        fixAttempts: 2,
        successfulFixes: 1,
        failedFixes: 1,
        totalVerificationTime: 3000,
        testLoopIterations: 1,
      };
      mockSessionRows = [makeSessionRow({ metrics: existingMetrics })];

      const testLoopResult = makeTestLoopResult({
        totalAttempts: 3,
        duration: 7000,
        fixAttempts: [
          makeFixAttemptRecord({ outcome: "resolved" }),
          makeFixAttemptRecord({ attemptNumber: 2, outcome: "resolved" }),
          makeFixAttemptRecord({ attemptNumber: 3, outcome: "failed" }),
        ],
      });

      await pipelineOrchestratorService.updateSessionMetrics("session-123", testLoopResult);

      expect(lastSetArgs).toBeDefined();
      expect(lastSetArgs.metadata.metrics).toEqual({
        fixAttempts: 5,          // 2 existing + 3 new totalAttempts
        successfulFixes: 3,      // 1 existing + 2 resolved
        failedFixes: 2,          // 1 existing + 1 failed
        totalVerificationTime: 10000, // 3000 + 7000
        testLoopIterations: 2,   // 1 existing + 1 new iteration
      });
    });

    it("initializes metrics from zero when session has no existing metrics", async () => {
      mockSessionRows = [makeSessionRow({})];

      const testLoopResult = makeTestLoopResult({
        totalAttempts: 2,
        duration: 4000,
        fixAttempts: [
          makeFixAttemptRecord({ outcome: "resolved" }),
          makeFixAttemptRecord({ attemptNumber: 2, outcome: "reverted" }),
        ],
      });

      await pipelineOrchestratorService.updateSessionMetrics("session-123", testLoopResult);

      expect(lastSetArgs).toBeDefined();
      expect(lastSetArgs.metadata.metrics).toEqual({
        fixAttempts: 2,
        successfulFixes: 1,
        failedFixes: 1,         // "reverted" counts as failed
        totalVerificationTime: 4000,
        testLoopIterations: 1,
      });
    });

    it("counts reverted fixes as failed fixes", async () => {
      mockSessionRows = [makeSessionRow({ metrics: { fixAttempts: 0, successfulFixes: 0, failedFixes: 0, totalVerificationTime: 0, testLoopIterations: 0 } })];

      const testLoopResult = makeTestLoopResult({
        totalAttempts: 2,
        duration: 2000,
        fixAttempts: [
          makeFixAttemptRecord({ outcome: "reverted" }),
          makeFixAttemptRecord({ attemptNumber: 2, outcome: "reverted" }),
        ],
      });

      await pipelineOrchestratorService.updateSessionMetrics("session-123", testLoopResult);

      expect(lastSetArgs).toBeDefined();
      expect(lastSetArgs.metadata.metrics.failedFixes).toBe(2);
      expect(lastSetArgs.metadata.metrics.successfulFixes).toBe(0);
    });

    it("increments testLoopIterations by 1 per call regardless of attempt count", async () => {
      mockSessionRows = [makeSessionRow({ metrics: { fixAttempts: 0, successfulFixes: 0, failedFixes: 0, totalVerificationTime: 0, testLoopIterations: 5 } })];

      const testLoopResult = makeTestLoopResult({
        totalAttempts: 10,
        duration: 1000,
        fixAttempts: [],
      });

      await pipelineOrchestratorService.updateSessionMetrics("session-123", testLoopResult);

      expect(lastSetArgs).toBeDefined();
      expect(lastSetArgs.metadata.metrics.testLoopIterations).toBe(6); // 5 + 1
    });
  });
});
