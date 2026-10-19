import { validateIdParam } from "@server/utils/api-utils.js";

import { Router } from "express";
import { CycleManagerService } from "../domain/mission/core/cycle-manager.service.js";
import { cycleDagService } from "../domain/mission/core/cycle-dag.service.js";
import { cycleDataflowService } from "../domain/mission/core/cycle-dataflow.service.js";
import {
    operationalCycleAccess,
    operationalCycleAggregate,
    statusForCycleFailure,
    bodyForCycleFailure,
} from "../domain/mission/core/operational-cycle-access.service.js";
import { db } from "../database_service.js";
import { operationalCycles, missionRuns, cycleBlueprints, CYCLE_STATUSES, apps } from "@shared/schema/index.js";
import { normalizeCycleInputRequirements } from "@shared/cycle-inputs.js";
import { createLogger } from "../utils/logger.js";
import { eq, desc, and, or, SQL } from "drizzle-orm";
import { requireOrgAdminOrSuper, getUserOrgContext, requireOrgId } from "../utils/auth-context.js";
import { projectPlanCommitRequestSchema } from "@shared/project-plan-commit.js";
import { commitProjectPlan } from "../domain/mission/core/project-plan-commit.service.js";
import { requireAuth } from "../domain/auth/core/security.service.js";
import { redis } from "../domain/core/infrastructure/redis/redis-client.js";
import { DemoSeedService } from "../domain/admin/demo-seed.service.js";
import { orgRateLimit } from "../middleware/org-rate-limit.js";
import type { Request, Response, NextFunction } from "express";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";
import { cacheService } from "@domain/cache/cache.service.js";
import { invalidateCachePattern } from "../utils/cache-utils.js";
import { queueService, JobPriority } from "@domain/queue/queue.service.js";
import { appRegistryService } from "@domain/apps/app-registry.service.js";
import { appQueryService } from "@domain/apps/core/app-query.service.js";
import { cycleIntegrationsService } from "@domain/mission/core/cycle-integrations.service.js";
import net from "node:net";
import { resolveProjectScope } from "@server/middleware/project-scope.js";

/**
 * Lightweight TCP liveness probe — used to detect apps the registry marks
 * "running" but whose process has actually died (dead port). Resolves true if
 * something is listening on the local port within the timeout.
 */
function probePort(port: number, timeoutMs = 1200): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let settled = false;
        const finish = (ok: boolean) => { if (settled) return; settled = true; socket.destroy(); resolve(ok); };
        socket.setTimeout(timeoutMs);
        socket.once("connect", () => finish(true));
        socket.once("timeout", () => finish(false));
        socket.once("error", () => finish(false));
        socket.connect(port, "127.0.0.1");
    });
}

const logger = createLogger("CyclesRouter");
const cycleLaunchLimit = orgRateLimit({ max: 10, windowSecs: 300, resource: "cycle" });

function invalidateCycleCache(id: number, orgId?: number | null) {
    cacheService.invalidate(`cycle:metadata:${id}`)
        .catch((err: any) => logger.warn(`[Cycle ${id}] Cache invalidation skipped: ${err?.message}`));
    if (orgId) {
        invalidateCachePattern(`cache:cycles:org:${orgId}:*`)
            .catch((err: any) => logger.warn(`[Cycle ${id}] List cache invalidation skipped: ${err?.message}`));
    } else {
        invalidateCachePattern("cache:cycles:org:*")
            .catch((err: any) => logger.warn(`[Cycle ${id}] Global list cache invalidation skipped: ${err?.message}`));
    }
}

// Debounce guard for workbench app pre-warming (appId -> last warm ms). startApp()
// is destructive (it decommissions existing instances and reprovisions), so we must
// only warm apps that are actually stopped and never re-trigger while one is still
// booting across the cycle page's repeated polls.
const workbenchWarmCache = new Map<number, number>();
const WORKBENCH_WARM_DEBOUNCE_MS = 90_000;

async function unresolvedCycleIntegrations(cycleId: number, orgId: number | null | undefined, isSuperAdmin: boolean) {
    // Allow local development and super-admin execution without hard-blocking on third-party SaaS tokens
    if (process.env.NODE_ENV !== 'production' || isSuperAdmin) {
        return [];
    }
    const result = await cycleIntegrationsService.listForCycle(cycleId, orgId ?? 0, isSuperAdmin);
    return result.integrations.filter(integration => integration.status === "missing");
}

const TIMELINE_UNIT_MS: Record<string, number> = {
    ms: 1,
    milliseconds: 1,
    s: 1000,
    seconds: 1000,
    m: 60_000,
    minutes: 60_000,
    h: 3_600_000,
    hours: 3_600_000,
    d: 86_400_000,
    days: 86_400_000,
    w: 604_800_000,
    weeks: 604_800_000,
    M: 2_629_746_000,
    months: 2_629_746_000,
};

function blueprintDurationMs(bp: any): number {
    const unit = bp?.timeUnit ?? bp?.metadata?.timeUnit ?? "d";
    const unitMs = TIMELINE_UNIT_MS[unit] ?? TIMELINE_UNIT_MS.d;
    const duration = Number(bp?.estimatedDuration);
    if (duration > 0) return duration * unitMs;
    const avgRuntime = Number(bp?.avgRuntime);
    if (avgRuntime > 0) return avgRuntime;
    const days = Number(bp?.estimatedDays);
    return (days > 0 ? days : 1) * TIMELINE_UNIT_MS.d;
}

function blueprintEstimatedDays(bp: any): number {
    return Math.max(1, Math.ceil(blueprintDurationMs(bp) / TIMELINE_UNIT_MS.d));
}

const MISSION_NAME_TO_ID: Record<string, string> = {
    "Project Initialization & Sprint Zero": "mission-0-sprint-zero",
    "Sprint Kickoff & Planning": "mission-1-kickoff",
    "Requirements & Design Analysis": "mission-2-requirements",
    "Core Application Development": "mission-3-core-dev",
    "QA & Regression Testing": "mission-4-qa",
    "Release Candidate & UAT": "mission-5-uat",
    "Production Deployment": "mission-6-deployment",
    "Production Incident & Hotfix Routing": "mission-7-production-hotfix",
    "Nightly Codebase Scouting": "mission-scouting-report",
    "Rolling Wave: Nightly Codebase Scouting": "mission-scouting-report",
    // Product Launch Cycle
    "Launch Brief & Market Analysis": "mission-0-launch-brief",
    "GTM Strategy & Positioning": "mission-1-gtm-strategy",
    "Content & Asset Creation": "mission-2-content-creation",
    "Sales Enablement & Training": "mission-3-sales-enablement",
    "Beta Program Coordination": "mission-4-beta-program",
    "Launch Day Execution": "mission-5-launch-execution",
    "Post-Launch Analysis & Iteration": "mission-6-post-launch",
    "Continuous Launch Optimization": "mission-7-ongoing-optimization",
};

const router = Router();

// All cycle routes require authentication
router.use(requireAuth);

// cycle:read — members with read-only access to cycles (e.g. analysts, observers)
// Falls through to requireOrgAdminOrSuper if the user has no cycle:read permission
function requireCycleRead(req: Request, res: Response, next: NextFunction) {
    const perms: string[] = (req as any).user?.mcpPermissions || [];
    if (perms.includes("cycle:read") || perms.includes("cycle:write") || perms.includes("admin:full")) {
        return next();
    }
    // Fall back to org-admin check (org admins always have access)
    requireOrgAdminOrSuper(req, res, next);
}

function requireCycleWrite(req: Request, res: Response, next: NextFunction) {
    const perms: string[] = (req as any).user?.mcpPermissions || [];
    if (perms.includes("cycle:write") || perms.includes("admin:full")) {
        return next();
    }
    requireOrgAdminOrSuper(req, res, next);
}

function normalizeBlueprintForUi(bp: any, metadataBlueprint?: any, latestRun?: any, workbenchApps: any[] = []) {
    const metadata = (bp.metadata as Record<string, any>) ?? {};
    const runtime = metadata.runtime ?? {};
    const uiMetadata = metadataBlueprint?.uiMetadata ?? metadataBlueprint?.ui_metadata ?? null;
    const primaryAgent = metadataBlueprint?.primaryAgent ?? metadataBlueprint?.primary_agent ?? bp.config?.primaryAgent ?? null;
    const resources = metadataBlueprint?.resources ?? metadataBlueprint?.resourcesRequired ?? metadataBlueprint?.resources_required ?? null;
    const structuredResources = Array.isArray(resources) && resources.every((resource: any) => resource && typeof resource === "object")
        ? resources
        : null;
    const normalizedResources = normalizeCycleInputRequirements(metadataBlueprint ?? bp);

    let status = runtime.status ?? metadata.status ?? "pending";
    let currentStep = runtime.currentStep ?? 0;
    let executionMetadata = runtime.executionMetadata ?? null;

    if (latestRun) {
        status = latestRun.status;
        currentStep = latestRun.currentStepIndex ?? 0;
        const duration = latestRun.updatedAt ? new Date(latestRun.updatedAt).getTime() - new Date(latestRun.createdAt).getTime() : 0;
        executionMetadata = {
            duration,
            cost: parseFloat(String(latestRun.costUsd || 0)),
            tokensUsed: (latestRun.missionContext as any)?.tokensUsed ?? 0,
            error: latestRun.failureReason || null,
            ...(executionMetadata || {}),
        };
    }

    return {
        ...bp,
        status,
        currentStep,
        totalSteps: metadataBlueprint?.sequence?.length ?? runtime.totalSteps ?? null,
        objective: metadataBlueprint?.objective || bp.objective,
        type: metadataBlueprint?.type || bp.type,
        environment: metadataBlueprint?.environment ?? bp.config?.environment ?? null,
        estimatedDurationHours: metadataBlueprint?.estimatedDurationHours ?? metadataBlueprint?.estimated_duration_hours ?? null,
        inputs: metadataBlueprint?.inputs ?? null,
        outputs: metadataBlueprint?.outputs ?? null,
        resources: normalizedResources.length > 0 ? normalizedResources : structuredResources,
        resourcesRequired: resources,
        uiMetadata,
        primaryAgent,
        primary_agent: primaryAgent,
        trigger: metadataBlueprint?.trigger ?? bp.config?.trigger ?? null,
        appStep: bp.config?.appStep ?? metadataBlueprint?.config?.appStep ?? null,
        sequence: metadataBlueprint?.sequence ?? null,
        executionMetadata,
        workbenchApps,
    };
}

async function setBlueprintRuntimeStatus(cycleId: number, appName: string, orgContext: Awaited<ReturnType<typeof getUserOrgContext>>, status: string, output?: unknown) {
    const result = await operationalCycleAggregate.setBlueprintRuntimeStatus(
        cycleId,
        orgContext,
        appName,
        status,
        output,
    );

    if (result.ok) return { kind: "ok" as const, cycle: result.cycle, blueprint: result.blueprint };
    if (result.failure === "organization-required") return { kind: "forbidden" as const };
    if (result.failure === "not-found") return { kind: "missing-cycle" as const };
    return { kind: "missing-blueprint" as const };
}

// ─── Agent Prompt Hot-Reload ─────────────────────────────────────────────────
// POST /api/cycles/agents/reload-prompts — Reload all agent system prompts from disk
router.post("/agents/reload-prompts", requireOrgAdminOrSuper, async (req: any, res) => {
    try {
        const orgContext = await getUserOrgContext(req);
        if (!orgContext.organizationId) {
            return res.status(403).json({ error: "Organization context required for prompt reload." });
        }
        const { promptHotReloadService } = await import("@domain/agents/core/prompt-hot-reload.service.js");
        const result = await promptHotReloadService.reloadAll(orgContext.organizationId);
        res.json(result);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/cycles/agents/:jobId/reload-prompt — Reload a single agent's prompt
router.post("/agents/:jobId/reload-prompt", requireOrgAdminOrSuper, async (req: any, res) => {
    try {
        const jobId = parseInt(req.params.jobId);
        if (isNaN(jobId)) return res.status(400).json({ error: "Invalid jobId" });
        const orgContext = await getUserOrgContext(req);
        const { promptHotReloadService } = await import("@domain/agents/core/prompt-hot-reload.service.js");
        const result = await promptHotReloadService.reloadAgent(jobId, orgContext.organizationId ?? undefined);
        res.json(result);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/cycles/agents/:jobId/rollback-prompt — Rollback a prompt to previous version
router.post("/agents/:jobId/rollback-prompt", requireOrgAdminOrSuper, async (req: any, res) => {
    try {
        const jobId = parseInt(req.params.jobId);
        if (isNaN(jobId)) return res.status(400).json({ error: "Invalid jobId" });
        const orgContext = await getUserOrgContext(req);
        const { promptHotReloadService } = await import("@domain/agents/core/prompt-hot-reload.service.js");
        const result = await promptHotReloadService.rollback(jobId, orgContext.organizationId ?? undefined);
        res.json(result);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// 9. Simulate a cycle (must be before /:id routes to avoid matching "simulate" as an id)
router.post("/simulate", requireCycleWrite, async (req: any, res) => {
    try {
        const simulation = await CycleManagerService.simulateCycle(req.body);
        res.json(simulation);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// 10. Generate discovery questions for a template
router.post("/questions", requireCycleWrite, async (req: any, res) => {
    try {
        const questions = await CycleManagerService.generateConfigQuestions(req.body);
        res.json(questions);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// 11. Refine blueprints based on context
router.post("/refine", requireCycleWrite, async (req: any, res) => {
    try {
        const blueprints = await CycleManagerService.refineBlueprints(req.body.template, req.body.answers);
        res.json(blueprints);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// 12. Synthesize blueprints from raw objective
router.post("/synthesize", requireCycleWrite, async (req: any, res) => {
    logger.info(`[Cycles] POST /api/cycles/synthesize - Objective length: ${req.body?.objective?.length || 0}`);
    try {
        if (!req.body.objective) {
            return res.status(400).json({ error: "Objective is required for synthesis" });
        }
        const blueprints = await CycleManagerService.synthesizeBlueprints(req.body.objective);
        logger.info(`[Cycles] Synthesis successful - Generated ${blueprints?.length || 0} blueprints`);
        res.json(blueprints);
    } catch (err: any) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error(`[Cycles] Synthesis endpoint failed: ${errorMsg}`, err);
        res.status(500).json({ error: errorMsg });
    }
});

// WEBHOOKS — register/list/delete outbound webhook subscriptions
// These must be defined BEFORE /:id routes so that /webhooks is not captured by /:id.

// GET /api/cycles/webhooks — list webhooks for caller's org
router.get("/webhooks", requireCycleRead, async (req: any, res) => {
    try {
        const { organizationId: orgId } = await getUserOrgContext(req);
        if (!orgId) return res.status(403).json({ error: "Organization context required" });
        const { CycleWebhookService } = await import("../domain/mission/core/cycle-webhook.service.js");
        res.json(await CycleWebhookService.list(orgId));
    } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /api/cycles/webhooks — register a new webhook (cycle write)
router.post("/webhooks", requireCycleWrite, async (req: any, res) => {
    try {
        const { organizationId: orgId } = await getUserOrgContext(req);
        if (!orgId) return res.status(403).json({ error: "Organization context required" });
        const { url, secret, events = ['*'] } = req.body;
        if (!url || !secret) return res.status(400).json({ error: "url and secret are required" });
        const { CycleWebhookService } = await import("../domain/mission/core/cycle-webhook.service.js");
        try {
            res.status(201).json(await CycleWebhookService.register(orgId, url, secret, events));
        } catch (validationErr: any) {
            // SSRF / URL validation errors should be 400, not 500
            res.status(400).json({ error: validationErr.message });
        }
    } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/cycles/webhooks/:webhookId — remove webhook (cycle write)
router.delete("/webhooks/:webhookId", requireCycleWrite, async (req: any, res) => {
    try {
        const { organizationId: orgId } = await getUserOrgContext(req);
        if (!orgId) return res.status(403).json({ error: "Organization context required" });
        const { CycleWebhookService } = await import("../domain/mission/core/cycle-webhook.service.js");
        await CycleWebhookService.remove(orgId, req.params.webhookId);
        res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// 2. Launch a new cycle (Org Admin Only)
router.post("/launch", requireOrgAdminOrSuper, cycleLaunchLimit, async (req: any, res) => {
    try {
        const orgContext = await getUserOrgContext(req);
        const { userId, organizationId: orgId } = orgContext;
        if (!orgId) throw new Error("Organization context required");
        const cycle = await CycleManagerService.launchCycle(req.body, userId, orgId);

        // Cache the new cycle metadata immediately
        await cacheService.set(
            `cycle:metadata:${cycle.id}`,
            { cycle, runs: [], blueprints: [], audits: [] },
            { ttl: 3600, tags: [`cycle:${cycle.id}`, `org:${orgId}`] }
        );

        // Invalidate list cache
        invalidateCachePattern(`cache:cycles:org:${orgId}:*`).catch(() => {});

        // Submit cycle synthesis job (Phase 4D)
        // Blueprint synthesis happens async; client can check job status via /api/jobs/status/:jobId
        const synthesisJob = await queueService.addJob(
            'cycle-synthesis',
            'synthesize',
            {
                cycleId: cycle.id,
                organizationId: orgId,
                blueprints: req.body.blueprints,
                resynthesisReason: 'cycle_launch',
            },
            {
                priority: JobPriority.HIGH,
                organizationId: orgId,
            }
        );

        logger.info(`Cycle launched with async synthesis`, {
            cycleId: cycle.id,
            jobId: synthesisJob.id,
            blueprintCount: req.body.blueprints?.length,
        });

        res.json({ ...cycle, jobId: synthesisJob.id });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// 2b. Save a Project Studio plan as a cycle awaiting approval (Org Admin Only).
// Same gate as /launch, but nothing runs: the cycle is pending_approval and
// starts through /:id/approve. Retrying with the same idempotencyKey returns
// the cycle the first attempt created.
router.post("/plan-commit", requireOrgAdminOrSuper, cycleLaunchLimit, async (req: any, res) => {
    const parsed = projectPlanCommitRequestSchema.safeParse(req.body);
    // Errors use the { error: { message, code, details } } envelope apiRequest
    // unpacks into a ClientAppError, so the studio can show the real reason.
    if (!parsed.success) {
        const issues = parsed.error.issues.map(i => ({ path: i.path.join("."), message: i.message }));
        return res.status(400).json({
            error: { message: `The plan is not valid: ${issues[0]?.message ?? "unknown problem"}`, code: "INVALID_PLAN", details: { issues } },
        });
    }
    try {
        const orgContext = await getUserOrgContext(req);
        const orgId = requireOrgId(orgContext);
        if (!orgContext.userId) return res.status(401).json({ error: { message: "Authentication required", code: "UNAUTHORIZED" } });
        const { idempotencyKey, sessionKey, crewSessionId, projectId, ...plan } = parsed.data;
        // The header switcher's project, applied only when neither the room nor
        // the request names one. Includes the org default, deliberately: it is
        // what the header shows with nothing picked, and what a CREW room is
        // assigned on its first message — so a plan saved before anyone speaks
        // lands where the room will.
        const activeProject = await resolveProjectScope(req);
        const result = await commitProjectPlan(
            { plan, idempotencyKey, sessionKey, crewSessionId, projectId, fallbackProjectId: activeProject?.id ?? null },
            {
                organizationId: orgId,
                userId: orgContext.userId,
                isSuperAdmin: orgContext.isSuperAdmin,
                isOrgAdmin: orgContext.isOrgAdmin,
            },
        );
        res.status(result.replayed ? 200 : 201).json(result);
    } catch (err: any) {
        const status = typeof err?.statusCode === "number" ? err.statusCode : 500;
        if (status >= 500) logger.error(`[PlanCommit] ${err?.message}`);
        res.status(status).json({
            error: { message: err?.message ?? "Plan commit failed", code: err?.code ?? "INTERNAL_ERROR", details: err?.details },
        });
    }
});

// 1. List all cycles (scoped to caller's org) — cycle:read or org admin
// Query params: limit (default 20, max 100), offset (default 0), status
router.get("/", requireCycleRead, async (req: any, res) => {
    try {
        const orgContext = await getUserOrgContext(req);
        const { organizationId: orgId, isSuperAdmin } = orgContext;
        // No fallback to "whatever org is first in the table". `orgs` was not even
        // imported here, so this never compiled — but had it run, a caller with no
        // organization context would have been handed the lowest-numbered org's
        // cycles. Absent context is a 403, not a default tenant.
        if (!orgId) return res.status(403).json({ error: "Organization context required" });

        const limit = Math.min(parseInt(String(req.query.limit || 20)), 100);
        const offset = parseInt(String(req.query.offset || 0));
        const statusFilter = req.query.status as string | undefined;

        // Honour the active Project Space so the Launchpad and cycle lists show
        // what the header switcher says they are showing. orgDefault:false means
        // "no project selected" lists every cycle in the org rather than
        // inventing a default project and hiding the rest.
        const projectScope = await resolveProjectScope(req, { useDefault: false });
        const projectId = projectScope?.id ?? null;

        // projectId MUST be part of the cache key. Without it two projects in the
        // same org serve each other's cached page — a cross-project leak through
        // Redis that no amount of correct SQL below would prevent.
        const cacheKey =
            `cache:cycles:org:${orgId}:project:${projectId ?? "all"}` +
            `:limit:${limit}:offset:${offset}:status:${statusFilter || "all"}`;
        try {
            const cached = await redis.get(cacheKey);
            if (cached) {
                return res.json(JSON.parse(cached));
            }
        } catch (e: any) {
            logger.warn(`[Cycles Cache] Read error: ${e.message}`);
        }

        const page = await operationalCycleAggregate.list(orgId, {
            status: statusFilter,
            projectId,
            limit,
            offset,
        });
        let cycles = page.cycles;
        let total = page.total;

        const isRedisDemo = orgId
            ? (await redis.get(`org:${orgId}:demo_mode`)) === "true"
            : false;

        if ((cycles.length === 0 || isRedisDemo) && offset === 0) {
            const demoCycles = DemoSeedService.getDemoCycles();
            cycles = demoCycles as any;
            total = demoCycles.length;
        }

        const responseData = { cycles, total, limit, offset };
        try {
            await redis.setex(cacheKey, 30, JSON.stringify(responseData));
        } catch (e: any) {
            logger.warn(`[Cycles Cache] Write error: ${e.message}`);
        }

        res.json(responseData);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// 3. Get specific cycle details (org-scoped) — cycle:read or org admin.
//    Super admins can view any cycle regardless of their session's org context;
//    regular users are restricted to their org.
router.get("/:id", requireCycleRead, async (req: any, res) => {
    try {
        const id = validateIdParam(req.params.id);
        if (id === 991 || id === 992) {
            const demoCycles = DemoSeedService.getDemoCycles();
            const cycle = demoCycles.find(c => c.id === id);
            return res.json({
                cycle,
                runs: [],
                blueprints: [],
                audits: []
            });
        }
        const orgContext = await getUserOrgContext(req);
        const detail = await operationalCycleAggregate.findDetail(id, orgContext);
        if (!detail.ok) return res.status(statusForCycleFailure(detail.failure)).json(bodyForCycleFailure(detail.failure));
        const { cycle, runs, blueprints, audits } = detail.cycle;

        const result = { cycle, runs, blueprints, audits };

        res.json(result);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// 3.1. Get apps for a cycle (for cycle management interface)
router.get("/:id/apps", requireCycleRead, async (req: any, res) => {
    try {
        const id = validateIdParam(req.params.id);
        if (id === 991 || id === 992) {
            return res.json([]);
        }
        const orgContext = await getUserOrgContext(req);
        const found = await operationalCycleAccess.find(id, orgContext);
        if (!found.ok) return res.status(statusForCycleFailure(found.failure)).json(bodyForCycleFailure(found.failure));
        const cycle = found.cycle;

        if (cycle.name === "Autonomous Code Generation Pipeline") {
            const apps = [
                {
                    appId: 9501,
                    deploymentId: 9501,
                    name: "Pipeline Session Dashboard",
                    sourceAppId: "codegen-pipeline-dashboard",
                    interactionModel: "core-route",
                    publicPath: `/pipeline/sessions?embed=cycle&orgId=${cycle.organizationId}`,
                    externalPath: `/pipeline/sessions?orgId=${cycle.organizationId}`,
                    editPath: null,
                    status: "running",
                    health: "healthy",
                    isPublished: true,
                    dependentMissionIds: ["context-load", "change-plan", "apply-edits", "test-loop", "quality-gate", "pr-generation"],
                },
                {
                    appId: 9502,
                    deploymentId: 9502,
                    name: "Quality Metrics & Reporting",
                    sourceAppId: "codegen-quality-metrics",
                    interactionModel: "core-route",
                    publicPath: `/pipeline/metrics?embed=cycle&orgId=${cycle.organizationId}`,
                    externalPath: `/pipeline/metrics?orgId=${cycle.organizationId}`,
                    editPath: null,
                    status: "running",
                    health: "healthy",
                    isPublished: true,
                    dependentMissionIds: ["context-load", "change-plan", "apply-edits", "test-loop", "quality-gate", "pr-generation"],
                }
            ];

            const pair = await operationalCycleAggregate.listBlueprintsAndRuns(id, orgContext, {
                blueprints: 500,
                runs: 1000,
            });
            if (!pair.ok) return res.status(statusForCycleFailure(pair.failure)).json(bodyForCycleFailure(pair.failure));
            const { blueprints, runs } = pair.cycle;

            const cycleMetadata = cycle.metadata as any;
            const enhancedBlueprints = blueprints.map(bp => {
                const missionId = (bp.config as any)?.missionId;
                const metadataBlueprint = cycleMetadata?.blueprints?.find((mb: any) =>
                    mb.name === bp.name || mb.id === missionId || mb.missionId === missionId || mb.mission_id === missionId
                );
                const latestRun = runs.find(r => r.name === bp.name);
                return normalizeBlueprintForUi(bp, metadataBlueprint, latestRun, apps);
            });

            return res.json({ apps: enhancedBlueprints });
        }

        // A cycle with no organization has no apps to show. The previous query
        // asserted the organization away with `!` and added a second branch for
        // organization 291, so such a cycle listed that tenant's apps instead.
        if (cycle.organizationId == null) {
            return res.status(409).json({ error: "Cycle has no organization; its apps cannot be resolved" });
        }

        const [pair, appRows] = await Promise.all([
            operationalCycleAggregate.listBlueprintsAndRuns(id, orgContext, {
                blueprints: 500, // Max 500 blueprints per cycle
                runs: 1000,      // Last 1000 runs
            }),
            appQueryService.listDeployedAppsForOrg(cycle.organizationId),
        ]);
        if (!pair.ok) return res.status(statusForCycleFailure(pair.failure)).json(bodyForCycleFailure(pair.failure));
        const { blueprints, runs } = pair.cycle;

        // Probe only cycle-app candidates, not every deployment visible to the org.
        // The cycle manager must return quickly even when unrelated app runtimes are slow.
        const healthByAppId = new Map<number, 'healthy' | 'unhealthy' | 'unknown'>();
        const uniqueRunningApps = Array.from(new Map(appRows.map(r => [r.app.id, r.app])).values())
            .filter(a => ((a.runtimeMetadata as any)?.cycleApp ?? (a.config as any)?.cycleApp) && (a.runtimeMetadata as any)?.status === 'running');
        await Promise.all(uniqueRunningApps.map(async (a) => {
            const port = Number((a.runtimeMetadata as any)?.assignedPort);
            if (!port) { healthByAppId.set(a.id, 'unknown'); return; }
            healthByAppId.set(a.id, (await probePort(port, 300)) ? 'healthy' : 'unhealthy');
        }));

        // Merge with UI metadata from cycle metadata if available
        const cycleMetadata = cycle.metadata as any;
        const enhancedBlueprints = blueprints.map(bp => {
            const missionId = (bp.config as any)?.missionId;
            const metadataBlueprint = cycleMetadata?.blueprints?.find((mb: any) =>
                mb.name === bp.name || mb.id === missionId || mb.missionId === missionId || mb.mission_id === missionId
            );
            const latestRun = runs.find(r => r.name === bp.name);
            const candidateMissionIds = new Set([
                missionId,
                metadataBlueprint?.id,
                metadataBlueprint?.missionId,
                metadataBlueprint?.mission_id,
                bp.name,
                MISSION_NAME_TO_ID[bp.name],
            ].filter(Boolean));

            const workbenchAppsRaw: any[] = [];

            // Optimization: Pre-compute which mission IDs we're looking for as an array for faster intersection checks
            // than repeated .some() calls (which require iteration over dependentIds every time)
            const candidateMissionIdArray = Array.from(candidateMissionIds);
            const hasMatchingDependency = (dependentIds: any[]): boolean => {
                if (!Array.isArray(dependentIds) || dependentIds.length === 0) return false;
                // Use O(1) Set.has() for fast lookup instead of nested iteration
                return dependentIds.some((depId: string) => candidateMissionIds.has(depId));
            };

            for (const { app, deployment } of appRows) {
                const cycleApp = (app.runtimeMetadata as any)?.cycleApp ?? (app.config as any)?.cycleApp ?? (deployment.config as any)?.cycleApp ?? null;
                if (!cycleApp) continue;

                const interactionModel = String(cycleApp.interactionModel || "").toLowerCase();

                if (interactionModel === "shared-server") {
                    // Extract workbench modules injected by org-forge.service.ts
                    const modules = (app.runtimeMetadata as any)?.workbenchModules || [];
                    // Filter modules to only those with matching dependencies (linear scan, not nested)
                    const matchingModules = modules.filter((mod: any) =>
                        hasMatchingDependency(Array.isArray(mod.dependentMissions) ? mod.dependentMissions : [])
                    );

                    for (const mod of matchingModules) {
                        const dependentIds = Array.isArray(mod.dependentMissions) ? mod.dependentMissions : [];
                        workbenchAppsRaw.push({
                            app: {
                                ...app,
                                name: mod.name,
                                slug: mod.routePath || mod.id,
                            },
                            deployment,
                            cycleApp: {
                                ...cycleApp,
                                sourceAppName: mod.name,
                                sourceAppId: mod.id,
                                interactionModel: mod.interaction_model || "form-workbench",
                                dependentMissionIds: dependentIds,
                                routePath: mod.routePath || mod.id
                            },
                            isSharedModule: true
                        });
                    }
                } else {
                    const dependentIds = Array.isArray(cycleApp.dependentMissionIds) ? cycleApp.dependentMissionIds : [];
                    if (hasMatchingDependency(dependentIds)) {
                        workbenchAppsRaw.push({ app, deployment, cycleApp, isSharedModule: false });
                    }
                }
            }

            // Deduplicate matching workbench apps by sourceAppId / slug / name.
            // Priority order: (1) org-owned beats foreign regardless of status,
            // (2) within the same ownership tier, active beats inactive.
            const uniqueAppsMap = new Map<string, typeof workbenchAppsRaw[0]>();
            for (const item of workbenchAppsRaw) {
                const key = item.cycleApp?.sourceAppId || item.app.slug || item.app.name;
                const existing = uniqueAppsMap.get(key);
                if (!existing) {
                    uniqueAppsMap.set(key, item);
                } else {
                    const existingIsOrgOwned = existing.app.organizationId === cycle.organizationId;
                    const newIsOrgOwned = item.app.organizationId === cycle.organizationId;
                    if (newIsOrgOwned && !existingIsOrgOwned) {
                        // Org-owned always beats a foreign/shared-template deployment
                        uniqueAppsMap.set(key, item);
                    } else if (!newIsOrgOwned && existingIsOrgOwned) {
                        // Keep the org-owned entry
                    } else {
                        // Same ownership tier: prefer the active deployment
                        const existingIsActive = existing.deployment?.status === 'active';
                        const newIsActive = item.deployment?.status === 'active';
                        if (newIsActive && !existingIsActive) {
                            uniqueAppsMap.set(key, item);
                        }
                        // else keep existing (both active, both inactive, or existing active/new inactive)
                    }
                }
            }

            const workbenchApps = Array.from(uniqueAppsMap.values()).map(({ app, deployment, cycleApp, isSharedModule }: any) => {
                let publicPath = deployment.isPublished && deployment.publicSlug ? `/app/${deployment.publicSlug}?embed=cycle` : null;
                let externalPath = deployment.isPublished && deployment.publicSlug ? `/app/${deployment.publicSlug}` : null;

                if (deployment.isPublished && deployment.publicSlug) {
                    if (isSharedModule && cycleApp.routePath) {
                        publicPath = `/app/${deployment.publicSlug}/${cycleApp.routePath}?embed=cycle`;
                        externalPath = `/app/${deployment.publicSlug}/${cycleApp.routePath}`;
                    } else if (cycleApp.blueprint) {
                        const normSlug = deployment.publicSlug.toLowerCase().replace(/_/g, "-");
                        const normBlueprint = cycleApp.blueprint.toLowerCase().replace(/_/g, "-");
                        // A slug is standalone when it equals the blueprint name or begins with
                        // "{blueprint}-" (random suffix). The "-" boundary prevents "product"
                        // from matching "product-launch-workbench".
                        const isStandalone = normSlug === normBlueprint || normSlug.startsWith(normBlueprint + "-");

                        if (!isStandalone) {
                            // Non-shared apps that point to a shared container (e.g. sdlc-workbench):
                            // the blueprint field identifies the sub-path within that container.
                            // Use the normalised form so URLs are always hyphenated.
                            publicPath = `/app/${deployment.publicSlug}/${normBlueprint}?embed=cycle`;
                            externalPath = `/app/${deployment.publicSlug}/${normBlueprint}`;
                        }
                    }
                }

                return {
                    appId: app.id,
                    deploymentId: deployment.id,
                    name: cycleApp.sourceAppName || app.name,
                    sourceAppId: cycleApp.sourceAppId || app.slug,
                    interactionModel: cycleApp.interactionModel || "form-workbench",
                    publicPath,
                    externalPath,
                    editPath: `/armory/apps/${app.id}?tab=preview`,
                    status: deployment.status,
                    health: (app.runtimeMetadata as any)?.status === 'running'
                        ? (healthByAppId.get(app.id) ?? 'unknown')
                        : 'stopped',
                    isPublished: deployment.isPublished,
                    dependentMissionIds: cycleApp.dependentMissionIds || [],
                };
            });

            return normalizeBlueprintForUi(bp, metadataBlueprint, latestRun, workbenchApps);
        });

        // Pre-warm workbench apps: proactively boot any app that is stopped so the
        // embedded iframe is ready when the user opens the Workbench tab, instead of
        // showing the "Starting App…" placeholder. Fire-and-forget — never blocks the
        // cycle response. Only 'stopped' apps are warmed (startApp is destructive) and
        // warming is debounced so repeated polls don't tear down a booting instance.
        try {
            const nowMs = Date.now();
            const warmTargets = new Map<number, number | null>(); // appId -> orgId
            for (const bp of enhancedBlueprints) {
                for (const wb of (((bp as any).workbenchApps || []) as any[])) {
                    if (wb?.health !== 'stopped' || typeof wb.appId !== 'number') continue;
                    if (nowMs - (workbenchWarmCache.get(wb.appId) || 0) < WORKBENCH_WARM_DEBOUNCE_MS) continue;
                    warmTargets.set(wb.appId, cycle.organizationId ?? null);
                    workbenchWarmCache.set(wb.appId, nowMs);
                }
            }
            if (warmTargets.size > 0) {
                logger.info(`[Cycle ${cycle.id}] Pre-warming ${warmTargets.size} stopped workbench app(s)`);
                for (const [appId, orgId] of warmTargets) {
                    appRegistryService.startApp(appId, orgId ?? undefined)
                        .then(() => logger.info(`[Cycle ${cycle.id}] Pre-warmed workbench app ${appId}`))
                        .catch((err: any) => logger.warn(`[Cycle ${cycle.id}] Pre-warm failed for app ${appId}: ${err?.message}`));
                }
            }
        } catch (e: any) {
            logger.warn(`[Cycle] Workbench pre-warm skipped: ${e?.message}`);
        }

        res.json({ apps: enhancedBlueprints });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// 3.2. SSE endpoint for cycle events (real-time updates)
router.get("/:id/events", requireCycleRead, async (req: any, res) => {
    const id = validateIdParam(req.params.id);
    const orgContext = await getUserOrgContext(req);
    const found = await operationalCycleAccess.find(id, orgContext);
    if (!found.ok) return res.status(statusForCycleFailure(found.failure)).json(bodyForCycleFailure(found.failure));
    const cycle = found.cycle;

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Send initial connection message
    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

    // Optimization: Precompile event type set for O(1) lookup instead of array.includes() O(n)
    const clientEventTypes = new Set([
        'cycle.status_changed',
        'cycle.progress_updated',
        'cycle.milestone_reached',
        'cycle.step_started',
        'cycle.step_completed',
        'cycle.step_failed',
    ]);
    const listener = (event: any) => {
        // Early exit for non-matching cycles (most common case in multi-connection scenario)
        if (event.payload?.cycleId !== id) return;
        // Then check if event type is in our whitelist (O(1) Set lookup instead of O(n) array)
        if (clientEventTypes.has(event.eventType)) {
            res.write(`event: ${event.eventType}\ndata: ${JSON.stringify(event.payload)}\n\n`);
        }
    };

    eventStream.on("*", listener);

    const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
    }, 25000);

    req.on('close', () => {
        eventStream.off("*", listener);
        clearInterval(heartbeat);
    });
});

// 3.3. SSE endpoint for app events (real-time updates)
router.get("/:id/apps/events", requireCycleRead, async (req: any, res) => {
    const id = validateIdParam(req.params.id);
    const orgContext = await getUserOrgContext(req);
    const found = await operationalCycleAccess.find(id, orgContext);
    if (!found.ok) return res.status(statusForCycleFailure(found.failure)).json(bodyForCycleFailure(found.failure));
    const cycle = found.cycle;

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Send initial connection message
    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

    // Optimization: Precompile event type set for O(1) lookup instead of array.includes() O(n)
    const appEventTypes = new Set(['app.status_changed', 'app.step_changed']);
    const listener = (event: any) => {
        // Early exit for non-matching cycles (most common case in multi-connection scenario)
        if (event.payload?.cycleId !== id) return;
        // Then check if event type is in our whitelist (O(1) Set lookup instead of O(n) array)
        if (appEventTypes.has(event.eventType)) {
            res.write(`event: ${event.eventType}\ndata: ${JSON.stringify(event.payload)}\n\n`);
        }
    };

    eventStream.on("*", listener);

    const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
    }, 25000);

    req.on('close', () => {
        eventStream.off("*", listener);
        clearInterval(heartbeat);
    });
});

// 3.4. App-level actions (for cycle management interface)
// These update lightweight runtime metadata on the blueprint row. The actual
// execution engine can replace this shim once app-level orchestration is wired.
const APP_ACTION_STATUS: Record<string, string> = {
    start: "active",
    pause: "paused",
    resume: "active",
    skip: "skipped",
    retry: "active",
    complete: "completed",
    fail: "failed",
};

router.post("/:id/apps/:appName/:action", requireCycleWrite, async (req: any, res) => {
    try {
        const id = validateIdParam(req.params.id);
        const appName = req.params.appName;
        const action = String(req.params.action);
        const status = APP_ACTION_STATUS[action];
        if (!status) return res.status(404).json({ error: "Unsupported app action" });

        const orgContext = await getUserOrgContext(req);
        const result = await setBlueprintRuntimeStatus(id, appName, orgContext, status, req.body?.output);
        if (result.kind === "forbidden") return res.status(403).json({ error: "Organization context required" });
        if (result.kind === "missing-cycle") return res.status(404).json({ error: "Cycle not found" });
        if (result.kind === "missing-blueprint") return res.status(404).json({ error: "App not found" });

        if (action === "complete" || action === "fail" || action === "skip") {
            CycleManagerService.resolveAppStep(
                id,
                appName,
                action === "complete" ? "completed" : action === "fail" ? "failed" : "skipped",
                req.body?.output
            );
        }

        await eventStream.publish('app.status_changed', { cycleId: id, appName, status, output: req.body?.output }, {
            organizationId: result.cycle.organizationId ?? undefined,
            subject: `cycle:${id}`,
        }, 'cycles-router');

        res.json({ success: true, status, message: `App ${action} accepted` });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// 13. Update a cycle (Org Admin Only, org-scoped)
// Uses deep-merge for metadata — never full-replaces, preventing silent data loss.
router.patch("/:id", requireCycleWrite, async (req: any, res) => {
    try {
        const id = validateIdParam(req.params.id);
        const orgContext = await getUserOrgContext(req);
        const { userId, organizationId: orgId } = orgContext;

        const { name, description, objective, status, priority, budgetLimitUsd, tokenLimit, recurrence, timezone, nextRunAt, requiresApproval, metadata } = req.body;

        if (status !== undefined && !CYCLE_STATUSES.includes(status)) {
            return res.status(400).json({ error: `Invalid status. Allowed values: ${CYCLE_STATUSES.join(', ')}` });
        }

        const found = await operationalCycleAccess.find(id, orgContext);
        if (!found.ok) return res.status(statusForCycleFailure(found.failure)).json(bodyForCycleFailure(found.failure));
        const existing = found.cycle;

        // Deep-merge incoming metadata with existing — never overwrite keys not present in the patch
        const existingMetadata = (existing.metadata as Record<string, any>) ?? {};
        const incomingMetadata = (metadata as Record<string, any>) ?? null;
        const mergedMetadata = incomingMetadata
            ? {
                ...existingMetadata,
                ...incomingMetadata,
                ...(incomingMetadata.scheduling
                    ? { scheduling: { ...(existingMetadata.scheduling ?? {}), ...incomingMetadata.scheduling } }
                    : {}),
                ...(incomingMetadata.resource_answers
                    ? { resource_answers: { ...(existingMetadata.resource_answers ?? {}), ...incomingMetadata.resource_answers } }
                    : {}),
            }
            : existing.metadata;

        const parsedPriority = priority !== undefined ? Number(priority) : undefined;
        const parsedTokenLimit = tokenLimit !== undefined ? Number(tokenLimit) : undefined;

        const patched = await operationalCycleAccess.updateReturning(id, orgContext, {
            ...(name !== undefined && { name: String(name) }),
            ...(description !== undefined && { description }),
            ...(objective !== undefined && { objective: String(objective) }),
            ...(status && { status }),
            ...(priority !== undefined && Number.isFinite(parsedPriority) && { priority: parsedPriority }),
            ...(budgetLimitUsd !== undefined && { budgetLimitUsd: String(budgetLimitUsd) }),
            ...(tokenLimit !== undefined && Number.isFinite(parsedTokenLimit) && { tokenLimit: parsedTokenLimit }),
            ...(recurrence !== undefined && { recurrence: String(recurrence) }),
            ...(timezone !== undefined && { timezone: String(timezone) }),
            ...(nextRunAt !== undefined && { nextRunAt: nextRunAt ? new Date(nextRunAt) : null }),
            ...(requiresApproval !== undefined && { requiresApproval: Number(requiresApproval) }),
            ...(metadata && { metadata: mergedMetadata }),
        });
        if (!patched.ok) return res.status(statusForCycleFailure(patched.failure)).json(bodyForCycleFailure(patched.failure));

        invalidateCycleCache(id);
        res.json(patched.cycle);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// 14. Update blueprints only — records history when cycle is active or paused.
// Body: { blueprints: Blueprint[], reason?: string }
router.patch("/:id/blueprints", requireCycleWrite, async (req: any, res) => {
    try {
        const id = validateIdParam(req.params.id);
        const orgContext = await getUserOrgContext(req);
        const { userId, organizationId: orgId } = orgContext;

        const { blueprints, reason } = req.body;
        if (!Array.isArray(blueprints)) {
            return res.status(400).json({ error: "blueprints must be an array" });
        }

        const found = await operationalCycleAccess.find(id, orgContext);
        if (!found.ok) return res.status(statusForCycleFailure(found.failure)).json(bodyForCycleFailure(found.failure));
        const existing = found.cycle;

        const existingMeta = (existing.metadata as Record<string, any>) ?? {};
        const previousBlueprints = existingMeta.blueprints ?? [];
        const isLive = ["active", "running", "paused"].includes(existing.status);

        // When the cycle is live, archive the current blueprints before overwriting
        let blueprintHistory: any[] = existingMeta.blueprint_history ?? [];
        if (isLive && previousBlueprints.length > 0) {
            blueprintHistory = [
                {
                    changedAt: new Date().toISOString(),
                    changedBy: userId,
                    reason: reason ?? null,
                    cycleStatus: existing.status,
                    blueprints: previousBlueprints,
                },
                ...blueprintHistory,
            ].slice(0, 10); // cap at 10 entries
        }

        const updatedMeta = {
            ...existingMeta,
            blueprints,
            ...(isLive ? { blueprint_history: blueprintHistory } : {}),
        };

        // The blueprint set, the relational rows and the dependency gates are
        // one fact about the cycle, so the service writes all three in a single
        // transaction and scopes the cycle update by organization.
        const replaced = await operationalCycleAggregate.replaceBlueprints(id, orgContext, {
            metadata: updatedMeta,
            blueprints: blueprints.map((bp: any) => ({
                name: bp.name,
                objective: bp.objective,
                type: bp.type,
                dependencies: bp.dependencies || (bp.dependsOn
                    ? bp.dependsOn.map((d: string) => ({ blueprintName: d, type: 'finish_to_start' }))
                    : []),
                estimatedDays: blueprintEstimatedDays(bp),
                config: bp.config,
                metadata: bp.metadata,
            })),
        });
        if (!replaced.ok) return res.status(statusForCycleFailure(replaced.failure)).json(bodyForCycleFailure(replaced.failure));
        const updated = replaced.cycle;

        // 4. Recalculate critical path/waves execution plan
        try {
            const fresh = await operationalCycleAggregate.listBlueprints(id, orgContext);
            const freshBlueprints = fresh.ok ? fresh.cycle : [];
            await CycleManagerService.prepareExecutionPlan(id, freshBlueprints, updated, orgId);
            logger.info(`[Cycles] Updated execution plan on blueprint patch for cycle ${id}`);
        } catch (planErr: any) {
            logger.warn(`[Cycles] Failed to update execution plan on blueprint patch for cycle ${id}: ${planErr.message}`);
        }

        invalidateCycleCache(id);
        res.json({
            cycle: updated,
            historyRecorded: isLive,
            historyCount: blueprintHistory.length,
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// 4. Inject a mission into an existing cycle (Org Admin Only)
router.post("/:id/spawn", requireOrgAdminOrSuper, async (req: any, res) => {
    try {
        const id = validateIdParam(req.params.id);
        const orgContext = await getUserOrgContext(req);
        const { userId, organizationId: orgId } = orgContext;
        await CycleManagerService.spawnMissionForCycle(id, req.body, userId, orgId);

        // Invalidate cycle cache (blueprints changed)
        invalidateCycleCache(id);

        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// 5. Manual Synthesis trigger — processes completed missions and closes the cycle (Org Admin Only)
router.post("/:id/synthesize", requireOrgAdminOrSuper, async (req: any, res) => {
    logger.info(`[Cycles] POST /api/cycles/${req.params.id}/synthesize - Triggering cycle outcome synthesis`);
    try {
        const id = validateIdParam(req.params.id);
        const orgContext = await getUserOrgContext(req);
        const { organizationId: orgId, isSuperAdmin } = orgContext;

        const found = await operationalCycleAccess.find(id, orgContext);
        if (!found.ok) return res.status(statusForCycleFailure(found.failure)).json(bodyForCycleFailure(found.failure));
        const cycle = found.cycle;

        const result = await CycleManagerService.synthesizeCycle(id, cycle.organizationId);

        // Invalidate cycle cache (cycle status changed)
        invalidateCycleCache(id);

        res.json(result);
    } catch (err: any) {
        logger.error(`[Cycles] Manual synthesis trigger failed: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// 6. Pause a cycle (Org Admin Only, org-scoped)
router.post("/:id/pause", requireOrgAdminOrSuper, async (req: any, res) => {
    try {
        const id = validateIdParam(req.params.id);
        const orgContext = await getUserOrgContext(req);
        const { organizationId: orgId, isSuperAdmin } = orgContext;

        const updated = await operationalCycleAccess.setStatus(id, orgContext, 'paused');
        if (!updated.ok) return res.status(statusForCycleFailure(updated.failure)).json(bodyForCycleFailure(updated.failure));

        // Invalidate cycle cache
        invalidateCycleCache(id);

        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// 7. Resume a cycle (Org Admin Only)
router.post("/:id/resume", requireOrgAdminOrSuper, async (req: any, res) => {
    try {
        const id = validateIdParam(req.params.id);
        const orgContext = await getUserOrgContext(req);
        const { organizationId: orgId, isSuperAdmin } = orgContext;

        const updated = await operationalCycleAccess.setStatus(id, orgContext, 'active');
        if (!updated.ok) return res.status(statusForCycleFailure(updated.failure)).json(bodyForCycleFailure(updated.failure));

        // Invalidate cycle cache
        invalidateCycleCache(id);

        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// 8. Approve a cycle (Org Admin Only)
router.post("/:id/approve", requireOrgAdminOrSuper, async (req: any, res) => {
    try {
        const id = validateIdParam(req.params.id);
        const orgContext = await getUserOrgContext(req);
        const { userId, organizationId: orgId, isSuperAdmin } = orgContext;

        const found = await operationalCycleAccess.find(id, orgContext);
        if (!found.ok) return res.status(statusForCycleFailure(found.failure)).json(bodyForCycleFailure(found.failure));
        const existing = found.cycle;
        const force = req.query.force === 'true' || req.body?.force === true || req.query.force === '1';
        const missingIntegrations = await unresolvedCycleIntegrations(id, orgId, isSuperAdmin);
        if (missingIntegrations.length > 0 && !isSuperAdmin && !force) {
            return res.status(422).json({
                error: "Cycle integrations are not ready",
                code: "INTEGRATIONS_NOT_READY",
                missingIntegrations: missingIntegrations.map(integration => ({
                    credentialId: integration.credentialId,
                    integrationName: integration.integrationName,
                    envVarName: integration.envVarName,
                })),
            });
        }

        const durationDays = Number((existing.metadata as any)?.durationDays ?? (existing.metadata as any)?.duration_days ?? 5);
        const startDate = new Date();
        const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

        const approved = await operationalCycleAccess.updateReturning(id, orgContext, {
            status: 'active',
            startDate,
            endDate,
        });
        if (!approved.ok) return res.status(statusForCycleFailure(approved.failure)).json(bodyForCycleFailure(approved.failure));
        const cycle = approved.cycle;
        if ((cycle?.metadata as any)?.blueprints && (cycle.metadata as any).blueprints.length > 0) {
            void CycleManagerService.spawnBlueprintsWithDeps(
                id,
                (cycle.metadata as any).blueprints,
                userId,
                orgId,
                cycle.priority ?? 5
            ).catch(err => {
                logger.error(`[Cycles] Manual approval spawn failed for cycle ${id}: ${err.message}`);
            });
        }

        // Invalidate cycle cache
        invalidateCycleCache(id);

        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// 8.5. Trigger a cycle execution manually on-demand
router.post("/:id/trigger", requireCycleWrite, async (req: any, res) => {
    try {
        const id = validateIdParam(req.params.id);
        const orgContext = await getUserOrgContext(req);
        const { userId, organizationId: orgId, isSuperAdmin } = orgContext;

        const found = await operationalCycleAccess.find(id, orgContext);
        if (!found.ok) return res.status(statusForCycleFailure(found.failure)).json(bodyForCycleFailure(found.failure));
        const cycle = found.cycle;

        if (cycle.status !== 'active') {
            return res.status(400).json({ error: "Only active cycles can be triggered manually" });
        }
        const force = req.query.force === 'true' || req.body?.force === true || req.query.force === '1';
        const missingIntegrations = await unresolvedCycleIntegrations(id, orgId, isSuperAdmin);
        if (missingIntegrations.length > 0 && !isSuperAdmin && !force) {
            return res.status(422).json({
                error: "Cycle integrations are not ready",
                code: "INTEGRATIONS_NOT_READY",
                missingIntegrations: missingIntegrations.map(integration => ({
                    credentialId: integration.credentialId,
                    integrationName: integration.integrationName,
                    envVarName: integration.envVarName,
                })),
            });
        }

        const inFlight = await operationalCycleAggregate.findInFlightRun(id, orgContext);
        if (!inFlight.ok) return res.status(statusForCycleFailure(inFlight.failure)).json(bodyForCycleFailure(inFlight.failure));
        const inFlightRun = inFlight.cycle;
        if (inFlightRun) {
            return res.status(409).json({ error: "Cycle already has work in flight" });
        }

        const blueprints = (cycle.metadata as any)?.blueprints || [];
        if (blueprints.length > 0) {
            void CycleManagerService.spawnBlueprintsWithDeps(
                id,
                blueprints,
                userId,
                orgId,
                cycle.priority ?? 5
            ).catch(err => {
                logger.error(`[Cycles] Manual run spawn failed for cycle ${id}: ${err.message}`);
            });
        }

        // Invalidate cycle cache (cycle execution triggered)
        invalidateCycleCache(id);

        res.json({ success: true, message: "Cycle execution triggered" });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});


// POST /:id/abort — Hard cancel: marks cycle cancelled, terminates active runs
router.post("/:id/abort", requireOrgAdminOrSuper, async (req: any, res) => {
    try {
        const id = validateIdParam(req.params.id);
        const orgContext = await getUserOrgContext(req);
        const { organizationId: orgId, isSuperAdmin } = orgContext;

        const found = await operationalCycleAccess.find(id, orgContext);
        if (!found.ok) return res.status(statusForCycleFailure(found.failure)).json(bodyForCycleFailure(found.failure));
        const cycle = found.cycle;
        if (cycle.status === 'closed' || cycle.status === 'cancelled') {
            return res.status(400).json({ error: "Cycle is already terminated" });
        }

        // Terminate every live run of this cycle, and report which ones.
        const terminated = await operationalCycleAggregate.failActiveRuns(id, orgContext);
        if (!terminated.ok) return res.status(statusForCycleFailure(terminated.failure)).json(bodyForCycleFailure(terminated.failure));
        const failedMissionIds = terminated.cycle;

        await operationalCycleAccess.setStatus(id, orgContext, 'cancelled');

        // Invalidate cycle cache (cycle cancelled)
        invalidateCycleCache(id);

        // Submit postmortem analysis job (Phase 4D)
        // Analysis happens async; doesn't block response
        try {
            const postmortemJob = await queueService.addJob(
                'postmortem-analysis',
                'analyze',
                {
                    cycleId: id,
                    organizationId: orgId || 0,
                    failureType: 'user_abort',
                    failedMissionIds,
                },
                {
                    priority: JobPriority.NORMAL,
                    organizationId: orgId ?? undefined,
                }
            );

            logger.info(`Cycle abort postmortem job submitted`, {
                cycleId: id,
                jobId: postmortemJob.id,
                failedMissionCount: failedMissionIds.length,
            });
        } catch (jobErr) {
            logger.error(`Failed to submit postmortem job for cycle ${id}:`, jobErr);
            // Non-critical failure - postmortem is optional
        }

        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// POST /:id/milestone/approve — Approve a paused milestone gate, optionally merging fresh resource answers
router.post("/:id/milestone/approve", requireOrgAdminOrSuper, async (req: any, res) => {
    try {
        const id = validateIdParam(req.params.id);
        const orgContext = await getUserOrgContext(req);
        const { organizationId: orgId, isSuperAdmin } = orgContext;

        const found = await operationalCycleAccess.find(id, orgContext);
        if (!found.ok) return res.status(statusForCycleFailure(found.failure)).json(bodyForCycleFailure(found.failure));
        const cycle = found.cycle;
        if (cycle.status !== 'paused') {
            return res.status(400).json({ error: "Cycle is not paused at a milestone" });
        }

        const { resourceAnswers } = req.body;
        const updatedMetadata = {
            ...(cycle.metadata as object ?? {}),
            ...(resourceAnswers ? { resource_answers: { ...(cycle.metadata as any)?.resource_answers, ...resourceAnswers } } : {}),
        };

        await operationalCycleAccess.setStatus(id, orgContext, 'active', { metadata: updatedMetadata });

        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// POST /:id/blueprints/validate — dry-run blueprint validation
// Returns { valid: boolean, errors: string[], warnings: string[] }
router.post("/:id/blueprints/validate", requireCycleRead, async (req: any, res) => {
    try {
        const { blueprints } = req.body;
        if (!Array.isArray(blueprints)) return res.status(400).json({ error: "blueprints must be an array" });

        const errors: string[] = [];
        const warnings: string[] = [];
        const names = new Set(blueprints.map((b: any) => b.name).filter(Boolean));

        // 1. Missing names or objectives
        blueprints.forEach((bp: any, i: number) => {
            if (!bp.name?.trim()) errors.push(`Blueprint #${i + 1} has no name.`);
            if (!bp.objective?.trim()) warnings.push(`Blueprint "${bp.name || `#${i + 1}`}" has no objective.`);
        });

        // 2. Unresolved branch targets (UI-builder-specific)
        blueprints.forEach((bp: any) => {
            (bp.branches ?? []).forEach((br: any) => {
                if (br.targetBlueprint && !names.has(br.targetBlueprint)) {
                    errors.push(`"${bp.name}" branches to "${br.targetBlueprint}" which does not exist.`);
                }
            });
        });

        // 3. Centralized dependency validation (unresolved deps, self-deps, cycles)
        //    via the shared DAG service — single source of truth across all trigger formats.
        const dagBlueprints = blueprints
            .filter((b: any) => b.name)
            .map((bp: any) => ({ name: bp.name, dependencies: cycleDagService.normalizeManifestMission(bp) }));
        const report = cycleDagService.validateDag(dagBlueprints);
        errors.push(...report.errors);
        warnings.push(...report.warnings);

        // 3b. Data-flow contract validation (#4): dataFlows must reference outputs the source declares.
        const contract = cycleDataflowService.validateDataFlowContracts(blueprints);
        errors.push(...contract.errors);
        warnings.push(...contract.warnings);

        // 4. Disconnected blueprints (no incoming or outgoing edges)
        const hasEdge = new Set<string>();
        blueprints.forEach((bp: any) => {
            const deps = [...(bp.dependencies ?? []).map((d: any) => d.blueprintName), ...(bp.dependsOn ?? [])].filter((n: string) => names.has(n));
            if (deps.length > 0) { hasEdge.add(bp.name); deps.forEach((d: string) => hasEdge.add(d)); }
        });
        if (blueprints.length > 1) {
            blueprints.forEach((bp: any) => {
                if (bp.name && !hasEdge.has(bp.name)) {
                    warnings.push(`"${bp.name}" is disconnected — not linked to any other blueprint.`);
                }
            });
        }

        // 5. Pre-launch plan preview: topological waves + critical path (when valid).
        let plan: { waves: string[][]; criticalPath: string[]; projectDurationMs: number } | null = null;
        if (report.valid) {
            const dag = cycleDagService.buildDag(dagBlueprints);
            const durationOf = (name: string) => {
                const bp = blueprints.find((b: any) => b.name === name);
                return blueprintDurationMs(bp);
            };
            const cpm = cycleDagService.computeCriticalPath(dag, durationOf);
            plan = {
                waves: report.waves,
                criticalPath: cpm?.criticalPath ?? [],
                projectDurationMs: cpm?.projectDurationMs ?? 0,
            };
        }

        res.json({ valid: errors.length === 0, errors, warnings, plan });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /:id — Soft-delete (org admin only). Blocked if cycle is active.
router.delete("/:id", requireCycleWrite, async (req: any, res) => {
    try {
        const id = validateIdParam(req.params.id);
        const orgContext = await getUserOrgContext(req);
        const { organizationId: orgId, isSuperAdmin } = orgContext;

        const found = await operationalCycleAccess.findStatus(id, orgContext, { excludeDeleted: true });
        if (!found.ok) return res.status(statusForCycleFailure(found.failure)).json(bodyForCycleFailure(found.failure));
        const existing = found.cycle;
        if (['active', 'running'].includes(existing.status ?? '')) {
            return res.status(409).json({ error: "Cannot delete an active cycle. Abort it first." });
        }

        await operationalCycleAccess.update(id, orgContext, { deletedAt: new Date() }, { excludeDeleted: true });

        invalidateCycleCache(id, orgId);

        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Cycle Integrations (per-cycle secret values for provisioned credentials) ──

router.get("/:id/integrations", requireCycleRead, async (req: any, res) => {
    try {
        const id = validateIdParam(req.params.id);
        const orgContext = await getUserOrgContext(req);
        if (!orgContext.isSuperAdmin && !orgContext.organizationId) {
            return res.status(403).json({ error: "Organization context required" });
        }

        const { cycleIntegrationsService } = await import("../domain/mission/core/cycle-integrations.service.js");
        const result = await cycleIntegrationsService.listForCycle(id, orgContext.organizationId ?? 0, orgContext.isSuperAdmin);
        res.json(result);
    } catch (err: any) {
        const status = err.statusCode || 500;
        res.status(status).json({ error: err.message });
    }
});

router.put("/:id/integrations/:credentialId", requireCycleWrite, async (req: any, res) => {
    try {
        const id = validateIdParam(req.params.id);
        const credentialId = parseInt(req.params.credentialId);
        if (isNaN(credentialId)) return res.status(400).json({ error: "Invalid credential ID" });

        const { value } = req.body || {};
        if (typeof value !== "string" || value.length === 0) {
            return res.status(400).json({ error: "Body must include a non-empty 'value' string" });
        }

        const orgContext = await getUserOrgContext(req);
        if (!orgContext.isSuperAdmin && !orgContext.organizationId) {
            return res.status(403).json({ error: "Organization context required" });
        }

        const { cycleIntegrationsService } = await import("../domain/mission/core/cycle-integrations.service.js");
        await cycleIntegrationsService.setValue(id, credentialId, value, orgContext.organizationId ?? 0, orgContext.isSuperAdmin);
        res.json({ success: true });
    } catch (err: any) {
        const status = err.statusCode || 500;
        res.status(status).json({ error: err.message });
    }
});

router.delete("/:id/integrations/:credentialId", requireCycleWrite, async (req: any, res) => {
    try {
        const id = validateIdParam(req.params.id);
        const credentialId = parseInt(req.params.credentialId);
        if (isNaN(credentialId)) return res.status(400).json({ error: "Invalid credential ID" });

        const orgContext = await getUserOrgContext(req);
        if (!orgContext.isSuperAdmin && !orgContext.organizationId) {
            return res.status(403).json({ error: "Organization context required" });
        }

        const { cycleIntegrationsService } = await import("../domain/mission/core/cycle-integrations.service.js");
        await cycleIntegrationsService.clearValue(id, credentialId, orgContext.organizationId ?? 0, orgContext.isSuperAdmin);
        res.json({ success: true });
    } catch (err: any) {
        const status = err.statusCode || 500;
        res.status(status).json({ error: err.message });
    }
});

// GET /:id/trajectories?format=openai|anthropic|gemini
// Streams a JSONL file of multi-turn conversations from every mission run in the cycle.
// One JSONL line per mission. Streamed via res.write() so large cycles don't OOM.
router.get("/:id/trajectories", requireCycleRead, async (req: any, res) => {
    let headersSent = false;
    try {
        const id = validateIdParam(req.params.id);
        const orgContext = await getUserOrgContext(req);
        const formatParam = String(req.query.format ?? 'openai').toLowerCase();
        const format = (['openai', 'anthropic', 'gemini'] as const).includes(formatParam as any)
            ? (formatParam as 'openai' | 'anthropic' | 'gemini')
            : 'openai';

        // Cap caller-supplied systemPrompt; service also enforces but we want
        // to fail fast on obvious abuse rather than buffering huge query strings.
        const { MAX_SYSTEM_PROMPT_CHARS, cycleTrajectoryService } = await import("../domain/mission/core/cycle-trajectory.service.js");
        const rawSystemPrompt = typeof req.query.systemPrompt === 'string' ? req.query.systemPrompt : undefined;
        if (rawSystemPrompt && rawSystemPrompt.length > MAX_SYSTEM_PROMPT_CHARS) {
            return res.status(400).json({ error: `systemPrompt exceeds ${MAX_SYSTEM_PROMPT_CHARS} chars` });
        }

        // Stream — headers go out before the body so we don't buffer the
        // whole JSONL. Count headers can only be emitted as trailers via
        // chunked encoding; most clients don't read trailers, so we expose
        // counts via a final log line instead.
        res.setHeader('Content-Type', 'application/jsonl');
        res.setHeader('Content-Disposition', `attachment; filename="cycle-${id}-trajectories-${format}.jsonl"`);
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Trajectory-Format', format);
        headersSent = true;

        const gen = cycleTrajectoryService.exportCycleAsJsonlStream(
            id,
            orgContext.organizationId,
            orgContext.isSuperAdmin,
            format,
            { systemPrompt: rawSystemPrompt },
        );

        let trajectories = 0;
        let turns = 0;
        while (true) {
            const { value, done } = await gen.next();
            if (done) {
                if (value) { trajectories = value.trajectories; turns = value.turns; }
                break;
            }
            // value is one newline-terminated JSONL line
            if (!res.write(value)) {
                // Backpressure — wait for drain before continuing.
                await new Promise<void>(resolve => res.once('drain', resolve));
            }
        }
        res.end();

        logger.info(`Cycle trajectories exported`, { cycleId: id, format, trajectories, turns });
    } catch (err: any) {
        // If headers already went out we can't change the status; just end the response.
        if (headersSent) {
            logger.error(`Trajectory stream failed mid-response: ${err.message}`);
            try { res.end(); } catch { /* ignore */ }
            return;
        }
        if (err?.message === "CYCLE_NOT_FOUND") return res.status(404).json({ error: "Cycle not found" });
        if (err?.message === "FORBIDDEN" || err?.message === "CYCLE_HAS_NO_ORG") return res.status(403).json({ error: "Forbidden" });
        const status = err.statusCode || 500;
        res.status(status).json({ error: err.message });
    }
});

// GET /:id/mission-bindings
// Returns mission_app_bindings for every mission in the cycle, joined with
// app metadata + instance health. Shape:
//   [{ missionId: number, missionName: string,
//      bindings: [{ id, appId, appSlug, appName, role, label,
//                   openModeDefault, sortOrder, health, publicSlug }] }]
// Drives the per-row "🛠 Apps ▾" dropdown in Cycle Manager.
router.get("/:id/mission-bindings", requireCycleRead, async (req: any, res) => {
    try {
        const id = validateIdParam(req.params.id);
        const orgContext = await getUserOrgContext(req);

        const found = await operationalCycleAccess.find(id, orgContext);
        if (!found.ok) return res.status(statusForCycleFailure(found.failure)).json(bodyForCycleFailure(found.failure));
        const cycle = found.cycle;
        if (cycle.organizationId == null) return res.status(403).json({ error: "Cycle has no org" });

        const bound = await operationalCycleAggregate.listMissionBindings(id, orgContext);
        if (!bound.ok) return res.status(statusForCycleFailure(bound.failure)).json(bodyForCycleFailure(bound.failure));
        const { missions: missionRows, bindings: bindingRows, instanceHealthByDeployment: instanceHealthByDep } = bound.cycle;
        if (missionRows.length === 0) return res.json({ items: [] });

        // Group bindings by mission
        const grouped = new Map<number, typeof bindingRows>();
        for (const b of bindingRows) {
            const arr = grouped.get(b.missionId) ?? [];
            arr.push(b);
            grouped.set(b.missionId, arr);
        }
        const items = missionRows.map(m => ({
            missionId: m.id,
            missionName: m.name || `Mission #${m.id}`,
            bindings: (grouped.get(m.id) ?? []).map(b => ({
                id: b.bindingId,
                appId: b.appId,
                appSlug: b.appSlug,
                appName: b.appName || `App #${b.appId}`,
                role: b.role,
                label: b.label || b.appName || `App #${b.appId}`,
                openModeDefault: b.openModeDefault,
                sortOrder: b.sortOrder,
                source: b.source,
                publicSlug: b.publicSlug,
                // For shared-server apps (e.g. research-workbench) each binding maps to
                // a specific workbench module/route. Resolve it from the app's
                // runtimeMetadata.workbenchModules by matching the binding label to the
                // module name, so the modal opens that module directly instead of the
                // app's landing page. Null for single-page apps.
                route: (() => {
                    const mods = (b.appMeta as any)?.workbenchModules;
                    if (Array.isArray(mods) && b.label) {
                        const mod = mods.find((x: any) => x?.name === b.label);
                        const rp = mod?.routePath ?? mod?.id;
                        if (rp) return `/${String(rp).replace(/^\/+/, "")}`;
                    }
                    return null;
                })(),
                health: b.deploymentId != null
                    ? (instanceHealthByDep.get(b.deploymentId) ?? 'stopped')
                    : 'unknown',
            })),
        }));

        res.json({ items, count: items.length });
    } catch (err: any) {
        logger.error(`Mission bindings lookup failed for cycle ${req.params.id}: ${err.message}`);
        res.status(err.statusCode || 500).json({ error: err.message });
    }
});

// ───────────────────────────────────────────────────────────────────────────
// STREAMING ENDPOINTS (Phase 4C)
// ───────────────────────────────────────────────────────────────────────────

// GET /api/cycles/stream - Server-Sent Events streaming for all cycles
router.get("/stream", requireAuth, async (req: any, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = orgContext.organizationId;
    const { isSuperAdmin } = orgContext;

    if (!organizationId && !isSuperAdmin) {
        return res.status(403).json({ error: "Organization context required" });
    }

    try {
        const { StreamController } = await import("@domain/streaming/streaming.service.js");
        const { createPaginator } = await import("@domain/pagination/pagination.service.js");

        const paginator = createPaginator<typeof operationalCycles.$inferSelect>(operationalCycles);

        const conditions: SQL[] = [];
        if (!isSuperAdmin && organizationId) {
            conditions.push(eq(operationalCycles.organizationId, organizationId));
        }

        await StreamController.streamPaginated(
            res,
            'sse',
            async (cursor) => {
                const result = await paginator.getPageByOffset(db, {
                    cursor,
                    limit: 50,
                    where: conditions.length > 0 ? and(...conditions) : undefined,
                    orderBy: [desc(operationalCycles.createdAt)]
                });
                return result;
            },
            {
                formatItem: (item) => ({
                    id: item.id,
                    status: item.status,
                    name: (item.metadata as any)?.name || `Cycle #${item.id}`,
                    createdAt: item.createdAt,
                    updatedAt: item.updatedAt,
                    progress: (item.metadata as any)?.progress || 0
                })
            }
        );
    } catch (error: any) {
        logger.error('Cycle stream error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
});

// GET /api/cycles/export.csv - CSV streaming export for all cycles
router.get("/export.csv", requireAuth, async (req: any, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = orgContext.organizationId;
    const { isSuperAdmin } = orgContext;

    if (!organizationId && !isSuperAdmin) {
        return res.status(403).json({ error: "Organization context required" });
    }

    try {
        const { StreamController } = await import("@domain/streaming/streaming.service.js");
        const { createPaginator } = await import("@domain/pagination/pagination.service.js");

        const paginator = createPaginator<typeof operationalCycles.$inferSelect>(operationalCycles);

        const conditions: SQL[] = [];
        if (!isSuperAdmin && organizationId) {
            conditions.push(eq(operationalCycles.organizationId, organizationId));
        }

        await StreamController.streamPaginated(
            res,
            'csv',
            async (cursor) => {
                const result = await paginator.getPageByOffset(db, {
                    cursor,
                    limit: 500,
                    where: conditions.length > 0 ? and(...conditions) : undefined,
                    orderBy: [desc(operationalCycles.createdAt)]
                });
                return result;
            },
            {
                headers: ['ID', 'Status', 'Name', 'Created At', 'Updated At', 'Progress'],
                formatRow: (item) => [
                    String(item.id),
                    item.status,
                    (item.metadata as any)?.name || `Cycle #${item.id}`,
                    item.createdAt.toISOString(),
                    item.updatedAt.toISOString(),
                    String((item.metadata as any)?.progress || 0)
                ]
            }
        );
    } catch (error: any) {
        logger.error('Cycle CSV export error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
});

// GET /api/cycles/export.jsonl - JSONL streaming export for all cycles
router.get("/export.jsonl", requireAuth, async (req: any, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = orgContext.organizationId;
    const { isSuperAdmin } = orgContext;

    if (!organizationId && !isSuperAdmin) {
        return res.status(403).json({ error: "Organization context required" });
    }

    try {
        const { StreamController } = await import("@domain/streaming/streaming.service.js");
        const { createPaginator } = await import("@domain/pagination/pagination.service.js");

        const paginator = createPaginator<typeof operationalCycles.$inferSelect>(operationalCycles);

        const conditions: SQL[] = [];
        if (!isSuperAdmin && organizationId) {
            conditions.push(eq(operationalCycles.organizationId, organizationId));
        }

        await StreamController.streamPaginated(
            res,
            'jsonl',
            async (cursor) => {
                const result = await paginator.getPageByOffset(db, {
                    cursor,
                    limit: 100,
                    where: conditions.length > 0 ? and(...conditions) : undefined,
                    orderBy: [desc(operationalCycles.createdAt)]
                });
                return result;
            },
            {
                formatItem: (item) => ({
                    id: item.id,
                    status: item.status,
                    name: (item.metadata as any)?.name || `Cycle #${item.id}`,
                    createdAt: item.createdAt.toISOString(),
                    updatedAt: item.updatedAt.toISOString(),
                    progress: (item.metadata as any)?.progress || 0,
                    metadata: item.metadata
                })
            }
        );
    } catch (error: any) {
        logger.error('Cycle JSONL export error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
});

// GET /api/cycles/:id/runs - Paginated endpoint for cycle mission runs
router.get("/:id/runs", requireCycleRead, async (req: any, res) => {
    try {
        const id = validateIdParam(req.params.id);
        const orgContext = await getUserOrgContext(req);
        const { organizationId: orgId, isSuperAdmin } = orgContext;

        const limit = Math.min(parseInt(String(req.query.limit || 50)), 200);
        const offset = parseInt(String(req.query.offset || 0));

        const page = await operationalCycleAggregate.listRuns(id, orgContext, { limit, offset });
        if (!page.ok) return res.status(statusForCycleFailure(page.failure)).json(bodyForCycleFailure(page.failure));
        const { runs, total: count } = page.cycle;

        res.json({
            runs,
            total: count,
            limit,
            offset,
            hasMore: offset + limit < count
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/cycles/:id/blueprints - Paginated endpoint for cycle blueprints
router.get("/:id/blueprints", requireCycleRead, async (req: any, res) => {
    try {
        const id = validateIdParam(req.params.id);
        const orgContext = await getUserOrgContext(req);

        const limit = Math.min(parseInt(String(req.query.limit || 50)), 200);
        const offset = parseInt(String(req.query.offset || 0));

        const page = await operationalCycleAggregate.listBlueprintsPage(id, orgContext, { limit, offset });
        if (!page.ok) return res.status(statusForCycleFailure(page.failure)).json(bodyForCycleFailure(page.failure));
        const { blueprints, total: count } = page.cycle;

        res.json({
            blueprints,
            total: count,
            limit,
            offset,
            hasMore: offset + limit < count
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.post("/:id/geofence-checkpoint", requireCycleWrite, async (req: any, res) => {
    try {
        const id = validateIdParam(req.params.id);
        const { targetLat, targetLng, currentLat, currentLng, geofenceRadiusMeters = 50, stepId } = req.body;

        if (typeof targetLat !== "number" || typeof targetLng !== "number" || typeof currentLat !== "number" || typeof currentLng !== "number") {
            return res.status(400).json({ error: "Missing required numeric coordinates (targetLat, targetLng, currentLat, currentLng)" });
        }
        if (typeof geofenceRadiusMeters !== "number" || !Number.isFinite(geofenceRadiusMeters) || geofenceRadiusMeters <= 0) {
            return res.status(400).json({ error: "geofenceRadiusMeters must be a positive number" });
        }

        const { H3HexagonalSpatialEngineService } = await import("../domain/ai/core/h3-hexagonal-spatial-engine.service.js");
        const currentCell = H3HexagonalSpatialEngineService.latLngToH3Index(currentLat, currentLng, 8);
        const targetCell = H3HexagonalSpatialEngineService.latLngToH3Index(targetLat, targetLng, 8);

        // Measure on the raw fixes, not the H3 centroids. A res-8 centroid distance
        // is 0 m within a cell and ~1.2 km across the boundary, so comparing it to a
        // metres-scale radius answers "same cell?" rather than "within the geofence?".
        const distanceMeters = H3HexagonalSpatialEngineService.pointDistanceMeters(currentLat, currentLng, targetLat, targetLng);

        const isWithinGeofence = distanceMeters <= geofenceRadiusMeters;
        const eventType = isWithinGeofence ? "ON_ENTER" : "OUTSIDE_GEOFENCE";

        // publish(topic, payload, context, source) — the single-object form this
        // used to call does not match the signature, so every request to this route
        // threw before returning.
        await eventStream.publish(
            'cycle.geofence_checkpoint_evaluated',
            {
                cycleId: id,
                stepId,
                eventType,
                distanceMeters,
                isWithinGeofence,
                h3Index: currentCell.h3Index,
            },
            { subject: `cycle:${id}` },
            'cycles-router',
        );

        res.json({
            cycleId: id,
            stepId,
            isWithinGeofence,
            distanceMeters,
            geofenceRadiusMeters,
            eventType,
            currentCellH3: currentCell.h3Index,
            targetCellH3: targetCell.h3Index,
            unblocked: isWithinGeofence
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
