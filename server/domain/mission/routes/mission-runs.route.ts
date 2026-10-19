/**
 * Missions API
 *
 * CRUD and operations for durable missions (Blackboard as State Machine).
 * Aligned with docs/specs/MISSIONS_SPEC.md
 *
 * Local Runner (MCP): POST /:id/assign-local, GET /assignments, POST /assignments/:id/complete
 * Use Bearer token with runnerScope: "local" for local runner auth.
 */

import { Router, Request, Response } from "express";
import { missionRunService } from "../core/mission-run.service.js";
import { missionQueryService } from "../core/mission-query.service.js";
import { missionEvidenceTimelineService } from "../core/mission-evidence-timeline.service.js";
import {
  buildEvidenceIntegrityManifest,
  classifyMissionEvidence,
} from "../core/mission-audit-integrity.js";
import { getOrganizationReliabilityEvidence } from "../core/mission-reliability-evidence.service.js";
import { attestAuditReport, renderAuditReportHtml } from "../core/mission-audit-report.js";
import { z } from "zod";
import { SupervisorPlanSchema } from "@shared/schema/supervisor.js";
import { mcpAuthMiddleware, checkLocalRunnerScope } from "../../../mcp/auth.js";
import { asyncHandler } from "../../../middleware/error-handler.js";
import { NotFoundError, BadRequestError } from "@server/utils/errors.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { validateIdParam, parseNumericParam } from "../../../utils/api-utils.js";
import { getUserOrgContext, requireOrgId } from "../../../utils/auth-context.js";
import { requireOrganizationPermission } from "../../../utils/organization-permissions.js";
import type { MissionEvidenceEvent, MissionEvidenceTimeline } from "../core/mission-evidence-timeline.service.js";
import { reasoningAssessmentService } from "../core/reasoning-assessment.service.js";

export const missionRunsRouter = Router();

/**
 * Loads a run the caller may act on: one in the caller's organization, or any run
 * for a super admin. A run in another organization reads as not found, so a route
 * cannot be pointed at another tenant's run by its id alone.
 *
 * The organization comes from getUserOrgContext, which still accepts a
 * caller-supplied org without a membership check (observe-only until user_orgs is
 * backfilled — see the note there). This closes the unscoped path; that one closes
 * when membership enforcement lands.
 */
async function getRunForCaller(req: Request, id: number) {
  const context = await getUserOrgContext(req);
  if (context.isSuperAdmin) return missionRunService.getByIdOrThrow(id);
  return missionRunService.getByIdOrThrow(id, requireOrgId(context));
}

/**
 * GET /api/missions/dashboard
 * Get aggregated stats for the mission dashboard.
 */
missionRunsRouter.get("/dashboard", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgId = req.query.orgId ? validateIdParam(req.query.orgId, "Organization ID") : req.organizationId;
    if (!orgId) throw new BadRequestError("Organization context required");

    const stats = await missionRunService.getMissionDashboardStats(orgId);
    res.json(stats);
}));

/**
 * GET /api/agents/dashboard
 * Get aggregated stats for the agent dashboard.
 */
missionRunsRouter.get("/agents/dashboard", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgId = req.query.orgId ? validateIdParam(req.query.orgId, "Organization ID") : req.organizationId;
    if (!orgId) throw new BadRequestError("Organization context required");

    const stats = await missionRunService.getAgentDashboardStats(orgId);
    res.json(stats);
}));

/**
 * GET /api/mission-runs/reliability-evidence
 * Environment-separated reliability evidence. Demo and shadow runs remain
 * visible in integration cohorts and cannot inflate production claims.
 */
missionRunsRouter.get("/reliability-evidence", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const orgId = req.query.orgId ? validateIdParam(req.query.orgId, "Organization ID") : req.organizationId;
  if (!orgId) throw new BadRequestError("Organization context required");
  const days = parseNumericParam(req.query.days, 30);
  res.json(await getOrganizationReliabilityEvidence(orgId, days));
}));

const createMissionSchema = z.object({
  missionId: z.number(),
  organizationId: z.number().optional(),
  name: z.string().min(1),
  pipelineSequence: z.array(z.number()),
  createdBy: z.string().min(1),
});

const updateMissionSchema = z.object({
  missionContext: z.record(z.unknown()).optional(),
  status: z.enum(["active", "paused", "waiting_on_human", "waiting_on_file", "completed", "failed"]).optional(),
  currentPipelineId: z.number().optional(),
  currentStepIndex: z.number().optional(),
});

function summarizeAuditBundle(timeline: MissionEvidenceTimeline) {
  const countsByKind = timeline.events.reduce<Record<string, number>>((acc, event) => {
    acc[event.kind] = (acc[event.kind] ?? 0) + 1;
    return acc;
  }, {});
  const approvalEvents = timeline.events.filter((event) => event.kind === "approval");
  const actionEvents = timeline.events.filter((event) => event.kind === "action");
  const computerUseEvents = timeline.events.filter((event) => event.kind === "computer_use");
  const failedEvents = timeline.events.filter((event) => {
    const status = String(event.status || "").toLowerCase();
    return status.includes("fail") || status.includes("reject") || event.event.toLowerCase().includes("failed");
  });

  return {
    eventCount: timeline.events.length,
    countsByKind,
    approvals: {
      total: approvalEvents.length,
      pending: approvalEvents.filter((event) => event.status === "pending").length,
      approved: approvalEvents.filter((event) => event.status === "approved").length,
      rejected: approvalEvents.filter((event) => event.status === "rejected").length,
    },
    actions: {
      total: actionEvents.length,
      failed: actionEvents.filter((event) => String(event.status || "").toLowerCase().includes("fail")).length,
    },
    replayability: {
      hasDynamicTrace: timeline.events.some((event) => event.source === "dynamic_trace"),
      hasCheckpoints: timeline.events.some((event) => event.kind === "checkpoint"),
      hasApprovals: approvalEvents.length > 0,
      hasComputerUseReplay: computerUseEvents.length > 0,
    },
    riskHints: [
      approvalEvents.some((event) => event.status === "pending") ? "pending approval requires human decision" : undefined,
      failedEvents.length > 0 ? `${failedEvents.length} failed or rejected event(s) present` : undefined,
      computerUseEvents.length > 0 ? "computer-use steps should be reviewed for redaction and target confidence" : undefined,
      actionEvents.length > 0 ? "action events may represent system mutations or external calls" : undefined,
    ].filter(Boolean),
  };
}

function redactEvidenceEvent(event: MissionEvidenceEvent): MissionEvidenceEvent {
  if (!("payload" in event) || event.payload == null) return event;
  return {
    ...event,
    payload: "[redacted: pass includePayloads=true to export event payloads]",
  };
}

/**
 * GET /api/missions/assignments
 * List pending assignments for local runner to poll.
 * Requires MCP Bearer token with runnerScope: "local".
 * Must be defined before /:id to avoid matching "assignments" as id.
 */
missionRunsRouter.get("/assignments", mcpAuthMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const auth = (req as any).mcpAuth;
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const hasLocal = await checkLocalRunnerScope(auth.tokenId);
  if (!hasLocal) {
    return res.status(403).json({ error: "Forbidden", message: "Token must have runnerScope: local" });
  }
  const assignments = await missionRunService.listPendingAssignments(auth.organizationId);
  res.json({ assignments });
}));

/**
 * POST /api/missions/assignments/:id/complete
 * Local runner reports result of executed step.
 * Requires MCP Bearer token with runnerScope: "local".
 */
missionRunsRouter.post("/assignments/:id/complete", mcpAuthMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const auth = (req as any).mcpAuth;
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const hasLocal = await checkLocalRunnerScope(auth.tokenId);
  if (!hasLocal) {
    return res.status(403).json({ error: "Forbidden", message: "Token must have runnerScope: local" });
  }
  const assignmentId = validateIdParam(req.params.id, "Assignment ID");
  const { success, output, error } = req.body || {};
  const updated = await missionRunService.completeAssignment(assignmentId, { success: !!success, output: output || "", error }, auth.organizationId);
  if (!updated) throw new NotFoundError("Assignment not found");
  res.json({ assignment: updated, message: "Assignment completed" });
}));

/**
 * GET /api/missions
 * List missions (query: missionId, orgId, status)
 */
missionRunsRouter.get("/", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const missionId = req.query.missionId ? validateIdParam(req.query.missionId, "Mission ID") : undefined;
  // Always scope to the authenticated org; super-admins may pass orgId explicitly
  const orgId = req.query.orgId ? validateIdParam(req.query.orgId, "Organization ID") : req.organizationId;
  if (!orgId) throw new BadRequestError("Organization context required");
  const status = req.query.status as any;

  const missions = await missionRunService.list({
    missionId,
    organizationId: orgId,
    status,
  });
  res.json(missions);
}));

/**
 * GET /api/mission-runs/in-flight
 * Runs that are executing or waiting in the caller's organization, with real
 * spend, budget and last trace event (see core/in-flight-runs.ts). Feeds the
 * Copilot flight deck. Must be declared before /:id.
 *
 * Scoped to one organization even for a super admin: "all orgs" is never the
 * right answer for a per-workspace panel.
 */
missionRunsRouter.get("/in-flight", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const context = await getUserOrgContext(req);
  const orgId = requireOrgId(context);
  const runs = await missionQueryService.listInFlightRuns(orgId);
  res.json(runs);
}));

/**
 * POST /api/missions/bulk-delete
 * Delete multiple missions. Body: { ids: number[] }
 */
missionRunsRouter.post("/bulk-delete", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const ids = req.body.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "Invalid 'ids' array" });
  }
  const orgId = req.query.orgId ? validateIdParam(req.query.orgId, "Organization ID") : req.organizationId;
  const count = await missionRunService.bulkDelete(ids, orgId);
  res.json({ message: `Deleted ${count} missions`, deletedCount: count });
}));

/**
 * GET /api/missions/:id
 * Get mission detail with checkpoints
 */
missionRunsRouter.get("/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const id = validateIdParam(req.params.id, "Mission Run ID");
  const orgId = req.query.orgId ? validateIdParam(req.query.orgId, "Organization ID") : req.organizationId;

  let mission = await missionRunService.getById(id, orgId);
  if (!mission) {
    const orgContext = await getUserOrgContext(req);
    if (orgContext.isSuperAdmin) {
      mission = await missionRunService.getById(id);
    }
  }
  if (!mission) throw new NotFoundError("Mission not found");
  res.json(mission);
}));

/**
 * POST /api/missions
 * Create mission
 */
missionRunsRouter.post("/", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const parsed = createMissionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message, issues: parsed.error.issues });
  }
  const mission = await missionRunService.create(parsed.data);
  res.status(201).json(mission);
}));

/**
 * PUT /api/missions/:id
 * Update mission (e.g. missionContext)
 */
missionRunsRouter.put("/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const id = validateIdParam(req.params.id, "Mission Run ID");
  const parsed = updateMissionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message, issues: parsed.error.issues });
  }
  // update() writes by id alone.
  await getRunForCaller(req, id);
  const mission = await missionRunService.update(id, parsed.data);
  res.json(mission);
}));

/**
 * DELETE /api/missions/:id
 * Delete mission
 */
missionRunsRouter.delete("/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const id = validateIdParam(req.params.id, "Mission Run ID");
  const orgId = req.query.orgId ? validateIdParam(req.query.orgId, "Organization ID") : req.organizationId;
  await missionRunService.delete(id, orgId);
  res.json({ message: "Mission deleted" });
}));

/**
 * POST /api/missions/:id/resume
 * Manual resume. Body: { matchedFilePath?: string } for file wake-up.
 */
missionRunsRouter.post("/:id/resume", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const id = validateIdParam(req.params.id, "Mission Run ID");
  const matchedFilePath = req.body?.matchedFilePath;
  // Both service calls act on the id alone; the org check has to happen first.
  const run = await getRunForCaller(req, id);
  const { createLogger } = await import("@server/utils/logger.js");
  const rlog = createLogger("MissionRoute");
  rlog.info(`[Route] Resuming run ${id}`);
  await missionRunService.resumeMissionRun(id, matchedFilePath);
  const mission = await missionRunService.getByIdOrThrow(id, run.organizationId ?? undefined);
  res.json(mission);
}));

/**
 * POST /api/missions/:id/pause
 * Manually pause a mission run.
 */
missionRunsRouter.post("/:id/pause", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const id = validateIdParam(req.params.id, "Mission Run ID");
  const run = await getRunForCaller(req, id);
  await missionRunService.pause(id);
  const mission = await missionRunService.getByIdOrThrow(id, run.organizationId ?? undefined);
  res.json(mission);
}));

/**
 * POST /api/missions/:id/terminate
 * Manually terminate a mission run.
 */
missionRunsRouter.post("/:id/terminate", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const id = validateIdParam(req.params.id, "Mission Run ID");
  const run = await getRunForCaller(req, id);
  const userId = (req as any).user?.id || "system";
  await missionRunService.terminate(id, userId);
  const mission = await missionRunService.getByIdOrThrow(id, run.organizationId ?? undefined);
  res.json(mission);
}));

/**
 * GET /api/missions/:id/checkpoints
 * Checkpoint history for timeline
 */
missionRunsRouter.get("/:id/checkpoints", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const id = validateIdParam(req.params.id, "Mission Run ID");
  const limit = parseNumericParam(req.query.limit, 50);
  // Checkpoints carry the blackboard, and are read by run id alone.
  await getRunForCaller(req, id);
  const checkpoints = await missionRunService.getCheckpoints(id, limit);
  res.json(checkpoints);
}));

/**
 * GET /api/missions/:id/dwell-time
 * Simple dwell time: "Waiting since X" for waiting_on_file or waiting_on_human.
 * Returns waitingSinceMs and human-readable string.
 */
missionRunsRouter.get("/:id/dwell-time", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const id = validateIdParam(req.params.id, "Mission Run ID");
  const mission = await getRunForCaller(req, id);
  const isWaiting =
    mission.status === "waiting_on_file" || mission.status === "waiting_on_human";
  const lastCheckpoint = mission.lastCheckpointAt
    ? new Date(mission.lastCheckpointAt).getTime()
    : null;
  const now = Date.now();
  const waitingSinceMs = lastCheckpoint ? now - lastCheckpoint : 0;

  const formatDwell = (ms: number) => {
    const sec = Math.floor(ms / 1000);
    const min = Math.floor(sec / 60);
    const hr = Math.floor(min / 60);
    const d = Math.floor(hr / 24);
    if (d > 0) return `${d}d ${hr % 24}h`;
    if (hr > 0) return `${hr}h ${min % 60}m`;
    if (min > 0) return `${min}m ${sec % 60}s`;
    return `${sec}s`;
  };

  res.json({
    isWaiting,
    waitingSinceMs: isWaiting ? waitingSinceMs : 0,
    waitingSinceHuman: isWaiting ? formatDwell(waitingSinceMs) : null,
    lastCheckpointAt: mission.lastCheckpointAt,
  });
}));

/**
 * GET /api/missions/:id/timeline
 * Combined timeline: checkpoints + approval events for Decision Timeline
 */
missionRunsRouter.get("/:id/timeline", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const id = validateIdParam(req.params.id, "Mission Run ID");
  const limit = parseNumericParam(req.query.limit, 50);
  // Checkpoints and approval events, read by run id alone.
  await getRunForCaller(req, id);
  const timeline = await missionRunService.getTimeline(id, limit);
  res.json(timeline);
}));

/**
 * GET /api/missions/:id/evidence-timeline
 * Canonical evidence timeline across run state, dynamic traces, checkpoints,
 * approvals, and persisted event-log records.
 */
missionRunsRouter.get("/:id/evidence-timeline", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const id = validateIdParam(req.params.id, "Mission Run ID");
  const orgId = req.query.orgId ? validateIdParam(req.query.orgId, "Organization ID") : req.organizationId;
  const limit = parseNumericParam(req.query.limit, 100);
  const direction = req.query.direction === "asc" ? "asc" : "desc";
  const includePayloads = req.query.includePayloads === "true";

  // ?kinds=action,approval,checkpoint (comma-separated)
  const kinds = typeof req.query.kinds === "string"
    ? req.query.kinds.split(",").map(s => s.trim()).filter(Boolean) as any[]
    : undefined;
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;

  const timeline = await missionEvidenceTimelineService.getEvidenceTimeline(id, {
    organizationId: orgId,
    limit,
    direction,
    includePayloads,
    kinds,
    from,
    to,
  });
  res.json(timeline);
}));

/**
 * GET /api/mission-runs/:id/audit-bundle
 * Exportable JSON bundle for governed review: normalized evidence timeline,
 * approval/action summary, replayability markers, and redacted-by-default payloads.
 */
missionRunsRouter.get("/:id/audit-bundle", requireAuth, requireOrganizationPermission("audit:export"), asyncHandler(async (req: Request, res: Response) => {
  const id = validateIdParam(req.params.id, "Mission Run ID");
  const orgId = req.query.orgId ? validateIdParam(req.query.orgId, "Organization ID") : req.organizationId;
  const limit = parseNumericParam(req.query.limit, 250);
  const includePayloads = req.query.includePayloads === "true";
  const direction = req.query.direction === "asc" ? "asc" : "desc";

  const run = await missionRunService.getById(id, orgId);
  let timelineOrgId = orgId;
  if (!run) {
    const orgContext = await getUserOrgContext(req);
    if (!orgContext.isSuperAdmin) {
      throw new NotFoundError("Mission Run not found");
    }
    timelineOrgId = undefined;
  }

  const timeline = await missionEvidenceTimelineService.getEvidenceTimeline(id, {
    organizationId: timelineOrgId,
    limit,
    direction,
    includePayloads,
  });

  const ontologyRows = await missionRunService.listOntologyActionLog(id, timelineOrgId);

  const ontologyEvents: MissionEvidenceEvent[] = ontologyRows.map(({ log, action }, index) => ({
    id: `ontology-action-${log.id}`,
    missionRunId: id,
    missionId: timeline.missionId,
    kind: "action",
    source: "ontology_action_log",
    event: "ontology_action",
    title: action?.name ?? `Ontology action ${log.actionId ?? "unknown"}`,
    timestamp: log.createdAt.toISOString(),
    sequence: timeline.events.length + index,
    status: log.status,
    actor: log.actorUserId,
    summary: `${action?.effect ?? "unknown"} ontology action · risk ${action?.riskLevel ?? "unknown"}${action?.requiresApproval ? " · approval required" : ""}`,
    action: action?.name ?? null,
    payload: includePayloads ? { params: log.params, result: log.result } : "[redacted: pass includePayloads=true to export event payloads]",
    evidence: { table: "ontology_action_log", rowId: log.id, actionId: action?.name ?? String(log.actionId ?? "") },
  }));

  const baseEvents = includePayloads
    ? timeline.events
    : timeline.events.map(redactEvidenceEvent);
  const events = [...baseEvents, ...ontologyEvents]
    .sort((a, b) => direction === "asc"
      ? Date.parse(a.timestamp) - Date.parse(b.timestamp)
      : Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, limit);
  const exportedAt = new Date().toISOString();
  const provenance = classifyMissionEvidence(run as Record<string, unknown> | null, process.env.NODE_ENV);
  const integrity = buildEvidenceIntegrityManifest(events);
  const exportId = `mission-audit:${id}:${integrity.headHash.slice(0, 16)}`;
  const bundle = {
    schemaVersion: "oddjob.mission-run.audit-bundle.v3",
    exportId,
    exportedAt,
    exportedBy: (req.session as any)?.userId ?? null,
    missionRunId: timeline.missionRunId,
    missionId: timeline.missionId,
    payloadPolicy: includePayloads ? "included" : "redacted",
    provenance,
    integrity,
    attestation: attestAuditReport(exportId, integrity.headHash),
    claims: {
      executedMission: true,
      productionEvidence: provenance.level === "production" || provenance.level === "customer_verified",
      customerVerified: provenance.customerVerified,
      limitations: provenance.claimLimitations,
    },
    summary: summarizeAuditBundle({ ...timeline, events }),
    trustReviewQuestions: [
      "Why was each approval requested?",
      "What changed after each approved action?",
      "Which sources or checkpoints support the final result?",
      "Can the action path be replayed from trace, checkpoint, approval, or computer-use evidence?",
    ],
    ontologyActions: ontologyRows.map(({ log, action }) => ({
      logId: log.id,
      actionId: log.actionId,
      actionName: action?.name ?? null,
      effect: action?.effect ?? null,
      riskLevel: action?.riskLevel ?? null,
      requiresApproval: action?.requiresApproval ?? null,
      approvalId: log.approvalId,
      status: log.status,
      actorUserId: log.actorUserId,
      createdAt: log.createdAt.toISOString(),
      params: includePayloads ? log.params : "[redacted]",
      result: includePayloads ? log.result : "[redacted]",
    })),
    timeline: {
      ...timeline,
      events,
    },
  };

  if (req.query.format === "html") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="mission-run-${id}-audit-${exportedAt.slice(0, 10)}.html"`);
    res.send(renderAuditReportHtml(bundle));
    return;
  }

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="mission-run-${id}-audit-${exportedAt.slice(0, 10)}.json"`);
  res.json(bundle);
}));

/**
 * GET /api/mission-runs/:id/autoresearch-report
 * Aggregates the full autoresearch lifecycle for a mission run:
 * sentinel triggers, shadow experiments, evaluations, optimization proposals, and synthesis events.
 */
missionRunsRouter.get("/:id/autoresearch-report", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const id = validateIdParam(req.params.id, "Mission Run ID");
  await getRunForCaller(req, id);

  // 1. All shadow runs for this parent run
  const shadows = await missionRunService.listShadowRuns(id);

  // 2. Sentinel trigger events from forensic log for skills involved in this run
  const triggerEvents = await missionRunService.listSkillFailureEvents(20);

  // 3. Optimization proposals (HIL requests) linked to shadow runs of this parent
  const shadowIds = shadows.map(s => `optimization:${s.id}`);
  const proposals: any[] = await missionRunService.listOptimizationProposals(shadowIds);

  // 4. Build phase timeline — one entry per event, sorted chronologically
  const timeline: Array<{
    phase: string;
    type: "trigger" | "experiment" | "evaluation" | "proposal" | "synthesis" | "promotion";
    title: string;
    detail: string;
    score?: number;
    isImproved?: boolean;
    status: string;
    skillId?: string;
    shadowId?: number;
    proposalId?: number;
    modelId?: string;
    strategy?: string;
    failureCount?: number;
    cost?: string;
    isAutoSynthesis?: boolean;
    timestamp: string;
  }> = [];

  // Phase 1 — Sentinel trigger events
  for (const ev of triggerEvents) {
    const attrs = ev.attributes as any;
    if (attrs?.action === "trigger_autoresearch") {
      timeline.push({
        phase: "1 — Sentinel Trigger",
        type: "trigger",
        title: `Skill reliability below threshold`,
        detail: `Skill ${attrs.skillId} at ${attrs.reliabilityIndex ?? "?"}% reliability (${attrs.totalRuns ?? "?"} runs). Autoresearch initiated.`,
        status: "triggered",
        skillId: attrs.skillId,
        timestamp: ev.createdAt?.toISOString() ?? new Date().toISOString(),
      });
    }
  }

  // Phase 2 — Shadow experiments
  for (const s of shadows) {
    const meta = (s.missionContext as any)?.autoresearchMetadata;
    const isSynth = Array.isArray((s as any).ancestorShadowIds) && (s as any).ancestorShadowIds.length > 0;
    timeline.push({
      phase: isSynth ? "6 — Synthesis" : "2 — Shadow Experiment",
      type: isSynth ? "synthesis" : "experiment",
      title: isSynth ? `Synthesized candidate from ${(s as any).ancestorShadowIds?.length ?? "?"} ancestors` : `Shadow run #${s.id} launched`,
      detail: meta?.strategy ?? (isSynth ? "Tactic merge of high-scoring ancestors." : "Experimental configuration spawned."),
      status: s.status ?? "active",
      shadowId: s.id,
      modelId: s.modelId ?? undefined,
      strategy: meta?.strategy,
      failureCount: meta?.failureCount,
      cost: s.costUsd ?? undefined,
      isAutoSynthesis: isSynth,
      timestamp: s.createdAt?.toISOString() ?? new Date().toISOString(),
    });

    // Phase 4 — Evaluation result (if scored)
    if (s.evalScore !== null && s.evalScore !== undefined) {
      timeline.push({
        phase: "4 — Consensus Evaluation",
        type: "evaluation",
        title: `Peer review complete — Score: ${s.evalScore}/100`,
        detail: s.evalReasoning ?? "No reasoning captured.",
        score: s.evalScore,
        isImproved: s.evalScore > 60,
        status: s.evalScore > 60 ? "improved" : "not_improved",
        shadowId: s.id,
        timestamp: s.updatedAt?.toISOString() ?? new Date().toISOString(),
      });
    }

    // Phase 5 — Promotion
    if (s.status === "promoted") {
      timeline.push({
        phase: "5 — Promotion",
        type: "promotion",
        title: `Shadow #${s.id} promoted to primary`,
        detail: "This configuration became the new production baseline.",
        status: "promoted",
        shadowId: s.id,
        timestamp: s.updatedAt?.toISOString() ?? new Date().toISOString(),
      });
    }
  }

  // Phase 3+5 — Optimization proposals (HIL)
  for (const p of proposals) {
    const ctx = p.context as any;
    timeline.push({
      phase: "5 — Optimization Proposal",
      type: "proposal",
      title: `HIL proposal: Shadow #${ctx?.shadowRunId} → Score ${ctx?.score ?? "?"}`,
      detail: ctx?.reasoning ?? "Awaiting human decision.",
      score: ctx?.score,
      isImproved: ctx?.improvementDetected,
      status: p.status,
      shadowId: ctx?.shadowRunId,
      proposalId: p.id,
      timestamp: p.createdAt?.toISOString() ?? new Date().toISOString(),
    });
  }

  // Sort entire timeline chronologically
  timeline.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Summary stats
  const totalShadows = shadows.length;
  const scored = shadows.filter(s => s.evalScore !== null);
  const improved = scored.filter(s => (s.evalScore ?? 0) > 60);
  const avgScore = scored.length > 0
    ? Math.round(scored.reduce((acc, s) => acc + (s.evalScore ?? 0), 0) / scored.length)
    : null;
  const totalCost = shadows.reduce((acc, s) => acc + parseFloat(s.costUsd ?? "0"), 0);
  const promoted = shadows.filter(s => s.status === "promoted").length;

  res.json({
    summary: {
      totalExperiments: totalShadows,
      evaluated: scored.length,
      improved: improved.length,
      promoted,
      avgEvalScore: avgScore,
      totalCostUsd: totalCost.toFixed(4),
      pendingProposals: proposals.filter(p => p.status === "pending").length,
    },
    timeline,
  });
}));

/**
 * GET /api/mission-runs/:id/shadow-runs
 * List shadow runs for a parent run.
 */
missionRunsRouter.get("/:id/shadow-runs", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const id = validateIdParam(req.params.id, "Mission Run ID");
  await getRunForCaller(req, id);
  const shadowRuns = await missionRunService.getShadowRuns(id);
  res.json(shadowRuns);
}));

/**
 * POST /api/mission-runs/shadow-runs/:id/promote
 * Promote a shadow run to primary.
 */
missionRunsRouter.post("/shadow-runs/:id/promote", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const id = validateIdParam(req.params.id, "Shadow Run ID");
  const { userId } = await getUserOrgContext(req);
  await missionRunService.promoteShadowRun(id, userId);
  res.json({ message: "Shadow run promoted to primary" });
}));

/**
 * GET /api/mission-runs/skills/:skillId/version-history
 * Linear snapshot history for a skill, populated by autoresearch promotions/rollbacks.
 */
missionRunsRouter.get("/skills/:skillId/version-history", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const skillId = validateIdParam(req.params.skillId, "Skill ID");
  const { skillPromotionService } = await import("../core/skill-promotion.service.js");
  res.json(await skillPromotionService.getVersionHistory(skillId));
}));

/**
 * POST /api/mission-runs/skills/:skillId/rollback
 * Manually roll back a skill to its prior durable version.
 */
missionRunsRouter.post("/skills/:skillId/rollback", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const skillId = validateIdParam(req.params.skillId, "Skill ID");
  const { userId } = await getUserOrgContext(req);
  const { skillPromotionService } = await import("../core/skill-promotion.service.js");
  await skillPromotionService.rollbackSkill(skillId, { reason: req.body?.reason || "Manual rollback", actor: userId });
  res.json({ message: "Skill rolled back" });
}));

/**
 * POST /api/mission-runs/shadow-runs/:id/extract
 * Extract a shadow run to a reusable template.
 */
missionRunsRouter.post("/shadow-runs/:id/extract", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const id = validateIdParam(req.params.id, "Shadow Run ID");
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: "Template name is required" });

  const template = await missionRunService.extractShadowRunToTemplate(id, name, description);
  res.json({ message: "Shadow run extracted to template", template });
}));

/**
 * POST /api/mission-runs/:id/synthesize-skill
 * Synthesize an autonomous skill from verified human intervention on this mission run.
 */
missionRunsRouter.post("/:id/synthesize-skill", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const id = validateIdParam(req.params.id, "Mission Run ID");
  const orgContext = await getUserOrgContext(req);
  const organizationId = orgContext.organizationId;
  if (organizationId == null) {
    return res.status(400).json({ error: "Active organization context is required" });
  }

  const { approvalRequestId, skillName, customInstructions } = req.body || {};
  const { skillGeneratorService } = await import("../core/skill-generator.service.js");
  const result = await skillGeneratorService.synthesizeFromIntervention({
    missionRunId: id,
    approvalRequestId: approvalRequestId ? Number(approvalRequestId) : undefined,
    organizationId,
    skillName,
    userId: (req as any).user?.id,
    customInstructions,
  });

  res.json({
    message: "Skill synthesized successfully from mission intervention",
    ...result,
  });
}));

/**
 * POST /api/missions/:id/assign-local
 * Local runner claims pending assignments for this mission.
 * Requires MCP Bearer token with runnerScope: "local".
 */
missionRunsRouter.post("/:id/assign-local", mcpAuthMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const auth = (req as any).mcpAuth;
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const hasLocal = await checkLocalRunnerScope(auth.tokenId);
  if (!hasLocal) {
    return res.status(403).json({ error: "Forbidden", message: "Token must have runnerScope: local" });
  }
  const missionId = validateIdParam(req.params.id, "Mission ID");
  const mission = await missionRunService.getById(missionId, auth.organizationId);
  if (!mission) throw new NotFoundError("Mission not found");
  const claimed = await missionRunService.claimAssignments(missionId, `token:${auth.tokenId}`, auth.organizationId);
  res.json({ assignment: claimed, message: claimed ? "Assignment claimed" : "No pending assignments" });
}));

/**
 * PATCH /api/mission-runs/:id/plan
 * Update the mission plan (supervisor checklist).
 */
missionRunsRouter.patch("/:id/plan", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const id = validateIdParam(req.params.id, "Mission Run ID");
  const userId = (req as any).user?.id || "system";

  // Validate request body
  const parsed = SupervisorPlanSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid plan format", issues: parsed.error.issues });
  }

  const mission = await getRunForCaller(req, id);
  const currentPlan = (mission.missionContext as any)?.plan || {};
  const newPlan = { ...currentPlan, ...req.body };

  const updatedMission = await missionRunService.updatePlan(id, newPlan, userId);
  res.json(updatedMission);
}));

/**
 * POST /api/mission-runs/:id/simulate
 * Dry-run simulation of a mission plan.
 */
missionRunsRouter.post("/:id/simulate", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const id = validateIdParam(req.params.id, "Mission Run ID");
  await getRunForCaller(req, id);
  const results = await missionRunService.simulatePlan(id);
  res.json(results);
}));

missionRunsRouter.get("/:id/reasoning", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const id = validateIdParam(req.params.id, "Mission Run ID");
  await getRunForCaller(req, id);
  const feed = await missionRunService.getReasoningFeed(id);
  res.json(feed);
}));

missionRunsRouter.get("/:id/reasoning-assessment", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const id = validateIdParam(req.params.id, "Mission Run ID");
  // req.organizationId is undefined for a user with no default org, which made
  // getById unscoped.
  const run = await getRunForCaller(req, id);
  const existing = (run.missionContext as any)?.reasoningGym;
  res.json(existing ?? await reasoningAssessmentService.assessAndPersist(id));
}));

missionRunsRouter.post("/:id/reasoning-assessment", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const id = validateIdParam(req.params.id, "Mission Run ID");
  await getRunForCaller(req, id);
  res.json(await reasoningAssessmentService.assessAndPersist(id));
}));

/**
 * POST /api/mission-runs/:id/recovery
 * Apply a recovery strategy to a mission run.
 */
missionRunsRouter.post("/:id/recovery", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const id = validateIdParam(req.params.id, "Mission Run ID");
  const { strategy, customInstructions, proposedAction } = req.body;
  const userId = (req as any).user?.id || "system";

  await getRunForCaller(req, id);
  await missionRunService.applyRecoveryStrategy(id, strategy, customInstructions, userId, proposedAction);
  res.json({ message: "Recovery strategy initiated" });
}));

/**
 * POST /api/mission-runs/:id/convert
 * Convert a dynamic mission run into a pre-planned mission.
 */
missionRunsRouter.post("/:id/convert", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const id = validateIdParam(req.params.id, "Mission Run ID");
  const userId = (req as any).user?.id || "system";

  await getRunForCaller(req, id);
  const { missionService } = await import("../core/mission.service.js");
  const newMission = await (missionService as any).convertToPrePlanned(id, userId);

  res.status(201).json(newMission);
}));

/**
 * POST /api/missions/:id/advance
 * Advance mission run to the next pipeline in sequence.
 */
missionRunsRouter.post("/:id/advance", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const id = validateIdParam(req.params.id, "Mission Run ID");
  const run = await getRunForCaller(req, id);
  const { missionService } = await import("../core/mission.service.js");
  await missionService.advanceSequence(id);
  const mission = await missionRunService.getByIdOrThrow(id, run.organizationId ?? undefined);
  res.json(mission);
}));

/**
 * GET /api/mission-runs/:id/replay/checkpoints
 * List available replay checkpoints (blackboard history snapshots) for a run.
 */
missionRunsRouter.get("/:id/replay/checkpoints", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const missionRunId = validateIdParam(req.params.id, "Mission Run ID");
    await getRunForCaller(req, missionRunId);
    const { missionReplayService } = await import("../core/mission-replay.service.js");
    const result = await missionReplayService.getReplayHistory(missionRunId);
    res.json(result);
}));

/**
 * POST /api/mission-runs/:id/replay
 * Replay a completed/failed run from a specific checkpoint snapshot.
 * Body: { checkpointId: number, dryRun?: boolean, modifyParameters?: object }
 */
missionRunsRouter.post("/:id/replay", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const missionRunId = validateIdParam(req.params.id, "Mission Run ID");
    const { checkpointId, dryRun, modifyParameters, stopBeforeTools, withDivergenceReport } = req.body;
    const userId = (req as any).user?.id || "system";

    if (!checkpointId) {
        return res.status(400).json({ error: "checkpointId is required. Call GET /replay/checkpoints first." });
    }

    // Replay re-executes the run, by id alone.
    await getRunForCaller(req, missionRunId);
    const { missionReplayService } = await import("../core/mission-replay.service.js");
    const opts = {
        dryRun: !!dryRun,
        modifyParameters,
        stopBeforeTools: Array.isArray(stopBeforeTools) ? stopBeforeTools : undefined,
    };

    const result = withDivergenceReport
        ? await missionReplayService.replayWithDivergenceReport(missionRunId, validateIdParam(checkpointId, "checkpointId"), userId, opts)
        : await missionReplayService.replayFromCheckpoint(missionRunId, validateIdParam(checkpointId, "checkpointId"), userId, opts);

    res.json(result);
}));

/**
 * GET /api/mission-runs/:id/replay/compare/:compareId
 * Compare this run against another run (e.g. its replay) for divergence analysis.
 */
missionRunsRouter.get("/:id/replay/compare/:compareId", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const runIdA = validateIdParam(req.params.id, "Mission Run ID");
    const runIdB = validateIdParam(req.params.compareId, "Compare Run ID");
    // Both sides: comparing against a run in another organization would disclose it.
    await getRunForCaller(req, runIdA);
    await getRunForCaller(req, runIdB);
    const { missionReplayService } = await import("../core/mission-replay.service.js");
    const result = await missionReplayService.compareRuns(runIdA, runIdB);
    res.json(result);
}));

/**
 * GET /api/mission-runs/:id/history
 * Full execution history for a mission run, based on cycle_run_events.
 * Supports filtering by status and stepCode.
 */
missionRunsRouter.get("/:id/history", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const runId = validateIdParam(req.params.id, "Mission Run ID");
    const { status, stepCode } = req.query;

    await getRunForCaller(req, runId);
    const events = await missionRunService.getRunEvents(runId, {
        status: typeof status === 'string' ? status : undefined,
        stepCode: typeof stepCode === 'string' ? stepCode : undefined,
    });

    res.json(events);
}));

export default missionRunsRouter;
