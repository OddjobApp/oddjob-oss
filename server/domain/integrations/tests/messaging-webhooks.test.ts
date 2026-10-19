import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import { registerMessagingWebhooks } from "../../../routes/messaging-webhooks.js";
import { conversationalBridgeService } from "../conversational-bridge.service.js";

// Mock conversationalBridgeService
vi.mock("../conversational-bridge.service.js", () => ({
    conversationalBridgeService: {
        handleInboundMessage: vi.fn().mockResolvedValue(undefined)
    }
}));

describe("Messaging Webhooks Route Handler", () => {
    let app: express.Express;

    beforeEach(() => {
        app = express();
        app.use(express.json());
        app.use(express.urlencoded({ extended: true }));
        registerMessagingWebhooks(app);
        vi.clearAllMocks();
    });

    it("should parse Twilio WhatsApp webhooks and route to conversationalBridge", async () => {
        const response = await request(app)
            .post("/api/webhooks/messaging/whatsapp")
            .send("From=whatsapp%3A%2B14155238886&Body=Run+deployment+1");

        expect(response.status).toBe(200);
        expect(response.text).toContain("<Response></Response>");
        expect(conversationalBridgeService.handleInboundMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                platform: "whatsapp",
                channelId: "+14155238886",
                userId: "+14155238886",
                text: "Run deployment 1"
            })
        );
    });

    it("should parse Telegram webhooks and route to conversationalBridge", async () => {
        const payload = {
            message: {
                chat: { id: 987654321 },
                from: { id: 123456, username: "testuser" },
                text: "Hello Oddjob!"
            }
        };

        const response = await request(app)
            .post("/api/webhooks/messaging/telegram")
            .send(payload);

        expect(response.status).toBe(200);
        expect(conversationalBridgeService.handleInboundMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                platform: "telegram",
                channelId: "987654321",
                userId: "123456",
                text: "Hello Oddjob!"
            })
        );
    });
});
