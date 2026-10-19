import { Express } from "express";
import {
    registerJobRoutes,
    pipelineRouter,
    pipelineSuggestionsRouter,
    registerScheduleRoutes,
    registerJobTestRoutes,
    registerTemplateRoutes,
    registerAgentChatRoutes,
    registerAgentDeploymentRoutes,
    registerSystemRoutes,
    registerEventRoutes,
    registerApprovalsRoutes,
    registerDecisionStreamRoutes,
    registerLicensingRoutes,
    credentialsRouter,
    settingsRouter,
    approvalExecutionRouter,
} from "../index.js";
import publicRouter from "../public.js";
import orgModelRouter from "../../domain/ai/org-model.route.js";
import { requireLicense } from "../../middleware/licensing.js";

export function registerCoreRoutes(app: Express) {
    // Auth routes are registered first in routes.ts before domain hubs.

    // --- Operational Routes (License Required) ---
    app.use("/api/jobs", requireLicense);
    app.use("/api/pipelines", requireLicense);
    app.use("/api/templates", requireLicense);
    app.use("/api/agents", requireLicense);
    app.use("/api/agent/chat", requireLicense);

    // --- Jobs ---
    registerJobRoutes(app);
    registerJobTestRoutes(app);

    // --- Pipelines ---
    app.use("/api", pipelineRouter);
    app.use("/api", pipelineSuggestionsRouter);
    registerTemplateRoutes(app);
    registerAgentChatRoutes(app);
    registerAgentDeploymentRoutes(app);

    // --- Authentication & System (auth routes registered first in routes.ts) ---
    app.use("/api/credentials", credentialsRouter);
    app.use("/api/org-model", orgModelRouter);
    app.use("/api", settingsRouter);
    registerSystemRoutes(app);
    registerEventRoutes(app);
    app.use("/api/public", publicRouter);

    // --- Approvals (Decision Inbox) ---
    registerApprovalsRoutes(app);
    app.use("/api/approvals", approvalExecutionRouter);

    // --- Decision Stream (SSE) ---
    registerDecisionStreamRoutes(app);

    // --- Schedules ---
    registerScheduleRoutes(app);

    // --- Licensing ---
    registerLicensingRoutes(app);
}

