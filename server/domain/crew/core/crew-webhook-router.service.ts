import crypto from "crypto";

/**
 * CREW webhook payload formatting and signing.
 *
 * SENDS NOTHING. This builds and HMAC-signs the body for a subscription; actually
 * delivering it is not implemented and there is no caller. The previous doc comment
 * said it "emits ... to external endpoints", which it has never done.
 *
 * Before wiring delivery, three things here are not production-ready:
 *   - subscriptions live in an in-process Map, so they vanish on restart and are
 *     invisible to the worker fleet. They need a table.
 *   - `secret` is held in plaintext. It belongs in encrypted_credentials, like the
 *     signal-feed tokens.
 *   - `targetUrl` is caller-supplied, so delivery is an SSRF sink unless it is
 *     validated against an egress allowlist first (see registerSubscription).
 */

export type CrewEventType =
    | "crew.turn.interrupted"
    | "crew.contradiction.flagged"
    | "crew.consensus.reached"
    | "crew.decision.committed"
    | "crew.decision.reverted"
    | "crew.quorum.escalated";

export interface CrewEventPayload {
    eventId: string;
    eventType: CrewEventType;
    roomKey: string;
    cycleId?: number;
    projectKey?: string;
    authorAgentId?: string;
    summary: string;
    details?: Record<string, any>;
    timestamp: Date;
}

export interface WebhookSubscription {
    id: string;
    targetUrl: string;
    secret: string;
    subscribedEvents: CrewEventType[];
    format: "raw_json" | "slack_blockkit" | "discord_embed";
    isActive: boolean;
}

export class CrewWebhookRouterService {
    private subscriptions = new Map<string, WebhookSubscription>();

    public registerSubscription(sub: WebhookSubscription): void {
        CrewWebhookRouterService.assertDeliverableUrl(sub.targetUrl);
        this.subscriptions.set(sub.id, sub);
    }

    /**
     * Reject targets that would turn delivery into an SSRF primitive. Applied at
     * registration so a bad target cannot be stored and later fired by a worker
     * that has no idea where the URL came from.
     */
    public static assertDeliverableUrl(target: string): void {
        let url: URL;
        try {
            url = new URL(target);
        } catch {
            throw new Error("Webhook targetUrl is not a valid URL");
        }
        if (url.protocol !== "https:") {
            throw new Error("Webhook targetUrl must use https");
        }
        const host = url.hostname.toLowerCase();
        const isLoopback = host === "localhost" || host === "[::1]" || /^127\./.test(host);
        const isPrivateV4 =
            /^10\./.test(host) ||
            /^192\.168\./.test(host) ||
            /^169\.254\./.test(host) ||            // link-local, incl. cloud metadata
            /^172\.(1[6-9]|2\d|3[01])\./.test(host);
        const isPrivateV6 = host.startsWith("[fc") || host.startsWith("[fd") || host.startsWith("[fe80");
        if (isLoopback || isPrivateV4 || isPrivateV6) {
            throw new Error("Webhook targetUrl may not point at a private or loopback address");
        }
    }

    public removeSubscription(id: string): void {
        this.subscriptions.delete(id);
    }

    public listSubscriptions(): WebhookSubscription[] {
        return Array.from(this.subscriptions.values());
    }

    /**
     * Formats and signs an event payload for a specific subscription.
     */
    public formatEvent(payload: CrewEventPayload, sub: WebhookSubscription): { body: any; headers: Record<string, string> } {
        let body: any;

        if (sub.format === "slack_blockkit") {
            body = {
                blocks: [
                    {
                        type: "header",
                        text: { type: "plain_text", text: `⚡ CREW Event: ${payload.eventType}` },
                    },
                    {
                        type: "section",
                        text: { type: "mrkdwn", text: `*Room:* \`${payload.roomKey}\`\n*Summary:* ${payload.summary}` },
                    },
                ],
            };
        } else if (sub.format === "discord_embed") {
            body = {
                embeds: [
                    {
                        title: `CREW Event: ${payload.eventType}`,
                        description: payload.summary,
                        color: payload.eventType.includes("reverted") ? 0xff0000 : 0x00ffff,
                        fields: [
                            { name: "Room", value: payload.roomKey, inline: true },
                            { name: "Timestamp", value: payload.timestamp.toISOString(), inline: true },
                        ],
                    },
                ],
            };
        } else {
            body = payload;
        }

        // Sign timestamp + body, not the body alone. A signature over the body only
        // is valid forever, so anyone who captures one request can replay it
        // indefinitely. Receivers must reject a stale `t` (a few minutes' skew) and
        // compare with a constant-time equality check.
        const timestamp = Math.floor(payload.timestamp.getTime() / 1000);
        const serialized = JSON.stringify(body);
        const signature = crypto
            .createHmac("sha256", sub.secret)
            .update(`${timestamp}.${serialized}`)
            .digest("hex");

        return {
            body,
            headers: {
                "Content-Type": "application/json",
                "X-Oddjob-Timestamp": String(timestamp),
                "X-Oddjob-Signature": `t=${timestamp},v1=${signature}`,
                "X-Oddjob-Event": payload.eventType,
            },
        };
    }

    public clear(): void {
        this.subscriptions.clear();
    }
}

export const crewWebhookRouter = new CrewWebhookRouterService();
