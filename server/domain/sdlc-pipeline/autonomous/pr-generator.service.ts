/**
 * PR Generator Service
 *
 * Creates branches, commits changes, and opens pull requests via existing
 * MCP git tools. Responsible for:
 *   - Generating a branch name from session ID + objective slug
 *   - Creating a branch from the target repository's default branch
 *   - Committing all file changes with a structured commit message
 *   - Pushing the branch and opening a PR with description including:
 *     objective, changes summary, test results, verification report reference
 *
 * Uses a pluggable GitToolProvider interface for all git operations,
 * enabling testability and integration with the existing MCP tool registry.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.6
 */

import { createLogger } from "@server/utils/logger.js";
import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";
import { GITHUB_TOOLS } from "@domain/tools/v1/capabilities/github.js";
import { GIT_WORKSPACE_TOOLS } from "@domain/tools/v1/capabilities/git-workspace.js";
import type { ToolContext } from "@domain/tools/v1/capabilities/types.js";
import { artifactRegistryService } from "../core/artifact-registry.service.js";
import { sessionLifecycleManager } from "../core/session-lifecycle-manager.js";
import type {
  EditPlan,
  FileOperation,
  VerificationReport,
  DetectedConventions,
  PRResult,
  QualityGateResult,
  TestEvidence,
  PipelineLifecycleEvent,
} from "../core/types.js";

const logger = createLogger("PRGenerator");
const exec = promisify(execCallback);

// ─── Git Tool Provider Interface ────────────────────────────────────────────

/**
 * Abstraction over MCP git tools. Each method maps to an MCP tool invocation.
 * Implementations can delegate to the MCP tool registry or provide stubs for testing.
 */
export interface GitToolProvider {
  /** Create a new branch from a base branch */
  createBranch(branchName: string, baseBranch: string): Promise<{ success: boolean }>;

  /** Commit a set of file changes with a structured message */
  commitFiles(
    branchName: string,
    files: Array<{ path: string; content: string; operation: "create" | "modify" | "delete" }>,
    message: string
  ): Promise<{ sha: string }>;

  /** Push a branch to the remote */
  pushBranch(branchName: string): Promise<{ success: boolean }>;

  /** Open a pull request targeting the base branch */
  openPullRequest(params: {
    title: string;
    body: string;
    head: string;
    base: string;
  }): Promise<{ url: string; number: number }>;
}

export interface RepoBackedGitToolProviderOptions {
  orgId?: number;
  repoUrl?: string;
}

// ─── Repo-backed Git Tool Provider ──────────────────────────────────────────
function createToolContext(orgId?: number): ToolContext {
  // This context is handed to the git workspace tools, and the tool layer reads
  // organizationId from it for governance and guardrail checks as well as for
  // scoping. Defaulting to org 1 meant an unattributed provider ran tools, and
  // was policy-checked, as the first tenant. Refuse instead.
  if (orgId == null) {
    throw new Error(
      "Cannot build a git tool context without an organization: pass orgId to createRepoBackedGitToolProvider",
    );
  }
  return {
    organizationId: orgId,
    named: {},
    positional: {},
  };
}

function assertToolSuccess(toolName: string, result: unknown): string {
  const text = typeof result === "string" ? result : JSON.stringify(result);
  if (/^Error\b/i.test(text) || /"error"\s*:/i.test(text)) {
    throw new Error(`${toolName} failed: ${text}`);
  }
  return text;
}

function parseRepoSlug(repoUrl: string): { owner: string; repo: string } {
  const match = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.#?]+)/i);
  if (!match) {
    throw new Error(`Cannot parse GitHub owner/repo from remote URL: ${repoUrl}`);
  }
  return { owner: match[1], repo: match[2].replace(/\.git$/i, "") };
}

async function resolveGitRemoteUrl(explicitRepoUrl?: string): Promise<string> {
  if (explicitRepoUrl) return explicitRepoUrl;
  if (process.env.GIT_REPO_URL) return process.env.GIT_REPO_URL;

  const { stdout } = await exec("git config --get remote.origin.url", {
    cwd: process.env.GIT_WORKSPACE_ROOT || process.cwd(),
    timeout: 10_000,
  });
  const remoteUrl = stdout.trim();
  if (!remoteUrl) throw new Error("No git remote URL found for PR creation.");
  return remoteUrl;
}

export function createRepoBackedGitToolProvider(
  options: RepoBackedGitToolProviderOptions = {}
): GitToolProvider {
  const context = createToolContext(options.orgId);

  return {
    async createBranch(branchName: string, baseBranch: string) {
      const result = await GIT_WORKSPACE_TOOLS.git_create_branch.execute(
        { branch_name: branchName, base_branch: baseBranch },
        context
      );
      assertToolSuccess("git_create_branch", result);
      return { success: true };
    },

    async commitFiles(_branchName, files, message) {
      const paths = files.map((file) => file.path);
      const result = await GIT_WORKSPACE_TOOLS.git_commit.execute(
        { message, files: paths.length > 0 ? paths : undefined },
        context
      );
      assertToolSuccess("git_commit", result);

      const shaResult = await GIT_WORKSPACE_TOOLS.workspace_run_command.execute(
        { command: "git rev-parse HEAD", timeout_ms: 10_000 },
        context
      );
      const shaOutput = assertToolSuccess("workspace_run_command", shaResult);
      const sha = shaOutput.match(/\b[0-9a-f]{40}\b/i)?.[0] ?? "unknown";
      return { sha };
    },

    async pushBranch(_branchName: string) {
      const result = await GIT_WORKSPACE_TOOLS.git_push.execute({ force: false }, context);
      assertToolSuccess("git_push", result);
      return { success: true };
    },

    async openPullRequest(params) {
      const repoUrl = await resolveGitRemoteUrl(options.repoUrl);
      const { owner, repo } = parseRepoSlug(repoUrl);
      const result = await GITHUB_TOOLS.github_create_pr.execute(
        {
          owner,
          repo,
          title: params.title,
          body: params.body,
          head: params.head,
          base: params.base,
        },
        context
      );
      const text = assertToolSuccess("github_create_pr", result);
      const parsed = JSON.parse(text);
      return {
        url: parsed.url,
        number: parsed.number,
      };
    },
  };
}

// ─── Branch Name Generation ─────────────────────────────────────────────────

/**
 * Generates a branch name from the session ID and objective.
 * If a branchNaming convention is provided, applies it as a pattern.
 * Default pattern: `codegen/{session-id}/{objective-slug}`
 */
export function generateBranchName(
  sessionId: string,
  objective: string,
  branchNamingPattern?: string
): string {
  const slug = objective
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);

  // Use short session ID for readability
  const shortSessionId = sessionId.slice(0, 8);

  if (branchNamingPattern) {
    return branchNamingPattern
      .replace("{session-id}", shortSessionId)
      .replace("{objective-slug}", slug);
  }

  return `codegen/${shortSessionId}/${slug}`;
}

// ─── Commit Message Generation ──────────────────────────────────────────────

/**
 * Builds a structured commit message containing the session objective
 * and a summary of changes.
 *
 * Validates: Requirement 5.2
 */
export function buildCommitMessage(
  objective: string,
  operations: FileOperation[]
): string {
  const createdFiles = operations.filter((op) => op.type === "create");
  const modifiedFiles = operations.filter((op) => op.type === "modify");
  const deletedFiles = operations.filter((op) => op.type === "delete");

  const lines: string[] = [];

  // Subject line (first line) — concise summary
  const subjectSlug = objective.slice(0, 72);
  lines.push(`feat: ${subjectSlug}`);
  lines.push("");

  // Body — objective and changes summary
  lines.push(`Objective: ${objective}`);
  lines.push("");
  lines.push("Changes:");

  if (createdFiles.length > 0) {
    lines.push(`  - Created ${createdFiles.length} file(s)`);
    for (const op of createdFiles.slice(0, 10)) {
      lines.push(`    + ${op.filePath}`);
    }
    if (createdFiles.length > 10) {
      lines.push(`    ... and ${createdFiles.length - 10} more`);
    }
  }

  if (modifiedFiles.length > 0) {
    lines.push(`  - Modified ${modifiedFiles.length} file(s)`);
    for (const op of modifiedFiles.slice(0, 10)) {
      lines.push(`    ~ ${op.filePath}`);
    }
    if (modifiedFiles.length > 10) {
      lines.push(`    ... and ${modifiedFiles.length - 10} more`);
    }
  }

  if (deletedFiles.length > 0) {
    lines.push(`  - Deleted ${deletedFiles.length} file(s)`);
    for (const op of deletedFiles.slice(0, 10)) {
      lines.push(`    - ${op.filePath}`);
    }
    if (deletedFiles.length > 10) {
      lines.push(`    ... and ${deletedFiles.length - 10} more`);
    }
  }

  lines.push("");
  lines.push(`Total: ${operations.length} operation(s)`);

  return lines.join("\n");
}

// ─── PR Description Generation ──────────────────────────────────────────────

/**
 * Builds a PR description containing:
 * - Original objective
 * - Summary of changes made
 * - Test results summary
 * - Reference to the full verification report
 *
 * If a PR template convention is detected, the description conforms to
 * that template structure.
 *
 * Validates: Requirement 5.3, 5.5
 */
export function buildPRDescription(
  objective: string,
  operations: FileOperation[],
  verificationReport: VerificationReport,
  conventions: DetectedConventions
): string {
  const sections: string[] = [];

  // If a PR template is detected, use it as the structure
  if (conventions.prTemplate) {
    sections.push(conventions.prTemplate);
    sections.push("");
    sections.push("---");
    sections.push("");
  }

  // Section: Objective
  sections.push("## Objective");
  sections.push("");
  sections.push(objective);
  sections.push("");

  // Section: Changes Summary
  sections.push("## Changes Summary");
  sections.push("");

  const createdFiles = operations.filter((op) => op.type === "create");
  const modifiedFiles = operations.filter((op) => op.type === "modify");
  const deletedFiles = operations.filter((op) => op.type === "delete");

  if (createdFiles.length > 0) {
    sections.push(`### Created (${createdFiles.length})`);
    for (const op of createdFiles) {
      sections.push(`- \`${op.filePath}\` — ${op.rationale.slice(0, 100)}`);
    }
    sections.push("");
  }

  if (modifiedFiles.length > 0) {
    sections.push(`### Modified (${modifiedFiles.length})`);
    for (const op of modifiedFiles) {
      sections.push(`- \`${op.filePath}\` — ${op.rationale.slice(0, 100)}`);
    }
    sections.push("");
  }

  if (deletedFiles.length > 0) {
    sections.push(`### Deleted (${deletedFiles.length})`);
    for (const op of deletedFiles) {
      sections.push(`- \`${op.filePath}\` — ${op.rationale.slice(0, 100)}`);
    }
    sections.push("");
  }

  // Section: Test Results
  sections.push("## Test Results");
  sections.push("");

  const { summary } = verificationReport;
  const passRate =
    summary.totalChecks > 0
      ? ((summary.passed / summary.totalChecks) * 100).toFixed(1)
      : "N/A";

  sections.push(`| Metric | Value |`);
  sections.push(`|--------|-------|`);
  sections.push(`| Total Checks | ${summary.totalChecks} |`);
  sections.push(`| Passed | ${summary.passed} |`);
  sections.push(`| Failed | ${summary.failed} |`);
  sections.push(`| Pass Rate | ${passRate}% |`);
  sections.push(`| Fix Attempts | ${summary.fixAttempts} |`);
  sections.push(`| Successful Fixes | ${summary.successfulFixes} |`);
  sections.push(`| Verification Duration | ${(summary.totalDuration / 1000).toFixed(1)}s |`);
  sections.push("");

  // Section: Verification Report Reference
  sections.push("## Verification Report");
  sections.push("");
  sections.push(
    `Final status: **${verificationReport.finalStatus}** (level: \`${verificationReport.verificationLevel}\`)`
  );
  sections.push("");
  sections.push(
    `Session: \`${verificationReport.sessionId}\` — ` +
      `${verificationReport.timeline.length} verification event(s) recorded.`
  );
  sections.push("");

  return sections.join("\n");
}

// ─── Test Evidence Generation ───────────────────────────────────────────────

/**
 * Extracts test evidence from the verification report for the PRResult.
 */
function buildTestEvidence(report: VerificationReport): TestEvidence {
  const timelineLines: string[] = [];

  // Build a markdown summary of the verification timeline
  for (const event of report.timeline.slice(0, 20)) {
    const ts =
      event.timestamp instanceof Date
        ? event.timestamp.toISOString()
        : String(event.timestamp);
    const icon = event.status === "passed" ? "✅" : event.status === "failed" ? "❌" : "⏭️";
    timelineLines.push(
      `${icon} [${ts}] ${event.type}${event.operationId ? ` (${event.operationId})` : ""}: ${event.status}`
    );
  }

  if (report.timeline.length > 20) {
    timelineLines.push(`... and ${report.timeline.length - 20} more event(s)`);
  }

  return {
    totalTests: report.summary.totalChecks,
    passingTests: report.summary.passed,
    fixAttempts: report.summary.fixAttempts,
    verificationTimeline: timelineLines.join("\n"),
  };
}

// ─── File Changes Extraction ────────────────────────────────────────────────

/**
 * Extracts file change entries from the edit plan for committing.
 */
function extractFileChanges(
  operations: FileOperation[]
): Array<{ path: string; content: string; operation: "create" | "modify" | "delete" }> {
  return operations.map((op) => {
    let content = "";

    if (op.type === "create" && op.newContent) {
      content = op.newContent;
    } else if (op.type === "modify" && op.changes && op.changes.length > 0) {
      // For modify, provide the new code from all changes
      content = op.changes.map((c) => c.newCode).join("\n");
    }

    return {
      path: op.filePath,
      content,
      operation: op.type,
    };
  });
}

// ─── Main PR Generation Method ──────────────────────────────────────────────

/**
 * Generates a complete PR from a completed generation session.
 *
 * Steps:
 * 1. Generate branch name from session ID + objective slug
 * 2. Create the branch from the target repository's default branch
 * 3. Commit all file operations with a structured commit message
 * 4. Push the branch to the remote
 * 5. Open a PR with a description including objective, changes, test results
 * 6. Return PRResult
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.6
 */
async function generatePR(
  sessionId: string,
  editPlan: EditPlan,
  verificationReport: VerificationReport,
  conventions: DetectedConventions,
  options?: {
    gitTools?: GitToolProvider;
    baseBranch?: string;
    orgId?: number;
    repoUrl?: string;
  }
): Promise<PRResult> {
  const gitTools = options?.gitTools ?? createRepoBackedGitToolProvider({
    orgId: options?.orgId,
    repoUrl: options?.repoUrl,
  });
  const baseBranch = options?.baseBranch ?? "main";

  logger.info(`Generating PR for session ${sessionId}`, {
    objective: editPlan.objective.slice(0, 80),
    operationCount: editPlan.operations.length,
    baseBranch,
  });

  // Step 1: Generate branch name
  const branchName = generateBranchName(
    sessionId,
    editPlan.objective,
    conventions.branchNaming
  );
  logger.info(`Branch name: ${branchName}`);

  // Step 2: Create branch from default branch (Requirement 5.1)
  const createResult = await gitTools.createBranch(branchName, baseBranch);
  if (!createResult.success) {
    throw new Error(`Failed to create branch "${branchName}" from "${baseBranch}"`);
  }
  logger.info(`Branch created: ${branchName} from ${baseBranch}`);

  // Step 3: Commit all file changes with structured message (Requirement 5.2)
  const commitMessage = buildCommitMessage(editPlan.objective, editPlan.operations);
  const fileChanges = extractFileChanges(editPlan.operations);

  const commitResult = await gitTools.commitFiles(branchName, fileChanges, commitMessage);
  logger.info(`Committed changes: sha=${commitResult.sha}`);

  // Step 4: Push the branch
  const pushResult = await gitTools.pushBranch(branchName);
  if (!pushResult.success) {
    throw new Error(`Failed to push branch "${branchName}"`);
  }
  logger.info(`Branch pushed: ${branchName}`);

  // Step 5: Open PR with structured description (Requirement 5.3)
  const prDescription = buildPRDescription(
    editPlan.objective,
    editPlan.operations,
    verificationReport,
    conventions
  );

  const prTitle = `[Codegen] ${editPlan.objective.slice(0, 72)}`;

  const prResult = await gitTools.openPullRequest({
    title: prTitle,
    body: prDescription,
    head: branchName,
    base: baseBranch,
  });
  logger.info(`PR opened: ${prResult.url} (#${prResult.number})`);

  // Step 6: Build test evidence and return PRResult
  const testEvidence = buildTestEvidence(verificationReport);

  const result: PRResult = {
    branchName,
    commitSha: commitResult.sha,
    prUrl: prResult.url,
    prNumber: prResult.number,
    description: prDescription,
    testEvidence,
  };

  logger.info(`PR generation complete for session ${sessionId}`, {
    branchName: result.branchName,
    prNumber: result.prNumber,
    prUrl: result.prUrl,
  });

  // Emit pr_created lifecycle event (Requirement 9.5)
  const prCreatedEvent: PipelineLifecycleEvent = {
    eventType: "pr_created",
    sessionId,
    orgId: 0,
    timestamp: new Date(),
    payload: {
      branchName: result.branchName,
      prNumber: result.prNumber,
      prUrl: result.prUrl,
    },
  };
  sessionLifecycleManager.emitEvent(prCreatedEvent);

  return result;
}

// ─── PR Failure Report ──────────────────────────────────────────────────────

/**
 * Structure for the failure report persisted when the quality gate blocks PR generation.
 */
export interface PRFailureReport {
  sessionId: string;
  reason: "quality_gate_failed";
  evaluatedAt: Date;
  blockingFailures: Array<{
    check: string;
    reason: string;
    operationId?: string;
    testFile?: string;
  }>;
  unresolvedVerifications: Array<{
    type: string;
    operationId?: string;
    status: string;
    details: Record<string, unknown>;
  }>;
  summary: string;
}

/**
 * Result of generatePROrReport — either a successful PR or a persisted failure report.
 */
export type PROrReportResult =
  | { outcome: "pr_created"; pr: PRResult }
  | { outcome: "failure_report_persisted"; report: PRFailureReport };

// ─── PR Generation with Gate Check ─────────────────────────────────────────

/**
 * Generates a PR if the quality gate passed, or persists a failure report
 * explaining unresolved verifications if the gate failed.
 *
 * This is the primary entry point for the PR generation phase, handling
 * the branching logic dictated by Requirements 5.4 and 5.5.
 *
 * Validates: Requirements 5.4, 5.5
 */
async function generatePROrReport(
  sessionId: string,
  editPlan: EditPlan,
  verificationReport: VerificationReport,
  gateResult: QualityGateResult,
  conventions: DetectedConventions,
  options?: {
    gitTools?: GitToolProvider;
    baseBranch?: string;
    missionRunId?: number;
    orgId?: number;
    repoUrl?: string;
  }
): Promise<PROrReportResult> {
  // Requirement 5.4: If quality gate fails, do NOT create PR
  if (!gateResult.passed) {
    logger.warn(
      `Quality gate failed for session ${sessionId}. PR will NOT be created.`,
      { blockingFailures: gateResult.blockingFailures.length }
    );

    // Build unresolved verifications from the verification report timeline
    const unresolvedVerifications = verificationReport.timeline
      .filter((event) => event.status === "failed")
      .map((event) => ({
        type: event.type,
        operationId: event.operationId,
        status: event.status,
        details: event.details,
      }));

    const failureReport: PRFailureReport = {
      sessionId,
      reason: "quality_gate_failed",
      evaluatedAt: gateResult.evaluatedAt,
      blockingFailures: gateResult.blockingFailures.map((f) => ({
        check: f.check,
        reason: f.reason,
        operationId: f.operationId,
        testFile: f.testFile,
      })),
      unresolvedVerifications,
      summary:
        `PR generation blocked: ${gateResult.blockingFailures.length} quality check(s) failed. ` +
        `${unresolvedVerifications.length} verification(s) remain unresolved. ` +
        `Fix attempts: ${verificationReport.summary.fixAttempts} ` +
        `(${verificationReport.summary.successfulFixes} successful).`,
    };

    // Persist the failure report as an artifact
    await artifactRegistryService.persist({
      sessionId,
      phase: "pr_generation",
      name: "pr_failure_report",
      content: failureReport,
      mimeType: "application/json",
      missionRunId: options?.missionRunId ?? 0,
    });

    logger.info(`Persisted PR failure report for session ${sessionId}`, {
      blockingFailures: failureReport.blockingFailures.length,
      unresolvedVerifications: failureReport.unresolvedVerifications.length,
    });

    return { outcome: "failure_report_persisted", report: failureReport };
  }

  // Quality gate passed — generate PR as normal (Requirement 5.5: conform to conventions)
  logger.info(`Quality gate passed for session ${sessionId}. Generating PR.`);

  const pr = await generatePR(sessionId, editPlan, verificationReport, conventions, {
    gitTools: options?.gitTools,
    baseBranch: options?.baseBranch,
    orgId: options?.orgId,
    repoUrl: options?.repoUrl,
  });

  return { outcome: "pr_created", pr };
}

// ─── Exported Service ───────────────────────────────────────────────────────

export const prGeneratorService = {
  generatePR,
  generatePROrReport,
  generateBranchName,
  buildCommitMessage,
  buildPRDescription,
};
