/**
 * Autonomous Runner Wiring
 *
 * Installs the *real* runners into the autonomous services:
 *   - Incremental Verifier — real command runners (eslint / tsc / vitest).
 *   - Test Loop Controller — a real MutationRunner that applies each mutant to
 *     disk, runs the affected tests, and reverts (reusing the vitest runner).
 *
 * Both command execution paths resolve their working directory from
 * `GIT_WORKSPACE_ROOT`, so wiring binds that env to the session's workspace.
 *
 * This is an explicit bootstrap — it is skipped in test environments so unit
 * tests keep the safe defaults (kill-all mutation runner, no recursive vitest).
 */

import { createLogger } from "@server/utils/logger.js";
import {
  createVitestRunner,
  testLoopControllerService,
} from "./test-loop-controller.service.js";
import {
  incrementalVerifierService,
  defaultLintRunner,
  defaultTypeCheckRunner,
  defaultTestRunner,
} from "./incremental-verifier.service.js";
import { createRealMutationRunner } from "./mutation-tester.js";
import { createAiFixGenerator } from "./ai-fix-generator.js";

const logger = createLogger("AutonomousRunnerWiring");

/** True inside vitest / NODE_ENV=test — wiring is skipped to keep defaults. */
export function isTestEnvironment(): boolean {
  return process.env.VITEST === "true" || process.env.NODE_ENV === "test";
}

export interface WireRunnersOptions {
  /** The session's repository workspace; falls back to GIT_WORKSPACE_ROOT / cwd. */
  workspaceRoot?: string;
}

/**
 * Wire the real verifier + mutation runners. Idempotent-friendly: safe to call
 * per session (last workspace wins). Command runners read GIT_WORKSPACE_ROOT.
 */
export function wireAutonomousRunners(opts: WireRunnersOptions = {}): void {
  const workspaceRoot = opts.workspaceRoot || process.env.GIT_WORKSPACE_ROOT || process.cwd();
  process.env.GIT_WORKSPACE_ROOT = workspaceRoot;

  // Verifier: install the real command runners explicitly (overriding any prior
  // stub configuration for this workspace).
  incrementalVerifierService.configure({
    lintRunner: defaultLintRunner,
    typeCheckRunner: defaultTypeCheckRunner,
    testRunner: defaultTestRunner,
  });

  // Mutation: real apply → run → revert runner, reusing the vitest test runner
  // to decide whether each mutant survives.
  const testRunner = createVitestRunner();
  const runTests = async (testFiles: string[]) => {
    const result = await testRunner.run(testFiles, "mutation-testing");
    return { passed: result.passed };
  };
  // Fix generation: real Gemini-backed generator (generate/apply/revert on disk),
  // replacing the fail-closed default so the loop can self-heal.
  testLoopControllerService.configure({
    mutationRunner: createRealMutationRunner({ workspaceRoot, runTests }),
    fixGenerator: createAiFixGenerator({ workspaceRoot }),
  });

  logger.info(`Autonomous runners wired (workspaceRoot=${workspaceRoot})`);
}

/**
 * Wire real runners unless running under tests. Called at the start of an
 * autonomous session (context_load) so verification + mutation testing target
 * the session's real workspace.
 */
export function ensureAutonomousRunnersWired(opts: WireRunnersOptions = {}): void {
  if (isTestEnvironment()) return;
  wireAutonomousRunners(opts);
}
