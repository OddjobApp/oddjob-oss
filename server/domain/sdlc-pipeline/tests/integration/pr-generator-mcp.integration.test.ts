/**
 * Integration test: PR Generator MCP tool invocation
 *
 * Validates that the PR Generator correctly invokes MCP git tools
 * for branch creation, commit, push, and PR opening, and handles
 * failures gracefully when MCP tools are unavailable.
 *
 * Validates: Requirements 5.1, 5.6
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { prGeneratorService } from "../../autonomous/pr-generator.service.js";
import type { GitToolProvider } from "../../autonomous/pr-generator.service.js";
import type {
  EditPlan,
  FileOperation,
  VerificationReport,
  DetectedConventions,
} from "../../core/types.js";

// ─── Test Helpers ───────────────────────────────────────────────────────────

function makeEditPlan(overrides: Partial<EditPlan> = {}): EditPlan {
  return {
    sessionId: "session-abc12345",
    objective: "Add user authentication module",
    operations: [
      {
        id: "op-1",
        type: "create",
        filePath: "src/auth/auth.service.ts",
        dependsOn: [],
        rationale: "New service for user authentication",
        newContent: 'export class AuthService { /* ... */ }',
      },
      {
        id: "op-2",
        type: "modify",
        filePath: "src/app.module.ts",
        dependsOn: ["op-1"],
        rationale: "Register the new auth module",
        changes: [
          {
            startLine: 5,
            endLine: 5,
            originalCode: "imports: []",
            newCode: "imports: [AuthModule]",
            contextLines: 2,
          },
        ],
      },
    ],
    dependencyOrder: ["op-1", "op-2"],
    totalFileCount: 2,
    requiresHumanReview: false,
    ...overrides,
  };
}

function makeVerificationReport(
  overrides: Partial<VerificationReport> = {}
): VerificationReport {
  return {
    sessionId: "session-abc12345",
    verificationLevel: "full_test",
    timeline: [],
    summary: {
      totalChecks: 10,
      passed: 10,
      failed: 0,
      fixAttempts: 1,
      successfulFixes: 1,
      totalDuration: 5000,
    },
    finalStatus: "all_passed",
    ...overrides,
  };
}

function makeConventions(
  overrides: Partial<DetectedConventions> = {}
): DetectedConventions {
  return {
    namingPatterns: [],
    formattingRules: [],
    architecturalPatterns: ["service-layer"],
    testingConventions: [],
    ...overrides,
  };
}

function createMockGitToolProvider(): GitToolProvider & {
  createBranch: ReturnType<typeof vi.fn>;
  commitFiles: ReturnType<typeof vi.fn>;
  pushBranch: ReturnType<typeof vi.fn>;
  openPullRequest: ReturnType<typeof vi.fn>;
} {
  return {
    createBranch: vi.fn().mockResolvedValue({ success: true }),
    commitFiles: vi.fn().mockResolvedValue({ sha: "abc123def456" }),
    pushBranch: vi.fn().mockResolvedValue({ success: true }),
    openPullRequest: vi.fn().mockResolvedValue({
      url: "https://github.com/org/repo/pull/42",
      number: 42,
    }),
  };
}

// ─── Integration Tests ──────────────────────────────────────────────────────

describe("PR Generator — MCP Tool Invocation (Integration)", () => {
  let mockGitTools: ReturnType<typeof createMockGitToolProvider>;
  let editPlan: EditPlan;
  let verificationReport: VerificationReport;
  let conventions: DetectedConventions;

  beforeEach(() => {
    mockGitTools = createMockGitToolProvider();
    editPlan = makeEditPlan();
    verificationReport = makeVerificationReport();
    conventions = makeConventions();
  });

  // ─── Branch Creation ────────────────────────────────────────────────────

  describe("Branch creation (Requirement 5.1)", () => {
    it("should invoke createBranch with the generated branch name and base branch", async () => {
      await prGeneratorService.generatePR(
        "session-abc12345",
        editPlan,
        verificationReport,
        conventions,
        { gitTools: mockGitTools, baseBranch: "main" }
      );

      expect(mockGitTools.createBranch).toHaveBeenCalledTimes(1);
      const [branchName, baseBranch] = mockGitTools.createBranch.mock.calls[0];

      // Branch name should contain session ID prefix and objective slug
      expect(branchName).toContain("session-");
      expect(branchName).toContain("add-user-authentication-module");
      expect(baseBranch).toBe("main");
    });

    it("should use a custom base branch when specified", async () => {
      await prGeneratorService.generatePR(
        "session-abc12345",
        editPlan,
        verificationReport,
        conventions,
        { gitTools: mockGitTools, baseBranch: "develop" }
      );

      const [, baseBranch] = mockGitTools.createBranch.mock.calls[0];
      expect(baseBranch).toBe("develop");
    });
  });

  // ─── Commit ─────────────────────────────────────────────────────────────

  describe("Commit (Requirement 5.1)", () => {
    it("should invoke commitFiles with file changes and a structured commit message containing the objective", async () => {
      await prGeneratorService.generatePR(
        "session-abc12345",
        editPlan,
        verificationReport,
        conventions,
        { gitTools: mockGitTools }
      );

      expect(mockGitTools.commitFiles).toHaveBeenCalledTimes(1);
      const [branchName, files, message] = mockGitTools.commitFiles.mock.calls[0];

      // Branch name matches what was created
      expect(branchName).toContain("session-");

      // Files include all operations from the edit plan
      expect(files).toHaveLength(2);
      expect(files[0]).toMatchObject({
        path: "src/auth/auth.service.ts",
        operation: "create",
      });
      expect(files[1]).toMatchObject({
        path: "src/app.module.ts",
        operation: "modify",
      });

      // Commit message contains the objective
      expect(message).toContain("Add user authentication module");
    });
  });

  // ─── Push ───────────────────────────────────────────────────────────────

  describe("Push (Requirement 5.6)", () => {
    it("should invoke pushBranch with the correct branch name", async () => {
      await prGeneratorService.generatePR(
        "session-abc12345",
        editPlan,
        verificationReport,
        conventions,
        { gitTools: mockGitTools }
      );

      expect(mockGitTools.pushBranch).toHaveBeenCalledTimes(1);
      const [branchName] = mockGitTools.pushBranch.mock.calls[0];

      // Branch name should match what was created
      expect(branchName).toContain("session-");
      expect(branchName).toContain("add-user-authentication-module");
    });
  });

  // ─── PR Opening ────────────────────────────────────────────────────────

  describe("PR opening (Requirement 5.6)", () => {
    it("should invoke openPullRequest with correct title, body, head, and base", async () => {
      await prGeneratorService.generatePR(
        "session-abc12345",
        editPlan,
        verificationReport,
        conventions,
        { gitTools: mockGitTools, baseBranch: "main" }
      );

      expect(mockGitTools.openPullRequest).toHaveBeenCalledTimes(1);
      const params = mockGitTools.openPullRequest.mock.calls[0][0];

      // Title includes the objective
      expect(params.title).toContain("Add user authentication module");
      // Body is the PR description
      expect(params.body).toContain("Objective");
      expect(params.body).toContain("Add user authentication module");
      expect(params.body).toContain("Changes Summary");
      expect(params.body).toContain("Test Results");
      // Head is the generated branch
      expect(params.head).toContain("session-");
      expect(params.head).toContain("add-user-authentication-module");
      // Base is the target branch
      expect(params.base).toBe("main");
    });
  });

  // ─── Failure Handling ───────────────────────────────────────────────────

  describe("Failure handling when MCP tools are unavailable", () => {
    it("should throw when createBranch fails", async () => {
      mockGitTools.createBranch.mockResolvedValue({ success: false });

      await expect(
        prGeneratorService.generatePR(
          "session-abc12345",
          editPlan,
          verificationReport,
          conventions,
          { gitTools: mockGitTools }
        )
      ).rejects.toThrow(/failed to create branch/i);

      // Subsequent operations should NOT be called
      expect(mockGitTools.commitFiles).not.toHaveBeenCalled();
      expect(mockGitTools.pushBranch).not.toHaveBeenCalled();
      expect(mockGitTools.openPullRequest).not.toHaveBeenCalled();
    });

    it("should throw when pushBranch fails", async () => {
      mockGitTools.pushBranch.mockResolvedValue({ success: false });

      await expect(
        prGeneratorService.generatePR(
          "session-abc12345",
          editPlan,
          verificationReport,
          conventions,
          { gitTools: mockGitTools }
        )
      ).rejects.toThrow(/failed to push branch/i);

      // PR should NOT be opened after push failure
      expect(mockGitTools.openPullRequest).not.toHaveBeenCalled();
    });

    it("should propagate errors when openPullRequest rejects", async () => {
      mockGitTools.openPullRequest.mockRejectedValue(
        new Error("MCP tool unavailable: git_create_pr")
      );

      await expect(
        prGeneratorService.generatePR(
          "session-abc12345",
          editPlan,
          verificationReport,
          conventions,
          { gitTools: mockGitTools }
        )
      ).rejects.toThrow("MCP tool unavailable: git_create_pr");
    });
  });

  // ─── Full Flow ──────────────────────────────────────────────────────────

  describe("Full flow — all MCP operations called in sequence", () => {
    it("should invoke create → commit → push → open in order", async () => {
      const callOrder: string[] = [];

      mockGitTools.createBranch.mockImplementation(async () => {
        callOrder.push("createBranch");
        return { success: true };
      });
      mockGitTools.commitFiles.mockImplementation(async () => {
        callOrder.push("commitFiles");
        return { sha: "full-flow-sha" };
      });
      mockGitTools.pushBranch.mockImplementation(async () => {
        callOrder.push("pushBranch");
        return { success: true };
      });
      mockGitTools.openPullRequest.mockImplementation(async () => {
        callOrder.push("openPullRequest");
        return { url: "https://github.com/org/repo/pull/99", number: 99 };
      });

      const result = await prGeneratorService.generatePR(
        "session-abc12345",
        editPlan,
        verificationReport,
        conventions,
        { gitTools: mockGitTools }
      );

      // All operations called exactly once
      expect(callOrder).toEqual([
        "createBranch",
        "commitFiles",
        "pushBranch",
        "openPullRequest",
      ]);

      // Result is correctly populated
      expect(result.branchName).toContain("add-user-authentication-module");
      expect(result.commitSha).toBe("full-flow-sha");
      expect(result.prUrl).toBe("https://github.com/org/repo/pull/99");
      expect(result.prNumber).toBe(99);
      expect(result.description).toContain("Objective");
      expect(result.testEvidence.totalTests).toBe(10);
      expect(result.testEvidence.passingTests).toBe(10);
    });

    it("should return a complete PRResult with test evidence", async () => {
      const report = makeVerificationReport({
        summary: {
          totalChecks: 25,
          passed: 23,
          failed: 2,
          fixAttempts: 3,
          successfulFixes: 2,
          totalDuration: 12000,
        },
      });

      const result = await prGeneratorService.generatePR(
        "session-abc12345",
        editPlan,
        report,
        conventions,
        { gitTools: mockGitTools }
      );

      expect(result.testEvidence).toMatchObject({
        totalTests: 25,
        passingTests: 23,
        fixAttempts: 3,
      });
    });
  });
});
