import { Router, type Request, type Response } from "express";
import { AppDeploymentService } from "../domain/apps/app-deployment.service.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { NotFoundError, UnauthorizedError, BadRequestError } from "@server/utils/errors.js";
import { verifyPassword } from "@server/domain/auth/index.js";
import { createRateLimiter } from "../middleware/rate-limiter.js";
import { missionService, missionQueryService } from "../domain/mission/index.js";
import { pipelineService } from "../domain/pipeline/core/pipeline.service.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";
import { type OrgContext } from "../utils/auth-context.js";

export const publicAppsRouter = Router();

// Strict rate limit for the auth/password endpoint
const authRateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 20 });
// Standard rate limit for page views and mission operations
const viewRateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 500 });

/**
 * Helper to verify app slug and organization context
 */
async function getValidatedAppContext(slug: string, req: Request, skipPasswordCheck = false) {
    // Supplied by /o/:orgId/app/:slug. Without it the slug alone picks the deployment,
    // which is ambiguous for an app deployed in more than one organization. Parsed
    // strictly and ignored when malformed rather than trusted into a query.
    const rawOrgId = typeof req.query.orgId === "string" ? Number.parseInt(req.query.orgId, 10) : NaN;
    const organizationId = Number.isInteger(rawOrgId) && rawOrgId > 0 ? rawOrgId : null;

    const result = await AppDeploymentService.getBySlug(slug, organizationId);
    if (!result) {
        throw new NotFoundError("App deployment not found or not published");
    }

    const { deployment, app } = result;

    // Check access policy
    if (deployment.accessPolicy === "internal_only") {
        if (!req.isAuthenticated() || !req.user) {
            throw new UnauthorizedError("Must be logged in to interact with this internal app");
        }
    } else if (deployment.accessPolicy === "password" && !skipPasswordCheck) {
        const isVerified = (req.session as any)?.isVerifiedPublicApp || (req.session as any)?.[`app_auth_${deployment.id}`];
        if (!isVerified) {
            throw new UnauthorizedError("Password required");
        }
    }

    return { deployment, app, organizationId: deployment.organizationId };
}

/**
 * Get public app info
 */
publicAppsRouter.get("/:slug", viewRateLimiter, asyncHandler(async (req: Request, res: Response) => {
    const { slug } = req.params;
    const { deployment, app } = await getValidatedAppContext(slug, req);

    res.json({
        appId: app.id,
        appName: app.name,
        slug: deployment.publicSlug,
        title: deployment.title || app.name,
        description: deployment.description || app.description,
        brandingConfig: deployment.brandingConfig,
        config: deployment.config,
        app: {
            dockerImage: app.dockerImage,
            runtimeMetadata: app.runtimeMetadata
        }
    });
}));

/**
 * Password verification for protected apps
 */
publicAppsRouter.post("/:slug/auth", authRateLimiter, asyncHandler(async (req: Request, res: Response) => {
    const { slug } = req.params;
    const { password } = req.body;

    const { deployment, app } = await getValidatedAppContext(slug, req, true);

    if (deployment.accessPolicy !== "password" || !deployment.accessPasswordHash) {
        throw new NotFoundError("App is not password protected");
    }

    const isValid = await verifyPassword(password, deployment.accessPasswordHash);
    if (!isValid) {
        throw new UnauthorizedError("Invalid password");
    }

    // Set a session flag to avoid re-verifying every request in this session if needed
    (req.session as any).isVerifiedPublicApp = true;

    res.json({
        success: true,
        appId: app.id,
        appName: app.name,
        slug: deployment.publicSlug,
        title: deployment.title || app.name,
        description: deployment.description || app.description,
        brandingConfig: deployment.brandingConfig,
        config: deployment.config,
        token: "session-verified"
    });
}));

/**
 * Get templates allowed for this app
 */
publicAppsRouter.get("/:slug/templates", viewRateLimiter, asyncHandler(async (req: Request, res: Response) => {
    const { slug } = req.params;
    const { organizationId } = await getValidatedAppContext(slug, req);
    
    // For now, return all templates for the org. In the future, filter by app-specific tags.
    const templates = await missionQueryService.listTemplates(organizationId);
    res.json(templates);
}));

/**
 * Instantiate a mission from a template for this app
 */
publicAppsRouter.post("/:slug/missions/templates/:id/instantiate", viewRateLimiter, asyncHandler(async (req: Request, res: Response) => {
    const { slug, id: templateIdStr } = req.params;
    const { name } = req.body;
    const { organizationId } = await getValidatedAppContext(slug, req);
    
    const templateId = parseInt(templateIdStr);
    if (isNaN(templateId)) throw new BadRequestError("Invalid template ID");

    const mission = await missionService.instantiateTemplate(
        templateId,
        name || "New Mission",
        "system:public",
        organizationId,
        slug
    );

    res.status(201).json(mission);
}));

/**
 * Handle public mission creation (direct message)
 */
publicAppsRouter.post("/:slug/missions", viewRateLimiter, asyncHandler(async (req: Request, res: Response) => {
    const { slug } = req.params;
    const { name, objective, blackboard } = req.body;
    const { organizationId, app, deployment } = await getValidatedAppContext(slug, req);

    const missionBlackboard = { 
        ...(blackboard || {}), 
        viaAppSlug: slug,
        appId: app.id,
        appDeploymentId: deployment.id
    };

    const mission = await missionService.createMission({
        name: name || `Public Message: ${app.name}`,
        objective: objective || "Inquiry from public app",
        organizationId: organizationId,
        createdBy: "system:public",
        blackboard: missionBlackboard,
        executionStrategy: "pre_planned", 
    }, "system:public", [], false);

    res.status(201).json(mission);
}));

/**
 * Launch a mission
 */
publicAppsRouter.post("/:slug/missions/:id/launch-mission", viewRateLimiter, asyncHandler(async (req: Request, res: Response) => {
    const { slug, id: missionIdStr } = req.params;
    const { organizationId } = await getValidatedAppContext(slug, req);
    
    const missionId = parseInt(missionIdStr);
    if (isNaN(missionId)) throw new BadRequestError("Invalid mission ID");

    // Verify mission belongs to org
    const mission = await missionService.getById(missionId);
    if (!mission || mission.organizationId !== organizationId) {
        throw new NotFoundError("Mission not found or access denied");
    }

    const result = await missionService.launchMission(missionId, "system:public", organizationId);
    res.json(result);
}));

/**
 * Send chat message to mission blackboard
 */
publicAppsRouter.post("/:slug/missions/:id/chat", viewRateLimiter, asyncHandler(async (req: Request, res: Response) => {
    const { slug, id: missionIdStr } = req.params;
    const { message } = req.body;
    const { organizationId } = await getValidatedAppContext(slug, req);
    
    const missionId = parseInt(missionIdStr);
    if (isNaN(missionId)) throw new BadRequestError("Invalid mission ID");

    // Verify mission belongs to org
    const mission = await missionService.getById(missionId);
    if (!mission || mission.organizationId !== organizationId) {
        throw new NotFoundError("Mission not found or access denied");
    }

    await missionService.updateBlackboard(missionId, { lastUserMessage: message }, "system:public", "Public App Input");
    res.json({ success: true });
}));

/**
 * Poll execution status
 */
publicAppsRouter.get("/:slug/pipeline-executions/:id", viewRateLimiter, asyncHandler(async (req: Request, res: Response) => {
    const { slug, id: executionIdStr } = req.params;
    const { organizationId } = await getValidatedAppContext(slug, req);
    
    const executionId = parseInt(executionIdStr);
    if (isNaN(executionId)) throw new BadRequestError("Invalid execution ID");

    const orgContext: OrgContext = { userId: "anonymous", organizationId, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false };
    const details = await pipelineService.getEnrichedExecutionDetails(executionId, orgContext);
    res.json(details);
}));

/**
 * Resume a HITL step
 */
publicAppsRouter.post("/:slug/pipeline-executions/:id/resume-step", viewRateLimiter, asyncHandler(async (req: Request, res: Response) => {
    const { slug, id: executionIdStr } = req.params;
    const { stepExecutionId, responses } = req.body;
    const { organizationId } = await getValidatedAppContext(slug, req);
    
    const executionId = parseInt(executionIdStr);
    if (isNaN(executionId)) throw new BadRequestError("Invalid execution ID");

    // Replicate logic from pipelines.ts but with org context
    await pipelineService.updateStepExecution(stepExecutionId, {
        output: JSON.stringify(responses),
        status: "success",
        completedAt: new Date(),
    });

    const orgContext: OrgContext = { userId: "anonymous", organizationId, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false };
    const result = await pipelineService.resume(executionId, null, orgContext, responses);
    res.json(result);
}));

/**
 * Start a forged app container
 */
publicAppsRouter.post("/:slug/start", viewRateLimiter, asyncHandler(async (req: Request, res: Response) => {
    const { slug } = req.params;
    const { app, organizationId } = await getValidatedAppContext(slug, req);
    
    const { appRegistryService } = await import("../domain/apps/app-registry.service.js");
    const result = await appRegistryService.startApp(app.id, organizationId);
    
    res.json({ success: true, ...result });
}));

/**
 * Public Event Stream filtered by organization
 */
publicAppsRouter.get("/:slug/events/stream", viewRateLimiter, asyncHandler(async (req: Request, res: Response) => {
    const { slug } = req.params;
    const { organizationId } = await getValidatedAppContext(slug, req);

    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const listener = (event: any) => {
        // Filter events by organization correctly
        if (event.context?.organizationId === organizationId || !event.context?.organizationId) {
            res.write(`data: ${JSON.stringify(event)}\n\n`);
        }
    };

    eventStream.on("*", listener);

    const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
    }, 30000);

    req.on('close', () => {
        eventStream.off("*", listener);
        clearInterval(heartbeat);
    });
}));

/**
 * Public App Telemetry (Pulse)
 */
publicAppsRouter.post("/:slug/telemetry", viewRateLimiter, asyncHandler(async (req: Request, res: Response) => {
    const { slug } = req.params;
    const { type, sessionId, metadata } = req.body;
    const { organizationId, app, deployment } = await getValidatedAppContext(slug, req);

    if (!type || !sessionId) {
        throw new BadRequestError("Missing telemetry type or sessionId");
    }

    // Publish to the Ephemeral Event Engine
    const eventId = await eventStream.publish(type, {
        sessionId,
        appSlug: slug,
        appId: app.id,
        deploymentId: deployment.id,
        metadata: metadata || {}
    }, {
        organizationId,
        subject: `app_session_${sessionId}`
    }, "public_app_client");

    res.json({ success: true, eventId });
}));

/**
 * Dynamic PWA Manifest
 */
publicAppsRouter.get("/:slug/manifest.json", asyncHandler(async (req: Request, res: Response) => {
    const { slug } = req.params;
    const { deployment, app } = await getValidatedAppContext(slug, req);
    const branding = (deployment.brandingConfig as any) || {};

    res.json({
        name: deployment.title || app.name,
        short_name: deployment.title || app.name,
        description: deployment.description || app.description,
        start_url: `/app/${slug}`,
        display: "standalone",
        background_color: "#ffffff",
        theme_color: branding.primaryColor || "#3B82F6",
        icons: [
            {
                src: branding.logoUrl || "/favicon.png",
                sizes: "192x192",
                type: "image/png"
            }
        ]
    });
}));
