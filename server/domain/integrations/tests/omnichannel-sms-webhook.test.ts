/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";
import crypto from "crypto";

const {
    mockResolveVerifiedIdentity,
    mockSendChannelMessage,
    mockGetTwilioConfig,
} = vi.hoisted(() => ({
    mockResolveVerifiedIdentity: vi.fn(),
    mockSendChannelMessage: vi.fn(async () => true),
    mockGetTwilioConfig: vi.fn(async () => null),
}));

// Keep the real normalizeChannelIdentifier + service shape; stub the two
// db/network-touching methods the webhook depends on.
vi.mock("../core/omnichannel.service.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../core/omnichannel.service.js")>();
    return {
        ...actual,
        omnichannelService: {
            ...actual.omnichannelService,
            resolveVerifiedIdentity: mockResolveVerifiedIdentity,
            sendChannelMessage: mockSendChannelMessage,
        },
    };
});

vi.mock("../conversational-bridge.service.js", () => ({
    conversationalBridgeService: {
        handleInboundMessage: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock("@domain/tools/v1/capabilities/twilio-helpers.js", () => ({
    getTwilioConfig: mockGetTwilioConfig,
    twilioRequest: vi.fn(async () => ({ sid: "SM_test" })),
}));

const { registerMessagingWebhooks } = await import("../../../routes/messaging-webhooks.js");
const { conversationalBridgeService } = await import("../conversational-bridge.service.js");

const AUTH_TOKEN = "test-twilio-auth-token";
const WEBHOOK_URL = "https://oddjob.test/api/webhooks/messaging/sms";

/** Reproduce Twilio's X-Twilio-Signature algorithm for the test fixture. */
function twilioSign(url: string, params: Record<string, string>, token: string): string {
    const data = Object.keys(params).sort().reduce((acc, key) => acc + key + params[key], url);
    return crypto.createHmac("sha1", token).update(data).digest("base64");
}

describe("Twilio inbound SMS webhook", () => {
    let app: express.Express;

    beforeEach(() => {
        app = express();
        app.use(express.json());
        app.use(express.urlencoded({ extended: true }));
        registerMessagingWebhooks(app);
        vi.clearAllMocks();
        mockResolveVerifiedIdentity.mockResolvedValue(null);
        mockSendChannelMessage.mockResolvedValue(true);
        vi.stubEnv("APP_URL", "https://oddjob.test");
        vi.stubEnv("TWILIO_AUTH_TOKEN", AUTH_TOKEN);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("rejects an unsigned request in production when a token is configured", async () => {
        vi.stubEnv("NODE_ENV", "production");

        const res = await request(app)
            .post("/api/webhooks/messaging/sms")
            .type("form")
            .send({ From: "+14155552671", Body: "status" });

        expect(res.status).toBe(401);
        expect(conversationalBridgeService.handleInboundMessage).not.toHaveBeenCalled();
        expect(mockSendChannelMessage).not.toHaveBeenCalled();
    });

    it("rejects a request with a wrong signature", async () => {
        vi.stubEnv("NODE_ENV", "production");

        const res = await request(app)
            .post("/api/webhooks/messaging/sms")
            .set("X-Twilio-Signature", "bogus")
            .type("form")
            .send({ From: "+14155552671", Body: "status" });

        expect(res.status).toBe(401);
    });

    it("replies with the not-linked message for an unpaired number", async () => {
        const params = { From: "+14155552671", Body: "hello oddjob" };
        const res = await request(app)
            .post("/api/webhooks/messaging/sms")
            .set("X-Twilio-Signature", twilioSign(WEBHOOK_URL, params, AUTH_TOKEN))
            .type("form")
            .send(params);

        expect(res.status).toBe(200);
        expect(res.text).toContain("<Response></Response>");
        expect(mockSendChannelMessage).toHaveBeenCalledWith(
            expect.objectContaining({ channelType: "sms", channelIdentifier: "+14155552671" }),
            expect.stringContaining("isn't linked"),
        );
        expect(conversationalBridgeService.handleInboundMessage).not.toHaveBeenCalled();
    });

    it("routes a verified sender into the conversational bridge as platform 'sms'", async () => {
        mockResolveVerifiedIdentity.mockResolvedValue({
            id: 9,
            organizationId: 3,
            userId: "user-42",
            channelType: "sms",
            channelIdentifier: "+14155552671",
            isVerified: true,
        });

        const params = { From: "+14155552671", Body: "run the report" };
        const res = await request(app)
            .post("/api/webhooks/messaging/sms")
            .set("X-Twilio-Signature", twilioSign(WEBHOOK_URL, params, AUTH_TOKEN))
            .type("form")
            .send(params);

        expect(res.status).toBe(200);
        expect(conversationalBridgeService.handleInboundMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                platform: "sms",
                channelId: "+14155552671",
                userId: "user-42",
                text: "run the report",
            }),
        );
    });

    it("serves the same handler on the documented /api/channels/twilio/inbound-sms path", async () => {
        mockResolveVerifiedIdentity.mockResolvedValue({
            id: 9,
            organizationId: 3,
            userId: "user-42",
            channelType: "sms",
            channelIdentifier: "+14155552671",
            isVerified: true,
        });

        const params = { From: "+14155552671", Body: "status" };
        const res = await request(app)
            .post("/api/channels/twilio/inbound-sms")
            .set("X-Twilio-Signature", twilioSign(
                "https://oddjob.test/api/channels/twilio/inbound-sms", params, AUTH_TOKEN))
            .type("form")
            .send(params);

        expect(res.status).toBe(200);
        expect(conversationalBridgeService.handleInboundMessage).toHaveBeenCalledWith(
            expect.objectContaining({ platform: "sms", userId: "user-42" }),
        );
    });

    it("allows unsigned requests in development when no token can be resolved", async () => {
        vi.stubEnv("TWILIO_AUTH_TOKEN", "");
        mockGetTwilioConfig.mockResolvedValue(null);

        const res = await request(app)
            .post("/api/webhooks/messaging/sms")
            .type("form")
            .send({ From: "+14155552671", Body: "hello" });

        expect(res.status).toBe(200);
        expect(mockSendChannelMessage).toHaveBeenCalled();
    });
});
