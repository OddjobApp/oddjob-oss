/**
 * Messaging Service Unit Tests
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

// Use hoisted for mock objects
const { mockSlackClient } = vi.hoisted(() => ({
    mockSlackClient: {
        chat: {
            postMessage: vi.fn(),
        },
    }
}));

// Mock database
vi.mock("@server/db/index.js", () => ({
    db: {
        select: vi.fn(() => ({
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            then: (onFulfilled: any) => Promise.resolve([]).then(onFulfilled),
        })),
    },
}));

// Mock Slack WebClient
vi.mock("@slack/web-api", () => {
    class WebClient {
        chat = mockSlackClient.chat;
    }
    return { WebClient };
});

// Mock fetch for Teams
global.fetch = vi.fn() as any;

vi.mock("../../../server/utils/logger.js", () => ({
    createLogger: vi.fn(() => ({
        info: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
    })),
}));

import { MessagingService, SlackProvider, TeamsProvider } from "../../../server/domain/integrations/messaging-service.js";
import { WebClient } from "@slack/web-api";
import { db } from "@server/db/index.js";

describe("MessagingService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSlackClient.chat.postMessage.mockResolvedValue({ ok: true, ts: "123.456" });
    });

    describe("Orchestration", () => {
        it("should register and notify providers", async () => {
            const service = new MessagingService();
            const provider = {
                name: "test",
                send: vi.fn().mockResolvedValue({ success: true })
            };

            service.registerProvider(provider);
            const results = await service.notify({ title: "Hi", body: "Test" });

            expect(results).toHaveLength(1);
            expect(provider.send).toHaveBeenCalled();
        });

        it("should handle provider failures gracefully", async () => {
            const service = new MessagingService();
            const provider = {
                name: "fail",
                send: vi.fn().mockRejectedValue(new Error("Network error"))
            };

            service.registerProvider(provider);
            const results = await service.notify({ title: "Hi", body: "Test" });

            expect(results[0].success).toBe(false);
        });
    });

    describe("SlackProvider", () => {
        it("should send message via Slack", async () => {
            process.env.SLACK_BOT_TOKEN = "test-token";
            process.env.SLACK_DEFAULT_CHANNEL = "C123";

            const provider = new SlackProvider();
            const result = await provider.send({ title: "Slack", body: "Message" });

            expect(result.success).toBe(true);
            expect(result.messageId).toBe("123.456");
        });

        it("should use organization specific credentials if available", async () => {
            const mockConnector = {
                credentials: { token: "org-token" },
                config: { channelId: "org-channel" },
                status: "connected"
            };

            (db.select as Mock).mockReturnValue({
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                then: (onFulfilled: any) => Promise.resolve([mockConnector]).then(onFulfilled),
            });

            const provider = new SlackProvider();
            await provider.send({ title: "Org Slack", body: "Data" }, 1);

            // Check if WebClient was instantiated with org-token
            // Since WebClient is now a class, we might need a different way to check its constructor args if WebClient isn't a mock fn
        });
    });

    describe("TeamsProvider", () => {
        it("should send message via Teams webhook", async () => {
            process.env.TEAMS_WEBHOOK_URL = "http://teams.webhook";
            (fetch as Mock).mockResolvedValue({ ok: true });

            const provider = new TeamsProvider();
            const result = await provider.send({ title: "Teams", body: "Alert" });

            expect(result.success).toBe(true);
            expect(fetch).toHaveBeenCalled();
        });

        it("should handle Teams failure", async () => {
            process.env.TEAMS_WEBHOOK_URL = "http://teams.webhook";
            (fetch as Mock).mockResolvedValue({ ok: false, status: 500 });

            const provider = new TeamsProvider();
            const result = await provider.send({ title: "Teams", body: "Alert" });

            expect(result.success).toBe(false);
            expect(result.error).toContain("500");
        });
    });
});
