import { Express } from "express";
import {
    registerExternalRoutes,
    registerWebhookRoutes,
    registerGmailRoutes,
    saasRouter,
    seleniumRouter,
    formAgentsRouter,
} from "../index.js";
import mcpRouter from "../mcp.js";
import { registerMessagingWebhooks } from "../messaging-webhooks.js";

export async function registerIntegrationRoutes(app: Express) {
    // --- External / Webhooks ---
    registerExternalRoutes(app);
    registerWebhookRoutes(app);
    registerMessagingWebhooks(app);

    // --- SaaS & Tools ---
    app.use("/api/saas", saasRouter);
    app.use("/api/selenium", seleniumRouter);
    app.use("/api/form-agents", formAgentsRouter);
    registerGmailRoutes(app);

    // --- MCP Protocol ---
    app.use("/api/mcp", mcpRouter);

    // --- Jira Oversight ---
    const { default: jiraRouter } = await import("../../domain/integrations/routes/jira.js");
    app.use("/api/integrations/jira", jiraRouter);

    // --- AgentMail (inbound email + HIL reply processing) ---
    const { default: orgAgentMailRouter } = await import("../../domain/integrations/routes/org-agentmail.js");
    app.use("/api/integrations/agentmail", orgAgentMailRouter);
    app.use("/api/agentmail", orgAgentMailRouter);
    const { default: agentMailRouter } = await import("../../domain/integrations/routes/agentmail.js");
    // The global JSON parser already captures rawBody; do not consume an ended stream here.
    app.use("/api/integrations/agentmail", agentMailRouter);

    // --- Trycua computer-use sessions ---
    const { default: trycuaRouter } = await import("../../domain/integrations/routes/trycua.js");
    app.use("/api/integrations/trycua", trycuaRouter);

    // --- Slack Integration (OAuth, events, commands, notifications) ---
    const { default: slackRouter } = await import("../integrations/slack/index.js");
    app.use("/api/integrations/slack", slackRouter);

    const { default: reliabilityRouter } = await import("../../domain/integrations/routes/reliability.js");
    app.use("/api/integrations/reliability", reliabilityRouter);

    // --- Governed HTTP Connector (external queries, live weather/market data) ---
    const { default: httpConnectorRouter } = await import("../../domain/integrations/routes/http-connector.js");
    app.use("/api/integrations/http-connector", httpConnectorRouter);

    // --- Omnichannel identity pairing (SMS/WhatsApp/Telegram → Oddjob user) ---
    const { default: omnichannelChannelsRouter } = await import("../channels/omnichannel.js");
    app.use("/api/channels", omnichannelChannelsRouter);

    // --- Mobile HIL solver links: token-signed page + submit, no session ---
    const { hilSolverPageRouter, hilSolverApiRouter } = await import("../../domain/integrations/routes/hil-solver.js");
    app.use("/hil", hilSolverPageRouter);
    app.use("/api/hil", hilSolverApiRouter);
}

