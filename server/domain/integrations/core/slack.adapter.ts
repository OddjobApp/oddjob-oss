import { createHmac } from "crypto";
import { createLogger } from "@server/utils/logger.js";
import type {
    ChannelAdapter,
    ChannelMessage,
    ChannelResponse,
    ChannelPlatform,
} from "./channel-gateway.types.js";

const logger = createLogger("SlackAdapter");
const SLACK_API_BASE = "https://slack.com/api";

export class SlackAdapter implements ChannelAdapter {
    readonly platformId: ChannelPlatform = "slack";
    private readonly botToken: string;
    private readonly signingSecret: string;

    constructor(
        botToken = process.env.SLACK_BOT_TOKEN ?? "",
        signingSecret = process.env.SLACK_SIGNING_SECRET ?? ""
    ) {
        this.botToken = botToken;
        this.signingSecret = signingSecret;
    }

    async initialize(): Promise<void> {
        if (!this.botToken) {
            logger.warn("[SlackAdapter] SLACK_BOT_TOKEN is not set — running in stub mode.");
            return;
        }
        logger.info("[SlackAdapter] Initialized (bot token present).");
    }

    async destroy(): Promise<void> {
        logger.info("[SlackAdapter] Destroyed.");
    }

    verifyWebhook(headers: Record<string, string>, rawBody: string): boolean {
        const signature = headers["x-slack-signature"];
        const timestamp = headers["x-slack-request-timestamp"];

        if (!signature || !timestamp) {
            throw new Error("[SlackAdapter] Missing Slack signature headers.");
        }

        // Check timestamp age (within 5 minutes)
        const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;
        if (parseInt(timestamp) < fiveMinutesAgo) {
            throw new Error("[SlackAdapter] Replay attack suspected: request timestamp too old.");
        }

        if (!this.signingSecret) {
            logger.warn("[SlackAdapter] No SLACK_SIGNING_SECRET set — skipping signature verification.");
            return true;
        }

        const sigBaseString = `v0:${timestamp}:${rawBody}`;
        const hmac = createHmac("sha256", this.signingSecret);
        const mySignature = `v0=${hmac.update(sigBaseString).digest("hex")}`;

        if (signature !== mySignature) {
            throw new Error("[SlackAdapter] Signature mismatch.");
        }

        return true;
    }

    parseInbound(payload: unknown): ChannelMessage | null {
        const p = payload as any;

        if (p?.type === "url_verification") {
            return null;
        }

        const event = p?.event;
        if (!event) return null;

        if (event.bot_id || event.bot_profile || event.subtype === "bot_message") return null;

        const userId = event.user ?? "unknown";
        const channelId = event.channel ?? "unknown";
        const text = (event.text ?? "").replace(/<@.*?>/gi, "").trim();

        if (!text) return null;

        return {
            id: p?.event_id ?? `slack-${Date.now()}`,
            platform: "slack",
            channelId,
            threadId: event.thread_ts || event.ts,
            senderId: userId,
            text,
            raw: payload,
            timestamp: event.event_ts ? new Date(parseFloat(event.event_ts) * 1000) : new Date(),
        };
    }

    async sendResponse(response: ChannelResponse): Promise<void> {
        if (!this.botToken) {
            logger.warn(`[SlackAdapter] Stub send to channel ${response.channelId}: ${response.text}`);
            return;
        }

        const body: Record<string, any> = {
            channel: response.channelId,
            text: response.text,
        };

        if (response.threadId) {
            body["thread_ts"] = response.threadId;
        }

        if (response.richContent) {
            body["blocks"] = response.richContent;
        }

        try {
            const res = await fetch(`${SLACK_API_BASE}/chat.postMessage`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${this.botToken}`,
                    "Content-Type": "application/json; charset=utf-8",
                },
                body: JSON.stringify(body),
            });

            const data = await res.json();
            if (!data.ok) {
                logger.error(`[SlackAdapter] Failed to send message: ${data.error}`);
            } else {
                logger.debug(`[SlackAdapter] Message sent to channel ${response.channelId}`);
            }
        } catch (err: any) {
            logger.error(`[SlackAdapter] Network error: ${err.message}`);
        }
    }
}

export const slackAdapter = new SlackAdapter();
