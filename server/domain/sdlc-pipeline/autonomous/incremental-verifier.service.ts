/**
 * Incremental Verifier Service
 *
 * Runs verification checks (linting, type checking, unit tests) after each
 * individual file operation based on the configured verification level.
 *
 * Verification levels:
 *  - `none`: skip all checks, return immediately
 *  - `lint_only`: run linting only
 *  - `type_check`: run type checking + linting
 *  - `full_test`: run type checking + linting + affected unit tests
 *
 * Uses the Change Impact Analyzer to determine which specific tests are
 * affected per operation. On failure at `full_test` level, delegates to
 * the Test Loop Controller for fix attempts.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.7
 */

import { createLogger } from "@server/utils/logger.js";
import { exec as execCallback } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { sessionLifecycleManager } from "../core/session-lifecycle-manager.js";
import type {
  FileOperation,
  VerificationLevel,
  ImpactAnalysis,
  StepVerificationResult,
  VerificationCheck,
  VerificationDiagnostic,
  VerificationReport,
  VerificationEvent,
  PipelineLifecycleEvent,
  DetectedIntegration,
} from "../core/types.js";
import { detectIntegrations, buildSandboxing } from "./sandbox-detector.js";

const logger = createLogger("IncrementalVerifier");
const exec = promisify(execCallback);
const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
const MAX_DIAGNOSTIC_OUTPUT = 12_000;

// ─── Check Runner Interfaces ────────────────────────────────────────────────

/**
 * A pluggable check runner that performs a single type of verification.
 * Real implementations will invoke external tools (eslint, tsc, vitest).
 * The default stubs always pass, allowing structure-first integration.
 */
export interface CheckRunner {
  run(filePath: string, context?: CheckRunnerContext): Promise<CheckRunnerResult>;
}

export interface CheckRunnerContext {
  /** For unit test runners: the specific test files to execute */
  testFiles?: string[];
  /** The session ID for logging/tracing */
  sessionId?: string;
}

export interface CheckRunnerResult {
  passed: boolean;
  errors: VerificationDiagnostic[];
  duration: number;
}

// ─── Repo-backed Command Runners ────────────────────────────────────────────

function quoteArg(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function truncate(value: string): string {
  if (value.length <= MAX_DIAGNOSTIC_OUTPUT) return value;
  return `${value.slice(0, MAX_DIAGNOSTIC_OUTPUT)}\n...(truncated, total ${value.length} chars)`;
}

function getRepoRoot(): string {
  return process.env.GIT_WORKSPACE_ROOT || process.cwd();
}

function readPackageScripts(cwd: string): Record<string, string> {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf-8"));
    return pkg.scripts ?? {};
  } catch {
    return {};
  }
}

function diagnosticFromOutput(
  file: string,
  message: string,
  severity: VerificationDiagnostic["severity"] = "error"
): VerificationDiagnostic {
  return {
    file,
    message: truncate(message.trim() || "Verification command failed"),
    severity,
  };
}

export function createCommandCheckRunner(
  commandFactory: string | ((filePath: string, context?: CheckRunnerContext) => string | null),
  diagnosticFile = "repository",
  timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS
): CheckRunner {
  return {
    async run(filePath: string, context?: CheckRunnerContext): Promise<CheckRunnerResult> {
      const startTime = Date.now();
      const command = typeof commandFactory === "function"
        ? commandFactory(filePath, context)
        : commandFactory;

      if (!command) {
        return {
          passed: false,
          errors: [diagnosticFromOutput(filePath || diagnosticFile, "No verification command is configured.")],
          duration: Date.now() - startTime,
        };
      }

      try {
        await exec(command, {
          cwd: getRepoRoot(),
          timeout: timeoutMs,
          maxBuffer: 1024 * 1024 * 10,
          env: { ...process.env, CI: "true", NODE_ENV: process.env.NODE_ENV || "test" },
        });

        return { passed: true, errors: [], duration: Date.now() - startTime };
      } catch (error: any) {
        const output = [error.stdout, error.stderr, error.message].filter(Boolean).join("\n");
        return {
          passed: false,
          errors: [diagnosticFromOutput(filePath || diagnosticFile, output)],
          duration: Date.now() - startTime,
        };
      }
    },
  };
}

function lintCommand(filePath: string): string | null {
  const cwd = getRepoRoot();
  const scripts = readPackageScripts(cwd);
  if (scripts.lint) return `npm run lint -- ${quoteArg(filePath)}`;

  const target = fs.existsSync(path.resolve(cwd, filePath)) ? filePath : "server";
  if (fs.existsSync(path.join(cwd, ".eslintrc.server.json"))) {
    return `npx eslint --config .eslintrc.server.json ${quoteArg(target)}`;
  }

  const hasEslintConfig = [
    ".eslintrc",
    ".eslintrc.json",
    ".eslintrc.js",
    ".eslintrc.cjs",
    "eslint.config.js",
    "eslint.config.mjs",
  ].some((configFile) => fs.existsSync(path.join(cwd, configFile)));

  return hasEslintConfig ? `npx eslint ${quoteArg(target)}` : null;
}

function typeCheckCommand(): string {
  const scripts = readPackageScripts(getRepoRoot());
  return scripts.check ? "npm run check" : "npx tsc --noEmit";
}

function unitTestCommand(_filePath: string, context?: CheckRunnerContext): string {
  const testFiles = context?.testFiles?.filter(Boolean) ?? [];
  if (testFiles.length > 0) {
    return `npx vitest run ${testFiles.map(quoteArg).join(" ")}`;
  }
  return "npm run test";
}

export const defaultLintRunner = createCommandCheckRunner(lintCommand, "lint");
export const defaultTypeCheckRunner = createCommandCheckRunner(() => typeCheckCommand(), "type_check");
export const defaultTestRunner = createCommandCheckRunner(unitTestCommand, "unit_test");

// ─── Session State ──────────────────────────────────────────────────────────

/**
 * In-memory per-session storage for step verification results.
 * Used to build the cumulative VerificationReport via getCumulativeReport().
 */
const sessionResults = new Map<string, StepVerificationResult[]>();

/**
 * Per-session accumulation of detected external integrations (Extension 3 —
 * Mock Link Sandboxing). Populated in verifyStep from each operation's code and
 * assembled into the report's `sandboxing` block in getCumulativeReport.
 */
const sessionSandbox = new Map<string, DetectedIntegration[]>();

/** Concatenate the new code an operation introduces (create + modify diffs). */
function operationCode(operation: FileOperation): string {
  const parts: string[] = [];
  if (operation.newContent) parts.push(operation.newContent);
  if (operation.changes) for (const c of operation.changes) parts.push(c.newCode);
  return parts.join("\n");
}

/** Detect and record external integrations in an operation's generated code. */
function accumulateSandbox(sessionId: string, operation: FileOperation): void {
  const detected = detectIntegrations(operation.filePath, operationCode(operation));
  if (detected.length === 0) return;
  if (!sessionSandbox.has(sessionId)) sessionSandbox.set(sessionId, []);
  sessionSandbox.get(sessionId)!.push(...detected);
  logger.debug(
    `Sandbox: detected ${detected.length} external integration(s) in ${operation.filePath} for session ${sessionId}`
  );
}

// ─── Configuration ──────────────────────────────────────────────────────────

interface IncrementalVerifierConfig {
  lintRunner: CheckRunner;
  typeCheckRunner: CheckRunner;
  testRunner: CheckRunner;
}

let config: IncrementalVerifierConfig = {
  lintRunner: defaultLintRunner,
  typeCheckRunner: defaultTypeCheckRunner,
  testRunner: defaultTestRunner,
};

/**
 * Configure the verifier with custom check runners.
 * Call this at startup to inject real tool integrations.
 */
function configure(newConfig: Partial<IncrementalVerifierConfig>): void {
  config = { ...config, ...newConfig };
  logger.info("Incremental verifier configured with custom runners");
}

// ─── Core Logic ─────────────────────────────────────────────────────────────

/**
 * Determines which check types to run based on the verification level.
 */
function getChecksForLevel(level: VerificationLevel): Array<VerificationCheck["type"]> {
  switch (level) {
    case "none":
      return [];
    case "lint_only":
      return ["lint"];
    case "type_check":
      return ["lint", "type_check"];
    case "full_test":
      return ["lint", "type_check", "unit_test"];
  }
}

/**
 * Executes a single check type against a file and returns the result.
 */
async function runCheck(
  checkType: VerificationCheck["type"],
  filePath: string,
  impactAnalysis: ImpactAnalysis,
  sessionId: string
): Promise<VerificationCheck> {
  const startTime = Date.now();

  let result: CheckRunnerResult;

  switch (checkType) {
    case "lint":
      result = await config.lintRunner.run(filePath, { sessionId });
      break;
    case "type_check":
      result = await config.typeCheckRunner.run(filePath, { sessionId });
      break;
    case "unit_test":
      result = await config.testRunner.run(filePath, {
        sessionId,
        testFiles: impactAnalysis.affectedTestFiles,
      });
      break;
  }

  const duration = result.duration || (Date.now() - startTime);

  return {
    type: checkType,
    passed: result.passed,
    errors: result.errors.length > 0 ? result.errors : undefined,
    duration,
  };
}

// ─── Service Methods ────────────────────────────────────────────────────────

/**
 * Verify a single file operation based on the configured verification level.
 *
 * For `none`: returns immediately with status "skipped".
 * For other levels: runs the appropriate checks sequentially,
 * aggregates results, and records the outcome.
 *
 * If any check fails at `full_test` level, the Test Loop Controller
 * should be invoked (stubbed for now — noted in result details).
 */
async function verifyStep(
  sessionId: string,
  operation: FileOperation,
  verificationLevel: VerificationLevel,
  impactAnalysis: ImpactAnalysis
): Promise<StepVerificationResult> {
  const startTime = Date.now();

  // Mock Link Sandboxing: detect external-API call sites in the operation's code
  // up front, independent of the verification level, so the cumulative report can
  // stub them (MSW / sandbox schema) rather than fail on remote network timeouts.
  accumulateSandbox(sessionId, operation);

  // Handle "none" — skip verification entirely (Requirement 4.4)
  if (verificationLevel === "none") {
    const skippedResult: StepVerificationResult = {
      operationId: operation.id,
      filePath: operation.filePath,
      status: "skipped",
      checks: [],
      duration: 0,
      timestamp: new Date(),
    };

    appendSessionResult(sessionId, skippedResult);
    logger.debug(`Skipping verification for operation ${operation.id} (level: none)`);
    return skippedResult;
  }

  // Determine which checks to run based on level
  const checkTypes = getChecksForLevel(verificationLevel);

  logger.info(`Verifying operation ${operation.id} at level "${verificationLevel}"`, {
    sessionId,
    filePath: operation.filePath,
    checks: checkTypes,
    affectedTestCount: impactAnalysis.affectedTestFiles.length,
  });

  // Execute all applicable checks sequentially
  const checks: VerificationCheck[] = [];
  let overallPassed = true;

  for (const checkType of checkTypes) {
    const check = await runCheck(checkType, operation.filePath, impactAnalysis, sessionId);
    checks.push(check);

    if (!check.passed) {
      overallPassed = false;

      // Emit incremental_verification_failed event (Requirement 8.4)
      const verificationFailedEvent: PipelineLifecycleEvent = {
        eventType: "incremental_verification_failed",
        sessionId,
        orgId: 0,
        timestamp: new Date(),
        payload: {
          operationId: operation.id,
          filePath: operation.filePath,
          checkType,
        },
      };
      sessionLifecycleManager.emitEvent(verificationFailedEvent);

      // Requirement 4.5: On failure at full_test level, invoke Test Loop Controller
      if (verificationLevel === "full_test") {
        logger.warn(
          `Check "${checkType}" failed for operation ${operation.id}. ` +
            `Test Loop Controller should be invoked for fix attempt.`,
          { sessionId, filePath: operation.filePath }
        );
        // NOTE: Test Loop Controller invocation is stubbed here.
        // When the TLC service is implemented, integrate:
        //   await testLoopControllerService.executeLoop(sessionId, impactAnalysis.affectedTestFiles, maxAttempts);
      }
    }
  }

  const duration = Date.now() - startTime;

  const result: StepVerificationResult = {
    operationId: operation.id,
    filePath: operation.filePath,
    status: overallPassed ? "passed" : "failed",
    checks,
    duration,
    timestamp: new Date(),
  };

  appendSessionResult(sessionId, result);

  logger.info(`Verification complete for operation ${operation.id}: ${result.status}`, {
    sessionId,
    duration,
    checkCount: checks.length,
    passedChecks: checks.filter((c) => c.passed).length,
  });

  return result;
}

/**
 * Get the cumulative verification report for a session.
 * Aggregates all per-step results into a single report (Requirement 4.6).
 */
async function getCumulativeReport(sessionId: string): Promise<VerificationReport> {
  const results = sessionResults.get(sessionId) ?? [];

  // Compute summary from all step results
  let totalChecks = 0;
  let passed = 0;
  let failed = 0;
  let totalDuration = 0;

  for (const result of results) {
    for (const check of result.checks) {
      totalChecks++;
      if (check.passed) {
        passed++;
      } else {
        failed++;
      }
    }
    totalDuration += result.duration;
  }

  // Build timeline from step results
  const timeline: VerificationEvent[] = results.map((result) => ({
    timestamp: result.timestamp,
    type: "step_check" as const,
    operationId: result.operationId,
    status: result.status,
    details: {
      filePath: result.filePath,
      checkCount: result.checks.length,
      checks: result.checks.map((c) => ({ type: c.type, passed: c.passed })),
    },
    duration: result.duration,
  }));

  // Determine final status
  let finalStatus: VerificationReport["finalStatus"];
  if (results.length === 0) {
    finalStatus = "in_progress";
  } else if (failed === 0) {
    finalStatus = "all_passed";
  } else {
    finalStatus = "has_failures";
  }

  // Determine the effective verification level from the first non-skipped result
  const firstNonSkipped = results.find((r) => r.status !== "skipped");
  let verificationLevel: VerificationLevel = "none";
  if (firstNonSkipped) {
    const checkTypes = firstNonSkipped.checks.map((c) => c.type);
    if (checkTypes.includes("unit_test")) {
      verificationLevel = "full_test";
    } else if (checkTypes.includes("type_check")) {
      verificationLevel = "type_check";
    } else if (checkTypes.includes("lint")) {
      verificationLevel = "lint_only";
    }
  }

  // Mock Link Sandboxing: fold accumulated external-integration detections into
  // the report, and append a `sandbox_stub` timeline entry per integration.
  const detectedIntegrations = sessionSandbox.get(sessionId) ?? [];
  let sandboxing: VerificationReport["sandboxing"];
  if (detectedIntegrations.length > 0) {
    sandboxing = buildSandboxing(detectedIntegrations);
    for (const integration of sandboxing.detectedIntegrations) {
      timeline.push({
        timestamp: new Date(),
        type: "sandbox_stub",
        status: integration.stubStrategy === "none" ? "skipped" : "passed",
        details: {
          registry: integration.registry,
          stubStrategy: integration.stubStrategy,
          callSites: integration.callSites.length,
        },
        duration: 0,
      });
    }
  }

  const report: VerificationReport = {
    sessionId,
    verificationLevel,
    timeline,
    summary: {
      totalChecks,
      passed,
      failed,
      fixAttempts: 0,        // Will be populated when TLC integration is complete
      successfulFixes: 0,    // Will be populated when TLC integration is complete
      totalDuration,
    },
    finalStatus,
    ...(sandboxing ? { sandboxing } : {}),
  };

  logger.info(`Generated cumulative report for session ${sessionId}`, {
    totalChecks,
    passed,
    failed,
    finalStatus,
  });

  return report;
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

/**
 * Append a step verification result to the session's in-memory store.
 */
function appendSessionResult(sessionId: string, result: StepVerificationResult): void {
  if (!sessionResults.has(sessionId)) {
    sessionResults.set(sessionId, []);
  }
  sessionResults.get(sessionId)!.push(result);
}

/**
 * Clear session results — useful for cleanup or testing.
 */
function clearSession(sessionId: string): void {
  sessionResults.delete(sessionId);
  sessionSandbox.delete(sessionId);
  logger.debug(`Cleared verification results for session ${sessionId}`);
}

// ─── Exported Service ───────────────────────────────────────────────────────

export const incrementalVerifierService = {
  verifyStep,
  getCumulativeReport,
  configure,
  clearSession,
};
