
import { Router, type Request, type Response } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { asyncHandler } from "../../../middleware/error-handler.js";
import { webhookService } from "../core/webhook.service.js";
import { createLogger } from "../../../utils/logger.js";
import { cycleDependencyGatewayService } from "../../mission/core/cycle-dependency-gateway.service.js";
import { channelGateway } from "../core/channel-gateway.service.js";
import { DiscordAdapter } from "../core/discord.adapter.js";
import { TeamsAdapter } from "../core/teams.adapter.js";
import { SlackAdapter } from "../core/slack.adapter.js";

const logger = createLogger("IntegrationsWebhooksRouter");
const router = Router();

// ---------------------------------------------------------------------------
// Register channel gateway adapters (idempotent — only runs on first import)
// ---------------------------------------------------------------------------
if (!channelGateway.has('discord')) {
    const discordAdapter = new DiscordAdapter();
    discordAdapter.initialize?.().catch(err =>
        logger.warn(`[Webhooks] Discord adapter init failed: ${err.message}`)
    );
    channelGateway.register(discordAdapter);
}

if (!channelGateway.has('teams')) {
    const teamsAdapterInstance = new TeamsAdapter();
    teamsAdapterInstance.initialize?.().catch(err =>
        logger.warn(`[Webhooks] Teams adapter init failed: ${err.message}`)
    );
    channelGateway.register(teamsAdapterInstance);
}

if (!channelGateway.has('slack')) {
    const slackAdapterInstance = new SlackAdapter();
    slackAdapterInstance.initialize?.().catch(err =>
        logger.warn(`[Webhooks] Slack adapter init failed: ${err.message}`)
    );
    channelGateway.register(slackAdapterInstance);
}


// --- Webhook Trigger: Pipeline ---
router.post("/trigger/pipeline/:id", asyncHandler(async (req: Request, res: Response) => {
    const pipelineId = parseInt(req.params.id);
    const apiKey = (req.headers['x-api-key'] as string) || (req.query.apiKey as string);

    // We pass (req as any).rawBody if available, which should be set by express.json({ verify: ... }) in app.ts
    // or we fall back to undefined, which the service handles (with limitations)
    const rawBody = (req as any).rawBody;

    const result = await webhookService.verifyAndTriggerPipeline(pipelineId, req.headers, req.body, rawBody, apiKey);

    if (result.success) {
        res.json({
            success: true,
            executionId: result.executionId,
            message: "Pipeline execution started successfully"
        });
    } else {
        res.status(500).json({
            success: false,
            error: result.error,
            message: "Pipeline execution failed"
        });
    }
}));

// --- Webhook Trigger: Scheduled Job ---
router.post("/trigger/scheduled-job/:id", asyncHandler(async (req: Request, res: Response) => {
    const scheduledJobId = parseInt(req.params.id);
    const apiKey = (req.headers['x-api-key'] as string) || (req.query.apiKey as string);

    const result = await webhookService.triggerScheduledJob(scheduledJobId, req.headers, req.body, apiKey);

    res.json({
        success: result.success,
        message: result.success ? "Scheduled job execution triggered successfully" : "Scheduled job execution failed",
        jobId: result.jobId,
        jobName: result.jobName,
        output: result.output,
        error: result.error,
        status: result.status
    });
}));

// --- Webhook Trigger: Mission (Quick Win) ---
router.post("/trigger/mission/:id", asyncHandler(async (req: Request, res: Response) => {
    const missionId = parseInt(req.params.id);
    const apiKey = (req.headers['x-api-key'] as string) || (req.query.apiKey as string);

    const result = await webhookService.triggerMission(missionId, req.headers, req.body, apiKey);

    if (result.success) {
        res.json({
            success: true,
            message: "Mission launched successfully",
            missionId: result.missionId,
            missionRunId: result.missionRunId,
            executionId: result.executionId,
        });
    } else {
        res.status(400).json({
            success: false,
            error: result.error,
            message: result.message || "Mission launch failed"
        });
    }
}));

function verifyGitHubSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret) {
        logger.warn("[Webhooks] GITHUB_WEBHOOK_SECRET not set — skipping signature verification");
        return true; // permissive if unconfigured; set the env var in production
    }
    if (!signatureHeader) return false;
    const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
    try {
        return timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
    } catch {
        return false;
    }
}

function verifyJiraSecret(tokenHeader: string | undefined): boolean {
    const secret = process.env.JIRA_WEBHOOK_SECRET;
    if (!secret) {
        logger.warn("[Webhooks] JIRA_WEBHOOK_SECRET not set — skipping token verification");
        return true;
    }
    if (!tokenHeader) return false;
    try {
        return timingSafeEqual(Buffer.from(tokenHeader), Buffer.from(secret));
    } catch {
        return false;
    }
}

// --- Inbound Webhook Gateway: Jira ---
router.post("/jira", asyncHandler(async (req: Request, res: Response) => {
    const rawBody: Buffer = (req as any).rawBody;
    if (!verifyJiraSecret(req.headers['x-atlassian-token'] as string | undefined)) {
        logger.warn("[Webhooks] Jira webhook rejected — invalid token");
        return res.status(401).json({ error: "Invalid webhook token" });
    }

    const issueKey = req.body.issue?.key ?? "unknown";
    const eventType = req.body.webhookEvent ?? "unknown";
    logger.info(`[Webhooks] Jira webhook received: event=${eventType} issue=${issueKey}`);

    const payload = {
        transition: {
            to: req.body.transition?.to_status || req.body.issue?.fields?.status?.name
        },
        issue: {
            type: req.body.issue?.fields?.issuetype?.name || req.body.issue?.fields?.issueType?.name
        }
    };

    await cycleDependencyGatewayService.triggerWebhook("jira", payload);

    const { eventStream } = await import("../../core/infrastructure/event-stream.service.js");
    await eventStream.publish("jira.webhook", req.body, { organizationId: null }, "jira-webhook");

    res.json({ success: true, message: "Webhook processed and dispatched" });
}));

// --- Inbound Webhook Gateway: GitHub ---
router.post("/github", asyncHandler(async (req: Request, res: Response) => {
    const rawBody: Buffer = (req as any).rawBody;
    if (!verifyGitHubSignature(rawBody, req.headers['x-hub-signature-256'] as string | undefined)) {
        logger.warn("[Webhooks] GitHub webhook rejected — invalid signature");
        return res.status(401).json({ error: "Invalid webhook signature" });
    }

    const eventType = req.headers['x-github-event'] ?? "unknown";
    const repo = req.body.repository?.full_name ?? "unknown";
    logger.info(`[Webhooks] GitHub webhook received: event=${eventType} repo=${repo}`);

    const payload = {
        pull_request: {
            merged: req.body.pull_request?.merged || false,
            base: { ref: req.body.pull_request?.base?.ref }
        },
        target_branch: req.body.pull_request?.base?.ref || req.body.ref?.replace('refs/heads/', '')
    };

    await cycleDependencyGatewayService.triggerWebhook("github", payload);

    const { eventStream } = await import("../../core/infrastructure/event-stream.service.js");
    await eventStream.publish("github.webhook", req.body, { organizationId: null }, "github-webhook");

    res.json({ success: true, message: "Webhook processed and dispatched" });
}));

// --- Inbound Webhook Gateway: Discord ---
// Discord requires HTTPS and a valid Ed25519 signature on every interaction.
// On first connection Discord sends a PING (type: 1) which must be ACK'd with type: 1.
router.post("/discord", asyncHandler(async (req: Request, res: Response) => {
    // Discord PING challenge — must respond immediately with { type: 1 }
    if (req.body?.type === 1) {
        return res.json({ type: 1 });
    }

    const rawBody: string = (req as any).rawBody?.toString?.() ?? JSON.stringify(req.body);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headers[k] = v;
    }

    const result = await channelGateway.handleWebhook('discord', headers, rawBody, req.body);

    if (!result) {
        // Adapter ignored the event (bot message, duplicate, etc.)
        return res.status(204).send();
    }

    logger.info(`[Webhooks] Discord interaction dispatched: intent=${result.intent} executionId=${result.executionId ?? 'none'}`);

    // Discord interactions require an immediate HTTP response
    res.json({
        type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
        data: { content: result.summary },
    });
}));

// --- Inbound Webhook Gateway: Microsoft Teams ---
// Teams uses the Bot Framework Activity schema and Bearer JWT auth.
// Activities are forwarded to ChannelGatewayService which dispatches to the right handler.
router.post("/teams", asyncHandler(async (req: Request, res: Response) => {
    const rawBody: string = (req as any).rawBody?.toString?.() ?? JSON.stringify(req.body);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headers[k] = v;
    }

    const result = await channelGateway.handleWebhook('teams', headers, rawBody, req.body);

    if (!result) {
        // Non-message activity (typing indicator, conversationUpdate, etc.)
        return res.status(202).send();
    }

    logger.info(`[Webhooks] Teams activity dispatched: intent=${result.intent} executionId=${result.executionId ?? 'none'}`);

    // Bot Framework expects a simple 200 OK for message activities
    res.json({ success: true, summary: result.summary });
}));

// --- Inbound Webhook Gateway: QuickBooks Online ---
// Intuit signs deliveries with `intuit-signature` = base64 HMAC-SHA256 of the
// raw body keyed by the app's webhook verifier token. Notifications carry
// entity ids only; refreshes fetch the record through the connector's token.
router.post("/quickbooks", asyncHandler(async (req: Request, res: Response) => {
    if (!process.env.QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN) {
        logger.error("[Webhooks] QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN is not configured — rejecting delivery");
        return res.status(503).json({ error: "QuickBooks webhooks are not configured" });
    }

    const rawBody: Buffer | undefined = (req as any).rawBody;
    const { verifyQuickBooksSignature, parseQuickBooksNotifications, handleQuickBooksWebhook } =
        await import("../quickbooks/webhooks.js");

    if (!verifyQuickBooksSignature(rawBody, req.headers['intuit-signature'] as string | undefined)) {
        logger.warn("[Webhooks] QuickBooks webhook rejected — invalid signature");
        return res.status(401).json({ error: "Invalid webhook signature" });
    }

    const notifications = parseQuickBooksNotifications(req.body);
    logger.info(`[Webhooks] QuickBooks webhook received: ${notifications.length} entity change(s)`);

    // Acknowledge before refreshing. Each change is a QuickBooks API round
    // trip, and Intuit retries (then disables) an endpoint that answers
    // slowly. A missed refresh is recovered by the next CDC sync (scheduled
    // when the connector has an enabled sync config, or "Sync now").
    // Always 200 once the signature verified — unknown realms and bad entity
    // shapes must not put the endpoint into Intuit's retry/disable path.
    res.json({ success: true, received: notifications.length });
    void handleQuickBooksWebhook(notifications)
        .then(result => logger.info(`[Webhooks] QuickBooks webhook processed: ${result.processed} refreshed, ${result.skipped} skipped`))
        .catch((err: any) => logger.error(`[Webhooks] QuickBooks webhook processing failed: ${err.message}`));
}));

// --- Inbound Webhook Gateway: Slack ---
router.post("/slack", asyncHandler(async (req: Request, res: Response) => {
    // Slack URL verification challenge
    if (req.body?.type === "url_verification") {
        return res.json({ challenge: req.body.challenge });
    }

    const rawBody: string = (req as any).rawBody?.toString?.() ?? JSON.stringify(req.body);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headers[k] = v;
    }

    const result = await channelGateway.handleWebhook('slack', headers, rawBody, req.body);

    if (!result) {
        return res.status(200).send();
    }

    logger.info(`[Webhooks] Slack event dispatched: intent=${result.intent} executionId=${result.executionId ?? 'none'}`);

    res.json({ success: true, summary: result.summary });
}));

export function registerWebhookRoutes(app: any) {
    app.use("/api/webhook", router);
}

export default router;


