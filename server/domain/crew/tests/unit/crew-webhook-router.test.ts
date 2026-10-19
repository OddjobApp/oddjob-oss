import { createHmac } from "crypto";
import { describe, it, expect, beforeEach } from "vitest";
import { crewWebhookRouter, type WebhookSubscription } from "../../core/crew-webhook-router.service.js";

describe("CrewWebhookRouterService", () => {
    beforeEach(() => {
        crewWebhookRouter.clear();
    });

    it("registers webhook subscriptions and formats Slack BlockKit payloads with HMAC signatures", () => {
        const sub: WebhookSubscription = {
            id: "sub_slack",
            targetUrl: "https://hooks.slack.com/services/T00/B00/X00",
            secret: "whsec_test_secret_key_12345",
            subscribedEvents: ["crew.consensus.reached"],
            format: "slack_blockkit",
            isActive: true,
        };

        crewWebhookRouter.registerSubscription(sub);
        expect(crewWebhookRouter.listSubscriptions().length).toBe(1);

        const formatted = crewWebhookRouter.formatEvent(
            {
                eventId: "evt_123",
                eventType: "crew.consensus.reached",
                roomKey: "room-sprint-95",
                summary: "Quorum approved architecture RFC #42",
                timestamp: new Date("2026-08-20T12:00:00Z"),
            },
            sub
        );

        expect(formatted.headers["Content-Type"]).toBe("application/json");
        expect(formatted.body.blocks).toBeDefined();
        expect(formatted.body.blocks[0].text.text).toContain("crew.consensus.reached");

        // Signature must cover the timestamp, or a captured request replays forever.
        const ts = Math.floor(Date.parse("2026-08-20T12:00:00Z") / 1000);
        expect(formatted.headers["X-Oddjob-Timestamp"]).toBe(String(ts));
        expect(formatted.headers["X-Oddjob-Signature"]).toMatch(
            new RegExp(`^t=${ts},v1=[a-f0-9]{64}$`),
        );

        const expected = createHmac("sha256", sub.secret)
            .update(`${ts}.${JSON.stringify(formatted.body)}`)
            .digest("hex");
        expect(formatted.headers["X-Oddjob-Signature"]).toBe(`t=${ts},v1=${expected}`);
    });

    it("refuses webhook targets that would make delivery an SSRF primitive", () => {
        const base: Omit<WebhookSubscription, "targetUrl"> = {
            id: "sub_bad",
            secret: "whsec_test_secret_key_12345",
            subscribedEvents: ["crew.consensus.reached"],
            format: "raw_json",
            isActive: true,
        };

        for (const targetUrl of [
            "http://hooks.example.com/x",        // plaintext
            "https://localhost/x",
            "https://127.0.0.1/x",
            "https://10.0.0.5/x",
            "https://192.168.1.10/x",
            "https://169.254.169.254/latest/meta-data/", // cloud metadata
            "not-a-url",
        ]) {
            expect(() => crewWebhookRouter.registerSubscription({ ...base, targetUrl })).toThrow();
        }

        expect(crewWebhookRouter.listSubscriptions().length).toBe(0);
    });
});
