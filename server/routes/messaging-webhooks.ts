
import { Router, Request, Response } from "express";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { MoltProducer } from "@domain/governor/index.js";
import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { missionRuns } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import crypto from "crypto";

const logger = createLogger("MessagingWebhooks");
const router = Router();

/**
 * Verify Slack Signature
 * Uses the shared verification logic from slack-auth.middleware
 */
function verifySlackSignature(req: Request): boolean {
    const signature = req.headers['x-slack-signature'] as string;
    const timestamp = req.headers['x-slack-request-timestamp'] as string;
    const rawBody = (req as any).rawBody;

    if (!signature || !timestamp) {
        logger.warn("Slack signature verification failed: Missing headers");
        return false;
    }

    if (!rawBody) {
        logger.error("Slack signature verification failed: No rawBody available - ensure body parser verify function is configured");
        return false;
    }

    // In production, fail if secret is not configured
    if (!process.env.SLACK_SIGNING_SECRET) {
        if (process.env.NODE_ENV === 'production') {
            logger.error("SLACK_SIGNING_SECRET not set in production - rejecting request");
            return false;
        }
        logger.warn("SLACK_SIGNING_SECRET not set, skipping verification (development mode only)");
        return true;
    }

    // Check for replay attacks (5 minute window)
    const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;
    if (parseInt(timestamp) < fiveMinutesAgo) {
        logger.warn(`Slack signature timestamp rejected: ${timestamp} (too old)`);
        return false;
    }

    const sigBaseString = `v0:${timestamp}:${rawBody.toString('utf8')}`;
    const mySignature = 'v0=' + crypto
        .createHmac('sha256', process.env.SLACK_SIGNING_SECRET)
        .update(sigBaseString)
        .digest('hex');

    try {
        return crypto.timingSafeEqual(Buffer.from(mySignature), Buffer.from(signature));
    } catch (err) {
        return false;
    }
}

/**
 * Slack Interactivity Webhook
 */
router.post("/slack/interactivity", asyncHandler(async (req: Request, res: Response) => {
    // Verify signature in production
    if (process.env.NODE_ENV === 'production' || process.env.SLACK_SIGNING_SECRET) {
        if (!verifySlackSignature(req)) {
            logger.warn("Rejected Slack request with invalid signature");
            return res.status(401).send("Invalid signature");
        }
    }

    // Slack sends payload in form-encoded field 'payload'
    const payloadStr = req.body.payload;
    if (!payloadStr) {
        return res.status(400).send("Missing payload");
    }

    const payload = JSON.parse(payloadStr);
    const actions = payload.actions || [];
    const action = actions[0];

    if (!action) {
        return res.status(200).send();
    }

    // Identify action: molt_approve_SESSIONID or molt_reject_SESSIONID
    const [type, state, sessionId] = action.action_id.split(':');

    if (type === 'molt') {
        logger.info(`Slack Decision: ${state} for session ${sessionId}`);

        const producer = new MoltProducer(sessionId);
        try {
            await producer.publish("DECISION", {
                approved: state === 'approve',
                reason: `Slack ${state} by ${payload.user?.name || 'unknown'}`,
                proposalId: payload.message?.metadata?.event_payload?.proposalId || action.value,
                timestamp: Date.now(),
                source: 'slack'
            });

            // Update original message to show decision
            res.json({
                replace_original: true,
                text: payload.message.text + `\n\n*Decision:* ${state.toUpperCase()} by <@${payload.user.id}>`
            });
        } catch (err) {
            logger.error("Failed to publish Slack decision:", err);
            res.status(500).send("Error publishing decision");
        } finally {
            await producer.disconnect();
        }
    } else if (type === 'mission') {
        const runId = parseInt(sessionId);
        logger.info(`Slack Mission Action: ${state} for run ${runId}`);

        try {
            const { rollingWaveOrchestratorService } = await import("@domain/mission/core/rolling-wave-orchestrator.service.js");
            const { scheduleMissionWave } = await import("@domain/mission/infrastructure/rolling-wave-queue.js");

            if (state === 'approve') {
                await rollingWaveOrchestratorService.updatePhase(runId, 'PLANNING');
                
                // Get orgId/userId from run
                const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, runId)).limit(1);
                if (run) {
                    await scheduleMissionWave({ 
                        missionRunId: runId, 
                        userId: run.createdBy || 'system', 
                        orgId: run.organizationId 
                    });
                }

                res.json({
                    replace_original: true,
                    text: payload.message.text + `\n\n? **Approved:** Mission is resuming...`
                });
            } else {
                await db.update(missionRuns)
                    .set({ status: 'cancelled', updatedAt: new Date() })
                    .where(eq(missionRuns.id, runId));

                res.json({
                    replace_original: true,
                    text: payload.message.text + `\n\n? **Cancelled:** Mission has been stopped.`
                });
            }
        } catch (err: any) {
            logger.error("Failed to process Slack mission action:", err.message);
            res.status(500).send("Error processing mission action");
        }
    } else {
        res.status(200).send();
    }
}));

/**
 * Slack Events Webhook (App Mentions, DMs, etc.)
 */
router.post("/slack/events", asyncHandler(async (req: Request, res: Response) => {
    // 1. URL Verification Challenge
    if (req.body.type === 'url_verification') {
        return res.json({ challenge: req.body.challenge });
    }

    // 2. Verify signature in production
    if (process.env.NODE_ENV === 'production' || process.env.SLACK_SIGNING_SECRET) {
        if (!verifySlackSignature(req)) {
            logger.warn("Rejected Slack event with invalid signature");
            return res.status(401).send("Invalid signature");
        }
    }

    const { event } = req.body;
    if (!event) return res.status(200).send();

    // 3. Dispatch to Conversational Bridge
    // We respond 200 immediately to Slack to avoid retries, then process in background
    res.status(200).send();

    // Ignore bot messages to prevent loops
    if (event.bot_id || event.subtype === 'bot_message') return;

    try {
        const { conversationalBridgeService } = await import("@domain/integrations/conversational-bridge.service.js");
        
        if (event.type === 'app_mention' || (event.type === 'message' && event.channel_type === 'im')) {
            logger.info(`Received Slack command from user ${event.user} in channel ${event.channel}`);
            
            await conversationalBridgeService.handleInboundMessage({
                platform: 'slack',
                channelId: event.channel,
                userId: event.user,
                text: event.text || '',
                files: event.files, // Pass files if present
                threadTs: event.thread_ts || event.ts,
                timestamp: event.event_ts
            });
        }
    } catch (err: any) {
        logger.error("Failed to process Slack event:", err.message);
    }
}));

/**
 * MS Teams Interactivity Webhook (Outgoing Webhook or Bot endpoint)
 */
router.post("/teams/interactivity", asyncHandler(async (req: Request, res: Response) => {
    const payload = req.body;
    logger.info("Teams Interactivity Payload:", payload);

    // Adaptive Cards Submit actions
    const data = payload.value;
    if (data && data.type === 'molt') {
        const { state, sessionId, proposalId } = data;

        logger.info(`Teams Decision: ${state} for session ${sessionId}`);

        const producer = new MoltProducer(sessionId);
        try {
            await producer.publish("DECISION", {
                approved: state === 'approve',
                reason: `Teams ${state} by ${payload.from?.name || 'unknown'}`,
                proposalId: proposalId,
                timestamp: Date.now(),
                source: 'teams'
            });

            // Update card or respond with confirmation
            res.json({
                type: "message",
                text: `Decision **${state.toUpperCase()}** received and processed.`
            });
        } catch (err) {
            logger.error("Failed to publish Teams decision:", err);
            res.status(500).send("Error publishing decision");
        } finally {
            await producer.disconnect();
        }
    } else {
        res.status(200).send();
    }
}));

/**
 * WhatsApp Webhook (Twilio)
 */
router.post("/whatsapp", asyncHandler(async (req: Request, res: Response) => {
    const { From, Body } = req.body;
    logger.info(`Received WhatsApp message from ${From}: "${Body}"`);

    // Respond 200 to Twilio immediately
    res.status(200).send("<Response></Response>");

    if (!From || !Body) return;

    try {
        const { conversationalBridgeService } = await import("@domain/integrations/conversational-bridge.service.js");
        
        const channelId = From.replace("whatsapp:", "");
        await conversationalBridgeService.handleInboundMessage({
            platform: 'whatsapp',
            channelId: channelId,
            userId: channelId,
            text: Body,
            timestamp: new Date().toISOString()
        });
    } catch (err: any) {
        logger.error("Failed to process WhatsApp event:", err.message);
    }
}));

/**
 * The URL Twilio signed. Behind a reverse proxy `req.protocol`/`req.host`
 * describe the hop Twilio did NOT post to, so a configured public base URL
 * (APP_URL / PUBLIC_URL) wins; only fall back to the request's own origin.
 */
function twilioSignatureUrl(req: Request): string {
    const base = process.env.APP_URL
        || process.env.PUBLIC_URL
        || `${req.protocol}://${req.get('host')}`;
    return `${base.replace(/\/$/, '')}${req.originalUrl}`;
}

/**
 * Verify the X-Twilio-Signature header: a base64 HMAC-SHA1 (keyed by the
 * account auth token) over the full webhook URL with every POST parameter
 * appended as `name + value` in alphabetical order.
 */
function verifyTwilioSignature(req: Request, authToken: string): boolean {
    const signature = req.headers['x-twilio-signature'];
    if (!signature || typeof signature !== 'string') {
        return false;
    }

    const params: Record<string, string> =
        (req.body && typeof req.body === 'object') ? req.body : {};
    const data = Object.keys(params)
        .sort()
        .reduce((acc, key) => acc + key + params[key], twilioSignatureUrl(req));

    const expected = crypto
        .createHmac('sha1', authToken)
        .update(data)
        .digest('base64');

    try {
        return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
        return false;
    }
}

/**
 * Which auth token can verify this request? The global TWILIO_AUTH_TOKEN is
 * preferred; when it is absent, the sender's verified pairing row identifies
 * the org whose stored Twilio credential applies (per-tenant Twilio accounts).
 */
async function resolveTwilioAuthToken(identityOrgId: number | null): Promise<string | null> {
    if (process.env.TWILIO_AUTH_TOKEN) {
        return process.env.TWILIO_AUTH_TOKEN;
    }
    if (identityOrgId) {
        const { getTwilioConfig } = await import("@domain/tools/v1/capabilities/twilio-helpers.js");
        const config = await getTwilioConfig(identityOrgId);
        if (config?.authToken) {
            return config.authToken;
        }
    }
    return null;
}

/**
 * Twilio inbound SMS webhook.
 *
 * Mounted twice (see registerMessagingWebhooks): on this router as
 * POST /api/webhooks/messaging/sms, and on the proposal's documented ingress
 * path POST /api/channels/twilio/inbound-sms.
 *
 * The sender's verified pairing row is resolved BEFORE the signature check so
 * the per-org auth-token fallback has an org to resolve against.
 */
export async function handleTwilioInboundSms(req: Request, res: Response) {
    const { From, Body } = req.body ?? {};

    const omnichannelModule = await import("@domain/integrations/core/omnichannel.service.js");
    const { omnichannelService, normalizeChannelIdentifier } = omnichannelModule;
    const from = typeof From === 'string'
        ? normalizeChannelIdentifier('sms', From)
        : null;
    const identity = from
        ? await omnichannelService.resolveVerifiedIdentity('sms', from)
        : null;

    // Fail closed in production when there is no token to verify against —
    // same convention as verifySlackSignature above. A missing token in dev
    // warns and lets the request through so local Twilio-less testing works.
    const authToken = await resolveTwilioAuthToken(identity?.organizationId ?? null);
    if (!authToken) {
        if (process.env.NODE_ENV === 'production') {
            logger.error("No Twilio auth token available in production - rejecting inbound SMS");
            return res.status(401).send("Invalid signature");
        }
        logger.warn("No Twilio auth token configured, skipping signature verification (development mode only)");
    } else if (!verifyTwilioSignature(req, authToken)) {
        logger.warn("Rejected inbound SMS with invalid Twilio signature");
        return res.status(401).send("Invalid signature");
    }

    // Ack Twilio immediately with empty TwiML — it retries on slow/non-200
    // responses, and the bridge work below can take seconds.
    res.status(200).send("<Response></Response>");

    if (!from || typeof Body !== 'string' || !Body.trim()) return;

    try {
        if (!identity) {
            // Unpaired number: one courtesy SMS (never log bodies — a reply can
            // carry a code or approval). Uses env/global Twilio config since no
            // org has been resolved.
            await omnichannelService.sendChannelMessage(
                { channelType: 'sms', channelIdentifier: from },
                "Oddjob: this number isn't linked to an account. Link it in Settings → Mobile Channels.",
            );
            return;
        }

        const { conversationalBridgeService } = await import("@domain/integrations/conversational-bridge.service.js");
        await conversationalBridgeService.handleInboundMessage({
            platform: 'sms',
            channelId: from,
            // Verified pairing → this is already the Oddjob users.id, not a
            // platform id like Slack's Uxxxx. resolveUser handles it directly.
            userId: identity.userId,
            text: Body,
            timestamp: new Date().toISOString()
        });
    } catch (err: any) {
        logger.error("Failed to process inbound SMS:", err.message);
    }
}

/**
 * Telegram Webhook
 */
router.post("/telegram", asyncHandler(async (req: Request, res: Response) => {
    const { message } = req.body;
    
    // Respond 200 to Telegram immediately
    res.status(200).send();

    if (!message || !message.text) return;

    logger.info(`Received Telegram message from chat ${message.chat.id}: "${message.text}"`);

    try {
        const { conversationalBridgeService } = await import("@domain/integrations/conversational-bridge.service.js");

        await conversationalBridgeService.handleInboundMessage({
            platform: 'telegram',
            channelId: message.chat.id.toString(),
            userId: message.from?.id?.toString() || message.chat.id.toString(),
            text: message.text,
            timestamp: new Date().toISOString()
        });
    } catch (err: any) {
        logger.error("Failed to process Telegram event:", err.message);
    }
}));

/**
 * Inbound SMS Webhook (Twilio)
 */
router.post("/sms", asyncHandler(handleTwilioInboundSms));

// The proposal documents POST /api/channels/twilio/inbound-sms as the ingress
// path; it is the same handler, mounted a second time so existing Twilio
// console configurations and the documented path both work.
const twilioIngressRouter = Router();
twilioIngressRouter.post("/inbound-sms", asyncHandler(handleTwilioInboundSms));

export function registerMessagingWebhooks(app: any) {
    app.use("/api/webhooks/messaging", router);
    app.use("/api/channels/twilio", twilioIngressRouter);
}

