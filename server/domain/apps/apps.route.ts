import express, { Router, type Request, type Response } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { createLogger } from "@server/utils/logger.js";
import { appRegistryService } from "./app-registry.service.js";
import { listedInMarket } from "./market-listing.js";
import { appBuilderService } from "./app-builder.service.js";
import { appForgeService } from "./app-forge.service.js";
import { asyncHandler } from "../../middleware/error-handler.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "@server/utils/errors.js";
import { appDeployments, apps as appsTable, appTelemetry, insertAppDeploymentSchema, jobs } from "@shared/schema/index.js";
import { eq, and, inArray, or, desc } from "drizzle-orm";
import { hashPassword } from "@server/domain/auth/index.js";
import { getUserOrgContext } from "../../utils/auth-context.js";
import { requireOrgAdminOrSuper } from "../../utils/auth-context.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { AppDeploymentService } from "./app-deployment.service.js";
import { AgentDeploymentService } from "@domain/agents/agent-deployment.service.js";
import { forgeContextService } from "./core/forge-context.service.js";
import { forgeSettingsService } from "./core/forge-settings.service.js";
import { appQueryService } from "./core/app-query.service.js";
import { forgeLifecycleService } from "./core/forge-lifecycle.service.js";
import { appReadinessService } from "./core/app-readiness.service.js";
import { forgeDraftService } from "./core/forge-draft.service.js";
import { startForgeRun } from "./core/forge-start.service.js";
import { FORGE_WORKSPACE_ROOT, getForgeWorkspacePath, resolveForgeWorkspacePath, isWithinDirectory } from "./core/forge-paths.js";
import { redis } from "@domain/core/infrastructure/redis/redis-client.js";
import { randomUUID } from "node:crypto";


const logger = createLogger("AppsRoute");
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", ".git", ".turbo", ".cache"]);

async function resolveThemeEnhancementPrompt(styleId: string, embellishment?: string): Promise<{ prompt: string; style: any }> {
    const { forgeDesignCatalogService } = await import("./core/forge-design-catalog.service.js");
    const style = await forgeDesignCatalogService.getStyleById(styleId);
    if (!style) throw new NotFoundError(`Design style "${styleId}" was not found`);

    const flourish = String(embellishment || "").trim();
    const prompt = `Apply a VISUAL-ONLY theme pass to this existing app.

NON-NEGOTIABLE FIDELITY CONTRACT:
- Preserve every feature, calculation, label, content block, route, API call, data field, event handler, and accessibility behavior.
- Do not replace the app with a template, chat shell, dashboard, or a different information architecture.
- Keep the current framework and file structure. For an Express/static app, edit its existing public HTML/CSS/JS rather than converting it to React or Next.js.
- Change presentation only: design tokens, typography, spacing, color, surfaces, borders, shadows, responsive layout polish, and motion that does not alter behavior.
- If a requested visual conflicts with usability or contrast, preserve usability.

${forgeDesignCatalogService.toPromptContext(style)}

OPTIONAL AI EMBELLISHMENT:
${flourish || "None. Apply the selected theme faithfully with restrained polish."}`;
    return { prompt, style };
}

const router = Router();

function getCycleCoreRouteHref(cycleApp: any, orgId: number, embed = true): string | null {
    const sourceAppId = String(cycleApp?.sourceAppId ?? "").toLowerCase();
    const suffix = `${embed ? "embed=cycle&" : ""}orgId=${orgId}`;

    if (sourceAppId === "codegen-pipeline-dashboard") {
        return `/pipeline/sessions?${suffix}`;
    }

    if (sourceAppId === "codegen-quality-metrics") {
        return `/pipeline/metrics?${suffix}`;
    }

    return null;
}

function normalizeRouteSegment(value: unknown): string {
    return String(value ?? "")
        .trim()
        .replace(/^\/+|\/+$/g, "")
        .replace(/_/g, "-")
        .toLowerCase();
}

function getCycleAppMetadata(deployment: any, app: any) {
    return app?.runtimeMetadata?.cycleApp ?? app?.config?.cycleApp ?? deployment?.config?.cycleApp ?? null;
}

function getAppCycleLaunchPath(publicSlug: string, cycleApp: any): string {
    const basePath = `/app/${publicSlug}`;
    const blueprint = normalizeRouteSegment(cycleApp?.blueprint);
    const routePath = normalizeRouteSegment(cycleApp?.routePath);
    if (routePath) return `${basePath}/${routePath}`;
    if (!blueprint) return basePath;

    const normalizedPublicSlug = normalizeRouteSegment(publicSlug);
    const alreadyBlueprintScoped = normalizedPublicSlug === blueprint || normalizedPublicSlug.startsWith(`${blueprint}-`);
    return alreadyBlueprintScoped ? basePath : `${basePath}/${blueprint}`;
}

function getAppLaunchHref(deployment: any, app: any, orgId: number): string | null {
    const cycleApp = getCycleAppMetadata(deployment, app);
    const coreCycleHref = getCycleCoreRouteHref(cycleApp, orgId, true);
    if (coreCycleHref) return coreCycleHref;

    if (deployment?.publicSlug) {
        const path = cycleApp ? getAppCycleLaunchPath(deployment.publicSlug, cycleApp) : `/app/${deployment.publicSlug}`;
        return cycleApp ? `${path}?embed=cycle` : path;
    }

    return null;
}

function getAppRelationshipMetadata(deployment: any, app: any) {
    const cycleApp = getCycleAppMetadata(deployment, app);
    return {
        blueprint: cycleApp?.blueprint ?? app?.blueprintSlug ?? app?.blueprint ?? null,
        cycleSlug: cycleApp?.sourceCycleSlug ?? null,
        cycleName: cycleApp?.sourceCycleName ?? null,
        routePath: cycleApp?.routePath ?? null,
        sourceAppId: cycleApp?.sourceAppId ?? null,
        sourceAppName: cycleApp?.sourceAppName ?? null,
    };
}

async function requireAppBuilderAccess(req: Request, appId: number) {
    const orgContext = await getUserOrgContext(req);
    const app = await appRegistryService.getApp(appId);
    const ownerOrgId = (app as any).developerOrgId ?? (app as any).organizationId ?? null;

    if (!orgContext.isSuperAdmin) {
        if (!orgContext.organizationId) {
            throw new BadRequestError("Organization context required");
        }
        if (!ownerOrgId || ownerOrgId !== orgContext.organizationId) {
            throw new ForbiddenError("App Builder access requires the app's developer organization");
        }
    }

    return {
        app,
        orgId: ownerOrgId ?? orgContext.organizationId ?? null,
    };
}

/**
 * GET /api/apps/:slug/context
 * Runtime config for a forged app — called by the app itself on load.
 * Returns systemPrompt, brandingConfig, missionContext, orgId.
 * Public (no auth) since forged app containers can't pass session cookies.
 */
router.get("/:slug/context", asyncHandler(async (req: Request, res: Response) => {
    const { slug } = req.params;
    const context = await forgeContextService.getAppContext(slug);
    if (!context) throw new NotFoundError(`App not found: ${slug}`);
    res.json(context);
}));

/**
 * GET /api/apps/:slug/assets/*
 * Serves static assets from the forged app's public directory.
 * Used for marketplace icons/banners even when the container is off.
 */
router.use("/:slug/assets", (req, res, next) => {
    const { slug } = req.params;
    const workspacePath = path.join(getForgeWorkspacePath(slug), "public");
    
    // Security check: ensure path is within workspace
    if (!isWithinDirectory(FORGE_WORKSPACE_ROOT, workspacePath)) {
        return res.status(403).json({ error: "Access denied" });
    }

    express.static(workspacePath)(req, res, next);
});

/**
 * GET /api/apps/:slug/pending-hil
 * Autonomous discovery of pending HIL forms for a forged app.
 * Scans for forms linked to the deployment's missionId.
 */
router.get("/:slug/pending-hil", asyncHandler(async (req: Request, res: Response) => {
    const { slug } = req.params;
    const pending = await appQueryService.getPendingHilForms(slug);
    if (!pending) throw new NotFoundError(`App deployment not found: ${slug}`);
    res.json(pending);
}));

/**
 * List available apps in the marketplace
 */
router.get("/market", asyncHandler(async (_req: Request, res: Response) => {
    const apps = (await appRegistryService.listAvailableApps()).filter(listedInMarket);
    // Ratings are read live, not from the market cache: a new review should show
    // on the next load, not whenever the cached listing expires.
    const { appReviewsService } = await import("./core/app-reviews.service.js");
    const summaries = await appReviewsService.summaries(apps.map((a: any) => a.id));
    res.json(apps.map((a: any) => ({ ...a, reviewSummary: summaries.get(a.id) ?? { average: 0, count: 0 } })));
}));

/**
 * List installed apps for the current organization
 */
router.get("/installed", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    let orgId = (req as any).organizationId;
    if (!orgId) {
        const orgContext = await getUserOrgContext(req);
        orgId = orgContext.organizationId;
    }
    if (!orgId) throw new BadRequestError("Organization context required");

    const deployments = await appRegistryService.listOrgDeployments(orgId);
    res.json(deployments);
}));

/**
 * Org-level lifecycle dashboard for installed apps.
 */
router.get("/lifecycle", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    let orgId = (req as any).organizationId;
    if (!orgId) {
        const orgContext = await getUserOrgContext(req);
        orgId = orgContext.organizationId;
    }
    if (!orgId) throw new BadRequestError("Organization context required");

    const dashboard = await appReadinessService.getOrgLifecycleDashboard(orgId);
    res.json(dashboard);
}));

/**
 * List the current organization's unified fleet for App Arsenal.
 * This is a read model over installed Apps plus published Agent AIs; it does
 * not mirror Agent AI deployments into app registry tables.
 */
router.get("/fleet", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    let orgId = (req as any).organizationId;
    if (!orgId) {
        const orgContext = await getUserOrgContext(req);
        orgId = orgContext.organizationId;
    }
    if (!orgId) throw new BadRequestError("Organization context required");

    const [appDeploymentsForOrg, agentDeploymentsForOrg] = await Promise.all([
        appRegistryService.listOrgDeployments(orgId),
        AgentDeploymentService.listDeployments(orgId),
    ]);

    const cycleKeyFor = (cycleApp: any) => {
        const cycle = cycleApp?.sourceCycleSlug ?? cycleApp?.sourceCycleName;
        const appKey = cycleApp?.sourceAppId ?? cycleApp?.blueprint ?? cycleApp?.sourceAppName;
        if (!cycle || !appKey) return null;
        return `${cycle}::${appKey}`.toLowerCase();
    };

    // Parent-cycle tag used by the App Arsenal to group a blueprint's assets
    // under one collapsible section instead of flooding the flat fleet grid.
    // Returns null for org-native assets so they sit at the top level.
    const normalizeCycle = (slug: unknown, name: unknown) => {
        const s = slug ? String(slug).trim() : "";
        if (!s) return null;
        return { slug: s.toLowerCase(), name: name ? String(name) : s };
    };

    // Agent fleet items come from agentDeployments, which carry no cycle link;
    // the parent tag lives on the underlying ai_agent job's config. Join once.
    const agentJobIds = Array.from(new Set(
        agentDeploymentsForOrg.map((d: any) => d.jobId).filter((id: any): id is number => typeof id === "number")
    ));
    const agentJobConfig = await appQueryService.getAgentJobConfigs(agentJobIds);

    const isLiveDeployment = (deployment: any, app: any) => Boolean(
        deployment.isPublished ||
        deployment.publicSlug ||
        ["running", "deployed", "active"].includes(String(deployment.status ?? "").toLowerCase()) ||
        ["running", "deployed", "active"].includes(String(app.runtimeMetadata?.status ?? "").toLowerCase())
    );

    const liveCycleDeployments = new Map<string, any>();
    for (const row of appDeploymentsForOrg as any[]) {
        const cycleApp = getCycleAppMetadata(row.deployment, row.app);
        if (!cycleApp || !isLiveDeployment(row.deployment, row.app) || !row.deployment.publicSlug) continue;
        const key = cycleKeyFor(cycleApp);
        if (key) liveCycleDeployments.set(key, row.deployment);
    }

    const appItems = appDeploymentsForOrg.map(({ deployment, app }: any) => {
        const cycleApp = getCycleAppMetadata(deployment, app);
        const configurePath = `/armory/apps/${app.id}`;
        const cycleKey = cycleKeyFor(cycleApp);
        const linkedLiveDeployment = cycleKey ? liveCycleDeployments.get(cycleKey) : null;
        const liveDeployment = isLiveDeployment(deployment, app) ? deployment : linkedLiveDeployment;
        const isLive = Boolean(liveDeployment);
        const publicPath = isLive && liveDeployment ? getAppLaunchHref(liveDeployment, app, orgId) : null;
        return {
            source: "app" as const,
            id: `app-${deployment.id}`,
            title: app.name,
            description: app.description,
            status: isLive ? "live" : deployment.status === "queued" ? "building" : deployment.status === "failed" ? "error" : app.status === "draft" ? "forging" : "inactive",
            publicPath,
            configurePath,
            editPath: cycleApp?.editableInAppBuilder ? `${configurePath}?tab=preview` : configurePath,
            cycleApp,
            relationship: getAppRelationshipMetadata(deployment, app),
            parentCycle: normalizeCycle(cycleApp?.sourceCycleSlug, cycleApp?.sourceCycleName),
            updatedAt: deployment.updatedAt ?? deployment.installedAt ?? app.updatedAt ?? null,
            deployment,
            app,
        };
    });

    const agentItems = agentDeploymentsForOrg
        .filter((deployment: any) => deployment.isActive === true)
        .map((deployment: any) => {
            const cfg = agentJobConfig.get(deployment.jobId) ?? {};
            return {
                source: "agent_ai" as const,
                id: `agent-${deployment.id}`,
                title: deployment.title,
                description: deployment.description,
                status: "live",
                publicPath: `/a/${deployment.slug}`,
                configurePath: `/agents/${deployment.jobId}?tab=publish`,
                parentCycle: normalizeCycle(cfg.sourceCycleSlug, cfg.sourceCycleName),
                updatedAt: deployment.updatedAt ?? deployment.createdAt ?? null,
                agentDeployment: deployment,
            };
        });

    const toTime = (value: unknown) => {
        if (!value) return 0;
        const time = new Date(value as string | Date).getTime();
        return Number.isNaN(time) ? 0 : time;
    };

    const sortedFleet = [...appItems, ...agentItems].sort((a, b) => {
        const aNum = parseInt(a.title.match(/^\d+/)?.[0] || "");
        const bNum = parseInt(b.title.match(/^\d+/)?.[0] || "");
        if (!isNaN(aNum) && !isNaN(bNum)) {
            return aNum - bNum;
        }
        if (!isNaN(aNum)) return -1;
        if (!isNaN(bNum)) return 1;
        return toTime(b.updatedAt) - toTime(a.updatedAt);
    });

    res.json(sortedFleet);
}));

/**
 * GET /api/apps/fleet-for-copilot
 * Lightweight read-model for the Oddjob Copilot assistant (requires auth, not admin).
 * Returns only: { slug, title, description, source, href, availability, actionLabel } for each live/active app
 * plus advertised marketplace apps that can be installed.
 * Used by the list_installed_apps agent tool so it can pass correct source + slug to render_app_surface.
 */
router.get("/fleet-for-copilot", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    let orgId = (req as any).organizationId;
    if (!orgId) {
        const orgContext = await getUserOrgContext(req);
        orgId = orgContext.organizationId;
    }
    if (!orgId) throw new BadRequestError("Organization context required");

    const { pool } = await import("@server/database_service.js");

    // Scope the fleet to the active Project Space. Filtered here rather than in
    // the services because both are shared with callers that legitimately want
    // the whole org.
    const { resolveProjectScope } = await import("@server/middleware/project-scope.js");
    const projectScope = await resolveProjectScope(req, { useDefault: false });
    const activeProjectId = projectScope?.id ?? null;

    /**
     * NULL projectId means org-global, NOT unassigned — every row predates the
     * column, so a strict equality would empty the fleet the moment a project is
     * selected. Both halves must use the same rule or the merged list is half
     * scoped, which is harder to notice than no scoping at all.
     */
    const visibleInProject = (row: any) =>
        activeProjectId == null || row?.projectId == null || row.projectId === activeProjectId;

    const [allAppDeployments, allAgentDeployments, marketApps, blueprintResult] = await Promise.all([
        appRegistryService.listOrgDeployments(orgId),
        AgentDeploymentService.listDeployments(orgId),
        appRegistryService.listAvailableApps(true),
        pool.query(`SELECT slug, name, description FROM blueprints WHERE is_public = true ORDER BY name`, []).catch(() => ({ rows: [] })),
    ]);

    const appDeploymentsForOrg = (allAppDeployments as any[]).filter(visibleInProject);
    const agentDeploymentsForOrg = (allAgentDeployments as any[]).filter(visibleInProject);

    const items: Array<{
        slug: string;
        title: string;
        description: string | null;
        source: "app" | "agent_ai" | "blueprint";
        href: string;
        availability: "installed" | "advertised" | "template";
        actionLabel: string;
        blueprint?: string | null;
        cycleSlug?: string | null;
        cycleName?: string | null;
        routePath?: string | null;
        sourceAppId?: string | null;
        sourceAppName?: string | null;
        appId?: number;
        deploymentId?: number;
        isPublished?: boolean;
        releaseRef?: string;
    }> = [];
    const installedAppIds = new Set<number>();
    const coveredBlueprintSlugs = new Set<string>();

    for (const { deployment, app } of appDeploymentsForOrg as any[]) {
        installedAppIds.add(deployment.appId);
        const href = getAppLaunchHref(deployment, app, orgId);
        if (!href) continue;
        const slug = deployment.publicSlug ?? app.slug;
        const rel = getAppRelationshipMetadata(deployment, app);
        if (rel.blueprint) coveredBlueprintSlugs.add(rel.blueprint);
        if (app.blueprintSlug) coveredBlueprintSlugs.add(app.blueprintSlug);
        items.push({
            slug,
            title: app.name ?? slug,
            description: app.description ?? null,
            source: "app",
            href,
            availability: "installed",
            actionLabel: `Open ${app.name ?? "app"}`,
            appId: deployment.appId,
            deploymentId: deployment.id,
            isPublished: deployment.isPublished === true,
            releaseRef: `deployment:${deployment.id}@${new Date(deployment.updatedAt ?? deployment.installedAt).toISOString()}`,
            ...rel,
        });
    }

    for (const deployment of agentDeploymentsForOrg as any[]) {
        if (!deployment.isActive) continue;
        items.push({
            slug: deployment.slug,
            title: deployment.title ?? deployment.slug,
            description: deployment.description ?? null,
            source: "agent_ai",
            href: `/a/${deployment.slug}`,
            availability: "installed",
            actionLabel: `Open ${deployment.title ?? "agent"}`,
        });
    }

    for (const app of marketApps as any[]) {
        if (installedAppIds.has(app.id) || !listedInMarket(app)) continue;
        if (app.slug) coveredBlueprintSlugs.add(app.slug);
        if (app.blueprintSlug) coveredBlueprintSlugs.add(app.blueprintSlug);
        items.push({
            slug: app.slug,
            title: app.name ?? app.slug,
            description: app.description ?? null,
            source: "app",
            href: `/armory/apps/${app.id}`,
            availability: "advertised",
            actionLabel: `Install ${app.name ?? "app"}`,
            appId: app.id,
            blueprint: app.blueprintSlug ?? app.blueprint ?? app.slug ?? null,
            cycleSlug: null,
            cycleName: null,
            routePath: null,
            sourceAppId: null,
            sourceAppName: null,
        });
    }

    for (const bp of blueprintResult.rows as any[]) {
        if (coveredBlueprintSlugs.has(bp.slug)) continue;
        const humanName = bp.name ?? bp.slug
            .split('-')
            .map((s: string) => s.charAt(0).toUpperCase() + s.slice(1))
            .join(' ');
        items.push({
            slug: bp.slug,
            title: humanName,
            description: bp.description ?? `Blueprint template: ${humanName}`,
            source: "blueprint",
            href: `/armory/new?blueprint=${encodeURIComponent(bp.slug)}`,
            availability: "template",
            actionLabel: `Create ${humanName}`,
            blueprint: bp.slug,
            cycleSlug: null,
            cycleName: null,
            routePath: null,
            sourceAppId: null,
            sourceAppName: null,
        });
    }

    res.json(items);
}));

/**
 * Install an app to the current organization
 */
router.post("/install", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const { appId } = req.body;
    let orgId = (req as any).organizationId;

    if (!orgId) {
        const orgContext = await getUserOrgContext(req);
        orgId = orgContext.organizationId;
    }

    if (!appId) throw new BadRequestError("App ID is required");
    if (!orgId) throw new BadRequestError("Organization context required");

    const { deployment } = await appRegistryService.installApp(appId, orgId);
    res.json(deployment);
}));

/**
 * List installed apps with pipeline step readiness for the current organization.
 */
router.get("/pipeline-runnable", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = orgContext.organizationId;
    if (!orgId) throw new BadRequestError("Organization context required");

    const deployments = await appRegistryService.listOrgDeployments(orgId);
    res.json(deployments.map((item: any) => ({
        ...item,
        pipeline: AppDeploymentService.getPipelineReadiness(item.deployment, item.app),
    })));
}));

/**
 * Create or update the hidden backing job used when an app is added to a pipeline.
 */
router.post("/deployments/:deploymentId/pipeline-job", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const deploymentId = parseInt(req.params.deploymentId, 10);
    if (isNaN(deploymentId)) throw new BadRequestError("Invalid deployment ID");

    const orgContext = await getUserOrgContext(req);
    const result = await AppDeploymentService.ensurePipelineRunnableJob(deploymentId, orgContext);
    res.json(result);
}));

async function getBlueprintApp(slug: string) {
    return await appQueryService.getBlueprintApp(slug);
}

/**
 * GET /api/apps/blueprint/:slug/sessions
 * Lightweight data source for generated Tokenized UI blueprint dashboards.
 */
router.get("/blueprint/:slug/sessions", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const slug = req.params.slug;
    const orgContext = await getUserOrgContext(req);
    const orgId = orgContext.organizationId;
    if (!orgId) throw new BadRequestError("Organization context required");

    const app = await getBlueprintApp(slug);
    if (!app) throw new NotFoundError(`Blueprint app not found: ${slug}`);

    const events = await appQueryService.getAppTelemetry(app.id, orgId, 10);

    res.json(events.map((event) => ({
        id: `TEL-${event.id}`,
        objective: event.event.replace(/\./g, " "),
        status: event.level,
    })));
}));

/**
 * POST /api/apps/blueprint/:slug/realign
 * Records a generated dashboard realignment request as auditable app telemetry.
 */
router.post("/blueprint/:slug/realign", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const slug = req.params.slug;
    const note = String(req.body?.note || "").trim();
    const orgContext = await getUserOrgContext(req);
    const orgId = orgContext.organizationId;
    if (!orgId) throw new BadRequestError("Organization context required");

    const app = await getBlueprintApp(slug);
    if (!app) throw new NotFoundError(`Blueprint app not found: ${slug}`);

    const event = await appQueryService.recordAppTelemetry({
        appId: app.id,
        orgId,
        event: "blueprint.realignment_requested",
        level: "info",
        metadata: {
            note,
            slug,
            requestedBy: (req as any).user?.id || (req as any).user?.email || "unknown",
            source: "tokenized_ui_control_deck",
        },
    });

    logger.info(`Blueprint realignment requested for ${slug}`, {
        appId: app.id,
        orgId,
        telemetryId: event.id,
    });

    res.status(202).json({
        status: "queued",
        message: "Realignment request recorded",
        telemetryId: event.id,
    });
}));

/**
 * Get publishing settings for an app deployment
 */
router.get("/:appId/deploy", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    let orgId = (req as any).organizationId;
    if (!orgId) {
        const orgContext = await getUserOrgContext(req);
        orgId = orgContext.organizationId;
    }

    const appId = parseInt(req.params.appId);
    if (isNaN(appId)) throw new BadRequestError("Invalid App ID");

    // Super admins may have no org — fall back to the app's owning org
    if (!orgId) {
        const app = await appRegistryService.getApp(appId);
        orgId = (app as any).developerOrgId ?? null;
    }
    if (!orgId) throw new BadRequestError("Organization context required");

    const existing = await AppDeploymentService.getByAppAndOrg(appId, orgId);

    if (!existing) {
        return res.json(null);
    }

    res.json(existing);
}));

/**
 * Update publishing settings for an app deployment
 */
router.post("/:appId/deploy", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    let orgId = (req as any).organizationId;
    if (!orgId) {
        const orgContext = await getUserOrgContext(req);
        orgId = orgContext.organizationId;
    }
    if (!orgId) throw new BadRequestError("Organization context required");

    const appId = parseInt(req.params.appId);
    if (isNaN(appId)) throw new BadRequestError("Invalid App ID");

    const existing = await AppDeploymentService.getByAppAndOrg(appId, orgId);

    if (!existing) {
        throw new NotFoundError("App not installed in this organization");
    }

    const validated = insertAppDeploymentSchema.parse(req.body);

    // Publishing is a lifecycle transition, not just a visibility toggle. A
    // public URL must never be enabled until the app has been prepared,
    // started, and answered an HTTP readiness probe.
    if (validated.isPublished === true) {
        try {
            await appRegistryService.startApp(appId, orgId);
        } catch (err: any) {
            throw new BadRequestError(`App could not be deployed: ${err?.message || String(err)}`);
        }

        const readiness = await appReadinessService.getAppReadiness(appId, orgId, { probeRuntime: true });
        if (!readiness.ready) {
            const blockers = readiness.checks
                .filter((item) => item.status === "fail" && item.severity === "blocker")
                .map((item) => item.message)
                .join(" ");
            throw new BadRequestError(`App was not published because deployment readiness failed.${blockers ? ` ${blockers}` : ""}`);
        }
    }

    const nextAccessPolicy = validated.accessPolicy !== undefined ? validated.accessPolicy : existing.accessPolicy;
    let passwordHash = existing.accessPasswordHash;
    const bodyPassword = (req.body as any).password;
    if (bodyPassword && bodyPassword.trim() !== '') {
        passwordHash = await hashPassword(bodyPassword);
    } else if (nextAccessPolicy !== 'password') {
        passwordHash = null;
    }

    const updated = await AppDeploymentService.updateDeploymentPublishing(appId, orgId, {
        publicSlug: validated.publicSlug !== undefined ? validated.publicSlug : existing.publicSlug,
        isPublished: validated.isPublished !== undefined ? validated.isPublished : existing.isPublished,
        title: validated.title !== undefined ? validated.title : existing.title,
        description: validated.description !== undefined ? validated.description : existing.description,
        brandingConfig: validated.brandingConfig !== undefined ? validated.brandingConfig : existing.brandingConfig,
        accessPolicy: nextAccessPolicy,
        accessPasswordHash: passwordHash,
        budgetLimitUsd: validated.budgetLimitUsd !== undefined ? (validated.budgetLimitUsd !== null && validated.budgetLimitUsd !== '' ? String(validated.budgetLimitUsd) : null) : existing.budgetLimitUsd,
        userBudgetLimit: validated.userBudgetLimit !== undefined ? (validated.userBudgetLimit !== null && validated.userBudgetLimit !== '' ? String(validated.userBudgetLimit) : null) : existing.userBudgetLimit,
        defaultModel: validated.defaultModel !== undefined ? validated.defaultModel : existing.defaultModel,
        systemPrompt: validated.systemPrompt !== undefined ? validated.systemPrompt : existing.systemPrompt,
        appMemoryEnabled: validated.appMemoryEnabled !== undefined ? validated.appMemoryEnabled : existing.appMemoryEnabled,
        hilEnabled: validated.hilEnabled !== undefined ? validated.hilEnabled : existing.hilEnabled,
        webhookUrl: validated.webhookUrl !== undefined ? validated.webhookUrl : existing.webhookUrl,
        webhookType: (validated as any).webhookType !== undefined ? (validated as any).webhookType : existing.webhookType,
        webhookSecret: (validated as any).webhookSecret !== undefined ? (validated as any).webhookSecret : existing.webhookSecret,
        nextPipelineId: (validated as any).nextPipelineId !== undefined ? (validated as any).nextPipelineId : existing.nextPipelineId,
        expertiseJobId: (validated as any).expertiseJobId !== undefined ? (validated as any).expertiseJobId : existing.expertiseJobId,
        allowedTopicIds: (validated as any).allowedTopicIds !== undefined ? (validated as any).allowedTopicIds : existing.allowedTopicIds,
        allowedDatasetIds: (validated as any).allowedDatasetIds !== undefined ? (validated as any).allowedDatasetIds : existing.allowedDatasetIds,
        allowedAgentIds: (validated as any).allowedAgentIds !== undefined ? (validated as any).allowedAgentIds : existing.allowedAgentIds,
        allowedPipelineIds: (validated as any).allowedPipelineIds !== undefined ? (validated as any).allowedPipelineIds : existing.allowedPipelineIds,
        defaultCollections: (validated as any).defaultCollections !== undefined ? (validated as any).defaultCollections : existing.defaultCollections,
        allowedTools: (validated as any).allowedTools !== undefined ? (validated as any).allowedTools : existing.allowedTools,
        reasoningProtocol: (validated as any).reasoningProtocol !== undefined ? (validated as any).reasoningProtocol : existing.reasoningProtocol,
        intelligenceCategory: (validated as any).intelligenceCategory !== undefined ? (validated as any).intelligenceCategory : existing.intelligenceCategory,
        deploymentMode: (validated as any).deploymentMode !== undefined ? (validated as any).deploymentMode : existing.deploymentMode,
        browserStartUrl: (validated as any).browserStartUrl !== undefined ? ((validated as any).browserStartUrl || null) : existing.browserStartUrl,
        browserGoal: (validated as any).browserGoal !== undefined ? (validated as any).browserGoal : existing.browserGoal,
        browserConfig: (validated as any).browserConfig !== undefined ? (validated as any).browserConfig : existing.browserConfig,
        navigationalMemoryShared: (validated as any).navigationalMemoryShared !== undefined ? (validated as any).navigationalMemoryShared : existing.navigationalMemoryShared,
    });

    res.json(updated);
}));

/**
 * Get basic analytics and telemetry for an app deployment
 */
router.get("/:appId/analytics", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    let orgId = (req as any).organizationId;
    if (!orgId) {
        const orgContext = await getUserOrgContext(req);
        orgId = orgContext.organizationId;
    }
    if (!orgId) throw new BadRequestError("Organization context required");

    const appId = parseInt(req.params.appId);
    if (isNaN(appId)) throw new BadRequestError("Invalid App ID");

    const analytics = await AppDeploymentService.getDeploymentAnalytics(appId, orgId);

    res.json(analytics);
}));

/**
 * Get QA audit results for an app
 */
router.get("/:appId/audits", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const appId = parseInt(req.params.appId);
    if (isNaN(appId)) throw new BadRequestError("Invalid App ID");

    const audits = await appQueryService.getAppAudits(appId, 50);

    res.json(audits);
}));

/**
 * Uninstall an app deployment and clean up its data
 */
router.delete("/:appId/deploy", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    let orgId = (req as any).organizationId;
    if (!orgId) {
        const orgContext = await getUserOrgContext(req);
        orgId = orgContext.organizationId;
    }
    if (!orgId) throw new BadRequestError("Organization context required");

    const appId = parseInt(req.params.appId);
    await AppDeploymentService.uninstallDeployment(appId, orgId);

    res.json({ success: true, message: "App uninstalled successfully" });
}));

/**
 * PATCH /api/apps/:appId/personality
 * Update OCEAN soul traits and archetype for an app deployment.
 */
router.patch("/:appId/personality", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    let orgId = (req as any).organizationId;
    if (!orgId) {
        const orgContext = await getUserOrgContext(req);
        orgId = orgContext.organizationId;
    }
    if (!orgId) throw new BadRequestError("Organization context required");

    const appId = parseInt(req.params.appId);
    if (isNaN(appId)) throw new BadRequestError("Invalid App ID");

    const { archetype, openness, conscientiousness, extraversion, agreeableness, neuroticism } = req.body;

    const clamp = (v: any) => {
        const n = parseFloat(v);
        if (isNaN(n)) return undefined;
        return Math.min(1, Math.max(0, n));
    };

    const existing = await AppDeploymentService.getByAppAndOrg(appId, orgId);
    if (!existing) throw new NotFoundError("App deployment not found");

    const existingTraits = (existing as any).oceanTraits as Record<string, number> | null;
    const newTraits = {
        o: clamp(openness)         ?? existingTraits?.o ?? 0.6,
        c: clamp(conscientiousness) ?? existingTraits?.c ?? 0.7,
        e: clamp(extraversion)      ?? existingTraits?.e ?? 0.5,
        a: clamp(agreeableness)     ?? existingTraits?.a ?? 0.6,
        n: clamp(neuroticism)       ?? existingTraits?.n ?? 0.3,
    };

    await appQueryService.updatePersonalityTraits(appId, orgId, newTraits, archetype ?? (existing as any).soulArchetype ?? null);

    res.json({ success: true, traits: newTraits, archetype: archetype ?? (existing as any).soulArchetype ?? null });
}));

/**
 * Preview the files and risk profile for an Interactive Builder request before writing.
 */
router.post("/:appId/enhancement-plan", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const appId = parseInt(req.params.appId);
    if (isNaN(appId)) throw new BadRequestError("Invalid App ID");

    const { prompt, scopePath } = req.body;
    if (!prompt || typeof prompt !== "string") throw new BadRequestError("Prompt is required for enhancement planning");

    const { app, orgId } = await requireAppBuilderAccess(req, appId);
    if (!orgId) throw new BadRequestError("Organization context required");

    const plan = await appBuilderService.previewEnhancementPlan(appId, app.slug, prompt, orgId, scopePath);
    if (!plan.success) throw new BadRequestError(plan.error || "Failed to create enhancement plan");
    res.json(plan);
}));

/** Preview a reversible App Forge theme pass without modifying source. */
router.post("/:appId/theme-plan", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const appId = parseInt(req.params.appId);
    if (isNaN(appId)) throw new BadRequestError("Invalid App ID");
    const { styleId, embellishment } = req.body;
    if (!styleId || typeof styleId !== "string") throw new BadRequestError("A design style is required");

    const { app, orgId } = await requireAppBuilderAccess(req, appId);
    if (!orgId) throw new BadRequestError("Organization context required");
    const themed = await resolveThemeEnhancementPrompt(styleId, embellishment);
    const plan = await appBuilderService.previewEnhancementPlan(appId, app.slug, themed.prompt, orgId);
    if (!plan.success) throw new BadRequestError(plan.error || "Failed to preview theme application");
    res.json({ ...plan, style: { id: themed.style.id, name: themed.style.name, tagline: themed.style.tagline } });
}));

/** Apply a catalog theme through the App Builder, preserving a revert snapshot. */
router.post("/:appId/apply-theme", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const appId = parseInt(req.params.appId);
    if (isNaN(appId)) throw new BadRequestError("Invalid App ID");
    const { styleId, embellishment } = req.body;
    if (!styleId || typeof styleId !== "string") throw new BadRequestError("A design style is required");

    const { app, orgId } = await requireAppBuilderAccess(req, appId);
    if (!orgId) throw new BadRequestError("Organization context required");
    const themed = await resolveThemeEnhancementPrompt(styleId, embellishment);

    res.setHeader("Connection", "keep-alive");
    res.setTimeout(120000);
    const result = await appBuilderService.enhanceApp(appId, app.slug, themed.prompt, orgId);
    if (!result.success) throw new BadRequestError(result.error || "Failed to apply theme");
    res.json({ ...result, style: { id: themed.style.id, name: themed.style.name }, revertAvailable: true });
}));

/**
 * Enhance an app dynamically via Interactive Chat Builder
 */
router.post("/:appId/enhance", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const appId = parseInt(req.params.appId);
    if (isNaN(appId)) throw new BadRequestError("Invalid App ID");

    const { prompt, chatHistory } = req.body;
    if (!prompt) throw new BadRequestError("Prompt is required for enhancement");

    const { app, orgId } = await requireAppBuilderAccess(req, appId);

    if (!orgId) throw new BadRequestError("Organization context required");

    
    // Set headers to prevent timeout for long-running AI requests
    res.setHeader('Connection', 'keep-alive');
    res.setTimeout(120000, () => {
        if (!res.headersSent) res.status(408).json({ error: "Build timeout" });
    });

    const result = await appBuilderService.enhanceApp(appId, app.slug, prompt, orgId, chatHistory);
    
    if (!result.success) {
        if (result.buildFailed || result.recoverable) {
            const updatedApp = await appRegistryService.getApp(appId);
            return res.json({
                success: false,
                buildFailed: true,
                recoverable: true,
                backupAvailable: result.backupAvailable,
                filesWritten: result.filesWritten ?? 0,
                error: result.error || "Rebuild failed after applying code changes",
                app: updatedApp,
            });
        }
        throw new BadRequestError(result.error || "Failed to enhance app");
    }

    // Conversational reply — no rebuild happened, return message directly
    if (result.conversational) {
        return res.json({ success: true, conversational: true, message: result.message, filesWritten: 0 });
    }

    // Return the updated app data so the frontend can retrieve the new assignedPort
    const updatedApp = await appRegistryService.getApp(appId);
    res.json({ success: true, filesWritten: result.filesWritten, app: updatedApp });
}));

/**
 * Start the app container (no rebuild — uses the existing :v1 image).
 * Use this when the container is stopped but the image already exists.
 */
router.post("/:appId/start", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const appId = parseInt(req.params.appId);
    if (isNaN(appId)) throw new BadRequestError("Invalid App ID");

    let orgId = (req as any).organizationId;
    if (!orgId) {
        const orgContext = await getUserOrgContext(req);
        orgId = orgContext.organizationId;
    }
    if (!orgId) throw new BadRequestError("Organization context required to start app");

    await appRegistryService.startApp(appId, orgId);

    const updatedApp = await appRegistryService.getApp(appId);
    res.json({ success: true, app: updatedApp });
}));

/**
 * Stop the app container.
 */
router.post("/:appId/stop", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const appId = parseInt(req.params.appId);
    if (isNaN(appId)) throw new BadRequestError("Invalid App ID");

    await appRegistryService.stopApp(appId);
    res.json({ success: true });
}));

/**
 * Revert the last AI-applied change by restoring the pre-enhance backup.
 */
router.post("/:appId/revert-last", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const appId = parseInt(req.params.appId);
    if (isNaN(appId)) throw new BadRequestError("Invalid App ID");

    const { app } = await requireAppBuilderAccess(req, appId);

    res.setHeader('Connection', 'keep-alive');
    res.setTimeout(60000, () => {
        if (!res.headersSent) res.status(408).json({ error: "Revert timeout" });
    });

    const result = await appBuilderService.revertLast(appId, (app as any).slug);

    if (!result.success) throw new BadRequestError(result.error || "Revert failed");

    res.json({ success: true, filesRestored: result.filesRestored });
}));

/**
 * Rebuild the app container from current workspace files (no AI, no code changes).
 * Builds a fresh :v1 image and restarts the dev container.
 */
router.post("/:appId/rebuild", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const appId = parseInt(req.params.appId);
    if (isNaN(appId)) throw new BadRequestError("Invalid App ID");

    const { app } = await requireAppBuilderAccess(req, appId);

    res.setHeader('Connection', 'keep-alive');
    res.setTimeout(180000, () => {
        if (!res.headersSent) res.status(408).json({ error: "Rebuild timeout" });
    });

    const result = await appBuilderService.buildContainer(appId, app.slug);

    if (!result.success) {
        throw new BadRequestError(result.error || "Rebuild failed");
    }

    const updatedApp = await appRegistryService.getApp(appId);
    res.json({ success: true, app: updatedApp });
}));

/**
 * Stage an update for an app (Developer only)
 */
router.post("/:appId/staging", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    let orgId = (req as any).organizationId;
    if (!orgId) {
        const orgContext = await getUserOrgContext(req);
        orgId = orgContext.organizationId;
    }
    const appId = parseInt(req.params.appId);

    // Check ownership
    const app = await appRegistryService.getApp(appId);
    if (app.developerOrgId !== orgId) {
        throw new BadRequestError("You do not have permission to update this app");
    }

    const { manifestUrl } = req.body;
    const updated = await appRegistryService.stageUpdate(appId, manifestUrl);
    res.json(updated);
}));

/**
 * Publish a staged update for an app (Developer only)
 */
router.post("/:appId/publish", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    let orgId = (req as any).organizationId;
    if (!orgId) {
        const orgContext = await getUserOrgContext(req);
        orgId = orgContext.organizationId;
    }
    const appId = parseInt(req.params.appId);

    // Check ownership
    const app = await appRegistryService.getApp(appId);
    if (app.developerOrgId !== orgId) {
        throw new BadRequestError("You do not have permission to publish this app");
    }

    const { changelog } = req.body;
    const updated = await appRegistryService.publishUpdate(appId, changelog);
    res.json(updated);
}));

/**
 * Rollback an app to a previous version tag
 */
router.post("/:appId/rollback", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    let orgId = (req as any).organizationId;
    if (!orgId) {
        const orgContext = await getUserOrgContext(req);
        orgId = orgContext.organizationId;
    }
    if (!orgId) throw new BadRequestError("Organization context required");

    const appId = parseInt(req.params.appId);
    if (isNaN(appId)) throw new BadRequestError("Invalid App ID");

    const { version } = req.body;
    if (!version || version.trim() === '') throw new BadRequestError("Version tag is required");

    const deployment = await AppDeploymentService.getByAppAndOrg(appId, orgId);
    if (!deployment) throw new NotFoundError("App not installed in this organization");

    const result = await appForgeService.rollbackToVersion(appId, version);
    res.json(result);
}));

// GET /api/apps/:appId/releases
router.get("/:appId/releases", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const appId = Number(req.params.appId);
    const { forgeReleaseService } = await import("./core/forge-release.service.js");
    const releases = await forgeReleaseService.listReleases(appId);
    res.json(releases);
}));

// POST /api/apps/:appId/releases/:releaseId/approve
router.post("/:appId/releases/:releaseId/approve", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const releaseId = Number(req.params.releaseId);
    const userId = (req as any).user?.id || "system";
    const { forgeReleaseService } = await import("./core/forge-release.service.js");
    const result = await forgeReleaseService.approveRelease(releaseId, userId);
    res.json(result);
}));

// POST /api/apps/:appId/releases/:releaseId/deploy
router.post("/:appId/releases/:releaseId/deploy", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const releaseId = Number(req.params.releaseId);
    const userId = (req as any).user?.id || "system";
    const { forgeReleaseService } = await import("./core/forge-release.service.js");
    const result = await forgeReleaseService.deployRelease(releaseId, userId);
    res.json(result);
}));

// POST /api/apps/:appId/rollback/:releaseId
router.post("/:appId/rollback/:releaseId", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const appId = Number(req.params.appId);
    const releaseId = Number(req.params.releaseId);
    const userId = (req as any).user?.id || "system";
    const { forgeReleaseService } = await import("./core/forge-release.service.js");
    const result = await forgeReleaseService.rollbackToRelease(appId, releaseId, userId);
    res.json(result);
}));

/**
 * List available blueprints with optional filtering
 */
router.get("/blueprints", asyncHandler(async (req: Request, res: Response) => {
    let blueprints = await appForgeService.listBlueprints();
    const { category, persona, q } = req.query;

    if (category && typeof category === "string" && category !== "All") {
        blueprints = blueprints.filter(b => b.category?.toLowerCase() === category.toLowerCase());
    }

    if (persona && typeof persona === "string") {
        blueprints = blueprints.filter(b => b.persona?.toLowerCase().includes(persona.toLowerCase()));
    }

    if (q && typeof q === "string" && q.trim()) {
        const queryLower = q.toLowerCase();
        blueprints = blueprints.filter(b => 
            b.name.toLowerCase().includes(queryLower) ||
            b.slug.toLowerCase().includes(queryLower) ||
            b.description.toLowerCase().includes(queryLower) ||
            b.persona?.toLowerCase().includes(queryLower) ||
            b.keywords?.some((k: string) => k.toLowerCase().includes(queryLower))
        );
    }

    res.json(blueprints);
}));

/**
 * Quick clone a blueprint into an initialized application draft
 */
router.post("/blueprints/:slug/clone", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const { slug } = req.params;
    const { customName, objective } = req.body;
    const blueprints = await appForgeService.listBlueprints();
    const blueprint = blueprints.find(b => b.slug === slug);

    if (!blueprint) {
        throw new NotFoundError(`Blueprint '${slug}' not found`);
    }

    const orgContext = await getUserOrgContext(req);
    const targetName = customName || `${blueprint.name} (Custom)`;
    const targetSlug = `${slug}-${Date.now().toString(36).slice(-4)}`;

    const draft = {
        name: targetName,
        slug: targetSlug,
        blueprint: slug,
        description: objective || blueprint.description,
        category: blueprint.category,
        persona: blueprint.persona,
        organizationId: orgContext.organizationId,
        readinessStatus: "draft",
        capabilities: blueprint.capabilities,
        createdAt: new Date().toISOString()
    };

    res.json({
        success: true,
        message: `Blueprint '${blueprint.name}' cloned successfully`,
        draft
    });
}));

/**
 * Kick off async app forge job; returns jobId immediately
 */
router.post("/forge", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    logger.info(`[Forge] Incoming request: ${req.body.slug} (skipToAssembly: ${req.body.skipToAssembly})`);
    const { name, slug } = req.body;
    if (!name || !slug) throw new BadRequestError("name and slug are required");

    const orgContext = await getUserOrgContext(req);

    // The lock, the draft, the history entry and the kickoff live together in
    // startForgeRun so that a build begun from a CREW room is the same sequence
    // as one begun here. See forge-start.service.ts.
    const result = await startForgeRun({
        ...req.body,
        organizationId: orgContext.organizationId,
        projectId: req.body.projectId ? Number(req.body.projectId) : (req as any).projectId || undefined,
    });

    if (!result.started) {
        // 503, not 409: nothing is wrong with the request, there is just no
        // executor to run it. The spec is explicit that a Forge request must
        // never be accepted without an execution path.
        if (result.reason === "no_executor") {
            res.status(503).json({
                error: `App Forge cannot accept builds right now. ${result.detail}`,
                retryable: true,
            });
            return;
        }

        res.status(409).json({
            error: `A forge is already running for "${result.slug}"${result.existingJobId ? ` (job ${result.existingJobId})` : ""}. Wait for it to finish or cancel it first.`,
            existingJobId: result.existingJobId,
        });
        return;
    }

    res.json({ jobId: result.jobId });
}));

/**
 * Lease a warm forge container when user enters App Forge.
 */
router.post("/forge/warmup/lease", requireOrgAdminOrSuper, asyncHandler(async (_req: Request, res: Response) => {
    const lease = await appForgeService.acquireWarmLease();
    if (!lease) {
        return res.status(503).json({ success: false, message: "No warm container available right now." });
    }
    res.json({ success: true, ...lease });
}));

/**
 * Release/dehydrate previously leased warm forge container.
 */
router.post("/forge/warmup/release", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const { leaseId, dehydrate = true } = req.body;
    if (!leaseId || typeof leaseId !== "string") {
        throw new BadRequestError("leaseId is required");
    }

    const released = await appForgeService.releaseWarmLease(leaseId, !!dehydrate);
    res.json({ success: released });
}));

/**
 * Poll forge job status (Legacy)
 */
router.get("/forge/status/:jobId", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = orgContext.organizationId;
    if (!orgId) throw new BadRequestError("Organization context required");

    const { jobId } = req.params;

    // This route read no org context at all: any org admin could fetch any job by
    // id and get the whole draft back — name, description, apiInstructions,
    // blackboard. It pairs with /forge/active/:slug below, whose lock key is
    // global, so one org could discover another's jobId and then read it here.
    // Scoped the way the sibling /forge/drafts/:jobId route already is.
    const draft = await forgeDraftService.getDraft(jobId);
    if (!draft) throw new NotFoundError("Forge job not found");
    if (draft.organizationId !== orgId && !orgContext.isSuperAdmin) {
        // 404, not 403: confirming the id exists tells the caller something about
        // an organization they cannot see.
        throw new NotFoundError("Forge job not found");
    }

    const raw = await redis.get(`forge:job:${jobId}`);
    if (!raw) return res.json(draft);

    try {
        res.json({ ...draft, ...JSON.parse(raw) });
    } catch {
        res.status(500).json({ error: "Corrupt job record" });
    }
}));

/**
 * GET /api/apps/forge/drafts
 * Long-lived server-side forge drafts for recovery/restart after navigation or failure.
 */
router.get("/forge/drafts", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = orgContext.organizationId;
    if (!orgId) throw new BadRequestError("Organization context required");

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const drafts = await forgeDraftService.listDrafts(orgId, limit);
    res.json({ drafts, count: drafts.length });
}));

/**
 * GET /api/apps/forge/drafts/:jobId
 */
router.get("/forge/drafts/:jobId", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = orgContext.organizationId;
    if (!orgId) throw new BadRequestError("Organization context required");

    const draft = await forgeDraftService.getDraft(req.params.jobId);
    if (!draft) throw new NotFoundError("Forge draft not found");
    if (draft.organizationId !== orgId && !orgContext.isSuperAdmin) {
        throw new ForbiddenError("Forge draft belongs to another organization");
    }
    res.json(draft);
}));

/**
 * DELETE /api/apps/forge/drafts/:jobId/layers/:layer
 * Unwires a whole layer — the UI form, the pipeline DAG, or the dataset.
 *
 * This is the shape the Assembly Stack actually offers: its cards are layers
 * ("UI Input Form", "Pipeline DAG"), not individual fields.
 */
router.delete("/forge/drafts/:jobId/layers/:layer", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = orgContext.organizationId;
    if (!orgId) throw new BadRequestError("Organization context required");

    const layer = req.params.layer;
    if (layer !== "components" && layer !== "pipelineSteps" && layer !== "dataset") {
        throw new BadRequestError(`Unknown assembly layer "${layer}".`);
    }

    // Ownership before mutation, for the same reason as the unit route below.
    const draft = await forgeDraftService.getDraft(req.params.jobId);
    if (!draft) throw new NotFoundError("Forge draft not found");
    if (draft.organizationId !== orgId && !orgContext.isSuperAdmin) {
        throw new ForbiddenError("Forge draft belongs to another organization");
    }

    const result = await forgeDraftService.clearDraftLayer(req.params.jobId, layer);
    if (!result) throw new NotFoundError("Forge draft not found");
    res.json({ removed: result.removed, draft: result.draft });
}));

/**
 * DELETE /api/apps/forge/drafts/:jobId/units/:kind/:unitId
 * Unwires one unit from a draft's assembly stack.
 *
 * The Assembly Stack rail is a projection of the last mount_builder_pod artifact; the
 * draft is what actually survives the conversation and feeds the next deploy. Removing
 * a unit from the view alone would leave it wired and it would reappear, so the removal
 * has to land here.
 */
router.delete("/forge/drafts/:jobId/units/:kind/:unitId", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = orgContext.organizationId;
    if (!orgId) throw new BadRequestError("Organization context required");

    const kind = req.params.kind;
    if (kind !== "component" && kind !== "pipelineStep" && kind !== "datasetField") {
        throw new BadRequestError(`Unknown unit kind "${kind}".`);
    }

    // Ownership is checked BEFORE the mutation, not after: removeDraftUnit writes, and
    // a check that runs afterwards has already let another tenant edit the draft.
    const draft = await forgeDraftService.getDraft(req.params.jobId);
    if (!draft) throw new NotFoundError("Forge draft not found");
    if (draft.organizationId !== orgId && !orgContext.isSuperAdmin) {
        throw new ForbiddenError("Forge draft belongs to another organization");
    }

    const result = await forgeDraftService.removeDraftUnit(req.params.jobId, { kind, id: req.params.unitId });
    if (!result) throw new NotFoundError("Forge draft not found");

    // removed:false is reported rather than treated as success, so the caller can tell
    // "already gone" from "never there".
    res.json({ removed: result.removed, draft: result.draft });
}));

/**
 * POST /api/apps/forge/drafts/:jobId/restart
 * Re-queue a failed/stale forge draft using its original configuration.
 */
/**
 * POST /api/apps/forge/drafts/:jobId/cancel
 * End a forge job: queued, running, or stuck.
 *
 * Cancelling by hand is unreliable because the state lives in four places — the
 * draft, the `forge:job:<id>` overlay that getDraft lets WIN over the draft, the
 * BullMQ entries that would otherwise retry it, and the per-slug lock that
 * refuses the next forge for the app. cancelForgeJob writes all four.
 */
router.post("/forge/drafts/:jobId/cancel", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = orgContext.organizationId;
    if (!orgId) throw new BadRequestError("Organization context required");

    const { jobId } = req.params;
    const draft = await forgeDraftService.getDraft(jobId);
    if (!draft) throw new NotFoundError("Forge draft not found");
    if (draft.organizationId !== orgId && !orgContext.isSuperAdmin) {
        throw new ForbiddenError("Forge draft belongs to another organization");
    }

    if (["completed", "failed", "cancelled"].includes(draft.status)) {
        return res.status(409).json({
            error: `Forge job ${jobId} already finished as "${draft.status}".`,
            jobId,
            status: draft.status,
        });
    }

    const { cancelForgeJob } = await import("./infrastructure/forge-queue.js");
    const result = await cancelForgeJob(jobId, req.body?.reason || "Cancelled from the Forge console");

    res.json({
        jobId,
        status: "cancelled",
        removedFromQueue: result.removedFromQueue,
        // An attempt already executing stops at its next stage boundary, not
        // instantly. Say so rather than implying the work halted on the spot.
        stoppingInFlight: result.wasRunning,
        message: result.wasRunning
            ? "Cancelled. The running attempt stops at its next stage boundary."
            : "Cancelled.",
    });
}));

router.post("/forge/drafts/:jobId/restart", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = orgContext.organizationId;
    if (!orgId) throw new BadRequestError("Organization context required");

    const { jobId } = req.params;
    const draft = await forgeDraftService.getDraft(jobId);
    if (!draft) throw new NotFoundError("Forge draft not found");
    if (draft.organizationId !== orgId && !orgContext.isSuperAdmin) {
        throw new ForbiddenError("Forge draft belongs to another organization");
    }

    const activeStatuses = new Set(["queued", "running", "building", "awaiting_strategy_approval", "awaiting_architecture_approval", "awaiting_wave_approval"]);
    if (activeStatuses.has(draft.status)) {
        return res.status(409).json({
            error: `Forge job ${jobId} is still active and can be resumed.`,
            jobId,
            status: draft.status,
            resumable: true,
        });
    }

    const activeKey = `forge:active:${draft.slug}`;
    const existingJobId = await redis.get(activeKey);
    if (existingJobId && existingJobId !== jobId) {
        const rawExisting = await redis.get(`forge:job:${existingJobId}`);
        let existingStatus = "unknown";
        try { existingStatus = rawExisting ? JSON.parse(rawExisting).status : "unknown"; } catch { /* ignore */ }
        if (activeStatuses.has(existingStatus)) {
            return res.status(409).json({
                error: `A forge is already running for "${draft.slug}" (job ${existingJobId}).`,
                existingJobId,
                status: existingStatus,
            });
        }
        await redis.del(activeKey).catch(() => {});
    }

    const claimed = await redis.set(activeKey, jobId, "EX", 86400, "NX");
    if (!claimed) {
        const current = await redis.get(activeKey);
        if (current !== jobId) {
            return res.status(409).json({ error: `Forge restart could not claim active slot for "${draft.slug}".`, existingJobId: current || undefined });
        }
    }

    // Restart reuses this jobId, so a prior cancel's flag is still live and the
    // pipeline would abort at stage 0 the moment it started. Asking for a restart
    // withdraws the cancel; clear it before the job re-enters.
    const { forgeCancelKey } = await import("./infrastructure/forge-queue.js");
    await redis.del(forgeCancelKey(jobId)).catch(() => {});

    await forgeDraftService.markRestarting(jobId);
    try {
        const restartOptions = {
            ...draft.options,
            organizationId: draft.organizationId ?? undefined,
            jobId,
            blackboard: {
                ...(draft.options.blackboard || {}),
                restartedFromDraft: true,
                restartAttempt: (draft.attempt ?? 1) + 1,
            },
        } as any;
        await appForgeService.forgeApp(draft.blueprintSlug, restartOptions);
        res.json({ success: true, jobId, draft: await forgeDraftService.getDraft(jobId) });
    } catch (err: any) {
        await redis.del(activeKey).catch(() => {});
        await forgeDraftService.updateDraft(jobId, { status: "failed", error: err.message, message: `Restart failed: ${err.message}` });
        throw err;
    }
}));

/**
 * GET /api/apps/forge/active
 * Discover the most recent active/suspended forge job for current org.
 * Helps users recover in-progress jobs after session timeout.
 */
router.get("/forge/active", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = orgContext.organizationId;
    if (!orgId) throw new BadRequestError("Organization context required");

    const activeStatuses = new Set(["queued", "running", "building", "awaiting_strategy_approval", "awaiting_architecture_approval", "awaiting_wave_approval"]);
    const drafts = await forgeDraftService.listDrafts(orgId, 25);
    const draftActiveJob = drafts.find(draft => activeStatuses.has(draft.status));
    if (draftActiveJob) {
        return res.json({
            active: true,
            jobId: draftActiveJob.jobId,
            slug: draftActiveJob.slug,
            name: draftActiveJob.name,
            status: draftActiveJob.status,
            updatedAt: draftActiveJob.updatedAt,
        });
    }

    const activeJob = await appQueryService.getActiveForgeJob(orgId);
    res.json(activeJob);
}));

/**
 * GET /api/apps/forge/active/:slug
 * Discover if there's an active forge job for a specific app slug.
 * Allows UI to re-attach to a background build after refresh/nav-away.
 */
router.get("/forge/active/:slug", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = orgContext.organizationId;
    if (!orgId) throw new BadRequestError("Organization context required");

    const { slug } = req.params;
    const jobId = await redis.get(`forge:active:${slug}`);

    if (!jobId) {
        return res.json({ active: false });
    }

    // forge:active:<slug> is a single global namespace — no org anywhere in the
    // key — so this answered for any organization's app. It also handed back the
    // jobId, which was the key to /forge/status/:jobId above. Answer only for a
    // job this caller's organization owns.
    //
    // "not active" rather than a refusal: this endpoint exists so the UI can
    // re-attach to its own build, and for a caller who cannot see that job the
    // truthful answer to "is there one of mine building?" is no.
    const owner = await forgeDraftService.getDraft(jobId);
    if (!owner || (owner.organizationId !== orgId && !orgContext.isSuperAdmin)) {
        return res.json({ active: false });
    }

    // Verify job still exists and isn't completed/failed
    const rawStatus = await redis.get(`forge:job:${jobId}`);
    if (!rawStatus) {
        await redis.del(`forge:active:${slug}`);
        return res.json({ active: false });
    }

    let statusObj: any;
    try { statusObj = JSON.parse(rawStatus); } catch { statusObj = {}; }
    const isStale = statusObj.status === 'completed' || statusObj.status === 'failed';
    
    if (isStale) {
        // Keep active mapping for a few minutes for 'Final Review' state, 
        // but tell UI it's not "actively building" if needed.
        return res.json({ active: true, jobId, status: statusObj.status, stale: true });
    }

    res.json({ active: true, jobId, status: statusObj.status });
}));

/**
 * GET /api/apps/forge/history
 * List recent forge jobs for the current organization.
 */
router.get("/forge/history", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = orgContext.organizationId;
    if (!orgId) throw new BadRequestError("Organization context required");

    const history = await appQueryService.getForgeHistory(orgId);
    res.json(history);
}));

/**
 * POST /api/apps/:appId/forge-cleanup
 * Admin endpoint to clean up a forge workspace for an app.
 * Triggered automatically on failure or manually via admin UI.
 */
router.post("/:appId/forge-cleanup", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const { appId } = req.params;
    const app = await appRegistryService.getApp(parseInt(appId, 10));
    if (!app) throw new NotFoundError("App not found");

    const result = await appForgeService.cleanupWorkspace(app.slug);
    res.json(result);
}));

/**
 * POST /api/apps/forge/analyze-idea
 * Takes a user's raw idea and returns a structured Agile Business Case.
 */
router.post("/forge/analyze-idea", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const { idea } = req.body;
    if (!idea) throw new BadRequestError("The 'idea' field is required.");

    const orgContext = await getUserOrgContext(req);
    const businessCase = await forgeLifecycleService.analyzeIdea(idea, orgContext.organizationId ?? undefined);

    res.json(businessCase);
}));

/**
 * POST /api/apps/forge/discover-assets
 * Takes a business case and returns a list of relevant existing assets.
 */
router.post("/forge/discover-assets", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const { businessCase } = req.body;
    if (!businessCase) throw new BadRequestError("The 'businessCase' field is required.");

    const orgContext = await getUserOrgContext(req);

    const assets = await appForgeService.discoverAssets(businessCase, orgContext.organizationId ?? undefined);

    res.json(assets);
}));

/**
 * POST /api/apps/forge/generate-diagram
 * Takes a business case and returns a graph data structure for rendering.
 */
router.post("/forge/generate-diagram", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const { businessCase, assets } = req.body;
    if (!businessCase) throw new BadRequestError("The 'businessCase' field is required.");

    const diagram = await appForgeService.generateDiagram(businessCase, assets);

    res.json(diagram);
}));

/**
 * POST /api/apps/forge/pre-flight-check
 * Runs the Forecaster and Compliance Officer agents.
 */
router.post("/forge/pre-flight-check", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const { businessCase, diagram } = req.body;
    if (!businessCase || !diagram) throw new BadRequestError("The 'businessCase' and 'diagram' fields are required.");

    const orgContext = await getUserOrgContext(req);
    const results = await appForgeService.runPreFlightCheck(businessCase, diagram, orgContext.organizationId ?? undefined);

    res.json(results);
}));

/**
 * List node_modules cache entries (admin)
 */
router.get("/forge/nm-cache", requireOrgAdminOrSuper, asyncHandler(async (_req: Request, res: Response) => {
    const entries = await appForgeService.listNmCacheEntries();
    res.json({ entries, count: entries.length });
}));

/**
 * Prune stale node_modules cache entries (admin)
 */
router.delete("/forge/nm-cache", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const maxEntries = parseInt(req.query.maxEntries as string) || 10;
    const result = await appForgeService.pruneNmCache(maxEntries);
    res.json(result);
}));

/**
 * Approve the generated build plan to resume forging.
 */
router.post("/forge/:jobId/approve", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const { jobId } = req.params;
    const { approvedPlan } = req.body;

    const raw = await redis.get(`forge:job:${jobId}`);
    if (!raw) throw new NotFoundError("Forge job not found");
    let jobData: any; try { jobData = JSON.parse(raw); } catch { throw new BadRequestError("Forge job record is corrupt"); }

    // Read immutable config — forge:job state is overwritten on every status update
    const configRaw = await redis.get(`forge:config:${jobId}`);
    let configData: any; try { configData = configRaw ? JSON.parse(configRaw) : jobData; } catch { configData = jobData; }
    if (!configData.blueprintSlug) throw new NotFoundError("Forge job config not found or expired");

    // Re-queue the forge job with approval
    await appForgeService.forgeApp(configData.blueprintSlug, {
        ...configData.options,
        isApprovedPlan: true,
        approvedPlan: approvedPlan || jobData.plan,
        jobId: jobId // Reuse same ID to track progress in same UI component
    });

    res.json({ success: true, message: "Plan approved. Forging resumed." });
}));

/**
 * Approve the technical architecture to resume forging.
 */
router.post("/forge/:jobId/approve-architecture", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const { jobId } = req.params;
    const { approvedArchitecture, archAnswers } = req.body;

    const raw = await redis.get(`forge:job:${jobId}`);
    if (!raw) throw new NotFoundError("Forge job not found");
    let jobData: any; try { jobData = JSON.parse(raw); } catch { throw new BadRequestError("Forge job record is corrupt"); }

    // Read immutable config — forge:job state is overwritten on every status update
    const configRaw = await redis.get(`forge:config:${jobId}`);
    let configData: any; try { configData = configRaw ? JSON.parse(configRaw) : jobData; } catch { configData = jobData; }
    if (!configData.blueprintSlug) throw new NotFoundError("Forge job config not found or expired");

    // Re-queue the forge job with architecture approval
    await appForgeService.forgeApp(configData.blueprintSlug, {
        ...configData.options,
        isApprovedPlan: true,
        isApprovedArchitecture: true,
        approvedArchitecture: approvedArchitecture || jobData.architecture,
        archAnswers,
        jobId: jobId
    });

    res.json({ success: true, message: "Architecture approved. Commencing assembly." });
}));

/**
 * Approve the current wave and proceed to the next one.
 */
router.post("/forge/:jobId/approve-wave", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const { jobId } = req.params;
    const { waveId } = req.body;

    const raw = await redis.get(`forge:job:${jobId}`);
    if (!raw) throw new NotFoundError("Forge job not found");
    let jobData: any;
    try { jobData = JSON.parse(raw); } catch { throw new BadRequestError("Forge job record is corrupt"); }

    const configRaw = await redis.get(`forge:config:${jobId}`);
    if (!configRaw) throw new NotFoundError("Forge job config expired — cannot resume. Please start a new forge.");
    let configData: any;
    try { configData = JSON.parse(configRaw); } catch { throw new BadRequestError("Forge job config is corrupt"); }
    if (!configData.blueprintSlug || !configData.options) throw new NotFoundError("Forge job config is malformed.");

    await appForgeService.forgeApp(configData.blueprintSlug, {
        ...configData.options,
        isApprovedPlan: true,
        isApprovedArchitecture: true,
        approvedWaveId: waveId || jobData.nextWaveId,
        jobId: jobId
    });

    res.json({ success: true, message: `Wave ${waveId} approved. Resuming assembly.` });
}));

/**
 * Finish the forge early at the current wave.
 */
router.post("/forge/:jobId/finish-early", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const { jobId } = req.params;

    const raw = await redis.get(`forge:job:${jobId}`);
    if (!raw) throw new NotFoundError("Forge job not found");
    let jobData: any; try { jobData = JSON.parse(raw); } catch { throw new BadRequestError("Forge job record is corrupt"); }

    const configRaw = await redis.get(`forge:config:${jobId}`);
    if (!configRaw) throw new NotFoundError("Forge job config expired — cannot resume. Please start a new forge.");
    let configData: any; try { configData = JSON.parse(configRaw); } catch { throw new BadRequestError("Forge job config is corrupt"); }
    if (!configData.blueprintSlug || !configData.options) throw new NotFoundError("Forge job config is malformed.");

    await appForgeService.forgeApp(configData.blueprintSlug, {
        ...configData.options,
        isApprovedPlan: true,
        isApprovedArchitecture: true,
        finishEarly: true,
        jobId: jobId
    });

    res.json({ success: true, message: "Finishing forge early. Moving to ignition." });
}));

/**
 * Fast-track build by skipping all governance reviews.
 */
router.post("/forge/:jobId/skip-to-build", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const { jobId } = req.params;

    const raw = await redis.get(`forge:job:${jobId}`);
    if (!raw) throw new NotFoundError("Forge job not found");
    let jobData: any; try { jobData = JSON.parse(raw); } catch { throw new BadRequestError("Forge job record is corrupt"); }

    const configRaw = await redis.get(`forge:config:${jobId}`);
    let configData: any; try { configData = configRaw ? JSON.parse(configRaw) : jobData; } catch { configData = jobData; }
    if (!configData.blueprintSlug) throw new NotFoundError("Forge job config not found or expired");

    // Re-queue with skipToAssembly flag
    await appForgeService.forgeApp(configData.blueprintSlug, {
        ...configData.options,
        skipToAssembly: true,
        jobId
    });

    res.json({ success: true, message: "Fast-track initiated. Assembly will commence autonomously." });
}));

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN CATALOG ROUTES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List all available design styles from designdotmd.directory (cached).
 */
router.get("/forge/design-catalog", asyncHandler(async (req: Request, res: Response) => {
    const { forgeDesignCatalogService } = await import("./core/forge-design-catalog.service.js");
    const styles = await forgeDesignCatalogService.listStyles();
    res.json(styles);
}));

/**
 * Get a single design style with full parsed tokens.
 */
router.get("/forge/design-catalog/:styleId", asyncHandler(async (req: Request, res: Response) => {
    const { styleId } = req.params;
    const { forgeDesignCatalogService } = await import("./core/forge-design-catalog.service.js");
    const tokens = await forgeDesignCatalogService.getStyleById(styleId);
    if (!tokens) throw new NotFoundError(`Design style "${styleId}" not found`);
    res.json(tokens);
}));

// ─────────────────────────────────────────────────────────────────────────────
// FORGE SETTINGS ROUTES
// ─────────────────────────────────────────────────────────────────────────────

const FORGE_SETTINGS_TTL = 60 * 60 * 24 * 365; // 1 year — user config, not ephemeral

/**
 * Get org-level forge settings (coding standards, security policies, AI behavior).
 */
router.get("/forge/settings", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = orgContext.organizationId ?? 0;
    const settings = await forgeSettingsService.getSettings(orgId);
    res.json(settings);
}));

/**
 * Save org-level forge settings.
 */
router.post("/forge/settings", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = orgContext.organizationId ?? 0;
    const settings = req.body;
    if (!settings || typeof settings !== 'object') throw new BadRequestError("Settings payload required");
    await forgeSettingsService.saveSettings(orgId, settings, (req as any).user?.id);
    res.json({ success: true });
}));

function getDefaultForgeSettings() {
    return {
        coding: {
            typescriptStrict: true,
            eslintRuleset: "airbnb",
            requireTests: false,
            coverageThreshold: 70,
            preferReactQuery: true,
            stateManagement: "react-query",
            blockedPackages: [],
            allowedPackages: [],
        },
        security: {
            owaspLevel: "owasp-top-10",
            blockHardcodedSecrets: true,
            requireAuth: false,
            requireZodValidation: true,
            requireRateLimiting: false,
            generateCSPHeaders: false,
        },
        ai: {
            verbosity: "balanced",
            enableArchitectureReview: true,
            enableStrategyReview: true,
            maxRetryAttempts: 3,
            defaultBlueprint: "analytics-dashboard",
            systemPromptSuffix: "",
        },
        rag: {
            autoIncludeOrgKnowledge: false,
            defaultReferenceAssetIds: [],
            semanticSearchThreshold: 0.7,
        },
        updatedAt: null,
        updatedBy: null,
    };
}

/**
 * Submit answers to clarifying questions to resume forging.
 */
router.post("/forge/:jobId/answer", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const { jobId } = req.params;
    const { answers } = req.body;

    const raw = await redis.get(`forge:job:${jobId}`);
    if (!raw) throw new NotFoundError("Forge job not found");
    let jobData: any; try { jobData = JSON.parse(raw); } catch { throw new BadRequestError("Forge job record is corrupt"); }

    // Read immutable config — forge:job state is overwritten on every status update
    const configRaw = await redis.get(`forge:config:${jobId}`);
    let configData: any; try { configData = configRaw ? JSON.parse(configRaw) : jobData; } catch { configData = jobData; }
    if (!configData.blueprintSlug) throw new NotFoundError("Forge job config not found or expired");

    await appForgeService.forgeApp(configData.blueprintSlug, {
        ...configData.options,
        userAnswers: answers,
        isApprovedPlan: false,
        jobId: jobId
    });

    res.json({ success: true, message: "Answers submitted. Re-evaluating plan." });
}));

/**
 * Submit freeform clarification notes to refine implementation direction before build.
 */
router.post("/forge/:jobId/refine", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const { jobId } = req.params;
    const { clarification } = req.body;

    if (!clarification || typeof clarification !== "string" || !clarification.trim()) {
        throw new BadRequestError("clarification is required");
    }

    const raw = await redis.get(`forge:job:${jobId}`);
    if (!raw) throw new NotFoundError("Forge job not found");
    let jobData: any; try { jobData = JSON.parse(raw); } catch { throw new BadRequestError("Forge job record is corrupt"); }

    const configRaw = await redis.get(`forge:config:${jobId}`);
    let configData: any; try { configData = configRaw ? JSON.parse(configRaw) : jobData; } catch { configData = jobData; }
    if (!configData.blueprintSlug) throw new NotFoundError("Forge job config not found or expired");

    const mergedAnswers = {
        ...(configData.options?.userAnswers || {}),
        refinementNote: clarification.trim(),
    };

    await appForgeService.forgeApp(configData.blueprintSlug, {
        ...configData.options,
        userAnswers: mergedAnswers,
        isApprovedPlan: false,
        isApprovedArchitecture: false,
        jobId,
    });

    res.json({ success: true, message: "Clarification received. Re-running requirements and review." });
}));

/**
 * SSE Stream for forge logs
 */
router.get("/forge/stream/:jobId", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const { jobId } = req.params;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    const { eventStream } = await import("@domain/core/infrastructure/event-stream.service.js");

    console.log(`[Forge] Telemetry stream connection established for jobId: ${jobId}`);

    // SSE is ephemeral; replay the durable job snapshot so a refreshed Forge
    // screen does not sit at "Awaiting Manifest Projection" until a new event
    // happens to arrive.
    const currentRaw = await redis.get(`forge:job:${jobId}`).catch(() => null);
    let current: any = null;
    try { current = currentRaw ? JSON.parse(currentRaw) : null; } catch { /* status route reports corruption */ }
    const draft = await forgeDraftService.getDraft(jobId).catch(() => null);
    res.write(`data: ${JSON.stringify({
        level: current?.status === 'failed' ? 'error' : 'info',
        message: current?.message || draft?.message || 'Telemetry link established',
        jobId,
        ...(draft || {}),
        ...(current || {}),
    })}\n\n`);

    const listener = (event: any) => {
        if (event.payload?.jobId === jobId) {
            res.write(`data: ${JSON.stringify(event.payload)}\n\n`);
        }
    };

    eventStream.on("FORGE_LOG", listener);

    const heartbeat = setInterval(() => {
        res.write(": heartbeat\n\n");
    }, 15000);

    req.on("close", () => {
        eventStream.off("FORGE_LOG", listener);
        clearInterval(heartbeat);
    });
}));

/**
 * Get manifest version history for an app
 */
router.get("/:appId/versions", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const appId = parseInt(req.params.appId);
    if (isNaN(appId)) throw new BadRequestError("Invalid App ID");

    const app = await appRegistryService.getApp(appId);
    const config = (app as any).config as any;
    res.json({ versions: config?.manifestHistory || [] });
}));

/**
 * Get workspace file tree for the App Studio scaffold navigator
 */
router.get("/:appId/files", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const appId = parseInt(req.params.appId);
    if (isNaN(appId)) throw new BadRequestError("Invalid App ID");

    const { app } = await requireAppBuilderAccess(req, appId);
    const workspacePath = await resolveForgeWorkspacePath((app as any).slug);

    try {
        await fs.access(workspacePath);
    } catch {
        return res.json({ tree: null, slug: (app as any).slug });
    }

    interface FileNode {
        name: string; path: string; type: "file" | "dir";
        ext?: string; size?: number; children?: FileNode[];
    }

    async function buildTree(dir: string, relBase: string): Promise<FileNode[]> {
        let entries: any[];
        try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return []; }
        const nodes: FileNode[] = [];
        for (const entry of entries) {
            if (SKIP_DIRS.has(entry.name)) continue;
            const fullPath = path.join(dir, entry.name);
            const relPath = (relBase ? relBase + "/" : "") + entry.name;
            if (entry.isDirectory()) {
                nodes.push({ name: entry.name, path: relPath, type: "dir", children: await buildTree(fullPath, relPath) });
            } else {
                const ext = path.extname(entry.name).slice(1);
                const stat = await fs.stat(fullPath).catch(() => ({ size: 0 }));
                nodes.push({ name: entry.name, path: relPath, type: "file", ext, size: (stat as any).size });
            }
        }
        return nodes.sort((a, b) => {
            if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
    }

    const tree = await buildTree(workspacePath, "");
    res.json({ tree, slug: (app as any).slug });
}));

/**
 * Get raw file content from the app workspace
 */
router.get("/:appId/files/content", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const appId = parseInt(req.params.appId);
    if (isNaN(appId)) throw new BadRequestError("Invalid App ID");

    const filePath = req.query.path as string;
    if (!filePath) throw new BadRequestError("path query param required");

    const { app } = await requireAppBuilderAccess(req, appId);
    const workspacePath = path.resolve(await resolveForgeWorkspacePath((app as any).slug));
    const fullPath = path.resolve(workspacePath, filePath);
    if (!isWithinDirectory(workspacePath, fullPath)) throw new BadRequestError("Invalid path");

    try {
        const content = await fs.readFile(fullPath, "utf-8");
        res.json({ content, path: filePath });
    } catch {
        throw new NotFoundError(`File not found: ${filePath}`);
    }
}));

/**
 * Developer earnings summary grouped by app/status
 */
router.get("/developer/earnings", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    let orgId = (req as any).organizationId;
    if (!orgId) {
        const orgContext = await getUserOrgContext(req);
        orgId = orgContext.organizationId;
    }
    if (!orgId) throw new BadRequestError("Organization context required");

    const rows = await appQueryService.getPayoutsSummary(orgId);

    res.json(rows);
}));

/**
 * Shadow Audit — adversarial critique of runtime manifest
 */
router.post("/:appId/shadow-audit", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    let orgId = (req as any).organizationId;
    if (!orgId) {
        const orgContext = await getUserOrgContext(req);
        orgId = orgContext.organizationId;
    }
    if (!orgId) throw new BadRequestError("Organization context required");

    const appId = parseInt(req.params.appId);
    if (isNaN(appId)) throw new BadRequestError("Invalid App ID");

    const { appShadowAuditService } = await import("./app-shadow-audit.service.js");
    const findings = await appShadowAuditService.runAudit(appId, orgId);
    res.json(findings);
}));

/**
 * Get health status for an app deployment
 */
router.get("/:appId/health", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    let orgId = (req as any).organizationId;
    if (!orgId) {
        const orgContext = await getUserOrgContext(req);
        orgId = orgContext.organizationId;
    }
    if (!orgId) throw new BadRequestError("Organization context required");

    const appId = parseInt(req.params.appId);
    if (isNaN(appId)) throw new BadRequestError("Invalid App ID");

    const health = await AppDeploymentService.getHealthStatus(appId, orgId);
    res.json(health);
}));

/**
 * GET /api/apps/:appId/readiness
 * Deployment readiness gate for App Forge/App Builder outputs.
 */
router.get("/:appId/readiness", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    let orgId = (req as any).organizationId;
    if (!orgId) {
        const orgContext = await getUserOrgContext(req);
        orgId = orgContext.organizationId;
    }

    const appId = parseInt(req.params.appId);
    if (isNaN(appId)) throw new BadRequestError("Invalid App ID");

    const { orgId: builderOrgId } = await requireAppBuilderAccess(req, appId);
    const report = await appReadinessService.getAppReadiness(
        appId,
        orgId ?? builderOrgId,
        { probeRuntime: req.query.probe === "true" }
    );
    res.json(report);
}));

/**
 * Stream app logs via SSE
 */
router.get("/:appId/logs", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    let orgId = (req as any).organizationId;
    if (!orgId) {
        const orgContext = await getUserOrgContext(req);
        orgId = orgContext.organizationId;
    }

    const appIdForOrg = parseInt(req.params.appId);
    // Super admins may have no org — fall back to the app's owning org
    if (!orgId && !isNaN(appIdForOrg)) {
        const app = await appRegistryService.getApp(appIdForOrg);
        orgId = (app as any).developerOrgId ?? null;
    }
    if (!orgId) throw new BadRequestError("Organization context required");

    const appId = parseInt(req.params.appId);
    if (isNaN(appId)) throw new BadRequestError("Invalid App ID");

    const row = await appQueryService.getAppDeploymentWithApp(appId, orgId);

    if (!row) throw new NotFoundError("App deployment not found");

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const containerName = `oddjob-app-${row.app.slug}-${orgId}`;
    const { dockerBridgeService } = await import("../core/infrastructure/docker/docker-bridge.service.js");

    try {
        const logs = await dockerBridgeService.getLogs(containerName);
        for (const line of logs) {
            res.write(`data: ${JSON.stringify({ line })}\n\n`);
        }
    } catch {
        res.write(`data: ${JSON.stringify({ line: "No container logs available." })}\n\n`);
    }

    res.end();
}));

/**
 * Export app usage and cost attribution as CSV
 */
router.get('/:appId/export-usage', requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const appId = parseInt(req.params.appId);
    const orgContext = await getUserOrgContext(req);
    const orgId = orgContext.organizationId;

    // 1. Resolve deployment
    const { appRegistryService } = await import("./app-registry.service.js");
    const deploymentInfo = orgId != null ? await appRegistryService.findDeploymentByAppId(appId, orgId) : null;

    if (!deploymentInfo) {
        return res.status(404).json({ error: "App deployment not found for this organization" });
    }

    // 2. Generate CSV
    const { costAttributionService } = await import("../analytics/core/cost-attribution.service.js");
    const csv = await costAttributionService.exportUsageToCSV(deploymentInfo.deployment.id);

    // 3. Send as file
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=app_usage_${appId}.csv`);
    res.send(csv);
}));


/**
 * POST /api/apps/:appId/refine
 * Iteratively update an existing app using surgical patching.
 */
router.post("/:appId/refine", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const appId = parseInt(req.params.appId);
    if (isNaN(appId)) throw new BadRequestError("Invalid App ID");

    const { newPlan, userRequest } = req.body;
    if (!newPlan) throw new BadRequestError("newPlan is required");
    if (!userRequest) throw new BadRequestError("userRequest is required");

    const app = await appRegistryService.getApp(appId);
    if (!app) throw new NotFoundError("App not found");

    let orgId = (req as any).organizationId;
    if (!orgId) {
        const orgContext = await getUserOrgContext(req);
        orgId = orgContext.organizationId;
    }

    const { forgeRefineService } = await import("./core/forge-refine.service.js");
    const result = await forgeRefineService.refineApp({
        appId,
        appSlug: app.slug,
        newPlan,
        userRequest,
        organizationId: orgId
    });

    if (!result.success) {
        throw new BadRequestError(result.error || "Refinement failed");
    }

    res.json(result);
}));


/**
 * GET /api/apps/:appId/telemetry
 * Real-time event stream from the Mission Bridge SDK.
 */
router.get("/:appId/telemetry", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const appId = parseInt(req.params.appId);
    if (isNaN(appId)) throw new BadRequestError("Invalid App ID");

    const telemetry = await appQueryService.getAppTelemetry(appId, undefined, 50);

    res.json(telemetry);
}));

/**
 * GET /api/apps/:appId/audit-logs
 * Results from the ForgeShadowService Selenium audits.
 */
router.get("/:appId/audit-logs", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const appId = parseInt(req.params.appId);
    if (isNaN(appId)) throw new BadRequestError("Invalid App ID");
    await requireAppBuilderAccess(req, appId);

    const logs = await appQueryService.getAuditLogs(appId, 50);

    res.json(logs);
}));

/**
 * POST /api/apps/:appId/approve-plan
 * User approval gate for the Development Plan.
 */
router.post("/:appId/approve-plan", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const appId = parseInt(req.params.appId);
    if (isNaN(appId)) throw new BadRequestError("Invalid App ID");
    await requireAppBuilderAccess(req, appId);

    const app = await appQueryService.approveAppPlan(appId);
    if (!app) throw new NotFoundError("App not found");

    res.json({ success: true, message: "Plan approved. Assembly will commence." });
}));

/**
 * GET /api/apps/:appId/platform-health
 * Check connectivity to platform APIs for this app's configured resources.
 */
router.get("/:appId/platform-health", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const appId = parseInt(req.params.appId);
    if (isNaN(appId)) throw new BadRequestError("Invalid App ID");

    const deployment = await appQueryService.getPlatformHealthDeployment(appId, orgContext.organizationId ?? undefined);

    if (!deployment) throw new NotFoundError("App deployment not found");

    // Check each platform API
    type HealthStatus = 'ok' | 'error' | 'unknown';
    const health: Record<string, HealthStatus> = {
        datasets: 'unknown',
        agents: 'unknown',
        missions: 'unknown',
        pipelines: 'unknown',
    };

    // Check datasets API if datasets are configured
    if (deployment.allowedDatasetIds && Array.isArray(deployment.allowedDatasetIds) && deployment.allowedDatasetIds.length > 0) {
        try {
            const { datasetService } = await import("@domain/knowledge/index.js");
            await datasetService.list(orgContext);
            health.datasets = 'ok';
        } catch {
            health.datasets = 'error';
        }
    } else {
        health.datasets = 'ok'; // No datasets configured, considered healthy
    }

    // Check agents API if agents are configured
    if (deployment.allowedAgentIds && Array.isArray(deployment.allowedAgentIds) && deployment.allowedAgentIds.length > 0) {
        try {
            const hasAgents = await appQueryService.checkAgentsConnectivity(orgContext.organizationId ?? undefined);
            health.agents = 'ok';
        } catch {
            health.agents = 'error';
        }
    } else {
        health.agents = 'ok';
    }

    // Check missions API (always available)
    try {
        const { missionQueryService } = await import("@domain/mission/index.js");
        if (orgContext.organizationId) {
            await missionQueryService.getMissions(orgContext.organizationId);
            health.missions = 'ok';
        } else {
            health.missions = 'ok';
        }
    } catch {
        health.missions = 'error';
    }

    // Check pipelines API if pipelines are configured
    if (deployment.allowedPipelineIds && Array.isArray(deployment.allowedPipelineIds) && deployment.allowedPipelineIds.length > 0) {
        try {
            const { pipelineService } = await import("@domain/pipeline/core/pipeline.service.js");
            // Use the list method from the facade
            await (pipelineService as any).list(orgContext);
            health.pipelines = 'ok';
        } catch {
            health.pipelines = 'error';
        }
    } else {
        health.pipelines = 'ok';
    }

    res.json(health);
}));

/**
 * GET /api/apps/:appId/platform-usage
 * Count how many platform blocks are actually used in the app's code.
 */
router.get("/:appId/platform-usage", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const appId = parseInt(req.params.appId);
    if (isNaN(appId)) throw new BadRequestError("Invalid App ID");

    const app = await appRegistryService.getApp(appId);
    if (!app) throw new NotFoundError("App not found");

    // Scan the app's source code for platform block imports
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const workspacePath = await resolveForgeWorkspacePath(app.slug);

    const usage = {
        datasetTableCount: 0,
        agentChatCount: 0,
        missionBlockCount: 0,
        missionLogBlockCount: 0,
        pipelineBlockCount: 0,
    };

    try {
        const indexFiles = [
            path.join(workspacePath, "src/domain/core/ui/components/packaged/index.ts"),
            path.join(workspacePath, "pages/index.tsx"),
        ];

        for (const filePath of indexFiles) {
            try {
                const content = await fs.readFile(filePath, "utf-8");
                
                // Count platform block imports/usage
                if (content.includes("PlatformDatasetTableBlock")) usage.datasetTableCount++;
                if (content.includes("PlatformAgentChatBlock")) usage.agentChatCount++;
                if (content.includes("PlatformMissionsBlock")) usage.missionBlockCount++;
                if (content.includes("PlatformMissionLogBlock")) usage.missionLogBlockCount++;
                if (content.includes("PlatformPipelineTriggerBlock")) usage.pipelineBlockCount++;
            } catch {
                // File doesn't exist, skip
            }
        }

        // Also check all .tsx files in the workspace
        const scanDirectory = async (dir: string): Promise<void> => {
            try {
                const entries = await fs.readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
                        await scanDirectory(fullPath);
                    } else if (entry.isFile() && entry.name.endsWith(".tsx")) {
                        try {
                            const content = await fs.readFile(fullPath, "utf-8");
                            if (content.includes("PlatformDatasetTableBlock")) usage.datasetTableCount++;
                            if (content.includes("PlatformAgentChatBlock")) usage.agentChatCount++;
                            if (content.includes("PlatformMissionsBlock")) usage.missionBlockCount++;
                            if (content.includes("PlatformMissionLogBlock")) usage.missionLogBlockCount++;
                            if (content.includes("PlatformPipelineTriggerBlock")) usage.pipelineBlockCount++;
                        } catch {
                            // Skip files we can't read
                        }
                    }
                }
            } catch {
                // Directory doesn't exist or can't be read
            }
        };

        await scanDirectory(path.join(workspacePath, "src"));
        await scanDirectory(path.join(workspacePath, "pages"));
        await scanDirectory(path.join(workspacePath, "components"));

    } catch {
        // Workspace doesn't exist yet (app not forged)
    }

    res.json(usage);
}));

/**
 * GET /api/apps/:appId/tokenized-ui
 * Fetch the Tokenized UI layout schema for an application.
 */
router.get("/:appId/tokenized-ui", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const appId = parseInt(req.params.appId);
    if (isNaN(appId)) throw new BadRequestError("Invalid App ID");

    const app = await appRegistryService.getApp(appId);
    if (!app) throw new NotFoundError("App not found");

    // 1. License Check: Active subscription status required for non-system apps
    //
    // apps.organization_id is nullable. This used to read `app.organizationId || 1`,
    // which checked an unattributable app against organization 1's subscription --
    // granting or denying a launch on an unrelated tenant's billing state -- and
    // then named that same org as the payout recipient below. Neither entitlement
    // nor money may fall back to a default tenant; the telemetry handler further
    // down this file refuses for the same reason.
    if (app.organizationId == null && !app.isSystem) {
        throw new BadRequestError("App has no organization; entitlement cannot be verified");
    }
    const ownerOrgId = app.organizationId;

    if (ownerOrgId != null) {
        const subscriptionStatus = await appQueryService.getOrgSubscriptionStatus(ownerOrgId);

        if (subscriptionStatus && subscriptionStatus !== "active" && !app.isSystem) {
            return res.status(403).json({
                message: "Active subscription required to launch this application."
            });
        }
    }

    // 2. Billing & Developer Payout
    const pricePerLaunch = parseFloat(app.pricePerLaunchUsd || "0");
    if (pricePerLaunch > 0) {
        const devPercentage = app.developerPayoutPercentage || 70;
        const developerShare = (pricePerLaunch * devPercentage) / 100;
        
        // A launch fee has to be credited to a real organization. Falling back to
        // org 1 here paid an unrelated tenant for someone else's app.
        const payeeOrgId = app.developerOrgId ?? ownerOrgId;
        if (payeeOrgId == null) {
            throw new BadRequestError("App has no developer or owning organization; a launch fee cannot be attributed");
        }
        await appQueryService.recordPayout(payeeOrgId, app.id, developerShare.toFixed(2));
    }

    const schema = (app.config as any)?.tokenizedUI || null;
    res.json({ schema });
}));

/**
 * POST /api/apps/:appId/telemetry
 * Record an audit log or telemetry event for an application.
 */
router.post("/:appId/telemetry", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const appId = parseInt(req.params.appId);
    if (isNaN(appId)) throw new BadRequestError("Invalid App ID");

    const { event, metadata, level } = req.body;
    if (!event) throw new BadRequestError("'event' is required");

    const app = await appRegistryService.getApp(appId);
    if (!app) throw new NotFoundError("App not found");

    // apps.organization_id is nullable while app_telemetry.org_id is NOT NULL, so
    // this used to read `app.organizationId || 1` -- which filed an unattributable
    // app's telemetry into org 1's ledger. Refuse the write instead of guessing.
    if (app.organizationId == null) {
        throw new BadRequestError("App has no organization; telemetry cannot be attributed");
    }

    await appQueryService.recordAppTelemetry({
        appId,
        orgId: app.organizationId,
        event,
        level: level || "info",
        metadata: metadata || {}
    });

    res.status(201).json({ status: "recorded" });
}));

/**
 * POST /api/apps/:appId/tokenized-ui
 * Save/update the Tokenized UI layout schema for an application.
 */
router.post("/:appId/tokenized-ui", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
    const appId = parseInt(req.params.appId);
    if (isNaN(appId)) throw new BadRequestError("Invalid App ID");

    const { schema } = req.body;
    if (!schema || !schema.layout || !Array.isArray(schema.layout.children)) {
        throw new BadRequestError("Invalid UI Token schema structure");
    }

    const app = await appRegistryService.getApp(appId);
    if (!app) throw new NotFoundError("App not found");

    const { verifyUICompliance } = await import("../../../client/src/components/dynamic-ui/verification.js");
    const verification = verifyUICompliance(schema);
    if (!verification.isValid) {
        return res.status(422).json({
            message: "Schema verification failed",
            violations: verification.violations
        });
    }

    await appQueryService.updateAppTokenizedUi(appId, schema, app.config);

    const updatedApp = await appRegistryService.getApp(appId);
    res.json(updatedApp);
}));

export default router;


export { router as appsRouter };
