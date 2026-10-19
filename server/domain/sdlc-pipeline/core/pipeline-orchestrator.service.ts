/**
 * Pipeline Orchestrator Service
 *
 * Central coordination service for the SDLC Code Generation Pipeline.
 * Wraps the existing CycleManagerService with:
 *   - Generation session lifecycle management
 *   - Artifact contract enforcement between phases
 *   - Cost rollup and budget threshold checking
 *   - Phase advancement and failure handling
 *
 * Does NOT replicate DAG orchestration — delegates to CycleManagerService for
 * actual cycle execution, blueprint spawning, and dependency resolution.
 */

import { db } from "@server/database_service.js";
import {
  generationSessions,
  cycleBlueprints,
  missionRuns,
} from "@shared/schema/index.js";
import { eq, and, desc } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { CycleManagerService } from "@server/domain/mission/core/cycle-manager.service.js";
import { sessionLifecycleManager } from "./session-lifecycle-manager.js";
import { artifactContractValidator } from "./artifact-contract-validator.js";
import { artifactRegistryService } from "./artifact-registry.service.js";
import { costRollupAggregator } from "./cost-rollup-aggregator.js";
import { decisionRouter } from "@domain/governor/core/decision-router.js";
import type {
  CreateSessionParams,
  SessionFilters,
  SessionMetrics,
  BudgetStatus,
  ArtifactContract,
  AutonomousCodegenConfig,
  VerificationLevel,
  SessionMetadataExtension,
  TestLoopResult,
} from "./types.js";

const logger = createLogger("PipelineOrchestrator");

// ============================================================================
// SESSION CREATION
// ============================================================================

/**
 * Create a new generation session from a pipeline template.
 *
 * 1. Validate the template exists (look up cycleBlueprints with matching templateId)
 * 2. Insert a `generationSessions` row in pending state
 * 3. Launch a cycle via CycleManagerService with pipeline metadata
 * 4. Transition session to active
 */
async function createSession(params: CreateSessionParams) {
  const { templateId, orgId, userId, inputParams, budgetLimitUsd, ttlHours, autonomousConfig } = params;

  logger.info(`Creating generation session: template=${templateId} org=${orgId} user=${userId}`);

  // Apply defaults to autonomousConfig if provided
  const resolvedConfig: AutonomousCodegenConfig | undefined = autonomousConfig
    ? {
        verificationLevel: autonomousConfig.verificationLevel ?? "type_check",
        maxFixAttempts: autonomousConfig.maxFixAttempts ?? 5,
        maxFileCount: autonomousConfig.maxFileCount ?? 50,
        contextTokenBudget: autonomousConfig.contextTokenBudget ?? 100_000,
        dependencyTraceDepth: autonomousConfig.dependencyTraceDepth ?? 3,
        repository: autonomousConfig.repository ?? {},
        prTemplate: autonomousConfig.prTemplate,
        branchNamingPattern: autonomousConfig.branchNamingPattern,
      }
    : undefined;

  // 1. Validate that the template exists by looking for a pipeline-mode cycle config.
  //    In Oddjob, pipeline templates are stored as operational cycles with
  //    pipeline_mode metadata. We look for cycle blueprints referencing this templateId.
  const templateBlueprints = await db
    .select()
    .from(cycleBlueprints)
    .where(eq(cycleBlueprints.name, templateId));

  // If no blueprints found, check by looking at operational cycle metadata
  // For now, we allow template creation even without pre-existing blueprints
  // as the cycle will be created fresh with the provided blueprint config.

  // 2. Compute phase sequence from template blueprints (ordered by waveIndex/dependencies)
  const phaseSequence = templateBlueprints.length > 0
    ? templateBlueprints
        .sort((a, b) => (a.waveIndex ?? 0) - (b.waveIndex ?? 0))
        .map((bp) => bp.name)
    : [];

  // 3. Insert session in pending state
  const expiresAt = ttlHours
    ? new Date(Date.now() + ttlHours * 60 * 60 * 1000)
    : null;

    const [session] = await db
    .insert(generationSessions)
    .values({
      templateId,
      assignedTeamId: params.assignedTeamId ?? null,
      organizationId: orgId,
      createdBy: userId,
      status: "pending",
      currentPhase: phaseSequence[0] ?? null,
      phaseSequence,
      inputParams,
      budgetLimitUsd: budgetLimitUsd?.toString(),
      ttlHours,
      expiresAt,
      metadata: {
        pipeline_mode: "code_generation",
        autonomous_config: resolvedConfig ?? undefined,
        metrics: resolvedConfig ? {
          fixAttempts: 0,
          successfulFixes: 0,
          failedFixes: 0,
          totalVerificationTime: 0,
          testLoopIterations: 0,
        } : undefined,
      },
    })
    .returning();

  logger.info(`Session ${session.id} created in pending state`);

  // 4. Launch a cycle via CycleManagerService with pipeline blueprints
  const cycleData = {
    name: `pipeline-${templateId}-${session.id.slice(0, 8)}`,
    objective: `SDLC Code Generation Pipeline: ${templateId}`,
    blueprints: templateBlueprints.map((bp) => ({
      name: bp.name,
      objective: bp.objective,
      type: bp.type,
      dependencies: bp.dependencies ?? [],
      estimatedDays: bp.estimatedDays ?? 1,
      config: bp.config ?? {},
      metadata: {
        ...(bp.metadata as Record<string, unknown> ?? {}),
        pipeline_session_id: session.id,
        pipeline_phase: bp.name,
      },
    })),
    metadata: {
      pipeline_mode: "code_generation",
      pipeline_session_id: session.id,
      template_id: templateId,
      input_params: inputParams,
    },
  };

  try {
    const cycle = await CycleManagerService.launchCycle(cycleData, userId, orgId);

    // 5. Update session with the cycle ID
    await db
      .update(generationSessions)
      .set({
        cycleId: cycle.id,
        updatedAt: new Date(),
      })
      .where(eq(generationSessions.id, session.id));

    // 6. Transition session to active
    await sessionLifecycleManager.transition(session.id, {
      type: "phase_started",
      phase: phaseSequence[0] ?? "unknown",
    });

    logger.info(`Session ${session.id} activated with cycle ${cycle.id}`);

    // Return the updated session
    const [updatedSession] = await db
      .select()
      .from(generationSessions)
      .where(eq(generationSessions.id, session.id))
      .limit(1);

    return updatedSession;
  } catch (error: any) {
    logger.error(`Failed to launch cycle for session ${session.id}: ${error.message}`);

    // Mark session as failed
    await db
      .update(generationSessions)
      .set({ status: "failed", completedAt: new Date(), updatedAt: new Date() })
      .where(eq(generationSessions.id, session.id));

    throw error;
  }
}

// ============================================================================
// SESSION QUERIES
// ============================================================================

/**
 * Get a single generation session by ID.
 */
async function getSession(sessionId: string) {
  const [session] = await db
    .select()
    .from(generationSessions)
    .where(eq(generationSessions.id, sessionId))
    .limit(1);

  if (!session) {
    throw new Error(`Generation session ${sessionId} not found`);
  }

  return session;
}

/**
 * List generation sessions for an organization with optional filters.
 */
async function listSessions(orgId: number, filters?: SessionFilters) {
  const conditions = [eq(generationSessions.organizationId, orgId)];

  if (filters?.status) {
    conditions.push(eq(generationSessions.status, filters.status));
  }
  if (filters?.templateId) {
    conditions.push(eq(generationSessions.templateId, filters.templateId));
  }

  const limit = filters?.limit ?? 50;
  const offset = filters?.offset ?? 0;

  const sessions = await db
    .select()
    .from(generationSessions)
    .where(and(...conditions))
    .orderBy(desc(generationSessions.createdAt))
    .limit(limit)
    .offset(offset);

  return sessions;
}

// ============================================================================
// SESSION CANCELLATION
// ============================================================================

/**
 * Cancel an active session — terminate its fleet via CycleManagerService
 * and transition the session to cancelled state.
 */
async function cancelSession(sessionId: string, reason: string) {
  const session = await getSession(sessionId);

  if (session.status !== "active" && session.status !== "paused") {
    throw new Error(
      `Cannot cancel session ${sessionId} in status '${session.status}' — must be active or paused`
    );
  }

  logger.info(`Cancelling session ${sessionId}: ${reason}`);

  // Terminate the cycle fleet if a cycle is linked
  if (session.cycleId) {
    await CycleManagerService.terminateFleet(session.cycleId, `Pipeline cancelled: ${reason}`);
  }

  // Transition session to cancelled
  await sessionLifecycleManager.transition(sessionId, {
    type: "cancelled",
    reason,
  });

  logger.info(`Session ${sessionId} cancelled successfully`);
}

// ============================================================================
// PHASE COMPLETION
// ============================================================================

/**
 * Called by lifecycle hooks when a mission in a pipeline-mode cycle completes.
 *
 * 1. Aggregate mission outputs from the completed mission run
 * 2. Validate artifacts against the phase's declared artifact contract
 * 3. Persist valid artifacts to the registry
 * 4. Determine if the next phase should start (advance or complete)
 */
async function onPhaseComplete(sessionId: string, phaseId: string, missionRunId: number) {
  logger.info(`Phase complete: session=${sessionId} phase=${phaseId} missionRun=${missionRunId}`);

  const session = await getSession(sessionId);
  const phaseSequence = (session.phaseSequence as string[]) ?? [];

  // 1. Get the mission run's output (from missionContext)
  const [missionRun] = await db
    .select({
      id: missionRuns.id,
      missionId: missionRuns.missionId,
      missionContext: missionRuns.missionContext,
      name: missionRuns.name,
    })
    .from(missionRuns)
    .where(eq(missionRuns.id, missionRunId))
    .limit(1);

  if (!missionRun) {
    logger.warn(`Mission run ${missionRunId} not found for phase completion`);
    return;
  }

  const missionOutput = (missionRun.missionContext as Record<string, unknown>) ?? {};

  // 2. Get the phase's artifact contract from cycleBlueprints
  const contract = await getPhaseArtifactContract(session.cycleId!, phaseId);

  // 3. Validate artifacts against contract if one exists
  if (contract) {
    const validation = artifactContractValidator.validate(missionOutput, contract);
    if (!validation.valid) {
      logger.error(
        `Artifact validation failed for session=${sessionId} phase=${phaseId}: ${validation.errors.map((e) => e.message).join(", ")}`
      );

      const governanceDecision = await decisionRouter.requestDecision({
        sessionId: `sdlc-gate-${sessionId}`,
        executionId: `sdlc_gate_${sessionId}_${phaseId}_${missionRunId}`,
        tool: "SDLC_ARTIFACT_CONTRACT_GATE",
        params: {
          type: "sdlc_artifact_contract_gate",
          sessionId,
          phase: phaseId,
          missionRunId,
          validationErrors: validation.errors,
          artifactContract: contract,
        },
        goal: `Review failed artifact contract for SDLC phase "${phaseId}"`,
        riskLevel: "high",
        description: `SDLC mission gate blocked phase "${phaseId}" because required artifacts did not satisfy the declared output contract.`,
        approverType: "internal",
        approverEmail: "admin@example.com",
        channels: ["inbox"],
        organizationId: session.organizationId ?? undefined,
        missionId: missionRun.missionId ?? missionRunId,
        noWait: true,
      });

      // Emit validation failed event but don't halt — let orchestrator decide
      sessionLifecycleManager.emitEvent({
        eventType: "phase_failed",
        sessionId,
        orgId: session.organizationId!,
        timestamp: new Date(),
        payload: {
          phase: phaseId,
          error: "artifact_validation_failed",
          validationErrors: validation.errors,
          governanceDecision,
        },
      });

      return;
    }
  }

  // 4. Persist artifacts to registry
  try {
    await artifactRegistryService.persist({
      sessionId,
      phase: phaseId,
      name: missionRun.name || phaseId,
      content: missionOutput,
      mimeType: "application/json",
      missionRunId,
    });
  } catch (error: any) {
    logger.error(`Failed to persist artifacts for session=${sessionId} phase=${phaseId}: ${error.message}`);
    // Continue — artifact persistence failure shouldn't block advancement
  }

  // 5. Advance to next phase or complete the session
  const currentPhaseIndex = phaseSequence.indexOf(phaseId);
  const isLastPhase = currentPhaseIndex === phaseSequence.length - 1;

  if (isLastPhase) {
    // All phases complete — transition session to completed
    await sessionLifecycleManager.transition(sessionId, {
      type: "phase_completed",
      phase: phaseId,
    });

    // Update session's currentPhase to null (done)
    await db
      .update(generationSessions)
      .set({ currentPhase: null, updatedAt: new Date() })
      .where(eq(generationSessions.id, sessionId));

    logger.info(`Session ${sessionId} completed — all phases done`);
  } else {
    // Advance to next phase
    const nextPhase = phaseSequence[currentPhaseIndex + 1];

    await db
      .update(generationSessions)
      .set({ currentPhase: nextPhase, updatedAt: new Date() })
      .where(eq(generationSessions.id, sessionId));

    // Emit phase_started for the next phase (informational)
    sessionLifecycleManager.emitEvent({
      eventType: "phase_started",
      sessionId,
      orgId: session.organizationId!,
      timestamp: new Date(),
      payload: { phase: nextPhase },
    });

    // Automatically trigger Quorum Stakeholder Attestation when entering an approval phase
    if (nextPhase.includes("approval") || nextPhase.includes("stakeholder") || nextPhase.includes("signoff")) {
      try {
        await decisionRouter.requestDecision({
          sessionId: `sdlc-approval-${sessionId}`,
          executionId: `sdlc_approval_${sessionId}_${nextPhase}`,
          tool: "SDLC_STAKEHOLDER_RELEASE_GATE",
          params: {
            type: "sdlc_stakeholder_release_gate",
            sessionId,
            phase: nextPhase,
            assignedTeamId: session.assignedTeamId ?? undefined,
            targetTeamId: session.assignedTeamId ?? undefined,
            quorumPolicy: "squad_lead_only",
          },
          goal: `Stakeholder release signoff for SDLC generation session "${sessionId}"`,
          riskLevel: "high",
          description: `SDLC code generation completed QA verification and is awaiting Squad Lead release attestation.`,
          approverType: "internal",
          approverEmail: "lead@example.com",
          channels: ["inbox"],
          organizationId: session.organizationId ?? undefined,
          noWait: true,
        });
      } catch (err: any) {
        logger.warn(`Failed to request stakeholder approval decision for session ${sessionId}:`, err.message);
      }
    }

    logger.info(`Session ${sessionId} advanced to phase: ${nextPhase}`);

    // The actual next phase execution is handled by CycleManagerService's
    // dependency gates — the cycle's blueprints have dependencies configured
    // so the next blueprint spawns automatically when its predecessor completes.
  }
}

// ============================================================================
// PHASE FAILURE
// ============================================================================

/**
 * Called by lifecycle hooks when a mission in a pipeline-mode cycle fails.
 *
 * Applies rescue strategy from the blueprint config, or transitions to failed.
 */
async function onPhaseFailed(sessionId: string, phaseId: string, error: string) {
  logger.warn(`Phase failed: session=${sessionId} phase=${phaseId} error=${error}`);

  const session = await getSession(sessionId);

  // Look up rescue strategy from the blueprint config
  const rescueStrategy = await getPhaseRescueStrategy(session.cycleId!, phaseId);

  switch (rescueStrategy) {
    case "retry":
      logger.info(`Applying retry rescue strategy for session=${sessionId} phase=${phaseId}`);
      // The existing CycleManagerService handles retry via self-healing synthesis.
      // We don't need to do anything extra here — the cycle's branching logic handles it.
      break;

    case "skip":
      logger.info(`Skipping failed phase ${phaseId} for session=${sessionId}`);
      // Advance to next phase despite failure
      const phaseSequence = (session.phaseSequence as string[]) ?? [];
      const currentIndex = phaseSequence.indexOf(phaseId);
      if (currentIndex < phaseSequence.length - 1) {
        const nextPhase = phaseSequence[currentIndex + 1];
        await db
          .update(generationSessions)
          .set({ currentPhase: nextPhase, updatedAt: new Date() })
          .where(eq(generationSessions.id, sessionId));
      }
      break;

    case "escalate":
      logger.info(`Escalating failed phase ${phaseId} for session=${sessionId} — pausing for human review`);
      await sessionLifecycleManager.transition(sessionId, {
        type: "budget_exceeded", // Reusing paused transition for escalation
      });
      break;

    default:
      // No rescue strategy configured — transition to failed
      await sessionLifecycleManager.transition(sessionId, {
        type: "phase_failed",
        phase: phaseId,
        error,
      });
      break;
  }
}

// ============================================================================
// COST & METRICS
// ============================================================================

/**
 * Get session metrics including cost breakdown and timing.
 * Delegates to CostRollupAggregator.
 */
async function getSessionMetrics(sessionId: string): Promise<SessionMetrics> {
  const session = await getSession(sessionId);
  const costBreakdown = await costRollupAggregator.calculateSessionCost(sessionId);

  const startedAt = session.startedAt ? new Date(session.startedAt).getTime() : Date.now();
  const endedAt = session.completedAt ? new Date(session.completedAt).getTime() : Date.now();
  const totalDurationMs = endedAt - startedAt;

  // Build per-phase metrics from cost breakdown
  const phases = Object.entries(costBreakdown.byPhase).map(([phase, costUsd]) => ({
    phase,
    durationMs: 0, // Not tracked individually yet
    costUsd,
    tokenCount: 0, // Would need per-phase token tracking
    missionRunCount: 0,
  }));

  return {
    sessionId,
    totalCostUsd: costBreakdown.totalUsd,
    totalTokens: costBreakdown.tokenCount,
    totalDurationMs,
    phases,
  };
}

/**
 * Check whether a session has exceeded its budget threshold.
 * Delegates to CostRollupAggregator.
 */
async function checkBudget(sessionId: string): Promise<BudgetStatus> {
  const session = await getSession(sessionId);
  const costBreakdown = await costRollupAggregator.calculateSessionCost(sessionId);

  const budgetLimitUsd = session.budgetLimitUsd
    ? parseFloat(String(session.budgetLimitUsd))
    : null;

  const currentCostUsd = costBreakdown.totalUsd;
  const percentUsed = budgetLimitUsd && budgetLimitUsd > 0
    ? (currentCostUsd / budgetLimitUsd) * 100
    : 0;
  const exceeded = budgetLimitUsd != null && currentCostUsd > budgetLimitUsd;

  // If exceeded, trigger budget alert and pause
  if (exceeded && session.status === "active") {
    logger.warn(`Session ${sessionId} exceeded budget: $${currentCostUsd.toFixed(4)} > $${budgetLimitUsd!.toFixed(2)}`);
    await sessionLifecycleManager.transition(sessionId, { type: "budget_exceeded" });
  }

  return {
    sessionId,
    budgetLimitUsd,
    currentCostUsd,
    percentUsed,
    exceeded,
  };
}

// ============================================================================
// AUTONOMOUS METRICS
// ============================================================================

/**
 * Shape returned by getAutonomousMetrics — the autonomous-specific metrics
 * tracked in session metadata during test loop and verification phases.
 */
export interface AutonomousMetrics {
  fixAttempts: number;
  successfulFixes: number;
  failedFixes: number;
  totalVerificationTime: number;
  testLoopIterations: number;
}

/**
 * Retrieve autonomous codegen metrics from the session's metadata.
 *
 * Returns the metrics block stored in `SessionMetadataExtension.metrics`.
 * If the session was not created with autonomous config (no metrics block),
 * returns zeroed-out metrics.
 */
async function getAutonomousMetrics(sessionId: string): Promise<AutonomousMetrics> {
  const session = await getSession(sessionId);
  const metadata = (session.metadata as Partial<SessionMetadataExtension>) ?? {};
  const metrics = metadata.metrics;

  if (!metrics) {
    return {
      fixAttempts: 0,
      successfulFixes: 0,
      failedFixes: 0,
      totalVerificationTime: 0,
      testLoopIterations: 0,
    };
  }

  return {
    fixAttempts: metrics.fixAttempts ?? 0,
    successfulFixes: metrics.successfulFixes ?? 0,
    failedFixes: metrics.failedFixes ?? 0,
    totalVerificationTime: metrics.totalVerificationTime ?? 0,
    testLoopIterations: metrics.testLoopIterations ?? 0,
  };
}

/**
 * Update session-level autonomous metrics based on a completed TestLoopResult.
 *
 * Reads the session metadata, increments metric counters based on the
 * test loop outcome, and persists the updated metrics back to the session.
 */
async function updateSessionMetrics(sessionId: string, testLoopResult: TestLoopResult): Promise<void> {
  const session = await getSession(sessionId);
  const metadata = (session.metadata as Record<string, unknown>) ?? {};
  const existingMetrics = (metadata.metrics as SessionMetadataExtension["metrics"]) ?? {
    fixAttempts: 0,
    successfulFixes: 0,
    failedFixes: 0,
    totalVerificationTime: 0,
    testLoopIterations: 0,
  };

  // Count successful and failed fixes from the test loop result
  const successfulFixes = testLoopResult.fixAttempts.filter(
    (attempt) => attempt.outcome === "resolved"
  ).length;
  const failedFixes = testLoopResult.fixAttempts.filter(
    (attempt) => attempt.outcome === "failed" || attempt.outcome === "reverted"
  ).length;

  // Accumulate metrics — clear currentAttemptNumber/currentAttemptElapsedMs since loop is done
  const updatedMetrics: SessionMetadataExtension["metrics"] = {
    fixAttempts: existingMetrics.fixAttempts + testLoopResult.totalAttempts,
    successfulFixes: existingMetrics.successfulFixes + successfulFixes,
    failedFixes: existingMetrics.failedFixes + failedFixes,
    totalVerificationTime: existingMetrics.totalVerificationTime + testLoopResult.duration,
    testLoopIterations: existingMetrics.testLoopIterations + 1,
    currentAttemptNumber: undefined,
    currentAttemptElapsedMs: undefined,
  };

  // Persist updated metadata
  const updatedMetadata = {
    ...metadata,
    metrics: updatedMetrics,
  };

  await db
    .update(generationSessions)
    .set({
      metadata: updatedMetadata,
      updatedAt: new Date(),
    })
    .where(eq(generationSessions.id, sessionId));

  logger.info(
    `Session ${sessionId} metrics updated: fixAttempts=${updatedMetrics.fixAttempts}, successfulFixes=${updatedMetrics.successfulFixes}, failedFixes=${updatedMetrics.failedFixes}, testLoopIterations=${updatedMetrics.testLoopIterations}`
  );
}

/**
 * Update the current attempt number and elapsed time in session metrics.
 *
 * Called during active test loop execution to track in-progress state.
 * The Pipeline Orchestrator stores `currentAttemptNumber` and `currentAttemptElapsedMs`
 * in the session metadata so that callers can observe progress in real time.
 *
 * Requirements: 9.5
 */
async function trackCurrentAttempt(
  sessionId: string,
  attemptNumber: number,
  elapsedMs: number
): Promise<void> {
  const session = await getSession(sessionId);
  const metadata = (session.metadata as Record<string, unknown>) ?? {};
  const existingMetrics = (metadata.metrics as SessionMetadataExtension["metrics"]) ?? {
    fixAttempts: 0,
    successfulFixes: 0,
    failedFixes: 0,
    totalVerificationTime: 0,
    testLoopIterations: 0,
  };

  const updatedMetrics: SessionMetadataExtension["metrics"] = {
    ...existingMetrics,
    currentAttemptNumber: attemptNumber,
    currentAttemptElapsedMs: elapsedMs,
  };

  const updatedMetadata = {
    ...metadata,
    metrics: updatedMetrics,
  };

  await db
    .update(generationSessions)
    .set({
      metadata: updatedMetadata,
      updatedAt: new Date(),
    })
    .where(eq(generationSessions.id, sessionId));

  logger.debug(
    `Session ${sessionId} tracking attempt ${attemptNumber} (elapsed: ${elapsedMs}ms)`
  );
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Retrieve the artifact contract for a phase from its cycleBlueprint.
 */
async function getPhaseArtifactContract(
  cycleId: number,
  phaseName: string
): Promise<ArtifactContract | null> {
  const [blueprint] = await db
    .select({ artifactContracts: cycleBlueprints.artifactContracts })
    .from(cycleBlueprints)
    .where(
      and(
        eq(cycleBlueprints.cycleId, cycleId),
        eq(cycleBlueprints.name, phaseName)
      )
    )
    .limit(1);

  if (!blueprint?.artifactContracts) {
    return null;
  }

  const contracts = blueprint.artifactContracts as Record<string, unknown>;
  return (contracts.output_contract as ArtifactContract) ?? null;
}

/**
 * Retrieve the rescue strategy for a phase from its cycleBlueprint config.
 */
async function getPhaseRescueStrategy(
  cycleId: number,
  phaseName: string
): Promise<string | null> {
  const [blueprint] = await db
    .select({ config: cycleBlueprints.config })
    .from(cycleBlueprints)
    .where(
      and(
        eq(cycleBlueprints.cycleId, cycleId),
        eq(cycleBlueprints.name, phaseName)
      )
    )
    .limit(1);

  if (!blueprint?.config) {
    return null;
  }

  const config = blueprint.config as Record<string, unknown>;
  return (config.rescue_strategy as string) ?? null;
}

// ============================================================================
// VERIFICATION LEVEL UPDATE
// ============================================================================

/**
 * Update the verification level on an active session.
 *
 * The new level applies to subsequent file operations only.
 * Requires the session to be in an active (or paused) state.
 */
async function updateVerificationLevel(sessionId: string, level: VerificationLevel) {
  const session = await getSession(sessionId);

  if (session.status !== "active" && session.status !== "paused") {
    throw new Error(
      `Cannot update verification level on session ${sessionId} in status '${session.status}' — must be active or paused`
    );
  }

  const metadata = (session.metadata as Record<string, unknown>) ?? {};
  const autonomousConfigData = (metadata.autonomous_config as Record<string, unknown>) ?? {};

  // Update the verificationLevel within the autonomous_config
  const updatedMetadata = {
    ...metadata,
    autonomous_config: {
      ...autonomousConfigData,
      verificationLevel: level,
    },
  };

  await db
    .update(generationSessions)
    .set({
      metadata: updatedMetadata,
      updatedAt: new Date(),
    })
    .where(eq(generationSessions.id, sessionId));

  logger.info(`Session ${sessionId} verification level updated to '${level}'`);

  // Return the updated session
  const [updatedSession] = await db
    .select()
    .from(generationSessions)
    .where(eq(generationSessions.id, sessionId))
    .limit(1);

  return updatedSession;
}

// ============================================================================
// EXPORTED SERVICE OBJECT
// ============================================================================

export const pipelineOrchestratorService = {
  createSession,
  getSession,
  listSessions,
  cancelSession,
  onPhaseComplete,
  onPhaseFailed,
  getSessionMetrics,
  checkBudget,
  updateVerificationLevel,
  getAutonomousMetrics,
  updateSessionMetrics,
  trackCurrentAttempt,
};
