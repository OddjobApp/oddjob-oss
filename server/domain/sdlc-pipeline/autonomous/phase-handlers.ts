/**
 * Autonomous Phase Handlers
 *
 * Integration layer between the Pipeline Orchestrator and autonomous services.
 * Each handler is registered for a specific phase (blueprint) and:
 *  1. Reads upstream artifacts via `artifactRegistryService.buildPhaseContext()`
 *  2. Invokes the appropriate service method
 *  3. Persists output artifacts
 *  4. Returns success/failure
 *
 * Requirements: 1.4, 2.6
 */

import { createLogger } from "@server/utils/logger.js";
import { artifactRegistryService } from "../core/artifact-registry.service.js";
import { repositoryContextLoaderService } from "./repository-context-loader.service.js";
import { changePlannerService } from "./change-planner.service.js";
import { incrementalVerifierService } from "./incremental-verifier.service.js";
import { testLoopControllerService } from "./test-loop-controller.service.js";
import { qualityGateService } from "./quality-gate.service.js";
import { prGeneratorService } from "./pr-generator.service.js";
import { componentLookupService, type AssemblyManifestArtifact } from "./component-lookup.service.js";
import { ensureAutonomousRunnersWired } from "./runner-wiring.js";
import type { AutonomousPhaseName } from "./contracts.js";
import type {
  AutonomousCodegenConfig,
  RepositoryContext,
  EditPlan,
  VerificationReport,
  DetectedConventions,
  TestLoopResult,
  QualityGateResult,
  PRResult,
} from "../core/types.js";

const logger = createLogger("AutonomousPhaseHandlers");

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PhaseHandlerResult {
  success: boolean;
  phaseName: AutonomousPhaseName;
  artifact?: unknown;
  error?: string;
  duration: number;
}

export type AutonomousPhaseHandler = (
  sessionId: string,
  missionRunId: number,
  config: AutonomousCodegenConfig
) => Promise<PhaseHandlerResult>;

// ─── Phase Handlers ─────────────────────────────────────────────────────────

/**
 * context_load phase handler.
 *
 * Invokes the Repository Context Loader to analyze the target repository
 * and persist the context artifact.
 */
async function handleContextLoad(
  sessionId: string,
  missionRunId: number,
  config: AutonomousCodegenConfig
): Promise<PhaseHandlerResult> {
  const start = Date.now();

  // Install real verifier + mutation runners for this session's workspace
  // (no-op under tests, which keep the safe defaults).
  ensureAutonomousRunnersWired({ workspaceRoot: config.repository?.workspacePath });

  try {
    const result = await repositoryContextLoaderService.loadContextAndPersist(
      sessionId,
      config,
      missionRunId
    );

    if (!result.success) {
      return {
        success: false,
        phaseName: "context_load",
        error: result.error.message,
        duration: Date.now() - start,
      };
    }

    return {
      success: true,
      phaseName: "context_load",
      artifact: result.context,
      duration: Date.now() - start,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`context_load handler failed for session=${sessionId}: ${message}`);
    return {
      success: false,
      phaseName: "context_load",
      error: message,
      duration: Date.now() - start,
    };
  }
}

/**
 * component_lookup phase handler.
 *
 * Reads repository context from upstream context_load phase,
 * queries component_index for matching high-effectiveness components,
 * and persists the assembly_manifest artifact.
 */
async function handleComponentLookup(
  sessionId: string,
  missionRunId: number,
  config: AutonomousCodegenConfig
): Promise<PhaseHandlerResult> {
  const start = Date.now();

  try {
    const phaseContext = await artifactRegistryService.buildPhaseContext(
      sessionId,
      "component_lookup"
    );

    const repositoryContext = phaseContext["context_load.repository_context"] as
      | RepositoryContext
      | undefined;

    if (!repositoryContext) {
      return {
        success: false,
        phaseName: "component_lookup",
        error: "Missing upstream artifact: repository_context from context_load phase",
        duration: Date.now() - start,
      };
    }

    const objective = extractObjectiveFromContext(phaseContext, config);
    const artifact = await componentLookupService.resolveAssemblyComponents(repositoryContext, objective);

    await artifactRegistryService.persist({
      sessionId,
      phase: "component_lookup",
      name: "assembly_manifest",
      content: artifact,
      mimeType: "application/json",
      missionRunId,
    });

    logger.info(`component_lookup completed for session=${sessionId} in ${Date.now() - start}ms`);

    return {
      success: true,
      phaseName: "component_lookup",
      artifact,
      duration: Date.now() - start,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`component_lookup handler failed for session=${sessionId}: ${message}`);
    return {
      success: false,
      phaseName: "component_lookup",
      error: message,
      duration: Date.now() - start,
    };
  }
}

/**
 * change_plan phase handler.
 *
 * Reads the repository context from upstream artifacts, then invokes
 * the Change Planner to generate and persist an edit plan.
 */
async function handleChangePlan(
  sessionId: string,
  missionRunId: number,
  config: AutonomousCodegenConfig
): Promise<PhaseHandlerResult> {
  const start = Date.now();

  try {
    // Read upstream context artifact
    const phaseContext = await artifactRegistryService.buildPhaseContext(
      sessionId,
      "change_plan"
    );

    const repositoryContext = phaseContext["context_load.repository_context"] as
      | RepositoryContext
      | undefined;

    if (!repositoryContext) {
      return {
        success: false,
        phaseName: "change_plan",
        error: "Missing upstream artifact: repository_context from context_load phase",
        duration: Date.now() - start,
      };
    }

    // Extract objective from session input params (stored in metadata)
    const objective = extractObjectiveFromContext(phaseContext, config);

    const { plan } = await changePlannerService.generatePlanAndPersist(
      sessionId,
      objective,
      repositoryContext,
      config.maxFileCount,
      missionRunId,
      config.contextTokenBudget
    );

    return {
      success: true,
      phaseName: "change_plan",
      artifact: plan,
      duration: Date.now() - start,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`change_plan handler failed for session=${sessionId}: ${message}`);
    return {
      success: false,
      phaseName: "change_plan",
      error: message,
      duration: Date.now() - start,
    };
  }
}

/**
 * apply_edits phase handler.
 *
 * Reads the edit plan from upstream, applies each operation through
 * the Incremental Verifier, and persists the cumulative verification report.
 */
async function handleApplyEdits(
  sessionId: string,
  missionRunId: number,
  config: AutonomousCodegenConfig
): Promise<PhaseHandlerResult> {
  const start = Date.now();

  try {
    // Read upstream artifacts
    const phaseContext = await artifactRegistryService.buildPhaseContext(
      sessionId,
      "apply_edits"
    );

    const editPlan = phaseContext["change_plan.edit_plan"] as EditPlan | undefined;

    if (!editPlan) {
      return {
        success: false,
        phaseName: "apply_edits",
        error: "Missing upstream artifact: edit_plan from change_plan phase",
        duration: Date.now() - start,
      };
    }

    // Apply each operation using the incremental verifier
    // The verifier handles per-step verification internally and accumulates results
    for (const operation of editPlan.operations) {
      await incrementalVerifierService.verifyStep(
        sessionId,
        operation,
        config.verificationLevel,
        { affectedTestFiles: [], affectedSourceFiles: [], traceDepth: config.dependencyTraceDepth, confidence: "medium", fullSuiteFallback: false }
      );
    }

    // Get cumulative verification report and persist
    const report = await incrementalVerifierService.getCumulativeReport(sessionId);

    await artifactRegistryService.persist({
      sessionId,
      phase: "apply_edits",
      name: "verification_report",
      content: report,
      mimeType: "application/json",
      missionRunId,
    });

    // Close the component feedback loop. component_lookup selects components by
    // effectiveness score, but nothing wrote the verification outcome back, so
    // every score stayed at its seeded default forever. This is the write half.
    await recordComponentAssemblyFeedback(phaseContext, report.finalStatus === "all_passed");

    return {
      success: true,
      phaseName: "apply_edits",
      artifact: report,
      duration: Date.now() - start,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`apply_edits handler failed for session=${sessionId}: ${message}`);
    return {
      success: false,
      phaseName: "apply_edits",
      error: message,
      duration: Date.now() - start,
    };
  }
}

/**
 * Feed the verification outcome back into the component index.
 *
 * Best-effort: a failure to record statistics must never fail the phase that
 * produced real work. Each component is recorded once, since the manifest can
 * list the same component from more than one category query.
 */
async function recordComponentAssemblyFeedback(
  phaseContext: Record<string, unknown>,
  verificationSuccess: boolean,
): Promise<void> {
  try {
    const manifest = phaseContext["component_lookup.assembly_manifest"] as
      | AssemblyManifestArtifact
      | undefined;

    const names = [...new Set((manifest?.matchedComponents ?? []).map(c => c.name))];
    if (names.length === 0) return;

    for (const name of names) {
      await componentLookupService
        .recordAssemblyFeedback(name, verificationSuccess)
        .catch(err =>
          logger.warn(`Failed to record assembly feedback for ${name}: ${err?.message ?? err}`),
        );
    }
    logger.info(
      `Recorded assembly feedback for ${names.length} component(s), success=${verificationSuccess}`,
    );
  } catch (err) {
    logger.warn(`Component feedback loop skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * test_loop phase handler.
 *
 * Reads the verification report from upstream and executes the self-healing
 * test loop against affected test files. Persists the test loop result.
 */
async function handleTestLoop(
  sessionId: string,
  missionRunId: number,
  config: AutonomousCodegenConfig
): Promise<PhaseHandlerResult> {
  const start = Date.now();

  try {
    // Read upstream artifacts for affected test files
    const phaseContext = await artifactRegistryService.buildPhaseContext(
      sessionId,
      "test_loop"
    );

    const editPlan = phaseContext["change_plan.edit_plan"] as EditPlan | undefined;

    // Determine test files from the edit plan's changed files
    const testFiles = editPlan
      ? editPlan.operations
          .map((op) => op.filePath)
          .filter((f) => isTestFile(f))
      : [];

    // Automated Mutation Testing input: the newly written *source* (non-test)
    // code, so surviving mutations can expose a weak assertion suite.
    const changedFiles = editPlan
      ? editPlan.operations
          .filter((op) => !isTestFile(op.filePath))
          .map((op) => ({
            filePath: op.filePath,
            newCode: [op.newContent ?? "", ...(op.changes?.map((c) => c.newCode) ?? [])]
              .filter(Boolean)
              .join("\n"),
          }))
          .filter((f) => f.newCode.trim().length > 0)
      : [];

    const result: TestLoopResult = await testLoopControllerService.executeLoop(
      sessionId,
      testFiles,
      config.maxFixAttempts,
      { verificationLevel: config.verificationLevel, changedFiles }
    );

    // Persist the test loop result
    await artifactRegistryService.persist({
      sessionId,
      phase: "test_loop",
      name: "test_loop_result",
      content: result,
      mimeType: "application/json",
      missionRunId,
    });

    return {
      success: result.status === "all_passed" || result.status === "partially_fixed",
      phaseName: "test_loop",
      artifact: result,
      duration: Date.now() - start,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`test_loop handler failed for session=${sessionId}: ${message}`);
    return {
      success: false,
      phaseName: "test_loop",
      error: message,
      duration: Date.now() - start,
    };
  }
}

/**
 * quality_gate phase handler.
 *
 * Evaluates whether all verifications and tests pass. Persists the gate result.
 */
async function handleQualityGate(
  sessionId: string,
  missionRunId: number,
  _config: AutonomousCodegenConfig
): Promise<PhaseHandlerResult> {
  const start = Date.now();

  try {
    const result: QualityGateResult = await qualityGateService.evaluate(sessionId);

    // Persist the quality gate result
    await artifactRegistryService.persist({
      sessionId,
      phase: "quality_gate",
      name: "gate_result",
      content: result,
      mimeType: "application/json",
      missionRunId,
    });

    return {
      success: result.passed,
      phaseName: "quality_gate",
      artifact: result,
      duration: Date.now() - start,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`quality_gate handler failed for session=${sessionId}: ${message}`);
    return {
      success: false,
      phaseName: "quality_gate",
      error: message,
      duration: Date.now() - start,
    };
  }
}

/**
 * pr_generation phase handler.
 *
 * Reads the edit plan, verification report, and conventions from upstream,
 * then invokes the PR Generator to create a branch, commit, and open a PR.
 */
async function handlePRGeneration(
  sessionId: string,
  missionRunId: number,
  _config: AutonomousCodegenConfig
): Promise<PhaseHandlerResult> {
  const start = Date.now();

  try {
    // Read upstream artifacts
    const phaseContext = await artifactRegistryService.buildPhaseContext(
      sessionId,
      "pr_generation"
    );

    const editPlan = phaseContext["change_plan.edit_plan"] as EditPlan | undefined;
    const verificationReport = phaseContext["apply_edits.verification_report"] as
      | VerificationReport
      | undefined;
    const repositoryContext = phaseContext["context_load.repository_context"] as
      | RepositoryContext
      | undefined;

    if (!editPlan || !verificationReport) {
      return {
        success: false,
        phaseName: "pr_generation",
        error: "Missing upstream artifacts: edit_plan or verification_report",
        duration: Date.now() - start,
      };
    }

    const conventions: DetectedConventions = repositoryContext?.conventions ?? {
      namingPatterns: [],
      formattingRules: [],
      architecturalPatterns: [],
      testingConventions: [],
    };

    const prResult: PRResult = await prGeneratorService.generatePR(
      sessionId,
      editPlan,
      verificationReport,
      conventions
    );

    // Persist the PR result
    await artifactRegistryService.persist({
      sessionId,
      phase: "pr_generation",
      name: "pr_result",
      content: prResult,
      mimeType: "application/json",
      missionRunId,
    });

    return {
      success: true,
      phaseName: "pr_generation",
      artifact: prResult,
      duration: Date.now() - start,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`pr_generation handler failed for session=${sessionId}: ${message}`);
    return {
      success: false,
      phaseName: "pr_generation",
      error: message,
      duration: Date.now() - start,
    };
  }
}

// ─── Handler Registry ───────────────────────────────────────────────────────

/**
 * Maps each autonomous pipeline phase to its handler function.
 */
const handlerRegistry: Record<AutonomousPhaseName, AutonomousPhaseHandler> = {
  context_load: handleContextLoad,
  component_lookup: handleComponentLookup,
  change_plan: handleChangePlan,
  apply_edits: handleApplyEdits,
  test_loop: handleTestLoop,
  quality_gate: handleQualityGate,
  pr_generation: handlePRGeneration,
};

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Returns the full handler registry mapping phase names to handler functions.
 * Used when wiring autonomous phases into the Cycle Manager blueprint system.
 */
export function registerAutonomousPhaseHandlers(): Record<AutonomousPhaseName, AutonomousPhaseHandler> {
  return { ...handlerRegistry };
}

/**
 * Executes the handler for a specific autonomous phase.
 *
 * Looks up the handler by phase name, builds upstream context via the
 * artifact registry, and invokes the handler with session configuration.
 *
 * @param sessionId - The generation session ID
 * @param phaseName - The autonomous phase to execute
 * @param missionRunId - The mission run ID for artifact tracking
 * @param config - The autonomous codegen configuration for this session
 * @returns PhaseHandlerResult with success/failure, artifact, and timing
 */
export async function executeAutonomousPhase(
  sessionId: string,
  phaseName: AutonomousPhaseName,
  missionRunId: number,
  config: AutonomousCodegenConfig
): Promise<PhaseHandlerResult> {
  const handler = handlerRegistry[phaseName];

  if (!handler) {
    logger.error(`No handler registered for phase "${phaseName}"`);
    return {
      success: false,
      phaseName,
      error: `No handler registered for phase "${phaseName}"`,
      duration: 0,
    };
  }

  logger.info(`Executing autonomous phase "${phaseName}" for session=${sessionId}`, {
    missionRunId,
    verificationLevel: config.verificationLevel,
  });

  const result = await handler(sessionId, missionRunId, config);

  logger.info(`Phase "${phaseName}" completed for session=${sessionId}`, {
    success: result.success,
    duration: result.duration,
    error: result.error,
  });

  return result;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract the session objective from phase context or config.
 * Looks for it in the repository context's relevant files metadata
 * or falls back to a generic placeholder.
 */
function extractObjectiveFromContext(
  phaseContext: Record<string, unknown>,
  _config: AutonomousCodegenConfig
): string {
  // The objective is typically stored in the session metadata.
  // For now, attempt to extract from the repository context if available,
  // or use a placeholder that will be resolved by the orchestrator.
  const context = phaseContext["context_load.repository_context"] as
    | RepositoryContext
    | undefined;

  // If there are relevant files, the objective was already used to select them.
  // The actual objective comes from session inputParams — the orchestrator should
  // pass it through config or session metadata. Return a generic marker here.
  if (context && context.relevantFiles.length > 0) {
    return "Objective from session input parameters";
  }

  return "Objective from session input parameters";
}

/**
 * Simple heuristic to detect test files by path pattern.
 */
function isTestFile(filePath: string): boolean {
  return (
    filePath.includes(".test.") ||
    filePath.includes(".spec.") ||
    filePath.includes("__tests__") ||
    filePath.includes("/tests/") ||
    filePath.includes("/test/")
  );
}
