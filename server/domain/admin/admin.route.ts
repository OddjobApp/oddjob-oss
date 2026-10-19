import { Router, type Request, type Response } from "express";
import { requireAuth } from "../auth/core/security.service.js";
import { assertOrgId, getUserOrgContext, requireSuperAdmin } from "../../utils/auth-context.js";
import { redis } from "@domain/core/infrastructure/redis/redis-client.js";
import { asyncHandler } from "../../middleware/error-handler.js";
import { BadRequestError, ForbiddenError, ValidationError, UnauthorizedError, NotFoundError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";
import { adminService } from "./admin.service.js";
import { userService } from "../org/core/user.service.js";
import { organizationService } from "../org/core/organization.service.js";
import { organizationInviteService } from "../org/core/organization-invite.service.js";
import { credentialsService } from "../auth/core/credentials-service.js";
import { formatDate } from "date-fns";
import { SentinelService } from "../agents/core/sentinel.service.js";
import {
    getAutoresearchMaintenanceStatus,
    routeAutoresearchFindingsToAssistant
} from "./infrastructure/autoresearch-maintenance.js";

const logger = createLogger('AdminRouter');
const router = Router();

// suppressionPolicies is a system-wide table with no org column — superadmin only
router.get("/suppression-policies", requireAuth, requireSuperAdmin, asyncHandler(async (_req: Request, res: Response) => {
    const policies = await adminService.getSuppressionPolicies(200);
    res.json({ policies });
}));

// DIAGNOSTIC - Verify AdminRouter connectivity
router.get("/autoresearch/ping", (_req, res) => {
    res.json({ message: "AdminRouter: Autoresearch endpoints active", timestamp: new Date().toISOString() });
});

router.post("/autoresearch/sync", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    // Only superadmins may target a foreign org; everyone else is pinned to their own
    const orgId = (orgContext.isSuperAdmin && req.body.orgId)
        ? parseInt(req.body.orgId as string)
        : assertOrgId(orgContext.organizationId);
    if (isNaN(orgId)) throw new BadRequestError("Invalid orgId");

    logger.info('[Sync] Triggering Neural Core Sync', { orgId, correlationId: req.correlationId });
    const result = await adminService.syncNeuralCore(orgId);
    const assistantFindings = await routeAutoresearchFindingsToAssistant(orgId, result, "manual");
    res.json({ ...result, assistantFindings });
}));

router.get("/autoresearch/automation-status", requireAuth, asyncHandler(async (_req: Request, res: Response) => {
    res.json(getAutoresearchMaintenanceStatus());
}));

// ============================================================================
// ORGANIZATION SETTINGS
// ============================================================================

// Organization settings are now handled by settingsRouter

// ============================================================================
// USERS MANAGEMENT
// ============================================================================

router.get("/users", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgIdParam = req.query.orgId ? parseInt(req.query.orgId as string, 10) : undefined;
    const users = await userService.listUsers(orgContext, Number.isNaN(orgIdParam) ? undefined : orgIdParam);
    res.json(users);
}));

router.post("/users", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const { username, password, email, firstName, lastName, organizationId } = req.body;
    if (!organizationId) throw new ValidationError("Organization ID is required", { field: 'organizationId' });

    const user = await userService.createUser({
        username,
        password,
        email,
        firstName,
        lastName,
        organizationId
    }, orgContext);

    logger.info('User created', { correlationId: req.correlationId, userId: user.id, username });
    res.status(201).json(user);
}));

router.get("/users/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const id = req.params.id;
    if (!id) throw new BadRequestError("Invalid User ID");

    const user = await userService.getUser(id, orgContext);
    res.json(user);
}));

router.put("/users/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const userId = (req.session as any)?.userId;
    const id = req.params.id;
    if (!id) throw new BadRequestError("Invalid User ID");

    const user = await userService.updateUser(id, req.body, orgContext, String(userId));
    res.json(user);
}));

router.delete("/users/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const id = req.params.id;
    if (!id) throw new BadRequestError("Invalid User ID");

    await userService.deleteUser(id, orgContext);
    logger.info('User deleted', { correlationId: req.correlationId, deletedUserId: id });
    res.status(204).send();
}));

// ============================================================================
// ADMIN ROLES
// ============================================================================

router.post("/roles", requireAuth, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const { userId, roleType, organizationId } = req.body;
    const role = await adminService.assignAdminRole(userId, roleType, organizationId);
    logger.info('Admin role created', { correlationId: req.correlationId, userId, roleType });
    res.status(201).json(role);
}));

router.get("/roles", requireAuth, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const roles = await adminService.listAdminRoles();
    res.json(roles);
}));

router.delete("/roles/:id", requireAuth, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const roleId = parseInt(req.params.id);
    await adminService.removeAdminRole(roleId);
    logger.info('Admin role deleted', { correlationId: req.correlationId, roleId });
    res.status(204).send();
}));

// ============================================================================
// ORGANIZATIONS MANAGEMENT
// ============================================================================

router.post("/organizations", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organization = await organizationService.createOrganization(req.body, orgContext);
    logger.info('Organization created', { correlationId: req.correlationId, orgId: organization.id, name: organization.name });
    res.status(201).json({ organization });
}));

router.get("/organizations", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizations = await organizationService.listOrganizations(orgContext);
    res.json({ organizations });
}));

router.get("/organizations/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new BadRequestError("Invalid Organization ID");

    const org = await organizationService.getOrganization(id, orgContext);
    res.json({ organization: org });
}));

router.put("/organizations/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new BadRequestError("Invalid Organization ID");

    const updated = await organizationService.updateOrganization(id, req.body, orgContext);
    res.json({ organization: updated });
}));

router.delete("/organizations/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new BadRequestError("Invalid Organization ID");

    await organizationService.deleteOrganization(id, orgContext);
    logger.info('Organization deleted', { correlationId: req.correlationId, orgId: id });
    res.status(204).send();
}));

// Organization Settings
router.get("/organizations/:id/settings", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new BadRequestError("Invalid Organization ID");

    // Superadmins can see any org settings, admins only their own
    if (!orgContext.isSuperAdmin && orgContext.organizationId !== id) {
        throw new ForbiddenError("You do not have permission to view these settings");
    }

    const settings = await adminService.getOrgSettings(id);
    res.json({ settings });
}));

router.patch("/organizations/:id/settings", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new BadRequestError("Invalid Organization ID");

    // Only superadmins or org admins of this specific org can update
    if (!orgContext.isSuperAdmin && (orgContext.organizationId !== id || !orgContext.isAdmin)) {
        throw new ForbiddenError("Admin access for this organization is required");
    }

    if (req.body?.enterpriseRbacEnforced === true) {
        const { getOrganizationRoleAssignments } = await import("@server/utils/organization-permissions.js");
        const assignments = await getOrganizationRoleAssignments(id);
        if (assignments.length === 0) {
            throw new BadRequestError("Assign at least one operational role before enabling strict enforcement");
        }
    }

    const settings = await adminService.updateOrgSettings(id, req.body);
    res.json({ settings });
}));

// Organization Users
router.get("/organizations/:id/users", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new BadRequestError("Invalid Organization ID");

    const users = await organizationService.listOrganizationUsers(id, orgContext);
    res.json({ users });
}));

router.post("/organizations/:id/users", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const id = parseInt(req.params.id);
    const { userId } = req.body;
    if (isNaN(id)) throw new BadRequestError("Invalid Organization ID");
    if (!userId) throw new BadRequestError("User ID is required");

    await organizationService.addUserToOrganization(id, userId, orgContext);
    res.status(201).json({ message: "User added successfully" });
}));

router.delete("/organizations/:id/users/:userId", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const id = parseInt(req.params.id);
    const userId = req.params.userId;
    if (isNaN(id)) throw new BadRequestError("Invalid Organization ID");

    await organizationService.removeUserFromOrganization(id, userId, orgContext);
    res.status(204).send();
}));

// ============================================================================
// ORGANIZATION INVITES
// ============================================================================

router.get("/invites", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = assertOrgId(orgContext.organizationId);

    const invites = await organizationInviteService.listInvites(orgId, orgContext);
    res.json({ invites });
}));

router.post("/invites", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = assertOrgId(orgContext.organizationId);
    const { email, role } = req.body;

    const { notifyHooks } = await import("../auth/hooks/notify-hooks.js");
    const result = await organizationInviteService.createInvite(
        { organizationId: orgId, email, role },
        orgContext,
    );

    if (email && result.organization) {
        await notifyHooks.sendOrganizationInviteEmail(email, result.rawToken, result.organization.name, result.invite.role);
    }

    logger.info('Invite created', { correlationId: req.correlationId, inviteId: result.invite.id, organizationId: orgId });
    res.status(201).json({ token: result.rawToken, invite: result.invite });
}));

router.delete("/invites/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new BadRequestError("Invalid invite ID");

    await organizationInviteService.revokeInvite(id, orgContext);
    logger.info('Invite revoked', { correlationId: req.correlationId, inviteId: id });
    res.status(204).send();
}));

// ============================================================================
// AUTORESEARCH ORG-LEVEL REPORT
// ============================================================================

/**
 * GET /api/admin/autoresearch/org-report?orgId=&sort=&filter=&limit=
 * Aggregates autoresearch activity across ALL mission runs in the org.
 */
router.get("/autoresearch/org-report", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const requestedOrgId = req.query.orgId ? parseInt(req.query.orgId as string) : null;
    if (requestedOrgId && !orgContext.isSuperAdmin && requestedOrgId !== orgContext.organizationId) {
        throw new ForbiddenError("Cannot access another organization's autoresearch data");
    }
    const orgId = requestedOrgId ?? assertOrgId(orgContext.organizationId);
    const filterType = (req.query.filter as string) || "all";
    const sortDir = (req.query.sort as string) === "asc" ? "asc" : "desc";
    const limitN = Math.min(parseInt((req.query.limit as string) || "200"), 500);

    const candidates = await SentinelService.getEvolutionCandidatesForOrg(orgId, 80);
    let candidateRows = candidates.map((candidate) => ({
        ...candidate,
        latestMissionId: null as number | null,
        status: candidate.latestMissionRunId ? "ready" : "blocked_missing_mission_run",
        reason: candidate.latestMissionRunId
            ? "Ready for Autoresearch launch on the next sync."
            : "Telemetry is present, but no event is linked to a mission run. Autoresearch needs a parent run before creating a shadow experiment."
    }));
    const diagnostics = {
        thresholdPct: 80,
        eligibleCandidates: candidateRows.length,
        readyCandidates: candidateRows.filter(c => c.status === "ready").length,
        blockedCandidates: candidateRows.filter(c => c.status === "blocked_missing_mission_run").length,
        telemetryEvents: candidateRows.reduce((sum, c) => sum + c.total, 0),
        unlinkedEvents: candidateRows.reduce((sum, c) => sum + c.unlinkedEventCount, 0),
    };

    const { orgMissionRuns, allShadows, triggerEvents, proposals } = await adminService.getAutoresearchActivity(orgId, limitN);

    const runIds = orgMissionRuns.map(r => r.id);
    const missionIdByRunId = new Map(orgMissionRuns.map(r => [r.id, r.missionId]));
    candidateRows = candidateRows.map(candidate => ({
        ...candidate,
        latestMissionId: candidate.latestMissionRunId
            ? missionIdByRunId.get(candidate.latestMissionRunId) ?? null
            : null
    }));

    if (runIds.length === 0) {
        return res.json({
            summary: {
                totalExperiments: 0,
                evaluated: 0,
                improved: 0,
                promoted: 0,
                avgEvalScore: null,
                totalCostUsd: "0.0000",
                pendingProposals: 0,
                totalMissionsWithActivity: 0
            },
            timeline: [],
            candidates: candidateRows,
            diagnostics
        });
    }

    // Build a lookup: runId → mission name
    const runMap: Record<number, string> = {};
    orgMissionRuns.forEach(r => { runMap[r.id] = r.name || `Run #${r.id}`; });

    // 5. Build unified timeline
    const timeline: any[] = [];

    for (const ev of triggerEvents) {
        const attrs = ev.attributes as any;
        if (attrs?.action === "trigger_autoresearch") {
            timeline.push({
                phase: "1 — Sentinel Trigger", type: "trigger",
                title: `Skill reliability below threshold`,
                detail: `Skill ${attrs.skillId} at ${attrs.reliabilityIndex ?? "?"}% reliability. Autoresearch initiated.`,
                status: "triggered", skillId: attrs.skillId,
                missionRun: null,
                timestamp: ev.createdAt?.toISOString() ?? new Date().toISOString(),
            });
        }
    }

    for (const s of allShadows) {
        const meta = (s.missionContext as any)?.autoresearchMetadata;
        const isSynth = Array.isArray((s as any).ancestorShadowIds) && (s as any).ancestorShadowIds.length > 0;
        const runName = runMap[s.parentRunId] ?? `Run #${s.parentRunId}`;
        const parentMissionId = missionIdByRunId.get(s.parentRunId) ?? null;

        timeline.push({
            phase: isSynth ? "6 — Synthesis" : "2 — Shadow Experiment",
            type: isSynth ? "synthesis" : "experiment",
            title: isSynth ? `Synthesized candidate from ${(s as any).ancestorShadowIds?.length ?? "?"} ancestors` : `Shadow #${s.id} launched`,
            detail: meta?.strategy ?? (isSynth ? "Tactic merge of high-scoring ancestors." : "Experimental configuration spawned."),
            status: s.status ?? "active", shadowId: s.id, modelId: s.modelId ?? undefined,
            strategy: meta?.strategy, failureCount: meta?.failureCount, cost: s.costUsd ?? undefined,
            isAutoSynthesis: isSynth, missionRun: runName, parentRunId: s.parentRunId, parentMissionId,
            timestamp: s.createdAt?.toISOString() ?? new Date().toISOString(),
        });

        if (s.evalScore !== null && s.evalScore !== undefined) {
            timeline.push({
                phase: "4 — Consensus Evaluation", type: "evaluation",
                title: `Peer review — Score: ${s.evalScore}/100`,
                detail: s.evalReasoning ?? "No reasoning captured.",
                score: s.evalScore, isImproved: s.evalScore > 60,
                status: s.evalScore > 60 ? "improved" : "not_improved",
                shadowId: s.id, missionRun: runName, parentRunId: s.parentRunId, parentMissionId,
                timestamp: s.updatedAt?.toISOString() ?? new Date().toISOString(),
            });
        }

        if (s.status === "promoted") {
            timeline.push({
                phase: "5 — Promotion", type: "promotion",
                title: `Shadow #${s.id} promoted to primary`,
                detail: "This configuration became the new production baseline.",
                status: "promoted", shadowId: s.id, missionRun: runName, parentRunId: s.parentRunId, parentMissionId,
                timestamp: s.updatedAt?.toISOString() ?? new Date().toISOString(),
            });
        }
    }

    for (const p of proposals) {
        const ctx = p.modifiedOutput as any;
        const runName = ctx?.parentRunId ? (runMap[ctx.parentRunId] ?? `Run #${ctx.parentRunId}`) : null;
        const parentMissionId = ctx?.parentRunId ? (missionIdByRunId.get(ctx.parentRunId) ?? null) : null;
        timeline.push({
            phase: "5 — Optimization Proposal", type: "proposal",
            title: `HIL proposal: Shadow #${ctx?.shadowRunId} — Score ${ctx?.score ?? "?"}`,
            detail: ctx?.reasoning ?? "Awaiting human decision.",
            score: ctx?.score, isImproved: ctx?.improvementDetected, status: p.status,
            shadowId: ctx?.shadowRunId, proposalId: p.id,
            missionRun: runName, parentRunId: ctx?.parentRunId, parentMissionId,
            timestamp: p.createdAt?.toISOString() ?? new Date().toISOString(),
        });
    }

    // Filter & sort
    const filtered = filterType === "all" ? timeline : timeline.filter(e => e.type === filterType);
    filtered.sort((a, b) => sortDir === "asc"
        ? new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        : new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    // Summary
    const scored = allShadows.filter(s => s.evalScore !== null);
    const improved = scored.filter(s => (s.evalScore ?? 0) > 60);
    const avgScore = scored.length > 0 ? Math.round(scored.reduce((a, s) => a + (s.evalScore ?? 0), 0) / scored.length) : null;
    const totalCost = allShadows.reduce((a, s) => a + parseFloat(s.costUsd ?? "0"), 0);
    const missionsWithActivity = new Set(allShadows.map(s => s.parentRunId)).size;

    res.json({
        summary: {
            totalExperiments: allShadows.length,
            evaluated: scored.length,
            improved: improved.length,
            promoted: allShadows.filter(s => s.status === "promoted").length,
            avgEvalScore: avgScore,
            totalCostUsd: totalCost.toFixed(4),
            pendingProposals: proposals.filter(p => p.status === "pending").length,
            totalMissionsWithActivity: missionsWithActivity,
        },
        timeline: filtered,
        candidates: candidateRows,
        diagnostics,
    });
}));


// ============================================================================
// DEAD LETTER QUEUE
// ============================================================================

router.get("/dlq", requireAuth, requireSuperAdmin, asyncHandler(async (_req: Request, res: Response) => {
    const { getDLQJobs, getDLQStats } = await import("./core/dead-letter-queue.service.js");
    const [jobs, stats] = await Promise.all([getDLQJobs(200), getDLQStats()]);
    const serialized = jobs.map(j => ({
        id: j.id,
        name: j.name,
        data: j.data,
        timestamp: j.timestamp,
        attemptsMade: j.attemptsMade,
    }));
    res.json({ jobs: serialized, stats });
}));

router.post("/dlq/:jobId/retry", requireAuth, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const { retryDLQJob } = await import("./core/dead-letter-queue.service.js");
    const ok = await retryDLQJob(req.params.jobId);
    if (!ok) throw new NotFoundError("DLQ job not found");
    res.json({ success: true });
}));

router.delete("/dlq/:jobId", requireAuth, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const { purgeDLQJob } = await import("./core/dead-letter-queue.service.js");
    const ok = await purgeDLQJob(req.params.jobId);
    if (!ok) throw new NotFoundError("DLQ job not found");
    res.json({ success: true });
}));

router.post("/dlq/retry-all", requireAuth, requireSuperAdmin, asyncHandler(async (_req: Request, res: Response) => {
    const { getDLQJobs, retryDLQJob } = await import("./core/dead-letter-queue.service.js");
    const jobs = await getDLQJobs(500);
    const results = await Promise.all(
        jobs.filter(j => j.id).map(j => retryDLQJob(j.id!).then(() => true).catch(() => false))
    );
    const retried = results.filter(Boolean).length;
    res.json({ success: true, retried });
}));

router.delete("/dlq", requireAuth, requireSuperAdmin, asyncHandler(async (_req: Request, res: Response) => {
    const { purgeDLQ } = await import("./core/dead-letter-queue.service.js");
    const purged = await purgeDLQ();
    res.json({ success: true, purged });
}));

// ============================================================================
// CIRCUIT BREAKERS
// ============================================================================

router.get("/circuit-breakers", requireAuth, requireSuperAdmin, asyncHandler(async (_req: Request, res: Response) => {
    const { getAllCircuitStatuses } = await import("./core/circuit-breaker.service.js");
    const statuses = getAllCircuitStatuses();
    // Normalize to array for consistent frontend pagination
    const breakers = Object.entries(statuses).map(([name, stats]) => ({ name, ...stats }));
    res.json(breakers);
}));

router.post("/circuit-breakers/:name/reset", requireAuth, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const { resetCircuit, getCircuitState } = await import("./core/circuit-breaker.service.js");
    const { name } = req.params;
    if (!getCircuitState(name)) throw new NotFoundError(`Circuit breaker '${name}' not found`);
    resetCircuit(name);

    // Invalidate health triage brief cache
    try {
        const { redis } = await import("@domain/core/infrastructure/redis/redis-client.js");
        if (redis) {
            const keys = await redis.keys("health:triage-brief:*");
            if (keys.length > 0) {
                await redis.del(...keys);
            }
        }
    } catch (err: any) {
        logger.warn(`[TriageBrief] Redis invalidation failed on circuit reset: ${err?.message}`);
    }

    res.json({ success: true, name, state: "CLOSED" });
}));

// ============================================================================
// USAGE / COST METRICS
// ============================================================================

router.get("/usage/token-rate", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const metrics = await adminService.getTokenRateMetrics(since, orgContext.organizationId, orgContext.isSuperAdmin);
    res.json(metrics);
}));

// POST /api/admin/seed-demo - Toggle demo mode via Redis
router.post("/seed-demo", requireAuth, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = req.body.orgId ? parseInt(req.body.orgId as string) : orgContext.organizationId;
    if (!orgId) throw new BadRequestError("Organization context required");

    const enabled = req.body.enabled !== false; // default to true
    if (enabled) {
        await redis.set(`org:${orgId}:demo_mode`, "true");
        res.json({ success: true, message: `Demo mode activated for organization #${orgId}. Empty states will now fall back to mock data overlays.` });
    } else {
        await redis.del(`org:${orgId}:demo_mode`);
        res.json({ success: true, message: `Demo mode deactivated for organization #${orgId}.` });
    }
}));

// Sub-routers
import workersRouter from "../../routes/admin/workers.route.js";
import predictionMetricsRouter from "../../routes/admin/prediction-metrics.route.js";
router.use("/workers", workersRouter);
router.use("/metrics", predictionMetricsRouter);

import selfModificationRouter from "../../routes/admin/self-modification.route.js";
router.use("/code-modification", selfModificationRouter);

export default router;


