import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  QualityGateResult,
  PipelineLifecycleEvent,
} from "../core/types.js";

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockPersist = vi.fn().mockResolvedValue({ id: 1 });
const mockGetPhaseArtifacts = vi.fn();
const mockEmitEvent = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });

vi.mock("@server/database_service.js", () => ({
  db: {
    update: (...args: unknown[]) => {
      mockDbUpdate(...args);
      return { set: mockDbSet };
    },
  },
}));

vi.mock("@shared/schema/index.js", () => ({
  generationSessions: { id: "id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ field: a, value: b })),
}));

vi.mock("../core/artifact-registry.service.js", () => ({
  artifactRegistryService: {
    persist: (...args: unknown[]) => mockPersist(...args),
    getPhaseArtifacts: (...args: unknown[]) => mockGetPhaseArtifacts(...args),
  },
}));

vi.mock("../core/session-lifecycle-manager.js", () => ({
  sessionLifecycleManager: {
    emitEvent: (...args: unknown[]) => mockEmitEvent(...args),
  },
}));

vi.mock("@server/utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Import after mocks are set up
const { qualityGateService } = await import("../autonomous/quality-gate.service.js");

// ─── Helpers ────────────────────────────────────────────────────────────────

function setupPassingArtifacts() {
  mockGetPhaseArtifacts.mockImplementation((sessionId: string, phase: string) => {
    if (phase === "apply_edits") {
      return Promise.resolve([
        {
          name: "verification_report",
          content: {
            sessionId,
            verificationLevel: "full_test",
            timeline: [
              { timestamp: new Date(), type: "step_check", status: "passed", details: {}, duration: 100 },
            ],
            summary: { totalChecks: 1, passed: 1, failed: 0, fixAttempts: 0, successfulFixes: 0, totalDuration: 100 },
            finalStatus: "all_passed",
          },
        },
      ]);
    }
    if (phase === "test_loop") {
      return Promise.resolve([
        {
          name: "test_loop_result",
          content: {
            status: "all_passed",
            totalAttempts: 1,
            fixAttempts: [],
            passingTests: ["test1.ts"],
            failingTests: [],
            duration: 2000,
          },
        },
      ]);
    }
    return Promise.resolve([]);
  });
}

function setupFailingArtifacts() {
  mockGetPhaseArtifacts.mockImplementation((sessionId: string, phase: string) => {
    if (phase === "apply_edits") {
      return Promise.resolve([
        {
          name: "verification_report",
          content: {
            sessionId,
            verificationLevel: "full_test",
            timeline: [
              { timestamp: new Date(), type: "step_check", status: "failed", operationId: "op-1", details: {}, duration: 100 },
            ],
            summary: { totalChecks: 1, passed: 0, failed: 1, fixAttempts: 0, successfulFixes: 0, totalDuration: 100 },
            finalStatus: "has_failures",
          },
        },
      ]);
    }
    if (phase === "test_loop") {
      return Promise.resolve([
        {
          name: "test_loop_result",
          content: {
            status: "exhausted",
            totalAttempts: 5,
            fixAttempts: [],
            passingTests: [],
            failingTests: ["failing.test.ts"],
            duration: 10000,
          },
        },
      ]);
    }
    return Promise.resolve([]);
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("QualityGateService - evaluateAndEnforce", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when gate passes", () => {
    beforeEach(() => {
      setupPassingArtifacts();
    });

    it("should emit quality_gate_passed lifecycle event", async () => {
      await qualityGateService.evaluateAndEnforce("session-1", 42);

      expect(mockEmitEvent).toHaveBeenCalledTimes(1);
      const event: PipelineLifecycleEvent = mockEmitEvent.mock.calls[0][0];
      expect(event.eventType).toBe("quality_gate_passed");
      expect(event.sessionId).toBe("session-1");
      expect(event.orgId).toBe(42);
      expect(event.payload.checks).toBeDefined();
    });

    it("should persist gate result artifact", async () => {
      await qualityGateService.evaluateAndEnforce("session-1", 42);

      expect(mockPersist).toHaveBeenCalledTimes(1);
      expect(mockPersist).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "session-1",
          phase: "quality_gate",
          name: "gate_result",
          mimeType: "application/json",
        })
      );
      const persistedContent = mockPersist.mock.calls[0][0].content as QualityGateResult;
      expect(persistedContent.passed).toBe(true);
    });

    it("should NOT transition session to blocked state", async () => {
      await qualityGateService.evaluateAndEnforce("session-1", 42);

      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it("should return the gate result with passed=true", async () => {
      const result = await qualityGateService.evaluateAndEnforce("session-1", 42);

      expect(result.passed).toBe(true);
      expect(result.blockingFailures).toHaveLength(0);
    });
  });

  describe("when gate fails", () => {
    beforeEach(() => {
      setupFailingArtifacts();
    });

    it("should transition session to blocked state", async () => {
      await qualityGateService.evaluateAndEnforce("session-fail", 99);

      expect(mockDbUpdate).toHaveBeenCalledTimes(1);
      expect(mockDbSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: "blocked" })
      );
    });

    it("should emit quality_gate_blocked lifecycle event with blocking failures", async () => {
      await qualityGateService.evaluateAndEnforce("session-fail", 99);

      expect(mockEmitEvent).toHaveBeenCalledTimes(1);
      const event: PipelineLifecycleEvent = mockEmitEvent.mock.calls[0][0];
      expect(event.eventType).toBe("quality_gate_blocked");
      expect(event.sessionId).toBe("session-fail");
      expect(event.orgId).toBe(99);
      expect(event.payload.blockingFailures).toBeDefined();
      expect((event.payload.blockingFailures as unknown[]).length).toBeGreaterThan(0);
    });

    it("should persist gate result artifact with passed=false", async () => {
      await qualityGateService.evaluateAndEnforce("session-fail", 99);

      expect(mockPersist).toHaveBeenCalledTimes(1);
      const persistedContent = mockPersist.mock.calls[0][0].content as QualityGateResult;
      expect(persistedContent.passed).toBe(false);
      expect(persistedContent.blockingFailures.length).toBeGreaterThan(0);
    });

    it("should return the gate result with passed=false and blocking failures", async () => {
      const result = await qualityGateService.evaluateAndEnforce("session-fail", 99);

      expect(result.passed).toBe(false);
      expect(result.blockingFailures.length).toBeGreaterThan(0);
    });

    it("should include failing verifications in the blocked event payload", async () => {
      await qualityGateService.evaluateAndEnforce("session-fail", 99);

      const event: PipelineLifecycleEvent = mockEmitEvent.mock.calls[0][0];
      const failures = event.payload.blockingFailures as Array<{ check: string; operationId?: string; testFile?: string }>;
      // Should have both verification failures and test loop failures
      const verificationFailures = failures.filter((f) => f.check === "incremental_verifications");
      const testFailures = failures.filter((f) => f.check === "test_loop_completion");
      expect(verificationFailures.length).toBeGreaterThan(0);
      expect(testFailures.length).toBeGreaterThan(0);
    });
  });
});
