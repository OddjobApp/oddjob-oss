/**
 * Generation Sessions API Routes
 *
 * REST endpoints for the SDLC Code Generation Pipeline.
 * Provides session lifecycle management, artifact retrieval,
 * cost metrics, and phase control.
 */

import { Router, type Request, type Response } from "express";
import { requireAuth } from "../domain/core/auth/security.service.js";
import { asyncHandler } from "../middleware/error-handler.js";
import { BadRequestError, NotFoundError } from "../utils/errors.js";
import { createLogger } from "../utils/logger.js";
import { getUserOrgContext } from "../utils/auth-context.js";
import { pipelineOrchestratorService, sessionLifecycleManager } from "../domain/sdlc-pipeline/index.js";
import { artifactRegistryService } from "../domain/sdlc-pipeline/index.js";
import { db } from "../database_service.js";
import { generationSessions, missionRuns } from "@shared/schema/index.js";
import { eq, and, gte, sql, isNull } from "drizzle-orm";
import { eventStream } from "../domain/core/infrastructure/event-stream.service.js";
import type { PipelineLifecycleEvent } from "../domain/sdlc-pipeline/core/types.js";

const router = Router();
const logger = createLogger("GenerationSessionsRoute");

// All routes require authentication
router.use(requireAuth);

// ============================================================================
// POST /api/generation-sessions — Create a new session from a template
// ============================================================================
router.post("/", asyncHandler(async (req: Request, res: Response) => {
  const { organizationId, userId } = await getUserOrgContext(req);
  if (!organizationId) {
    throw new BadRequestError("Organization context required");
  }

  const { templateId, inputParams, budgetLimitUsd, ttlHours } = req.body;

  if (!templateId) {
    throw new BadRequestError("templateId is required");
  }

  const session = await pipelineOrchestratorService.createSession({
    templateId,
    orgId: organizationId,
    userId: userId!,
    inputParams: inputParams ?? {},
    budgetLimitUsd,
    ttlHours,
  });

  res.status(201).json(session);
}));

// ============================================================================
// GET /api/generation-sessions — List sessions for org with filters
// ============================================================================
router.get("/", asyncHandler(async (req: Request, res: Response) => {
  const { organizationId } = await getUserOrgContext(req);
  if (!organizationId) {
    throw new BadRequestError("Organization context required");
  }

  const { status, templateId } = req.query;
  const filters: Record<string, unknown> = {};
  if (status) filters.status = status as string;
  if (templateId) filters.templateId = templateId as string;

  const sessions = await pipelineOrchestratorService.listSessions(organizationId, filters);
  res.json(sessions);
}));

// ============================================================================
// GET /api/generation-sessions/analytics — Aggregate metrics across sessions
// ============================================================================
router.get("/analytics", asyncHandler(async (req: Request, res: Response) => {
  const { organizationId } = await getUserOrgContext(req);
  if (!organizationId) {
    throw new BadRequestError("Organization context required");
  }

  const sinceParam = req.query.since as string | undefined;
  const sinceDate = sinceParam ? new Date(sinceParam) : undefined;

  // Build base conditions
  const conditions = [eq(generationSessions.organizationId, organizationId)];
  if (sinceDate && !isNaN(sinceDate.getTime())) {
    conditions.push(gte(generationSessions.startedAt, sinceDate));
  }

  const whereClause = and(...conditions);

  // 1. Status counts
  const statusRows = await db
    .select({
      status: generationSessions.status,
      count: sql<number>`count(*)::int`,
    })
    .from(generationSessions)
    .where(whereClause)
    .groupBy(generationSessions.status);

  let totalSessions = 0;
  let activeCount = 0;
  let blockedCount = 0;
  let completedCount = 0;
  let failedCount = 0;

  for (const row of statusRows) {
    const c = Number(row.count);
    totalSessions += c;
    if (row.status === "active") activeCount = c;
    else if (row.status === "paused") blockedCount = c; // paused = blocked in UI terminology
    else if (row.status === "completed") completedCount = c;
    else if (row.status === "failed") failedCount = c;
  }

  // 2. Aggregate autonomous metrics from metadata JSONB
  const metricRows = await db
    .select({
      metadata: generationSessions.metadata,
      currentCostUsd: generationSessions.currentCostUsd,
      startedAt: generationSessions.startedAt,
      completedAt: generationSessions.completedAt,
      status: generationSessions.status,
    })
    .from(generationSessions)
    .where(whereClause);

  let totalFixAttempts = 0;
  let resolvedFixes = 0;
  let failedFixes = 0;
  let revertedFixes = 0;
  let totalVerificationTimeMs = 0;
  let totalTestLoopIterations = 0;
  let sessionsWithVerification = 0;
  let qualityGatePassed = 0;
  let qualityGateEvaluated = 0;
  let totalCost = 0;

  // Histogram buckets: [0, 1, 2, 3, 4, 5+]
  const testLoopDistribution = [0, 0, 0, 0, 0, 0];

  // Time-series accumulators (grouped by date)
  const verificationByDay: Record<string, { passed: number; total: number }> = {};
  const costByDay: Record<string, { cost: number; sessionCount: number }> = {};

  for (const row of metricRows) {
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    const cost = parseFloat(String(row.currentCostUsd ?? "0"));
    totalCost += cost;

    // Fix attempt metrics from metadata
    const fixes = Number(meta.fixAttempts ?? 0);
    const successes = Number(meta.successfulFixes ?? 0);
    const failures = Number(meta.failedFixes ?? 0);
    const reverted = Number(meta.revertedFixes ?? 0);
    const verTime = Number(meta.totalVerificationTime ?? 0);
    const iterations = Number(meta.testLoopIterations ?? 0);

    totalFixAttempts += fixes;
    resolvedFixes += successes;
    failedFixes += failures;
    revertedFixes += reverted;
    totalVerificationTimeMs += verTime;
    totalTestLoopIterations += iterations;

    if (verTime > 0 || iterations > 0) {
      sessionsWithVerification++;
    }

    // Quality gate tracking — completed sessions passed the gate
    if (row.status === "completed" || row.status === "failed" || row.status === "paused") {
      qualityGateEvaluated++;
      if (row.status === "completed") {
        qualityGatePassed++;
      }
    }

    // Test loop distribution histogram
    const bucket = Math.min(iterations, 5);
    testLoopDistribution[bucket]++;

    // Time-series: group by day
    const dateKey = row.startedAt
      ? new Date(row.startedAt).toISOString().slice(0, 10)
      : null;

    if (dateKey) {
      // Cost over time
      if (!costByDay[dateKey]) {
        costByDay[dateKey] = { cost: 0, sessionCount: 0 };
      }
      costByDay[dateKey].cost += cost;
      costByDay[dateKey].sessionCount++;

      // Verification pass rate over time (for evaluated sessions)
      if (row.status === "completed" || row.status === "failed" || row.status === "paused") {
        if (!verificationByDay[dateKey]) {
          verificationByDay[dateKey] = { passed: 0, total: 0 };
        }
        verificationByDay[dateKey].total++;
        if (row.status === "completed") {
          verificationByDay[dateKey].passed++;
        }
      }
    }
  }

  // 3. Cost by phase — aggregate from missionRuns linked via cycleId
  const costByPhaseRows = await db
    .select({
      phase: missionRuns.name,
      cost: sql<string>`coalesce(sum(${missionRuns.costUsd}::numeric), 0)`,
    })
    .from(missionRuns)
    .innerJoin(
      generationSessions,
      eq(missionRuns.cycleId, generationSessions.cycleId)
    )
    .where(and(whereClause, isNull(missionRuns.deletedAt)))
    .groupBy(missionRuns.name);

  const costByPhase: Record<string, number> = {};
  for (const row of costByPhaseRows) {
    costByPhase[row.phase] = parseFloat(String(row.cost));
  }

  // Compute derived metrics
  const averageTimeToFixMs =
    sessionsWithVerification > 0
      ? Math.round(totalVerificationTimeMs / totalTestLoopIterations || 0)
      : 0;

  const qualityGatePassRate =
    qualityGateEvaluated > 0
      ? Math.round((qualityGatePassed / qualityGateEvaluated) * 10000) / 10000
      : 0;

  // Build time-series arrays sorted by date
  const verificationPassRateOverTime = Object.entries(verificationByDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { passed, total }]) => ({
      date,
      rate: total > 0 ? Math.round((passed / total) * 10000) / 10000 : 0,
    }));

  const costOverTime = Object.entries(costByDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { cost, sessionCount }]) => ({
      date,
      cost: Math.round(cost * 10000) / 10000,
      sessionCount,
    }));

  const analytics = {
    totalSessions,
    activeCount,
    blockedCount,
    completedCount,
    failedCount,
    fixAttempts: {
      total: totalFixAttempts,
      resolved: resolvedFixes,
      failed: failedFixes,
      reverted: revertedFixes,
    },
    averageTimeToFixMs,
    qualityGatePassRate,
    totalCost: Math.round(totalCost * 10000) / 10000,
    costByPhase,
    testLoopDistribution,
    verificationPassRateOverTime,
    costOverTime,
  };

  res.json(analytics);
}));

// ============================================================================
// GET /api/generation-sessions/:id — Session detail with current phase
// ============================================================================
router.get("/:id", asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const session = await pipelineOrchestratorService.getSession(id);

  if (!session) {
    throw new NotFoundError("Generation session not found");
  }

  res.json(session);
}));

// ============================================================================
// GET /api/generation-sessions/:id/metrics — Cost breakdown and timing
// ============================================================================
router.get("/:id/metrics", asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const session = await pipelineOrchestratorService.getSession(id);
  if (!session) {
    throw new NotFoundError("Generation session not found");
  }

  const metrics = await pipelineOrchestratorService.getSessionMetrics(id);
  res.json(metrics);
}));

// ============================================================================
// GET /api/generation-sessions/:id/artifacts — All artifacts with lineage
// ============================================================================
router.get("/:id/artifacts", asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const lineage = await artifactRegistryService.getSessionLineage(id);
  res.json(lineage);
}));

// ============================================================================
// GET /api/generation-sessions/:id/artifacts/:phase — Phase-specific artifacts
// ============================================================================
router.get("/:id/artifacts/:phase", asyncHandler(async (req: Request, res: Response) => {
  const { id, phase } = req.params;
  const version = req.query.version ? Number(req.query.version) : undefined;

  const artifacts = await artifactRegistryService.getPhaseArtifacts(id, phase, version);
  res.json(artifacts);
}));

// ============================================================================
// GET /api/generation-sessions/:id/artifacts/:phase/:name — Specific artifact by name
// ============================================================================
router.get("/:id/artifacts/:phase/:name", asyncHandler(async (req: Request, res: Response) => {
  const { id, phase, name } = req.params;
  const version = req.query.version ? Number(req.query.version) : undefined;

  const artifacts = await artifactRegistryService.getPhaseArtifacts(id, phase, version);
  const artifact = artifacts.find((a) => a.name === name);

  if (!artifact) {
    throw new NotFoundError("Artifact not found", "NOT_FOUND", { phase, name });
  }

  res.json(artifact);
}));

// ============================================================================
// GET /api/generation-sessions/:id/events — Lifecycle event stream (polling)
// ============================================================================
router.get("/:id/events", asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { organizationId } = await getUserOrgContext(req);
  if (!organizationId) {
    throw new BadRequestError("Organization context required");
  }

  // Validate session exists
  const session = await pipelineOrchestratorService.getSession(id);
  if (!session) {
    throw new NotFoundError("Generation session not found");
  }

  // Parse optional cursor (since) parameter
  const sinceParam = req.query.since as string | undefined;
  let since: Date | undefined;
  if (sinceParam) {
    const parsed = new Date(sinceParam);
    if (isNaN(parsed.getTime())) {
      throw new BadRequestError("Invalid 'since' parameter — must be a valid ISO timestamp");
    }
    since = parsed;
  }

  // Query events filtered by pipeline type, source, and session subject
  const rawEvents = await eventStream.queryEvents({
    types: ["pipeline.*"],
    sources: ["pipeline-orchestrator"],
    since,
    limit: 100,
    organizationId,
    search: `session:${id}`,
  });

  // Map to PipelineLifecycleEvent shape and order chronologically (oldest first)
  const events: PipelineLifecycleEvent[] = rawEvents
    .filter(e => e.context?.subject === `session:${id}`)
    .sort((a, b) => a.timestamp - b.timestamp)
    .map(e => ({
      eventType: e.eventType.replace("pipeline.", "") as PipelineLifecycleEvent["eventType"],
      sessionId: id,
      orgId: organizationId,
      timestamp: new Date(e.timestamp),
      payload: e.payload,
    }));

  // Cursor is the timestamp of the last event (ISO string), or the since param if no events
  const cursor = events.length > 0
    ? events[events.length - 1].timestamp.toISOString()
    : (sinceParam ?? new Date(0).toISOString());

  res.json({ events, cursor });
}));

// ============================================================================
// POST /api/generation-sessions/:id/cancel — Cancel active session
// ============================================================================
router.post("/:id/cancel", asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { reason } = req.body;

  await pipelineOrchestratorService.cancelSession(id, reason ?? "Cancelled by user");
  res.json({ success: true, message: "Session cancelled" });
}));

// ============================================================================
// POST /api/generation-sessions/:id/retry-phase — Re-execute failed phase
// ============================================================================
router.post("/:id/retry-phase", asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const session = await pipelineOrchestratorService.getSession(id);

  if (!session) {
    throw new NotFoundError("Generation session not found");
  }

  if (session.status !== "failed") {
    throw new BadRequestError("Can only retry phases on failed sessions");
  }

  // Re-trigger the current (failed) phase by calling onPhaseComplete predecessor logic
  // The orchestrator will re-attempt the failed phase
  const currentPhase = session.currentPhase;
  if (!currentPhase) {
    throw new BadRequestError("No current phase to retry");
  }

  // Transition back to active and re-attempt
  await pipelineOrchestratorService.onPhaseFailed(id, currentPhase, "__retry__");

  res.json({ success: true, message: `Retrying phase: ${currentPhase}` });
}));

// ============================================================================
// POST /api/generation-sessions/:id/approve-scope — Approve scope review
// ============================================================================
router.post("/:id/approve-scope", asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const session = await pipelineOrchestratorService.getSession(id);

  if (!session) {
    throw new NotFoundError("Generation session not found");
  }

  // Session must be in "blocked" or "paused" status (awaiting scope review)
  if (session.status !== "blocked" && session.status !== "paused") {
    res.status(409).json({
      error: "Cannot perform action",
      currentStatus: session.status,
      reason: "Session is not awaiting scope review. Expected status: blocked or paused.",
    });
    return;
  }

  // Transition to active
  await db
    .update(generationSessions)
    .set({ status: "active", updatedAt: new Date() })
    .where(eq(generationSessions.id, id));

  // Emit lifecycle event for scope approval
  const { organizationId } = await getUserOrgContext(req);
  sessionLifecycleManager.emitEvent({
    eventType: "human_review_requested",
    sessionId: id,
    orgId: organizationId!,
    timestamp: new Date(),
    payload: { action: "scope_approved", resolution: "approved" },
  });

  const updatedSession = await pipelineOrchestratorService.getSession(id);
  res.json(updatedSession);
}));

// ============================================================================
// POST /api/generation-sessions/:id/force-approve-gate — Force approve quality gate
// ============================================================================
router.post("/:id/force-approve-gate", asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { reason } = req.body;
  const session = await pipelineOrchestratorService.getSession(id);

  if (!session) {
    throw new NotFoundError("Generation session not found");
  }

  // Session must be in "blocked" status
  if (session.status !== "blocked") {
    res.status(409).json({
      error: "Cannot perform action",
      currentStatus: session.status,
      reason: "Session is not blocked. Expected status: blocked.",
    });
    return;
  }

  const { userId, organizationId } = await getUserOrgContext(req);

  // Record override in session metadata (JSONB)
  const currentMetadata = (session.metadata as Record<string, unknown>) ?? {};
  const gateOverrides = (currentMetadata.gateOverrides as Array<Record<string, unknown>>) ?? [];
  gateOverrides.push({
    userId,
    timestamp: new Date().toISOString(),
    reason: reason ?? "Force approved by user",
  });

  // Transition to active (toward PR generation) and update metadata
  await db
    .update(generationSessions)
    .set({
      status: "active",
      metadata: { ...currentMetadata, gateOverrides },
      updatedAt: new Date(),
    })
    .where(eq(generationSessions.id, id));

  // Emit lifecycle event for gate override
  sessionLifecycleManager.emitEvent({
    eventType: "quality_gate_passed",
    sessionId: id,
    orgId: organizationId!,
    timestamp: new Date(),
    payload: { action: "force_approved", userId, reason: reason ?? "Force approved by user" },
  });

  const updatedSession = await pipelineOrchestratorService.getSession(id);
  res.json(updatedSession);
}));

// ============================================================================
// POST /api/generation-sessions/:id/resume-budget — Resume budget-paused session
// ============================================================================
router.post("/:id/resume-budget", asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { newBudgetLimitUsd } = req.body;
  const session = await pipelineOrchestratorService.getSession(id);

  if (!session) {
    throw new NotFoundError("Generation session not found");
  }

  // Session must be in "paused" status
  if (session.status !== "paused") {
    res.status(409).json({
      error: "Cannot perform action",
      currentStatus: session.status,
      reason: "Session is not paused. Expected status: paused.",
    });
    return;
  }

  // Build update: transition to active, optionally update budget limit
  const updateData: Record<string, unknown> = {
    status: "active",
    updatedAt: new Date(),
  };
  if (newBudgetLimitUsd !== undefined) {
    updateData.budgetLimitUsd = String(newBudgetLimitUsd);
  }

  await db
    .update(generationSessions)
    .set(updateData)
    .where(eq(generationSessions.id, id));

  // Emit lifecycle event for budget resume
  const { organizationId } = await getUserOrgContext(req);
  sessionLifecycleManager.emitEvent({
    eventType: "budget_alert",
    sessionId: id,
    orgId: organizationId!,
    timestamp: new Date(),
    payload: { action: "budget_resumed", newBudgetLimitUsd: newBudgetLimitUsd ?? null },
  });

  const updatedSession = await pipelineOrchestratorService.getSession(id);
  res.json(updatedSession);
}));

export default router;
