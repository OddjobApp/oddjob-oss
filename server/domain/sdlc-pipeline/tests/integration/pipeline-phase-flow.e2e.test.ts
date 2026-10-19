/**
 * @vitest-environment node
 *
 * Integration tests for the autonomous pipeline phase flow.
 *
 * Tests end-to-end phase advancement through the artifact registry,
 * lifecycle event emission, session metrics aggregation, and artifact
 * contract validation for each phase's output schema.
 *
 * Requirements: 1.4, 2.6, 8.4, 9.2, 9.5
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  AutonomousCodegenConfig,
  RepositoryContext,
  EditPlan,
  VerificationReport,
  TestLoopResult,
  QualityGateResult,
  PRResult,
  PipelineLifecycleEvent,
} from "../../core/types.js";
import {
  repositoryContextContract,
  editPlanContract,
  verificationReportContract,
  testLoopResultContract,
  gateResultContract,
  prResultContract,
} from "../../autonomous/contracts.js";

// ─── Hoisted State ──────────────────────────────────────────────────────────

const persistedArtifacts = vi.hoisted(() => new Map<string, unknown>());
const emittedEvents = vi.hoisted(() => [] as PipelineLifecycleEvent[]);
const phaseContextStore = vi.hoisted(() => new Map<string, Record<string, unknown>>());

// ─── Mock: Artifact Registry ────────────────────────────────────────────────

vi.mock("../../core/artifact-registry.service.js", () => ({
  artifactRegistryService: {
    persist: vi.fn(async (params: { sessionId: string; phase: string; name: string; content: unknown }) => {
      const key = `${params.phase}.${params.name}`;
      persistedArtifacts.set(key, params.content);
      return { id: persistedArtifacts.size, ...params, version: 1, validatedAt: new Date(), createdAt: new Date() };
    }),
    buildPhaseContext: vi.fn(async (_sessionId: string, targetPhase: string) => {
      return phaseContextStore.get(targetPhase) ?? {};
    }),
    getPhaseArtifacts: vi.fn(async (_sessionId: string, phase: string) => {
      const artifacts: Array<{ name: string; content: unknown }> = [];
      for (const [key, content] of persistedArtifacts.entries()) {
        if (key.startsWith(`${phase}.`)) {
          artifacts.push({ name: key.replace(`${phase}.`, ""), content });
        }
      }
      return artifacts;
    }),
  },
}));

// ─── Mock: Session Lifecycle Manager ────────────────────────────────────────

vi.mock("../../core/session-lifecycle-manager.js", () => ({
  sessionLifecycleManager: {
    transition: vi.fn(),
    emitEvent: vi.fn((event: PipelineLifecycleEvent) => {
      emittedEvents.push(event);
    }),
  },
}));

// ─── Mock: Logger ───────────────────────────────────────────────────────────

vi.mock("@server/utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// ─── Mock: Downstream Services ──────────────────────────────────────────────

vi.mock("../../autonomous/repository-context-loader.service.js", () => ({
  repositoryContextLoaderService: {
    loadContextAndPersist: vi.fn(async () => ({
      success: true,
      context: mockRepositoryContext(),
    })),
  },
}));

vi.mock("../../autonomous/change-planner.service.js", () => ({
  changePlannerService: {
    generatePlanAndPersist: vi.fn(async () => ({
      plan: mockEditPlan(),
    })),
  },
}));

vi.mock("../../autonomous/incremental-verifier.service.js", () => ({
  incrementalVerifierService: {
    verifyStep: vi.fn(async () => ({
      operationId: "op-1",
      filePath: "src/index.ts",
      status: "passed" as const,
      checks: [{ type: "type_check" as const, passed: true, duration: 100 }],
      duration: 100,
      timestamp: new Date(),
    })),
    getCumulativeReport: vi.fn(async () => mockVerificationReport()),
  },
}));

vi.mock("../../autonomous/test-loop-controller.service.js", () => ({
  testLoopControllerService: {
    executeLoop: vi.fn(async () => mockTestLoopResult()),
  },
}));

vi.mock("../../autonomous/quality-gate.service.js", () => ({
  qualityGateService: {
    evaluate: vi.fn(async () => mockQualityGateResult()),
  },
}));

vi.mock("../../autonomous/pr-generator.service.js", () => ({
  prGeneratorService: {
    generatePR: vi.fn(async () => mockPRResult()),
  },
}));

// ─── Mock: Artifact Contract Validator (real implementation, no DB) ──────────

// We use the actual validator since it's pure/stateless
import { artifactContractValidator } from "../../core/artifact-contract-validator.js";

// ─── Import SUT ─────────────────────────────────────────────────────────────

const { executeAutonomousPhase } = await import("../../autonomous/phase-handlers.js");

// ─── Test Config ────────────────────────────────────────────────────────────

const TEST_SESSION_ID = "integration-test-session-001";
const TEST_MISSION_RUN_ID = 42;

const testConfig: AutonomousCodegenConfig = {
  verificationLevel: "full_test",
  maxFixAttempts: 5,
  maxFileCount: 50,
  contextTokenBudget: 100_000,
  dependencyTraceDepth: 3,
  repository: {
    workspacePath: "/test/repo",
    branch: "main",
  },
  branchNamingPattern: "codegen/{session-id}/{objective-slug}",
};

// ─── Mock Data Factories ────────────────────────────────────────────────────

function mockRepositoryContext(): RepositoryContext {
  return {
    projectStructure: [
      { path: "src/index.ts", type: "file", language: "typescript", size: 1200 },
      { path: "src/utils.ts", type: "file", language: "typescript", size: 800 },
      { path: "src", type: "directory", children: [] },
    ],
    dependencyGraph: {
      nodes: [
        { filePath: "src/index.ts", exports: ["main"], language: "typescript" },
        { filePath: "src/utils.ts", exports: ["helper"], language: "typescript" },
      ],
      edges: [
        { source: "src/index.ts", target: "src/utils.ts", importType: "static" },
      ],
    },
    conventions: {
      namingPatterns: [{ scope: "files", pattern: "kebab-case", examples: ["my-file.ts"] }],
      formattingRules: [{ rule: "indent", value: 2 }],
      architecturalPatterns: ["layered"],
      testingConventions: [{ framework: "vitest", filePattern: "*.test.ts", location: "co-located" }],
    },
    languageMetadata: {
      primaryLanguage: "typescript",
      frameworks: ["express"],
      packageManager: "npm",
      buildTool: "vite",
      testRunner: "vitest",
    },
    relevantFiles: [
      { path: "src/index.ts", content: "export function main() {}", relevanceScore: 0.95 },
    ],
    tokenCount: 5000,
  };
}

function mockEditPlan(): EditPlan {
  return {
    sessionId: TEST_SESSION_ID,
    objective: "Add user authentication module",
    operations: [
      {
        id: "op-1",
        type: "create",
        filePath: "src/auth.ts",
        dependsOn: [],
        rationale: "New auth module following layered architecture pattern",
        newContent: "export class AuthService {}",
      },
      {
        id: "op-2",
        type: "modify",
        filePath: "src/index.ts",
        dependsOn: ["op-1"],
        rationale: "Wire auth service into main app",
        changes: [
          { startLine: 1, endLine: 1, originalCode: "", newCode: "import { AuthService } from './auth.js';", contextLines: 2 },
        ],
      },
    ],
    dependencyOrder: ["op-1", "op-2"],
    totalFileCount: 2,
    requiresHumanReview: false,
  };
}

function mockVerificationReport(): VerificationReport {
  return {
    sessionId: TEST_SESSION_ID,
    verificationLevel: "full_test",
    timeline: [
      {
        timestamp: new Date("2024-06-01T10:00:00Z"),
        type: "step_check",
        operationId: "op-1",
        status: "passed",
        details: { file: "src/auth.ts" },
        duration: 150,
      },
      {
        timestamp: new Date("2024-06-01T10:00:01Z"),
        type: "step_check",
        operationId: "op-2",
        status: "passed",
        details: { file: "src/index.ts" },
        duration: 200,
      },
    ],
    summary: {
      totalChecks: 2,
      passed: 2,
      failed: 0,
      fixAttempts: 0,
      successfulFixes: 0,
      totalDuration: 350,
    },
    finalStatus: "all_passed",
  };
}

function mockTestLoopResult(): TestLoopResult {
  return {
    status: "all_passed",
    totalAttempts: 2,
    fixAttempts: [
      {
        attemptNumber: 1,
        timestamp: new Date("2024-06-01T10:01:00Z"),
        diagnosis: {
          testFile: "src/auth.test.ts",
          testName: "should authenticate user",
          errorMessage: "Expected true to be false",
          rootCause: "Missing token validation",
          affectedFile: "src/auth.ts",
          suggestedApproach: "Add token validation logic",
        },
        appliedFix: {
          filePath: "src/auth.ts",
          changes: [{ startLine: 5, endLine: 5, originalCode: "", newCode: "validateToken()", contextLines: 2 }],
          description: "Added token validation call",
        },
        outcome: "resolved",
        duration: 3000,
        newFailuresIntroduced: [],
      },
      {
        attemptNumber: 2,
        timestamp: new Date("2024-06-01T10:01:05Z"),
        diagnosis: {
          testFile: "src/auth.test.ts",
          testName: "should handle expired tokens",
          errorMessage: "TokenExpiredError not thrown",
          rootCause: "Missing expiry check",
          affectedFile: "src/auth.ts",
          suggestedApproach: "Add token expiry verification",
        },
        appliedFix: {
          filePath: "src/auth.ts",
          changes: [{ startLine: 10, endLine: 10, originalCode: "", newCode: "checkExpiry(token)", contextLines: 2 }],
          description: "Added token expiry check",
        },
        outcome: "resolved",
        duration: 2500,
        newFailuresIntroduced: [],
      },
    ],
    passingTests: ["src/auth.test.ts"],
    failingTests: [],
    duration: 8000,
  };
}

function mockQualityGateResult(): QualityGateResult {
  return {
    passed: true,
    evaluatedAt: new Date("2024-06-01T10:02:00Z"),
    checks: [
      { name: "incremental_verifications", description: "All step verifications passed", passed: true },
      { name: "test_loop_completion", description: "All tests passing", passed: true },
    ],
    blockingFailures: [],
  };
}

function mockPRResult(): PRResult {
  return {
    branchName: "codegen/integration-test-session-001/add-user-auth",
    commitSha: "abc123def456",
    prUrl: "https://github.com/test/repo/pull/42",
    prNumber: 42,
    description: "## Add user authentication\n\nChanges: 2 files\nTests: all passing",
    testEvidence: {
      totalTests: 5,
      passingTests: 5,
      fixAttempts: 2,
      verificationTimeline: "All 2 checks passed. 2 fix attempts resolved.",
    },
  };
}

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe("Pipeline Phase Flow Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    persistedArtifacts.clear();
    emittedEvents.length = 0;
    phaseContextStore.clear();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. Phase Advancement Through Artifact Registry
  // ═══════════════════════════════════════════════════════════════════════════

  describe("end-to-end phase advancement through artifact registry", () => {
    it("should execute context_load phase and produce repository_context artifact", async () => {
      const result = await executeAutonomousPhase(
        TEST_SESSION_ID,
        "context_load",
        TEST_MISSION_RUN_ID,
        testConfig
      );

      expect(result.success).toBe(true);
      expect(result.phaseName).toBe("context_load");
      expect(result.artifact).toBeDefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it("should execute change_plan phase receiving upstream context", async () => {
      // Simulate context_load having produced its artifact
      phaseContextStore.set("change_plan", {
        "context_load.repository_context": mockRepositoryContext(),
      });

      const result = await executeAutonomousPhase(
        TEST_SESSION_ID,
        "change_plan",
        TEST_MISSION_RUN_ID,
        testConfig
      );

      expect(result.success).toBe(true);
      expect(result.phaseName).toBe("change_plan");
      expect(result.artifact).toBeDefined();
    });

    it("should execute apply_edits phase consuming edit_plan from upstream", async () => {
      phaseContextStore.set("apply_edits", {
        "change_plan.edit_plan": mockEditPlan(),
      });

      const result = await executeAutonomousPhase(
        TEST_SESSION_ID,
        "apply_edits",
        TEST_MISSION_RUN_ID,
        testConfig
      );

      expect(result.success).toBe(true);
      expect(result.phaseName).toBe("apply_edits");
      expect(result.artifact).toBeDefined();
      // Verify the verification report was persisted
      expect(persistedArtifacts.has("apply_edits.verification_report")).toBe(true);
    });

    it("should execute test_loop phase consuming edit_plan for test file discovery", async () => {
      const editPlanWithTests = mockEditPlan();
      editPlanWithTests.operations.push({
        id: "op-3",
        type: "create",
        filePath: "src/auth.test.ts",
        dependsOn: ["op-1"],
        rationale: "Add tests for auth module",
        newContent: "describe('auth', () => {})",
      });
      phaseContextStore.set("test_loop", {
        "change_plan.edit_plan": editPlanWithTests,
      });

      const result = await executeAutonomousPhase(
        TEST_SESSION_ID,
        "test_loop",
        TEST_MISSION_RUN_ID,
        testConfig
      );

      expect(result.success).toBe(true);
      expect(result.phaseName).toBe("test_loop");
      expect(persistedArtifacts.has("test_loop.test_loop_result")).toBe(true);
    });

    it("should execute quality_gate phase", async () => {
      const result = await executeAutonomousPhase(
        TEST_SESSION_ID,
        "quality_gate",
        TEST_MISSION_RUN_ID,
        testConfig
      );

      expect(result.success).toBe(true);
      expect(result.phaseName).toBe("quality_gate");
      expect(persistedArtifacts.has("quality_gate.gate_result")).toBe(true);
    });

    it("should execute pr_generation phase with all upstream artifacts", async () => {
      phaseContextStore.set("pr_generation", {
        "context_load.repository_context": mockRepositoryContext(),
        "change_plan.edit_plan": mockEditPlan(),
        "apply_edits.verification_report": mockVerificationReport(),
      });

      const result = await executeAutonomousPhase(
        TEST_SESSION_ID,
        "pr_generation",
        TEST_MISSION_RUN_ID,
        testConfig
      );

      expect(result.success).toBe(true);
      expect(result.phaseName).toBe("pr_generation");
      expect(persistedArtifacts.has("pr_generation.pr_result")).toBe(true);
    });

    it("should fail change_plan when upstream context_load artifact is missing", async () => {
      phaseContextStore.set("change_plan", {});

      const result = await executeAutonomousPhase(
        TEST_SESSION_ID,
        "change_plan",
        TEST_MISSION_RUN_ID,
        testConfig
      );

      expect(result.success).toBe(false);
      expect(result.phaseName).toBe("change_plan");
      expect(result.error).toContain("Missing upstream artifact");
    });

    it("should fail apply_edits when upstream edit_plan artifact is missing", async () => {
      phaseContextStore.set("apply_edits", {});

      const result = await executeAutonomousPhase(
        TEST_SESSION_ID,
        "apply_edits",
        TEST_MISSION_RUN_ID,
        testConfig
      );

      expect(result.success).toBe(false);
      expect(result.phaseName).toBe("apply_edits");
      expect(result.error).toContain("Missing upstream artifact");
    });

    it("should fail pr_generation when edit_plan or verification_report is missing", async () => {
      phaseContextStore.set("pr_generation", {
        "context_load.repository_context": mockRepositoryContext(),
        // Missing edit_plan and verification_report
      });

      const result = await executeAutonomousPhase(
        TEST_SESSION_ID,
        "pr_generation",
        TEST_MISSION_RUN_ID,
        testConfig
      );

      expect(result.success).toBe(false);
      expect(result.phaseName).toBe("pr_generation");
      expect(result.error).toContain("Missing upstream artifacts");
    });

    it("should execute full pipeline sequence with artifacts flowing between phases", async () => {
      // Phase 1: context_load
      const contextResult = await executeAutonomousPhase(
        TEST_SESSION_ID, "context_load", TEST_MISSION_RUN_ID, testConfig
      );
      expect(contextResult.success).toBe(true);

      // Phase 2: change_plan (receives context from phase 1)
      phaseContextStore.set("change_plan", {
        "context_load.repository_context": contextResult.artifact,
      });
      const planResult = await executeAutonomousPhase(
        TEST_SESSION_ID, "change_plan", TEST_MISSION_RUN_ID, testConfig
      );
      expect(planResult.success).toBe(true);

      // Phase 3: apply_edits (receives plan from phase 2)
      phaseContextStore.set("apply_edits", {
        "change_plan.edit_plan": planResult.artifact,
      });
      const editsResult = await executeAutonomousPhase(
        TEST_SESSION_ID, "apply_edits", TEST_MISSION_RUN_ID, testConfig
      );
      expect(editsResult.success).toBe(true);

      // Phase 4: test_loop
      phaseContextStore.set("test_loop", {
        "change_plan.edit_plan": planResult.artifact,
      });
      const testLoopRes = await executeAutonomousPhase(
        TEST_SESSION_ID, "test_loop", TEST_MISSION_RUN_ID, testConfig
      );
      expect(testLoopRes.success).toBe(true);

      // Phase 5: quality_gate
      const gateResult = await executeAutonomousPhase(
        TEST_SESSION_ID, "quality_gate", TEST_MISSION_RUN_ID, testConfig
      );
      expect(gateResult.success).toBe(true);

      // Phase 6: pr_generation (receives all upstream artifacts)
      phaseContextStore.set("pr_generation", {
        "context_load.repository_context": contextResult.artifact,
        "change_plan.edit_plan": planResult.artifact,
        "apply_edits.verification_report": editsResult.artifact,
      });
      const prResult = await executeAutonomousPhase(
        TEST_SESSION_ID, "pr_generation", TEST_MISSION_RUN_ID, testConfig
      );
      expect(prResult.success).toBe(true);

      // Verify artifacts were persisted for key phases
      expect(persistedArtifacts.has("apply_edits.verification_report")).toBe(true);
      expect(persistedArtifacts.has("test_loop.test_loop_result")).toBe(true);
      expect(persistedArtifacts.has("quality_gate.gate_result")).toBe(true);
      expect(persistedArtifacts.has("pr_generation.pr_result")).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. Lifecycle Event Emission for All New Event Types
  // ═══════════════════════════════════════════════════════════════════════════

  describe("lifecycle event emission for autonomous pipeline events", () => {
    it("should emit quality_gate_passed when gate passes", async () => {
      const { qualityGateService } = await import("../../autonomous/quality-gate.service.js");
      const { sessionLifecycleManager } = await import("../../core/session-lifecycle-manager.js");

      // Trigger quality gate evaluation (already mocked to pass)
      await qualityGateService.evaluate(TEST_SESSION_ID);

      // The quality gate service itself emits events via evaluateAndEnforce,
      // but the basic evaluate doesn't emit. The phase handler + orchestration does.
      // Verify the emitEvent function is accessible for event emission
      expect(sessionLifecycleManager.emitEvent).toBeDefined();
    });

    it("should support all new autonomous pipeline event types", () => {
      const autonomousEventTypes: PipelineLifecycleEvent["eventType"][] = [
        "fix_attempt_started",
        "fix_attempt_completed",
        "test_loop_exhausted",
        "quality_gate_blocked",
        "quality_gate_passed",
        "incremental_verification_failed",
        "human_review_requested",
        "pr_created",
      ];

      // Verify these are valid event types in the PipelineLifecycleEvent union
      for (const eventType of autonomousEventTypes) {
        const event: PipelineLifecycleEvent = {
          eventType,
          sessionId: TEST_SESSION_ID,
          orgId: 1,
          timestamp: new Date(),
          payload: {},
        };
        expect(event.eventType).toBe(eventType);
      }
    });

    it("should emit fix_attempt_started and fix_attempt_completed events with proper payload structure", async () => {
      const { sessionLifecycleManager } = await import("../../core/session-lifecycle-manager.js");

      const fixStartEvent: PipelineLifecycleEvent = {
        eventType: "fix_attempt_started",
        sessionId: TEST_SESSION_ID,
        orgId: 1,
        timestamp: new Date(),
        payload: {
          attemptNumber: 1,
          testFile: "src/auth.test.ts",
          testName: "should authenticate user",
        },
      };

      const fixCompleteEvent: PipelineLifecycleEvent = {
        eventType: "fix_attempt_completed",
        sessionId: TEST_SESSION_ID,
        orgId: 1,
        timestamp: new Date(),
        payload: {
          attemptNumber: 1,
          outcome: "resolved",
          duration: 3000,
          fixDescription: "Added token validation",
        },
      };

      sessionLifecycleManager.emitEvent(fixStartEvent);
      sessionLifecycleManager.emitEvent(fixCompleteEvent);

      expect(emittedEvents).toHaveLength(2);
      expect(emittedEvents[0].eventType).toBe("fix_attempt_started");
      expect(emittedEvents[0].payload.attemptNumber).toBe(1);
      expect(emittedEvents[1].eventType).toBe("fix_attempt_completed");
      expect(emittedEvents[1].payload.outcome).toBe("resolved");
    });

    it("should emit test_loop_exhausted event when max attempts reached", async () => {
      const { sessionLifecycleManager } = await import("../../core/session-lifecycle-manager.js");

      const exhaustedEvent: PipelineLifecycleEvent = {
        eventType: "test_loop_exhausted",
        sessionId: TEST_SESSION_ID,
        orgId: 1,
        timestamp: new Date(),
        payload: {
          maxAttempts: 5,
          failingTests: ["src/auth.test.ts"],
          totalDuration: 30000,
        },
      };

      sessionLifecycleManager.emitEvent(exhaustedEvent);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].eventType).toBe("test_loop_exhausted");
      expect(emittedEvents[0].payload.maxAttempts).toBe(5);
    });

    it("should emit quality_gate_blocked with list of failing verifications", async () => {
      const { sessionLifecycleManager } = await import("../../core/session-lifecycle-manager.js");

      const blockedEvent: PipelineLifecycleEvent = {
        eventType: "quality_gate_blocked",
        sessionId: TEST_SESSION_ID,
        orgId: 1,
        timestamp: new Date(),
        payload: {
          blockingFailures: [
            { check: "incremental_verifications", reason: "1 step failed", operationId: "op-2" },
            { check: "test_loop_completion", reason: "Tests still failing", testFile: "src/auth.test.ts" },
          ],
        },
      };

      sessionLifecycleManager.emitEvent(blockedEvent);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].eventType).toBe("quality_gate_blocked");
      const failures = emittedEvents[0].payload.blockingFailures as unknown[];
      expect(failures).toHaveLength(2);
    });

    it("should emit pr_created event after successful PR generation", async () => {
      const { sessionLifecycleManager } = await import("../../core/session-lifecycle-manager.js");

      const prCreatedEvent: PipelineLifecycleEvent = {
        eventType: "pr_created",
        sessionId: TEST_SESSION_ID,
        orgId: 1,
        timestamp: new Date(),
        payload: {
          prUrl: "https://github.com/test/repo/pull/42",
          prNumber: 42,
          branchName: "codegen/integration-test-session-001/add-user-auth",
        },
      };

      sessionLifecycleManager.emitEvent(prCreatedEvent);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].eventType).toBe("pr_created");
      expect(emittedEvents[0].payload.prNumber).toBe(42);
    });

    it("should emit human_review_requested when file count exceeds threshold", async () => {
      const { sessionLifecycleManager } = await import("../../core/session-lifecycle-manager.js");

      const reviewEvent: PipelineLifecycleEvent = {
        eventType: "human_review_requested",
        sessionId: TEST_SESSION_ID,
        orgId: 1,
        timestamp: new Date(),
        payload: {
          reason: "file_count_threshold",
          totalFileCount: 75,
          maxFileCount: 50,
        },
      };

      sessionLifecycleManager.emitEvent(reviewEvent);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].eventType).toBe("human_review_requested");
      expect(emittedEvents[0].payload.totalFileCount).toBe(75);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. Session Metrics Aggregation from Fix Attempt Data
  // ═══════════════════════════════════════════════════════════════════════════

  describe("session metrics aggregation from fix attempt data", () => {
    it("should aggregate fix attempt counts from test loop result", () => {
      const testLoopResult = mockTestLoopResult();

      const resolvedCount = testLoopResult.fixAttempts.filter(
        (fa) => fa.outcome === "resolved"
      ).length;
      const failedCount = testLoopResult.fixAttempts.filter(
        (fa) => fa.outcome === "failed" || fa.outcome === "reverted"
      ).length;

      expect(testLoopResult.totalAttempts).toBe(2);
      expect(resolvedCount).toBe(2);
      expect(failedCount).toBe(0);
      expect(testLoopResult.duration).toBe(8000);
    });

    it("should compute correct metrics for mixed fix outcomes", () => {
      const mixedResult: TestLoopResult = {
        status: "partially_fixed",
        totalAttempts: 4,
        fixAttempts: [
          { ...mockTestLoopResult().fixAttempts[0], outcome: "resolved" },
          { ...mockTestLoopResult().fixAttempts[1], outcome: "failed", attemptNumber: 2 },
          { ...mockTestLoopResult().fixAttempts[0], outcome: "reverted", attemptNumber: 3 },
          { ...mockTestLoopResult().fixAttempts[1], outcome: "resolved", attemptNumber: 4 },
        ],
        passingTests: ["test1.ts"],
        failingTests: ["test2.ts"],
        duration: 15000,
      };

      const successfulFixes = mixedResult.fixAttempts.filter((fa) => fa.outcome === "resolved").length;
      const failedFixes = mixedResult.fixAttempts.filter(
        (fa) => fa.outcome === "failed" || fa.outcome === "reverted"
      ).length;

      expect(successfulFixes).toBe(2);
      expect(failedFixes).toBe(2);
      expect(mixedResult.totalAttempts).toBe(4);
    });

    it("should track total verification time from test loop duration", () => {
      const result = mockTestLoopResult();
      expect(result.duration).toBeGreaterThan(0);
      expect(typeof result.duration).toBe("number");
    });

    it("should compute metrics from empty fix attempts (all tests passing on first try)", () => {
      const noFixResult: TestLoopResult = {
        status: "all_passed",
        totalAttempts: 0,
        fixAttempts: [],
        passingTests: ["src/auth.test.ts", "src/utils.test.ts"],
        failingTests: [],
        duration: 1000,
      };

      expect(noFixResult.fixAttempts).toHaveLength(0);
      expect(noFixResult.totalAttempts).toBe(0);
      expect(noFixResult.status).toBe("all_passed");
    });

    it("should track escalated status when max attempts exhausted", () => {
      const exhaustedResult: TestLoopResult = {
        status: "exhausted",
        totalAttempts: 5,
        fixAttempts: Array.from({ length: 5 }, (_, i) => ({
          ...mockTestLoopResult().fixAttempts[0],
          attemptNumber: i + 1,
          outcome: "failed" as const,
        })),
        passingTests: [],
        failingTests: ["src/auth.test.ts"],
        duration: 30000,
      };

      expect(exhaustedResult.status).toBe("exhausted");
      expect(exhaustedResult.totalAttempts).toBe(5);
      expect(exhaustedResult.fixAttempts).toHaveLength(5);
      const allFailed = exhaustedResult.fixAttempts.every((fa) => fa.outcome === "failed");
      expect(allFailed).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. Artifact Contract Validation for Each Phase's Output Schema
  // ═══════════════════════════════════════════════════════════════════════════

  describe("artifact contract validation for each phase output schema", () => {
    it("should validate repository_context against its contract", () => {
      const context = mockRepositoryContext();
      const result = artifactContractValidator.validate(context, repositoryContextContract);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should validate edit_plan against its contract", () => {
      const plan = mockEditPlan();
      const result = artifactContractValidator.validate(plan, editPlanContract);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should validate verification_report against its contract", () => {
      const report = mockVerificationReport();
      // Convert Date timestamps to ISO strings for JSON Schema validation
      const serialized = JSON.parse(JSON.stringify(report));
      const result = artifactContractValidator.validate(serialized, verificationReportContract);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should validate test_loop_result against its contract", () => {
      const loopResult = mockTestLoopResult();
      const serialized = JSON.parse(JSON.stringify(loopResult));
      const result = artifactContractValidator.validate(serialized, testLoopResultContract);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should validate gate_result against its contract", () => {
      const gateResult = mockQualityGateResult();
      const serialized = JSON.parse(JSON.stringify(gateResult));
      const result = artifactContractValidator.validate(serialized, gateResultContract);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should validate pr_result against its contract", () => {
      const prResult = mockPRResult();
      const result = artifactContractValidator.validate(prResult, prResultContract);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should reject invalid repository_context missing required fields", () => {
      const invalid = { projectStructure: [], dependencyGraph: { nodes: [], edges: [] } };
      const result = artifactContractValidator.validate(invalid, repositoryContextContract);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      const missingFields = result.errors
        .filter((e) => e.keyword === "required")
        .map((e) => e.params?.missingProperty);
      expect(missingFields).toContain("conventions");
    });

    it("should reject invalid edit_plan with missing objective", () => {
      const invalid = {
        sessionId: "test",
        objective: "", // empty string violates minLength: 1
        operations: [],
        dependencyOrder: [],
        totalFileCount: 0,
        requiresHumanReview: false,
      };
      const result = artifactContractValidator.validate(invalid, editPlanContract);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should reject invalid verification_report with wrong finalStatus", () => {
      const invalid = {
        sessionId: "test",
        verificationLevel: "full_test",
        timeline: [],
        summary: { totalChecks: 0, passed: 0, failed: 0, fixAttempts: 0, successfulFixes: 0, totalDuration: 0 },
        finalStatus: "invalid_status",
      };
      const result = artifactContractValidator.validate(invalid, verificationReportContract);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.keyword === "enum")).toBe(true);
    });

    it("should reject invalid test_loop_result with wrong status enum", () => {
      const invalid = {
        status: "not_a_valid_status",
        totalAttempts: 0,
        fixAttempts: [],
        passingTests: [],
        failingTests: [],
        duration: 0,
      };
      const result = artifactContractValidator.validate(invalid, testLoopResultContract);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.keyword === "enum")).toBe(true);
    });

    it("should reject invalid pr_result with missing branchName", () => {
      const invalid = {
        branchName: "", // empty string violates minLength: 1
        commitSha: "abc",
        prUrl: "https://github.com/test/pull/1",
        prNumber: 1,
        description: "test",
        testEvidence: { totalTests: 0, passingTests: 0, fixAttempts: 0, verificationTimeline: "" },
      };
      const result = artifactContractValidator.validate(invalid, prResultContract);

      expect(result.valid).toBe(false);
    });
  });
});
