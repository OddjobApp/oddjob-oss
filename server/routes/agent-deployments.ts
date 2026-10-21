import { validateIdParam } from "@server/utils/api-utils.js";

import { Router, type Request, type Response } from "express";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext } from "../utils/auth-context.js";
import { type InsertAgentDeployment, insertAgentDeploymentSchema, agentChatMessages } from "@shared/schema/index.js";
import { v4 as uuidv4 } from 'uuid';
import { hashPassword, verifyPassword } from "@server/domain/auth/index.js";
import { db } from "../database_service.js";
import { eq, and } from "drizzle-orm";
import { BadRequestError } from "@server/utils/errors.js";
import * as fs from 'fs';
import { AgentDeploymentService } from "@domain/agents/agent-deployment.service.js";
import { allowsAgentChat, agentButton, type AgentInteractionConfig } from "@shared/agent-interaction.js";
import { agentAccessAuditMiddleware, agentRateLimitMiddleware } from "../middleware/agent-access-audit.js";
import { organizationService } from "@domain/org/core/organization.service.js";
import { jobService } from "@domain/jobs/job.service.js";
import { agentService } from "@domain/agents/agent.service.js";
import multer from "multer";
import {
    createOAuthState,
    consumeOAuthState,
    getAuthorizationUrl,
    exchangeCodeForTokens,
    buildEmbedOAuthCookie,
    getEmbedOAuthTokenFromCookie,
    type EmbedOAuthConfig,
} from "@domain/auth/core/embed-oauth.service.js";

// Import split routers
import agentAnalyticsRouter from "./agent-analytics.js";
import agentHintsRouter from "./agent-hints.js";

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }
});

/**
 * Serve a turn from the agent's deterministic fallback manifest — no model call.
 *
 * Used on three paths: the model layer is known-degraded, the model exceeded its
 * interactive deadline, or a deterministic handler failed and we must NOT escalate
 * into the model to recover (the inversion that turned outages into hangs).
 *
 * Returns false when the agent has no manifest yet, letting the caller fall back
 * to its previous behaviour rather than dropping the request.
 */
async function serveFallbackTurn(
    res: Response,
    deployment: any,
    message: string,
    ctx: {
        sessionId: string;
        userId: string;
        isFormSubmission: boolean;
        pipelineExecution?: { nonce?: string; inputData?: Record<string, any> };
        cause: string;
    },
): Promise<boolean> {
    const { agentFallbackService } = await import("@domain/agents/agent-fallback.service.js");

    const resolution = await agentFallbackService.resolve(deployment, message, {
        sessionId: ctx.sessionId,
        userId: ctx.userId,
        organizationId: deployment.organizationId,
        isFormSubmission: ctx.isFormSubmission,
        pipelineExecution: ctx.pipelineExecution,
    });

    if (!resolution) return false;

    console.warn(
        `[AgentFallback] Served "${deployment.slug}" turn via deterministic route "${resolution.route.id}" (${resolution.route.kind}). Cause: ${ctx.cause}`,
    );

    let messageId: number | undefined;
    try {
        const inserted = await db.insert(agentChatMessages).values([
            { jobId: deployment.jobId, userId: ctx.userId, sessionId: ctx.sessionId, role: "user", content: message, organizationId: deployment.organizationId } as any,
            {
                jobId: deployment.jobId,
                userId: ctx.userId,
                sessionId: ctx.sessionId,
                role: "agent",
                content: resolution.response,
                metadata: { degraded: true, fallbackRoute: resolution.route.id, cause: ctx.cause },
                organizationId: deployment.organizationId,
            } as any,
        ]).returning();
        messageId = inserted.find(m => m.role === "agent")?.id;
    } catch (persistErr: any) {
        // Persisting is best-effort; the user still gets their answer.
        console.warn(`[AgentFallback] Failed to persist degraded turn: ${persistErr.message}`);
    }

    res.json({
        response: resolution.response,
        sessionId: ctx.sessionId,
        messageId,
        degraded: true,
        degradedReason: ctx.cause,
    });
    return true;
}

/** Look up the "Managed Assets" dataset item for a QR-scanned asset by its assetId. */
async function resolveAssetRecord(organizationId: number, assetId: string): Promise<any | null> {
    try {
        const { datasets: dsTable, datasetItems } = await import("@shared/schema/index.js");
        const [assetDs] = await db.select().from(dsTable)
            .where(and(
                eq(dsTable.organizationId, organizationId),
                eq(dsTable.name, "Managed Assets")
            ))
            .limit(1);
        if (!assetDs) return null;

        const items = await db.select().from(datasetItems)
            .where(eq(datasetItems.datasetId, assetDs.id))
            .limit(100);

        const assetRecord = items.find((item: any) => (item.data as any)?.assetId === assetId);
        return assetRecord ? assetRecord.data : null;
    } catch {
        return null;
    }
}

export function registerAgentDeploymentRoutes(app: any) {
    const router = Router();
    const publicRouter = Router();
    const getActivePublicDeployment = async (slug: string) => {
        const deployment = await AgentDeploymentService.getBySlug(slug);
        return deployment?.isActive === true ? deployment : null;
    };

    // Apply audit logging and rate limiting to all public agent routes
    publicRouter.use(agentAccessAuditMiddleware);
    publicRouter.use(agentRateLimitMiddleware(300, 60 * 1000)); // 300 req/min per IP

    // Single OAuth callback (no slug in path) - must be before /:slug routes for IdPs that require exact redirect URI
    const OAUTH_CALLBACK_PATH = "/oauth/callback";
    publicRouter.get(OAUTH_CALLBACK_PATH, asyncHandler(async (req: Request, res: Response) => {
        const { code, state, error } = req.query;
        const redirectToSlug = (slug: string, params: Record<string, string>) => {
            const qs = new URLSearchParams({ embed: '1', ...params });
            res.redirect(`/a/${slug}?${qs.toString()}`);
        };
        const fallbackRedirect = (params: Record<string, string>) => {
            const qs = new URLSearchParams({ embed: '1', ...params });
            res.redirect(`/?${qs.toString()}`);
        };

        const entry = consumeOAuthState(String(state || ''));
        const slug = entry?.slug;

        if (!slug) {
            fallbackRedirect({ error: 'oauth_failed', error_description: 'state_invalid' });
            return;
        }

        if (error) {
            redirectToSlug(slug, { error: 'oauth_denied', error_description: String(error) });
            return;
        }

        if (!entry || !code) {
            if (slug) redirectToSlug(slug, { error: 'oauth_failed', error_description: 'state_invalid' });
            else fallbackRedirect({ error: 'oauth_failed', error_description: 'state_invalid' });
            return;
        }

        const deployment = await getActivePublicDeployment(slug);
        if (!deployment) {
            redirectToSlug(slug, { error: 'oauth_failed', error_description: 'deployment_not_found' });
            return;
        }

        const orgSetting = await AgentDeploymentService.getOrgSettings(deployment.organizationId);
        const config = (orgSetting?.embedOAuthConfig as EmbedOAuthConfig) ?? {};
        const baseUrl = process.env.APP_URL || process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
        const redirectUri = config.embedOAuthRedirectUri || `${baseUrl}/api/public/agents${OAUTH_CALLBACK_PATH}`;
        const tokens = await exchangeCodeForTokens(config, String(code), redirectUri);
        if (!tokens?.accessToken) {
            redirectToSlug(slug, { error: 'oauth_failed', error_description: 'token_exchange_failed' });
            return;
        }
        const maxAge = tokens.expiresIn ?? 3600;
        res.setHeader('Set-Cookie', buildEmbedOAuthCookie(tokens.accessToken, maxAge));
        redirectToSlug(slug, {});
    }));

    // Mount split routers
    // These routers already have their own access control middleware
    router.use("/deployments", agentAnalyticsRouter);
    router.use("/deployments", agentHintsRouter);

    // ========================================================================
    // ADMIN ROUTES (Protected)
    // ========================================================================

    // List workforce for Agentic HR
    router.get("/hr/workforce", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);
        const deployments = await AgentDeploymentService.listDeployments(orgContext.organizationId!);

        // Scope to the active Project Space. NULL projectId means org-global,
        // not unassigned — every row predates the column, so a strict equality
        // would return an empty workforce the moment a project is selected.
        const { resolveProjectScope } = await import("@server/middleware/project-scope.js");
        const scope = await resolveProjectScope(req, { useDefault: false });
        const activeProjectId = scope?.id ?? null;

        res.json(
            (deployments as any[]).filter(
                (d) => activeProjectId == null || d?.projectId == null || d.projectId === activeProjectId
            )
        );
    }));

    // Get specific portfolio data (CV + Legend)
    router.get("/hr/:id/portfolio", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const id = validateIdParam(req.params.id);
        const orgContext = await getUserOrgContext(req);
        
        const deployment = await AgentDeploymentService.getById(id);
        if (!deployment || deployment.organizationId !== orgContext.organizationId) {
            res.status(404).json({ error: "Agent not found" });
            return;
        }

        // Fetch CV nodes from Knowledge Graph (Nodes with type 'cv_achievement' and tag for this agent)
        const { knowledgeService } = await import("@domain/knowledge/knowledge.service.js");
        const cvNodes = await knowledgeService.searchNodes({ 
            types: ['cv_achievement'], 
            tags: [`agent_${deployment.jobId}`],
            limit: 50 
        } as any);

        res.json({
            id: deployment.id,
            name: deployment.title,
            archetype: deployment.soulArchetype,
            legend: deployment.legend,
            cv: cvNodes
        });
    }));

    // List candidates for performance improvement
    router.get("/hr/upskilling/candidates", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);
        const { UpskillingService } = await import("@domain/agents/core/upskilling.service.js");
        const candidates = await UpskillingService.getCandidates(orgContext.organizationId!);
        res.json(candidates);
    }));

    // Trigger upskilling session
    router.post("/hr/:id/upskill", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const id = validateIdParam(req.params.id);
        const orgContext = await getUserOrgContext(req);
        const { UpskillingService } = await import("@domain/agents/core/upskilling.service.js");
        
        const result = await UpskillingService.triggerUpskilling(id, orgContext.organizationId!);
        res.json(result);
    }));

    // Trigger "Dreaming Phase" (Compaction)
    router.post("/hr/dreaming", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);
        const { InstitutionalMemoryService } = await import("@domain/agents/core/institutional-memory.service.js");
        await InstitutionalMemoryService.performNightlyCompaction(orgContext.organizationId!);
        await InstitutionalMemoryService.updatePortfolios(orgContext.organizationId!);
        res.json({ success: true, phase: "COMPACTION_COMPLETE" });
    }));

    // Trigger Knowledge Federation
    router.post("/hr/federate", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);
        const { InstitutionalMemoryService } = await import("@domain/agents/core/institutional-memory.service.js");
        await InstitutionalMemoryService.federateKnowledge(orgContext.organizationId!);
        res.json({ success: true, phase: "FEDERATION_COMPLETE" });
    }));

    // Get deployment for a job
    router.get("/deployments/:jobId", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const jobId = validateIdParam(req.params.jobId, 'jobId');
        const orgContext = await getUserOrgContext(req);

        const deployment = await AgentDeploymentService.getByJobId(jobId, orgContext.organizationId!);
        res.json(deployment || null);
    }));

    // Update deployment state by deployment id
    router.patch("/deployments/:deploymentId", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const deploymentId = validateIdParam(req.params.deploymentId, 'deploymentId');
        const orgContext = await getUserOrgContext(req);

        const deployment = await AgentDeploymentService.getById(deploymentId);
        if (!deployment || deployment.organizationId !== orgContext.organizationId) {
            res.status(404).json({ error: "Deployment not found" });
            return;
        }

        const update: { isActive?: boolean } = {};
        if (req.body.isActive !== undefined) {
            if (typeof req.body.isActive !== "boolean") {
                res.status(400).json({ error: "isActive must be a boolean" });
                return;
            }
            update.isActive = req.body.isActive;
        }

        if (Object.keys(update).length === 0) {
            res.status(400).json({ error: "No supported deployment fields provided" });
            return;
        }

        const updated = await AgentDeploymentService.updateDeployment(deploymentId, update);
        res.json(updated);
    }));

    // Create/Update deployment
    router.post("/deploy", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const body = req.body as InsertAgentDeployment;
        const orgContext = await getUserOrgContext(req);

        // Validate schema
        const validated = insertAgentDeploymentSchema.parse(body);

        // Verify job ownership
        const job = await AgentDeploymentService.getJobById(validated.jobId, orgContext.organizationId!);

        if (!job) {
            res.status(404).json({ error: "Job not found or access denied" });
            return;
        }

        const existing = await AgentDeploymentService.getByJobId(validated.jobId, orgContext.organizationId!);

        let passwordHash = existing?.accessPasswordHash || null;
        if ((validated as any).password) {
            passwordHash = await hashPassword((validated as any).password);
        }

        const deployment = await AgentDeploymentService.upsert({
            jobId: validated.jobId,
            organizationId: orgContext.organizationId!,
            slug: validated.slug,
            title: validated.title,
            description: validated.description,
            welcomeMessage: validated.welcomeMessage,
            brandingConfig: validated.brandingConfig,
            accessPasswordHash: passwordHash,
            accessPolicy: validated.accessPolicy || 'public',
            isActive: validated.isActive ?? existing?.isActive ?? true,
            allowedTopicIds: validated.allowedTopicIds,
            allowedDatasetIds: validated.allowedDatasetIds,
            allowedPipelineIds: validated.allowedPipelineIds,
            allowedTools: validated.allowedTools,
            allowedFileTypes: validated.allowedFileTypes,
            maxFileSizeMb: validated.maxFileSizeMb,
            oceanTraits: (validated as any).oceanTraits ?? existing?.oceanTraits,
            soulArchetype: (validated as any).soulArchetype ?? existing?.soulArchetype,
            embedConfig: { ...((existing?.embedConfig as Record<string, unknown>) ?? {}), ...validated.embedConfig },
            createdBy: existing ? undefined : orgContext.userId!,
            updatedAt: existing ? new Date() : undefined
        });

        // Trigger manifest update
        if (deployment.allowedPipelineIds && deployment.allowedPipelineIds.length > 0) {
            try {
                await AgentDeploymentService.updateManifest(deployment.id);
            } catch (err) {
                console.error("Failed to update agent manifest:", err);
            }
        }

        res.json(deployment);
    }));

    // Upload avatar
    router.post("/deployments/:jobId/avatar", requireAuth, upload.single('avatar'), asyncHandler(async (req: Request, res: Response) => {
        if (!req.file) {
            res.status(400).json({ error: "No file provided" });
            return;
        }

        const jobId = validateIdParam(req.params.jobId, 'jobId');
        const orgContext = await getUserOrgContext(req);

        // Verify access
        const deployment = await AgentDeploymentService.getByJobId(jobId, orgContext.organizationId!);

        if (!deployment) {
            res.status(404).json({ error: "Deployment not found" });
            return;
        }

        // Save to /uploads/avatars
        const uploadDir = 'uploads/avatars';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        const filename = `${deployment.id}-${Date.now()}-${req.file.originalname}`;
        const filePath = `${uploadDir}/${filename}`;

        fs.writeFileSync(filePath, req.file.buffer);

        // Update deployment
        const avatarUrl = `/uploads/avatars/${filename}`;

        // Fetch current branding to merge
        const existing = await AgentDeploymentService.getById(deployment.id);
        const currentBranding = (existing?.brandingConfig as any) || {};

        await AgentDeploymentService.updateBranding(deployment.id, {
            ...currentBranding,
            avatarUrl
        });

        res.json({ avatarUrl });
    }));

    // ========================================================================
    // PUBLIC ROUTES (External Access)
    // ========================================================================

    // Get public agent info by slug
    publicRouter.get("/:slug", asyncHandler(async (req: Request, res: Response) => {
        const slug = req.params.slug;
        const deployment = await getActivePublicDeployment(slug);

        if (!deployment) {
            res.status(404).json({ error: "Agent not found" });
            return;
        }

        // Return public info only (embedConfig.allowedEmbedOrigins for postMessage origin validation)
        const embedConfig = deployment.embedConfig as { allowedEmbedOrigins?: string[] } | null;
        res.json({
            id: deployment.id,
            jobId: deployment.jobId,
            slug: deployment.slug,
            title: deployment.title,
            description: deployment.description,
            welcomeMessage: deployment.welcomeMessage,
            brandingConfig: deployment.brandingConfig,
            accessPolicy: deployment.accessPolicy,
            organizationId: deployment.organizationId,
            allowedFileTypes: deployment.allowedFileTypes,
            maxFileSizeMb: deployment.maxFileSizeMb,
            allowedEmbedOrigins: embedConfig?.allowedEmbedOrigins ?? [],
            allowChatInput: allowsAgentChat(deployment.embedConfig as AgentInteractionConfig | null),
            buttons: ((deployment.embedConfig as AgentInteractionConfig | null)?.buttons ?? []).map(({ id, label }) => ({ id, label })),
        });
    }));

    // Verify password for protected agents
    publicRouter.post(["/:slug/auth", "/:slug/verify-password"], asyncHandler(async (req: Request, res: Response) => {
        const slug = req.params.slug;
        const { password } = req.body;

        const deployment = await getActivePublicDeployment(slug);

        if (!deployment) {
            res.status(404).json({ error: "Agent not found" });
            return;
        }

        if (deployment.accessPolicy === 'public') {
            res.json({ token: "public" });
            return;
        }

        if (!deployment.accessPasswordHash) {
            res.status(500).json({ error: "Configuration error" });
            return;
        }

        const isValid = await verifyPassword(password, deployment.accessPasswordHash);
        if (!isValid) {
            res.status(401).json({ error: "Invalid password" });
            return;
        }

        // Generate session token (simplified)
        const token = `auth-${deployment.id}-${Date.now()}`;
        res.json({ token });
    }));

    // OAuth start: redirect to org's IdP
    publicRouter.get("/:slug/oauth/start", asyncHandler(async (req: Request, res: Response) => {
        const slug = req.params.slug;
        const deployment = await getActivePublicDeployment(slug);
        if (!deployment) {
            res.redirect(`/a/${slug}?embed=1&error=oauth_failed&error_description=deployment_not_found`);
            return;
        }
        const orgSetting = await AgentDeploymentService.getOrgSettings(deployment.organizationId);
        const config = (orgSetting?.embedOAuthConfig as EmbedOAuthConfig) ?? {};
        if (!config.embedOAuthEnabled || !config.embedOAuthClientId) {
            res.redirect(`/a/${slug}?embed=1&error=oauth_failed&error_description=not_configured`);
            return;
        }
        const baseUrl = process.env.APP_URL || process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
        const redirectUri = config.embedOAuthRedirectUri || `${baseUrl}/api/public/agents${OAUTH_CALLBACK_PATH}`;
        const state = createOAuthState(slug, deployment.id, deployment.organizationId);
        const authUrl = getAuthorizationUrl({ ...config, embedOAuthRedirectUri: redirectUri }, state);
        if (!authUrl) {
            res.redirect(`/a/${slug}?embed=1&error=oauth_failed&error_description=config_error`);
            return;
        }
        res.redirect(authUrl);
    }));

    // Chat with agent
    publicRouter.post("/:slug/chat", asyncHandler(async (req: Request, res: Response) => {
        const slug = req.params.slug;
        const { sessionId, token, accessToken, sessionToken } = req.body;
        let { message, context } = req.body;
        const orgContext = await getUserOrgContext(req);

        const deployment = await getActivePublicDeployment(slug);

        if (!deployment) {
            res.status(404).json({ error: "deployment_not_found", message: "Agent not found" });
            return;
        }

        // Verify auth if needed
        if (deployment.accessPolicy === 'password' && !token?.startsWith(`auth-${deployment.id}`)) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }

        // Enforce authentication for internal_only agents
        if (deployment.accessPolicy === 'internal_only') {
            if (!orgContext.organizationId || (deployment.organizationId !== orgContext.organizationId)) {
                res.status(401).json({ error: "Unauthorized: Registered organization users only" });
                return;
            }
        }

        // For internal_only agents, use the authenticated userId for persistent memory
        // For public/password, use the client-provided sessionId
        const finalUserId = deployment.accessPolicy === 'internal_only'
            ? String(orgContext.userId)
            : (sessionId || uuidv4());

        const finalSessionId = deployment.accessPolicy === 'internal_only'
            ? `internal-${orgContext.userId}`
            : finalUserId;

        const interaction = deployment.embedConfig as AgentInteractionConfig | null;
        const button = agentButton(interaction, req.body.buttonId);
        if (req.body.buttonId !== undefined) {
            if (!button) return res.status(400).json({ error: "invalid_button", message: "This button is no longer available." });
            // The server owns the prompt and context. A forged message or attachment
            // cannot turn an approved button into arbitrary free-text input.
            message = button.message;
            context = {};
        } else if (!allowsAgentChat(interaction)) {
            const submission = context?.pipelineExecution;
            if (!submission || typeof submission.nonce !== "string" || !submission.inputData || typeof submission.inputData !== "object" || Array.isArray(submission.inputData)) {
                return res.status(403).json({ error: "chat_input_disabled", message: "Use this agent’s buttons or forms to continue." });
            }
            const { agentNonceService } = await import("@domain/agents/agent-nonce.service.js");
            const mapping = await agentNonceService.resolveWithContext(finalSessionId, submission.nonce);
            const target = mapping?.pipelineId;
            const manifest = (deployment.formManifest ?? {}) as Record<string, any>;
            const permitted = target !== undefined && ((deployment.allowedPipelineIds ?? []).includes(Number(target)) || Object.hasOwn(manifest, String(target)));
            if (!permitted) return res.status(403).json({ error: "invalid_form_submission", message: "This form is unavailable or its session has expired." });
            context = { pipelineExecution: { nonce: submission.nonce, inputData: submission.inputData } };
            message = `[FORM_SUBMISSION] Execute pipeline with nonce ${submission.nonce}. Input: ${JSON.stringify(submission.inputData)}`;
        }

        // Profile pre-fetch for embed personalization
        let profile: object | null = null;
        let profileFallback = false;
        let profileError: string | undefined;
        let profileErrorCode: string | undefined;

        // Tokens: from body or from OAuth cookie (use accessToken as sessionToken when only cookie present)
        let effectiveAccessToken = accessToken;
        let effectiveSessionToken = sessionToken;
        if (!effectiveAccessToken && req.headers.cookie) {
            const cookieToken = getEmbedOAuthTokenFromCookie(req.headers.cookie);
            if (cookieToken) {
                effectiveAccessToken = cookieToken;
                effectiveSessionToken = effectiveSessionToken || cookieToken;
            }
        }

        const embedConfig = deployment.embedConfig as { profileApiUrl?: string; profileApiMethod?: string; profileApiTimeoutMs?: number; profileApiHeaders?: Record<string, string>; profileCacheTtlSeconds?: number; enableHttpRequest?: boolean } | null;

        // Fetch org settings once if needed for embed config
        let orgSetting: any;
        if (embedConfig?.enableHttpRequest || (effectiveAccessToken && effectiveSessionToken && embedConfig?.profileApiUrl)) {
            orgSetting = await AgentDeploymentService.getOrgSettings(deployment.organizationId);
        }

        // Build allowedToolsOverride:
        // 1. If deployment has an explicit allowedTools list, use it as the ceiling.
        // 2. If embedConfig.enableHttpRequest is set, also add http_request (subject to org allowlist).
        // Empty allowedTools array = inherit all tools from the job config (no override).
        const deploymentAllowedTools = (deployment.allowedTools as string[] | null) ?? null;
        let allowedToolsOverride: string[] | undefined = deploymentAllowedTools?.length ? [...deploymentAllowedTools] : undefined;

        if (embedConfig?.enableHttpRequest && orgSetting) {
            const orgAllowed = (orgSetting.allowedAgentTools as string[] | null) ?? [];
            if (orgAllowed.includes('http_request') || orgAllowed.includes('*')) {
                allowedToolsOverride = allowedToolsOverride
                    ? [...new Set([...allowedToolsOverride, 'http_request'])]
                    : ['http_request'];
            }
        }

        if (effectiveAccessToken && effectiveSessionToken && embedConfig?.profileApiUrl) {
            const { fetchEmbedProfile } = await import("@domain/auth/core/embed-profile.service.js");
            const cacheTtl = embedConfig.profileCacheTtlSeconds ?? 120;
            const result = await fetchEmbedProfile(effectiveAccessToken, effectiveSessionToken, {
                profileApiUrl: embedConfig.profileApiUrl,
                profileApiMethod: embedConfig.profileApiMethod,
                profileApiTimeoutMs: embedConfig.profileApiTimeoutMs,
                profileApiHeaders: embedConfig.profileApiHeaders,
                profileCacheTtlSeconds: cacheTtl > 0 ? cacheTtl : undefined,
                profileApiDomainAllowlist: (orgSetting?.profileApiDomainAllowlist as string[] | null | undefined) ?? undefined,
            }, { sessionId: finalSessionId, deploymentId: deployment.id });
            profile = result.profile;
            if (!profile && result.profileErrorCode) {
                profileFallback = true;
                profileError = result.profileError;
                profileErrorCode = result.profileErrorCode;
            }
        }

        // Process message with agent service
        // ─── ASSET CONTEXT PRE-INJECTION ─────────────────────────────────
        // If the request includes an assetId (from QR scan URL param),
        // resolve the full asset record immediately and inject it so the LLM
        // doesn't need an extra tool-call round trip on the first message.
        let enrichedContext = { ...(context || {}) };
        // The QR assetId may arrive either directly (context.assetId) or nested under
        // the query params the public chat UI forwards (context.urlParams.assetId).
        if (!enrichedContext.assetId && (enrichedContext as any).urlParams?.assetId) {
            enrichedContext.assetId = (enrichedContext as any).urlParams.assetId;
        }
        if (enrichedContext.assetId && deployment.slug === "service-bot") {
            try {
                const assetData = await resolveAssetRecord(deployment.organizationId, enrichedContext.assetId);

                if (assetData) {
                    enrichedContext._assetRecord = assetData;
                    enrichedContext._assetContext = `ASSET CONTEXT (pre-loaded from QR scan):\n${JSON.stringify(assetData, null, 2)}`;

                    // Resolve the initial chat form based on asset type
                    try {
                        const { chatFormResolver } = await import("@domain/asset-service/chat-form-resolver.service.js");
                        const initialForm = chatFormResolver.getIntentForm(assetData);
                        enrichedContext._initialForm = initialForm;
                        enrichedContext._formResolverAvailable = true;
                    } catch (formErr: any) {
                        // Non-blocking
                    }
                }
            } catch (assetErr: any) {
                // Non-blocking: if asset lookup fails, agent can still use tool calls
                console.warn(`[ServiceBot] Asset pre-fetch failed for ${enrichedContext.assetId}: ${assetErr.message}`);
            }
        }

        const isFormSubmission = !!(context as any)?.pipelineExecution
            || (typeof message === "string" && message.startsWith("[FORM_SUBMISSION]"));

        // ─── Deterministic initial-turn form ─────────────────────────────────
        // An agent whose blueprint declares an intake form serves it on the first
        // turn in ~1ms, with no model round-trip at all. This used to be a
        // per-slug branch carrying a copy of the rescue-dispatch field list; the
        // fields now live on the form manifest, so this path is generic and the
        // same declaration also feeds the agent's derived fallback routes.
        const initialTurnForm = (() => {
            const manifest = (deployment.formManifest ?? {}) as Record<string, any>;
            for (const [formId, entry] of Object.entries(manifest)) {
                if (entry?.servesInitialTurn && entry.fields?.length) return { formId, entry };
            }
            return null;
        })();

        if (initialTurnForm && !isFormSubmission && typeof message === "string") {
            const { agentNonceService } = await import("@domain/agents/agent-nonce.service.js");
            const nonce = await agentNonceService.generate(
                finalSessionId,
                initialTurnForm.formId,
                initialTurnForm.entry.pipelineName,
            );
            const inputRequest = JSON.stringify({
                type: "input_request",
                nonce,
                pipelineName: initialTurnForm.entry.pipelineName,
                fields: initialTurnForm.entry.fields,
            });

            try {
                const inserted = await db.insert(agentChatMessages).values([
                    { jobId: deployment.jobId, userId: finalUserId, sessionId: finalSessionId, role: "user", content: message, organizationId: deployment.organizationId } as any,
                    { jobId: deployment.jobId, userId: finalUserId, sessionId: finalSessionId, role: "agent", content: inputRequest, metadata: { deterministicForm: true, formId: initialTurnForm.formId }, organizationId: deployment.organizationId } as any,
                ]).returning();
                const agentMessage = inserted.find(m => m.role === "agent");
                console.log(`[AgentIntake] Deterministic initial-turn form "${initialTurnForm.formId}" served for ${deployment.slug} — no LLM call.`);
                res.json({ response: inputRequest, sessionId: finalSessionId, messageId: agentMessage?.id });
                return;
            } catch (persistErr: any) {
                console.warn(`[AgentIntake] Failed to persist initial-turn form: ${persistErr.message}`);
                res.json({ response: inputRequest, sessionId: finalSessionId });
                return;
            }
        }

        if (deployment.slug === "rescue-dispatcher" && isFormSubmission) {
            const pipelineExecution = (context as any)?.pipelineExecution;
            const inputData = pipelineExecution?.inputData || {};
            try {
                const { rescueService } = await import("@domain/rescue/index.js");

                // Verify the submitted serial against Managed Assets before the
                // session exists, so the maintenance standing is part of the
                // record from the outset rather than being asserted later.
                const { verifyAssetMaintenance } = await import("@domain/rescue/core/asset-verification.js");
                const assetVerification = await verifyAssetMaintenance(
                    deployment.organizationId,
                    inputData.serialNumber,
                );

                const session = await rescueService.initiateRescue({
                    orgId: deployment.organizationId,
                    serviceType: inputData.incidentType || "Emergency Rescue",
                    userLocation: {
                        lat: 34.0522,
                        lng: -118.2437,
                        address: inputData.address || "200 N Spring St, Los Angeles, CA 90012",
                        resolvedBy: "map"
                    },
                    isDemoMode: true,
                    // Carried on the session so /api/rescue/sessions/:id exposes it
                    // to the requester's tracking card without a second lookup.
                    metadata: { assetVerification },
                });

                await rescueService.syncToAppDataset(session, { ...inputData, assetVerification });

                const rescueStatusResponse = JSON.stringify({
                    type: "rescue_status",
                    sessionId: session.id,
                    status: session.status,
                    message: `Rescue Dispatch Initiated! Session ID: ${session.id}. Provider assigned: Apex Field Response.`
                });

                const inserted = await db.insert(agentChatMessages).values([
                    { jobId: deployment.jobId, userId: finalUserId, sessionId: finalSessionId, role: "user", content: message, organizationId: deployment.organizationId } as any,
                    { jobId: deployment.jobId, userId: finalUserId, sessionId: finalSessionId, role: "agent", content: rescueStatusResponse, metadata: { rescueStatus: true }, organizationId: deployment.organizationId } as any,
                ]).returning();
                const agentMessage = inserted.find(m => m.role === "agent");
                console.log(`[RescueDispatcher] Form submission resolved to rescue session ${session.id}.`);
                res.json({
                    response: rescueStatusResponse,
                    // Chat-session identity (a uuid). The client keys conversation
                    // continuity off this, so it must stay as-is.
                    sessionId: finalSessionId,
                    // The rescue record's numeric id. Previously it existed only
                    // inside the serialized `response` body, so any caller wanting
                    // it had to parse the payload — and `Number(sessionId)` on the
                    // uuid above silently yields NaN, which is how callers ended up
                    // requesting /api/rescue/sessions/NaN and RSC-NaN.
                    rescueSessionId: session.id,
                    messageId: agentMessage?.id,
                });
                return;
            } catch (err: any) {
                // Do NOT fall through to the agent loop. This handler is fully
                // deterministic (rescueService does no model calls at all), so a
                // failure here is a data/config fault that the LLM cannot fix —
                // and escalating into it under a degraded backend converted a
                // fast error into a multi-minute hang. Degrade sideways instead.
                console.warn(`[RescueDispatcher] Rescue session initiation error: ${err.message}`);
                const served = await serveFallbackTurn(res, deployment, message, {
                    sessionId: finalSessionId,
                    userId: finalUserId,
                    isFormSubmission: true,
                    pipelineExecution,
                    cause: `deterministic_handler_failed: ${err.message}`,
                });
                if (served) return;
                res.status(503).json({
                    error: "Dispatch intake is temporarily unavailable.",
                    detail: err.message,
                    degraded: true,
                });
                return;
            }
        }

        // ─── ASSET CONTEXT PRE-INJECTION ─────────────────────────────────
        // For a QR-scanned asset, the structured intent turn is fully deterministic.
        // Resolve the matching input form from cached blocks and return it directly
        // so the first turn renders in milliseconds instead of running the ~3-min
        // agent loop. The agent is still used for the substantive turn once the form
        // is submitted (which arrives as a [FORM_SUBMISSION] message).
        if (deployment.slug === "service-bot" && enrichedContext._assetRecord && !isFormSubmission && typeof message === "string") {
            try {
                const { formBlockService } = await import("@domain/asset-service/form-block.service.js");
                const intent = formBlockService.matchIntent(message);
                if (intent) {
                    const resolved = await formBlockService.assembleForm(
                        deployment.organizationId,
                        enrichedContext._assetRecord,
                        intent,
                        deployment.formManifest as Record<string, any> | null
                    );
                    if (resolved && resolved.fields.length > 0) {
                        const { agentNonceService } = await import("@domain/agents/agent-nonce.service.js");
                        const nonce = await agentNonceService.generate(
                            finalSessionId,
                            `asset-triage:${resolved.formId}`,
                            resolved.pipelineName,
                            undefined,
                            enrichedContext.assetId
                        );
                        const inputRequest = JSON.stringify({
                            type: "input_request",
                            nonce,
                            pipelineName: resolved.pipelineName,
                            fields: resolved.fields,
                        });

                        // Persist the turn so /messages polling and reloads stay consistent.
                        try {
                            const inserted = await db.insert(agentChatMessages).values([
                                { jobId: deployment.jobId, userId: finalUserId, sessionId: finalSessionId, role: "user", content: message, organizationId: deployment.organizationId } as any,
                                // Persist as role "agent" (not "assistant") so the public chat UI
                                // recognizes it on reload/poll and renders the AgentInputForm — the
                                // normal agent path also persists with role "agent" (agent.service.ts).
                                { jobId: deployment.jobId, userId: finalUserId, sessionId: finalSessionId, role: "agent", content: inputRequest, metadata: { deterministicForm: true, intent, formId: resolved.formId }, organizationId: deployment.organizationId } as any,
                            ]).returning();
                            const agentMessage = inserted.find(m => m.role === "agent");
                            console.log(`[ServiceBot] Deterministic form served (intent="${intent}", form="${resolved.formId}") — no LLM call.`);
                            res.json({ response: inputRequest, sessionId: finalSessionId, messageId: agentMessage?.id });
                            return;
                        } catch (persistErr: any) {
                            console.warn(`[ServiceBot] Failed to persist deterministic form turn: ${persistErr.message}`);
                        }

                        console.log(`[ServiceBot] Deterministic form served (intent="${intent}", form="${resolved.formId}") — no LLM call.`);
                        res.json({ response: inputRequest, sessionId: finalSessionId });
                        return;
                    }
                    // Intent needs no form (e.g. "Check service status") → fall through to the agent.
                }
            } catch (formErr: any) {
                console.warn(`[ServiceBot] Deterministic form resolution failed, falling back to agent: ${formErr.message}`);
            }
        }

        // ─── Deterministic form-chain advance (no LLM) ─────────────────────────
        // A [FORM_SUBMISSION] for the *intent selection* form used to fall through
        // to the LLM agent loop, which has no way to render the next deterministic
        // form: restock_request/diagnostic_*/feedback aren't real DB-backed pipelines,
        // so trigger_pipeline's "asset-triage:" shortcut just echoes the submission
        // back, and show_pipeline_input_form 404s trying to resolve them by name.
        // The agent would then loop/stall until the client's fetch timeout aborted.
        // Resolve the chosen intent's next form here directly, same as the initial
        // form above, instead of leaving the agent with no path to finish the turn.
        if (deployment.slug === "service-bot" && isFormSubmission) {
            const pipelineExecution = (context as any)?.pipelineExecution;
            const submittedNonce: string | undefined = pipelineExecution?.nonce;
            const submittedIntent: string | undefined = pipelineExecution?.inputData?.intent;

            if (submittedNonce && submittedIntent) {
                try {
                    const { agentNonceService } = await import("@domain/agents/agent-nonce.service.js");
                    const mapping = await agentNonceService.resolveWithContext(finalSessionId, submittedNonce);

                    if (mapping?.pipelineId === "asset-triage:intent_selection") {
                        // The client doesn't resend assetId on form submissions, so recover it
                        // from the nonce mapping (stashed there when the intent form was issued).
                        const assetRecord = mapping.assetId
                            ? await resolveAssetRecord(deployment.organizationId, mapping.assetId)
                            : null;

                        if (assetRecord) {
                            const { formBlockService } = await import("@domain/asset-service/form-block.service.js");
                            const resolved = await formBlockService.assembleForm(
                                deployment.organizationId,
                                assetRecord,
                                submittedIntent,
                                deployment.formManifest as Record<string, any> | null
                            );

                            if (resolved && resolved.fields.length > 0) {
                                const nonce = await agentNonceService.generate(
                                    finalSessionId,
                                    `asset-triage:${resolved.formId}`,
                                    resolved.pipelineName,
                                    undefined,
                                    mapping.assetId
                                );
                                const inputRequest = JSON.stringify({
                                    type: "input_request",
                                    nonce,
                                    pipelineName: resolved.pipelineName,
                                    fields: resolved.fields,
                                });

                                try {
                                    const inserted = await db.insert(agentChatMessages).values([
                                        { jobId: deployment.jobId, userId: finalUserId, sessionId: finalSessionId, role: "user", content: message, organizationId: deployment.organizationId } as any,
                                        { jobId: deployment.jobId, userId: finalUserId, sessionId: finalSessionId, role: "agent", content: inputRequest, metadata: { deterministicForm: true, intent: submittedIntent, formId: resolved.formId }, organizationId: deployment.organizationId } as any,
                                    ]).returning();
                                    const agentMessage = inserted.find(m => m.role === "agent");
                                    console.log(`[ServiceBot] Deterministic form-chain advance (intent="${submittedIntent}" -> form="${resolved.formId}") — no LLM call.`);
                                    res.json({ response: inputRequest, sessionId: finalSessionId, messageId: agentMessage?.id });
                                    return;
                                } catch (persistErr: any) {
                                    console.warn(`[ServiceBot] Failed to persist form-chain turn: ${persistErr.message}`);
                                    console.log(`[ServiceBot] Deterministic form-chain advance (intent="${submittedIntent}" -> form="${resolved.formId}") — no LLM call.`);
                                    res.json({ response: inputRequest, sessionId: finalSessionId });
                                    return;
                                }
                            }

                            // Intent needs no form (e.g. "Check service status") → fall through to
                            // the agent, re-attaching the asset since this request didn't carry it.
                            enrichedContext._assetRecord = assetRecord;
                            enrichedContext._assetContext = `ASSET CONTEXT (pre-loaded from QR scan):\n${JSON.stringify(assetRecord, null, 2)}`;
                        }
                    }
                } catch (chainErr: any) {
                    console.warn(`[ServiceBot] Form-chain advance failed, falling back to agent: ${chainErr.message}`);
                }
            }
        }

        // ─── Limp mode ────────────────────────────────────────────────────────
        // Before paying for a model turn, check whether the model layer is even
        // usable. Under an outage the failover chain (cloud -> Qwen -> Ollama ->
        // Mock) absorbs failures by getting progressively slower, so calling into
        // it is what produces multi-minute hangs. Serving the agent's derived
        // deterministic routes is both faster and honest.
        const { aiAvailability, INTERACTIVE_AI_DEADLINE_MS } = await import("@domain/ai/core/ai-availability.service.js");
        const fallbackCtx = {
            sessionId: finalSessionId,
            userId: finalUserId,
            isFormSubmission,
            pipelineExecution: (context as any)?.pipelineExecution,
        };

        if (aiAvailability.isDegraded()) {
            const served = await serveFallbackTurn(res, deployment, message, {
                ...fallbackCtx,
                cause: `ai_degraded: ${aiAvailability.reason() ?? "model backend unavailable"}`,
            });
            if (served) return;
            // No manifest yet (pre-backfill agent) — fall through and try the
            // model anyway rather than refusing to serve the request at all.
        }

        let result: any;
        try {
            result = await aiAvailability.withDeadline(() => agentService.chat({
                message,
                context: {
                    ...enrichedContext,
                    jobId: deployment.jobId,
                    sessionId: finalSessionId,
                    profile: profile ?? undefined,
                    allowedToolsOverride,
                },
                userContext: {
                    organizationId: deployment.organizationId,
                    userId: finalUserId,
                    isAdmin: orgContext.isAdmin || false,
                    isSuperAdmin: orgContext.isSuperAdmin || false,
                    isOrgAdmin: orgContext.isOrgAdmin || false,
                    allowedTopicIds: deployment.allowedTopicIds,
                    allowedDatasetIds: deployment.allowedDatasetIds,
                    allowedPipelineIds: deployment.allowedPipelineIds
                }
            }), INTERACTIVE_AI_DEADLINE_MS);
        } catch (chatErr: any) {
            // The turn blew its budget or the backend failed outright. Both are
            // now recorded against the availability gate, so a sustained outage
            // trips limp mode for subsequent callers instead of making each one
            // wait out the same deadline.
            const served = await serveFallbackTurn(res, deployment, message, {
                ...fallbackCtx,
                cause: `ai_call_failed: ${chatErr.message}`,
            });
            if (served) return;
            throw chatErr;
        }

        // Save conversation history happens in agentService.chat

        const response: Record<string, unknown> = {
            response: (result as any).response || result,
            messageId: (result as any).messageId,
            sessionId: finalSessionId
        };
        if (profileFallback) {
            response.profileFallback = true;
            if (profileError) response.profileError = profileError;
            if (profileErrorCode) response.profileErrorCode = profileErrorCode;
        }
        res.json(response);
    }));

    // Get messages for session (Polling)
    publicRouter.get("/:slug/messages", asyncHandler(async (req: Request, res: Response) => {
        const slug = req.params.slug;
        const sessionId = req.query.sessionId as string;
        const orgContext = await getUserOrgContext(req);

        const deployment = await getActivePublicDeployment(slug);

        if (!deployment) {
            res.status(404).json({ error: "Agent not found" });
            return;
        }

        // Enforce authentication for internal_only agents
        if (deployment.accessPolicy === 'internal_only' && (!orgContext.organizationId || deployment.organizationId !== orgContext.organizationId)) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }

        // Determine which ID to use for fetching messages
        const finalUserId = deployment.accessPolicy === 'internal_only'
            ? String(orgContext.userId)
            : sessionId;

        if (!finalUserId) {
            res.json([]);
            return;
        }

        // Fetch last 50 messages for this user/session
        const messages = await AgentDeploymentService.listRecentMessages(deployment.jobId, finalUserId, 50);

        // Reverse to ensure chronological order (oldest -> newest) for frontend
        messages.reverse();

        // Convert timestamps to number
        const formatted = messages.map(m => ({
            ...m,
            timestamp: m.timestamp?.getTime() || Date.now()
        }));

        res.json(formatted);
    }));

    // Rate agent response
    publicRouter.post("/:slug/feedback/:messageId", asyncHandler(async (req: Request, res: Response) => {
        const slug = req.params.slug;
        const messageId = validateIdParam(req.params.messageId, 'messageId');
        const { rating, feedback, feedbackReason } = req.body; // rating: 1 (up), -1 (down)

        const deployment = await getActivePublicDeployment(slug);
        if (!deployment) {
            res.status(404).json({ error: "Agent not found" });
            return;
        }

        res.json({ success: true });
    }));

    // Get real-time activities for agent (Step-level observability)
    // INTERNAL ONLY: Only returns detailed reasoning if user is logged in
    publicRouter.get("/:slug/activities", asyncHandler(async (req: Request, res: Response) => {
        const slug = req.params.slug;
        const sessionId = req.query.sessionId as string;
        const user = (req as any).user;

        // Security: Reasoning is for internal users only
        if (!user) {
            res.json([]);
            return;
        }

        const deployment = await getActivePublicDeployment(slug);

        if (!deployment) {
            res.status(404).json({ error: "Agent not found" });
            return;
        }

        // Fetch last 100 steps for this user/session
        // Note: In a production scenario, we might want to filter by sessionId 
        // to ensure the user only sees their own session's reasoning if they are logged in.
        const steps = await AgentDeploymentService.listRecentSteps(deployment.jobId, sessionId, 100);

        // Reverse for chronological order
        steps.reverse();

        res.json(steps.map(s => ({
            ...s,
            createdAt: s.createdAt?.getTime() || Date.now()
        })));
    }));

    // Submit a form response from a chat user
    publicRouter.post("/:slug/submit-form", asyncHandler(async (req: Request, res: Response) => {
        const { slug } = req.params;
        const { sessionId, formData, executionId, stepExecutionId, toolCallId } = req.body;

        if (!sessionId || !formData) {
            throw new BadRequestError("sessionId and formData are required");
        }

        const deployment = await getActivePublicDeployment(slug);
        if (!deployment) {
            res.status(404).json({ error: "Agent deployment not found or not published" });
            return;
        }

        const organizationId = deployment.organizationId;

        // Save the form submission as a user message
        await db.insert(agentChatMessages).values({
            jobId: deployment.jobId,
            userId: "public-user",
            sessionId,
            role: "user",
            content: `[Form Submission] ${JSON.stringify(formData)}`,
            metadata: { formSubmission: true, formData },
            organizationId
        } as any);
        // Dialectic turn counter (fire & forget)
        import("../domain/agents/core/user-representation.service.js")
            .then(({ userRepresentationService }) => userRepresentationService.recordTurn(organizationId, "public-user"))
            .catch(() => { });

        // If we have execution context, resume the pipeline
        if (executionId && stepExecutionId) {
            const { pipelineService } = await import("../domain/pipeline/core/pipeline.service.js");
            
            // Update the step execution with form data
            await pipelineService.updateStepExecution(stepExecutionId, {
                output: JSON.stringify(formData),
                status: "success",
                completedAt: new Date(),
            });

            // Resume the pipeline
            const orgContext = { 
                userId: `public-agent:${slug}`, 
                organizationId, 
                isAdmin: false, 
                isSuperAdmin: false, 
                isOrgAdmin: false 
            };
            
            const resumeResult = await pipelineService.resume(
                parseInt(executionId), 
                null, 
                orgContext as any, 
                formData
            );

            res.json({
                success: true,
                message: "Form submitted and pipeline resumed",
                executionId,
                pipelineStatus: resumeResult.status,
                sessionId
            });
        } else {
            // No pipeline to resume, just acknowledge
            res.json({
                success: true,
                message: "Form submitted successfully",
                sessionId
            });
        }
    }));

    // Upload files to the agent session
    publicRouter.post("/:slug/upload", upload.array("files", 5), asyncHandler(async (req: Request, res: Response) => {
        const { slug } = req.params;

        const deployment = await getActivePublicDeployment(slug);
        if (!deployment) {
            res.status(404).json({ error: "Agent deployment not found or not published" });
            return;
        }

        const files = (req.files as Express.Multer.File[]) || [];

        const uploadedFiles = files.map(f => ({
            name: f.originalname,
            size: f.size,
            mimeType: f.mimetype,
        }));

        res.json({ files: uploadedFiles });
    }));

    // Fallback for GET request on chat endpoint
    publicRouter.get("/:slug/chat", asyncHandler(async (req: Request, res: Response) => {
        res.status(405).json({
            error: "Method Not Allowed",
            message: "GET requests to /chat are not supported. Use POST to send chat messages."
        });
    }));

    // Register routes
    app.use("/api/agents", router);
    app.use("/api/public/agents", publicRouter);
}
