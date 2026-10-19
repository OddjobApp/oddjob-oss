import { Router, type Request, type Response } from "express";
import { checkDatabaseConnection } from "@server/database_service.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { logSecurityEvent } from "../utils/security-logger.js";
import { getUserOrgContext } from "../utils/auth-context.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { AppError, ErrorCode, BadRequestError, ForbiddenError, UnauthorizedError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";
import { ensureQdrantCollection } from "../integrations/qdrant-client.js";
import { getOddjobCapabilityManifest } from "@shared/product/oddjob-capability-manifest.js";
import { calibrateSourceConfidence, SOURCE_REVIEW_SCORES } from "@domain/ai/core/copilot-observability.service.js";
import { platformSettingsService } from "@domain/system/platform-settings.service.js";
import { copilotGuideTelemetryService } from "@domain/system/copilot-guide-telemetry.service.js";
import { z } from "zod";

const router = Router();
const logger = createLogger("System");

// Track server start time for uptime calculation
// We set this once when the module is loaded
const SERVER_START_TIME = Date.now();

// GET /api/health
// Lightweight liveness/readiness probe for load balancers and orchestrators.
router.get("/health", (_req: Request, res: Response) => {
    res.json({
        status: "healthy",
        timestamp: new Date().toISOString(),
        uptimeMs: Date.now() - SERVER_START_TIME,
    });
});

// GET /api/health/database
router.get("/health/database", asyncHandler(async (_req: Request, res: Response) => {
    const health = await checkDatabaseConnection();
    if (health.connected) {
        res.json({
            status: "healthy", database: "connected",
            timestamp: new Date().toISOString()
        });
    } else {
        // We throw 503 here for standard error handling, or we can send 503 directly.
        // Given it's a health check, returning a specific JSON structure is often expected by probers.
        // I will keep the JSON structure but use res.status.
        res.status(503).json({
            status: "unhealthy", database: "disconnected",
            error: health.error, timestamp: new Date().toISOString()
        });
    }
}));

/**
 * GET /api/system/health/matrix
 * Consolidated platform health matrix: Redis latency, DB connection,
 * Container Reconciliation status, and memory stats.
 */
router.get("/system/health/matrix", asyncHandler(async (_req: Request, res: Response) => {
    const dbHealth = await checkDatabaseConnection();
    let redisLatencyMs: number | null = null;
    let redisStatus = "disconnected";

    try {
        const { redis } = await import("@domain/core/infrastructure/redis/redis-client.js");
        const start = Date.now();
        await redis.ping();
        redisLatencyMs = Date.now() - start;
        redisStatus = "connected";
    } catch (err: any) {
        logger.warn("[SystemHealth] Redis ping check failed:", err.message);
    }

    const { containerReconciliationService } = await import("@domain/infrastructure/container-reconciliation.service.js");
    const containerStats = (containerReconciliationService as any).getLastReconciliationStats ? (containerReconciliationService as any).getLastReconciliationStats() : { status: "running" };

    res.json({
        status: dbHealth.connected && redisStatus === "connected" ? "healthy" : "degraded",
        timestamp: new Date().toISOString(),
        database: {
            status: dbHealth.connected ? "connected" : "disconnected",
            latencyMs: (dbHealth as any).latencyMs || null
        },
        redis: {
            status: redisStatus,
            latencyMs: redisLatencyMs
        },
        reconciliationWorker: containerStats,
        memoryUsage: process.memoryUsage()
    });
}));

// GET /api/health/vector
router.get("/health/vector", requireAuth, asyncHandler(async (_req: Request, res: Response) => {
    await ensureQdrantCollection();
    res.json({ status: "ok" });
}));

// GET /api/system/info
router.get("/system/info", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const version = process.env.APP_VERSION || "1.0.0";
    const uptimeMs = Date.now() - SERVER_START_TIME;
    const uptimeDays = Math.floor(uptimeMs / (1000 * 60 * 60 * 24));
    const uptimeHours = Math.floor((uptimeMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const uptimeMinutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));

    const uptimeString = uptimeDays > 0
        ? `${uptimeDays} day${uptimeDays !== 1 ? 's' : ''}, ${uptimeHours} hour${uptimeHours !== 1 ? 's' : ''}`
        : uptimeHours > 0
            ? `${uptimeHours} hour${uptimeHours !== 1 ? 's' : ''}, ${uptimeMinutes} minute${uptimeMinutes !== 1 ? 's' : ''}`
            : `${uptimeMinutes} minute${uptimeMinutes !== 1 ? 's' : ''}`;

    // An org sees its own count; only a super admin with no org sees the platform total.
    let activeJobsCount = 0;
    if (orgContext.organizationId !== null) {
        activeJobsCount = await platformSettingsService.countActiveJobs(orgContext.organizationId);
    } else if (orgContext.isSuperAdmin) {
        activeJobsCount = await platformSettingsService.countActiveJobs(null);
    }

    res.json({
        version: `v${version}`,
        uptime: uptimeString,
        activeJobs: `${activeJobsCount} configured`,
        lastBackup: "Not configured",
    });
}));

// GET /api/system/capabilities
router.get("/system/capabilities", requireAuth, asyncHandler(async (_req: Request, res: Response) => {
    res.json({
        ...getOddjobCapabilityManifest(),
        generatedAt: new Date().toISOString(),
    });
}));

// GET /api/system/copilot-guide
router.get("/system/copilot-guide", requireAuth, asyncHandler(async (_req: Request, res: Response) => {
    const manifest = getOddjobCapabilityManifest();
    res.json({
        positioning: manifest.positioning,
        copilotGuide: manifest.copilotGuide,
        capabilityNextActions: manifest.capabilities.map((capability) => ({
            id: capability.id,
            name: capability.name,
            pillar: capability.pillar,
            maturity: capability.maturity,
            buyerValue: capability.buyerValue,
            nextActions: capability.copilotNextActions,
        })),
        canonicalDemos: manifest.canonicalDemos,
        generatedAt: new Date().toISOString(),
    });
}));

const copilotCommandEventSchema = z.object({
    commandId: z.string().min(1),
    surface: z.enum(["mission_create", "mission_chat", "copilot"]),
    missionId: z.number().int().positive().optional(),
    missionRunId: z.number().int().positive().optional(),
});

router.post("/system/copilot-guide/commands/events", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const parsed = copilotCommandEventSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError("Invalid Copilot command event");
    const orgContext = await getUserOrgContext(req);
    if (orgContext.organizationId == null) throw new BadRequestError("Organization context required");
    const command = getOddjobCapabilityManifest().copilotGuide.commands.find((item) => item.id === parsed.data.commandId);
    if (!command) throw new BadRequestError("Unknown Copilot command");

    const event = await copilotGuideTelemetryService.recordCommandEvent(orgContext.organizationId, {
        userId: orgContext.userId,
        commandId: command.id,
        surface: parsed.data.surface,
        riskLevel: command.riskLevel,
        requiresApproval: command.requiresApproval,
        missionId: parsed.data.missionId,
        missionRunId: parsed.data.missionRunId,
    });
    res.status(201).json({ event });
}));

router.get("/system/copilot-guide/commands/analytics", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    if (orgContext.organizationId == null) throw new BadRequestError("Organization context required");
    const rows = await copilotGuideTelemetryService.commandAnalytics(orgContext.organizationId);
    res.json({ commands: rows });
}));

const sourceReviewSchema = z.object({
    sourceId: z.string().min(1),
    sourceType: z.string().min(1).default("knowledge"),
    originalConfidence: z.number().min(0).max(1),
    outcome: z.enum(["relevant", "partially_relevant", "irrelevant"]),
});

router.post("/system/copilot-guide/source-reviews", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const parsed = sourceReviewSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError("Invalid knowledge-source review");
    const orgContext = await getUserOrgContext(req);
    if (orgContext.organizationId == null) throw new BadRequestError("Organization context required");
    const outcomeScore = SOURCE_REVIEW_SCORES[parsed.data.outcome];
    const review = await copilotGuideTelemetryService.recordSourceReview(orgContext.organizationId, {
        userId: orgContext.userId,
        ...parsed.data,
        outcomeScore,
    });

    const history = await copilotGuideTelemetryService.sourceReviewHistory(orgContext.organizationId, parsed.data.sourceId);
    res.status(201).json({ review, calibration: calibrateSourceConfidence(parsed.data.originalConfidence, history) });
}));

router.get("/system/copilot-guide/source-confidence/:sourceId", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    if (orgContext.organizationId == null) throw new BadRequestError("Organization context required");
    const originalConfidence = Number(req.query.originalConfidence);
    if (!Number.isFinite(originalConfidence) || originalConfidence < 0 || originalConfidence > 1) {
        throw new BadRequestError("originalConfidence must be between 0 and 1");
    }
    const history = await copilotGuideTelemetryService.sourceReviewHistory(orgContext.organizationId, req.params.sourceId);
    res.json({ sourceId: req.params.sourceId, ...calibrateSourceConfidence(originalConfidence, history) });
}));

// GET /api/system/copilot-guide/export
router.get("/system/copilot-guide/export", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const manifest = getOddjobCapabilityManifest();
    const exportedAt = new Date().toISOString();
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="oddjob-copilot-guide-${exportedAt.slice(0, 10)}.json"`);
    res.json({
        exportedAt,
        exportedBy: (req.session as any)?.userId ?? null,
        organizationId: orgContext.organizationId,
        positioning: manifest.positioning,
        copilotGuide: manifest.copilotGuide,
        capabilities: manifest.capabilities.map((capability) => ({
            id: capability.id,
            pillar: capability.pillar,
            name: capability.name,
            maturity: capability.maturity,
            buyerValue: capability.buyerValue,
            copilotNextActions: capability.copilotNextActions,
            hardeningFocus: capability.hardeningFocus,
        })),
        canonicalDemos: manifest.canonicalDemos,
        readinessChecks: manifest.readinessChecks,
    });
}));

// GET /api/settings
router.get("/settings", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const data = await platformSettingsService.getGlobalSettings();
    if (!data) {
        return res.json({
            maintenanceMode: false, logRetentionDays: 30, emailNotifications: true,
            slackNotifications: false, systemTimezone: 'UTC', executionHistoryLimit: '1000',
            emailRecipients: '', requireMFA: false,
            smtp: { enabled: false, host: '', port: 587, secure: false, user: '', from: '', smtpPasswordConfigured: false },
        });
    }
    const smtpRaw = data.smtp || { enabled: false, host: '', port: 587, secure: false, user: '', pass: '', from: '' };
    const { pass: _smtpPass, ...smtpPublic } = smtpRaw;
    res.json({
        maintenanceMode: data.maintenanceMode || false,
        logRetentionDays: data.logRetentionDays || 30,
        emailNotifications: data.emailNotifications ?? true,
        slackNotifications: data.slackNotifications || false,
        systemTimezone: data.systemTimezone || 'UTC',
        executionHistoryLimit: data.executionHistoryLimit || '1000',
        emailRecipients: data.emailRecipients || '',
        requireMFA: data.requireMFA || false,
        smtp: { ...smtpPublic, smtpPasswordConfigured: !!smtpRaw.pass },
        systemAiDefaults: data.systemAiDefaults || {},
        governorSettings: data.governorSettings || { enabled: false, mode: 'OFF' },
    });
}));

// PUT /api/settings
//
// The global row is shared by every tenant: SMTP server and credentials,
// maintenance mode, the MFA requirement, governor and AI defaults. `isAdmin`
// is true for any org admin (and any org API key), so gating on it let one
// tenant's admin reroute every tenant's mail or switch MFA off platform-wide.
// Org-level settings are /api/org-settings.
router.put("/settings", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req.session as any)?.userId;
    if (!userId) throw new UnauthorizedError("Not authenticated");
    const settingsOrgContext = await getUserOrgContext(req);
    if (!settingsOrgContext.isSuperAdmin) {
        throw new ForbiddenError("Platform settings can only be modified by a super admin");
    }

    const existing = await platformSettingsService.getGlobalSettings();
    const existingSmtpPass = existing?.smtp?.pass ?? '';
    const incomingSmtp = req.body.smtp || {};
    const settingsData = {
        maintenanceMode: req.body.maintenanceMode || false,
        logRetentionDays: req.body.logRetentionDays || 30,
        emailNotifications: req.body.emailNotifications ?? true,
        slackNotifications: req.body.slackNotifications || false,
        systemTimezone: req.body.systemTimezone || 'UTC',
        executionHistoryLimit: req.body.executionHistoryLimit || '1000',
        emailRecipients: req.body.emailRecipients || '',
        requireMFA: req.body.requireMFA || false,
        smtp: { ...incomingSmtp, pass: incomingSmtp.pass || existingSmtpPass },
        systemAiDefaults: req.body.systemAiDefaults || {},
        governorSettings: req.body.governorSettings || { enabled: false, mode: 'OFF' },
    };
    const saved = await platformSettingsService.saveGlobalSettings(settingsData, userId);
    const { pass: _p, ...safeSmtp } = saved.smtp ?? {};
    res.json({ ...saved, smtp: safeSmtp });
}));

// GET /api/settings/browser-notifications
// Per-user browser notification preferences for decision approvals (Requirements 6.1, 6.5, 6.6, 6.7)
router.get("/settings/browser-notifications", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req.session as any)?.userId;
    if (!userId) throw new UnauthorizedError("Not authenticated");

    const data = await platformSettingsService.getBrowserNotificationPreferences(String(userId));

    if (!data) {
        // Return defaults: disabled, high-risk only
        return res.json({
            browserNotificationsEnabled: false,
            browserNotificationRiskLevels: ['high'],
        });
    }

    res.json({
        browserNotificationsEnabled: data.browserNotificationsEnabled ?? false,
        browserNotificationRiskLevels: data.browserNotificationRiskLevels ?? ['high'],
    });
}));

// PUT /api/settings/browser-notifications
router.put("/settings/browser-notifications", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req.session as any)?.userId;
    if (!userId) throw new UnauthorizedError("Not authenticated");

    const { browserNotificationsEnabled, browserNotificationRiskLevels } = req.body;

    // Validate risk levels
    const validLevels = ['low', 'medium', 'high'];
    const levels = Array.isArray(browserNotificationRiskLevels)
        ? browserNotificationRiskLevels.filter((l: string) => validLevels.includes(l))
        : ['high'];

    const settingsData = {
        browserNotificationsEnabled: !!browserNotificationsEnabled,
        browserNotificationRiskLevels: levels.length > 0 ? levels : ['high'],
    };

    await platformSettingsService.saveBrowserNotificationPreferences(String(userId), settingsData);
    res.json(settingsData);
}));

// POST /api/execute
//
// Runs arbitrary Python in the shared consumer service, whose only defence is
// a keyword denylist around exec(). That is platform-level code execution, so
// it is a super-admin capability — `isAdmin` admitted every org admin and
// every org API key.
router.post("/execute", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const executeOrgContext = await getUserOrgContext(req);
    if (!executeOrgContext.isSuperAdmin) {
        void logSecurityEvent(req, "script_execution_denied", { userId: executeOrgContext.userId }).catch(() => {});
        throw new ForbiddenError("Script execution is restricted to super admins");
    }
    const { script, input_data } = req.body;
    if (!script) {
        throw new BadRequestError("Missing script");
    }

    const { pythonBridge } = await import("@domain/integrations/core/gateway/python.gateway.js");
    const result = await pythonBridge.executeScript(script, input_data || {});

    res.json({ result });
}));

export function registerSystemRoutes(app: any) {
    app.use("/api", router);
}

