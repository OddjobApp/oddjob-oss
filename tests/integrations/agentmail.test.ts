import { describe, it, expect, beforeEach, vi } from "vitest";
import { agentMailService } from "@domain/integrations/core/agentmail.service.js";
import { db } from "@server/database_service.js";

describe("AgentMail Service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.AGENTMAIL_API_KEY = "test_key";
        process.env.AGENTMAIL_INBOX = "oddjobapp@agentmail.to";
    });

    describe("send", () => {
        it("should send an email with premium features (idempotency, labels)", async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: vi.fn().mockResolvedValue({ message_id: "msg_123", thread_id: "thread_456" }),
            });

            const result = await agentMailService.send({
                to: ["user@example.com"],
                subject: "Test Subject",
                text: "Test Body",
                labels: ["test", "premium"],
                client_id: "unique_id_456"
            });

            expect(result.message_id).toBe("msg_123");
            expect(fetch).toHaveBeenCalledWith(
                expect.stringContaining("/inboxes/oddjobapp%40agentmail.to/messages/send"),
                expect.objectContaining({
                    method: "POST",
                    body: expect.stringContaining('"client_id":"unique_id_456"'),
                })
            );
            expect(fetch).toHaveBeenCalledWith(
                expect.stringContaining("/inboxes/oddjobapp%40agentmail.to/messages/send"),
                expect.objectContaining({
                    body: expect.stringContaining('"labels":["test","premium"]'),
                })
            );
        });
    });

    describe("reply", () => {
        it("should send a reply linked to a thread", async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: vi.fn().mockResolvedValue({ message_id: "msg_reply_1", thread_id: "thread_abc" }),
            });

            const result = await agentMailService.reply("msg_original_1", {
                text: "Reply Body",
            });

            expect(result.message_id).toBe("msg_reply_1");
            expect(fetch).toHaveBeenCalledWith(
                expect.stringContaining("/inboxes/oddjobapp%40agentmail.to/messages/msg_original_1/reply"),
                expect.objectContaining({
                    method: "POST",
                    body: expect.stringContaining('"text":"Reply Body"'),
                })
            );
        });
    });

    describe("verifyWebhookSignature", () => {
        it("should have the signature verification method", () => {
            expect(agentMailService.verifyWebhookSignature).toBeDefined();
            // Basic check for configuration gating
            process.env.AGENTMAIL_WEBHOOK_SECRET = "";
            const result = agentMailService.verifyWebhookSignature(Buffer.from("{}"), "id", "ts", "sig");
            expect(result).toBe(false);
        });
    });
});
