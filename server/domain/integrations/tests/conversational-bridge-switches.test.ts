import { describe, it, expect, vi, beforeEach } from "vitest";
import { conversationalBridgeService } from "../conversational-bridge.service.js";
import { db } from "../../../database_service.js";
import { users, saasConnectors } from "@shared/schema/index.js";

vi.mock("@server/database_service.js", () => ({
    db: {
        select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([{ id: "test-user", email: "slack@oddjob.ai" }])
                })
            })
        }),
        insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{ id: 123 }])
            })
        }),
        update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue([])
            })
        })
    }
}));

vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => ({
    redis: {
        get: vi.fn().mockResolvedValue("planning"),
        set: vi.fn().mockResolvedValue("OK")
    },
    getRedisOptions: vi.fn().mockReturnValue({ host: "127.0.0.1", port: 6379 })
}));

vi.mock("@domain/core/infrastructure/queue/queue-service.ts", () => ({
    QueueService: {
        getInstance: vi.fn().mockReturnValue({
            addJob: vi.fn().mockResolvedValue({ id: "mock-job-id" }),
            getJob: vi.fn().mockResolvedValue(null)
        })
    }
}));

vi.mock("../slack-service.js", () => ({
    getSlackClient: vi.fn().mockResolvedValue({
        postMessage: vi.fn().mockResolvedValue({ ok: true })
    })
}));

vi.mock("../../agents/agent.service.js", () => ({
    agentService: {
        chat: vi.fn()
    }
}));

import { agentService } from "../../agents/agent.service.js";

describe("Conversational Bridge Switch Types", () => {
    let testOrgId = 1;
    let testUserId = "test-user";
    let mockClient = {
        postMessage: vi.fn().mockResolvedValue({ ok: true })
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should process clarification_request and render option buttons", async () => {
        const mockResponse = {
            response: `Plan ready. I need clarification.\n{"type": "clarification_request", "question": "Deploy where?", "options": ["stg", "prod"], "runId": 999}`
        };
        (agentService.chat as any).mockResolvedValue(mockResponse);

        const message = {
            platform: "slack" as const,
            channelId: "C123",
            userId: "U123",
            text: "Launch deployment",
            timestamp: Date.now().toString()
        };

        await conversationalBridgeService.handleAgentChat(message, testOrgId, testUserId, mockClient);

        expect(mockClient.postMessage).toHaveBeenCalledWith(
            "C123",
            expect.any(String),
            expect.arrayContaining([
                expect.objectContaining({
                    type: "actions",
                    elements: expect.arrayContaining([
                        expect.objectContaining({
                            type: "button",
                            text: expect.objectContaining({ text: "stg" }),
                            action_id: "mission:clarify:999",
                            value: "stg"
                        }),
                        expect.objectContaining({
                            type: "button",
                            text: expect.objectContaining({ text: "prod" }),
                            action_id: "mission:clarify:999",
                            value: "prod"
                        })
                    ])
                })
            ]),
            undefined
        );
    });

    it("should process snooze_request and render delay buttons", async () => {
        const mockResponse = {
            response: `Let's delay.\n{"type": "snooze_request", "reason": "Cooldown period", "runId": 999}`
        };
        (agentService.chat as any).mockResolvedValue(mockResponse);

        const message = {
            platform: "slack" as const,
            channelId: "C123",
            userId: "U123",
            text: "Wait",
            timestamp: Date.now().toString()
        };

        await conversationalBridgeService.handleAgentChat(message, testOrgId, testUserId, mockClient);

        expect(mockClient.postMessage).toHaveBeenCalledWith(
            "C123",
            expect.any(String),
            expect.arrayContaining([
                expect.objectContaining({
                    type: "actions",
                    elements: expect.arrayContaining([
                        expect.objectContaining({
                            type: "button",
                            text: expect.objectContaining({ text: "Snooze 10m" }),
                            action_id: "mission:snooze:999:10"
                        }),
                        expect.objectContaining({
                            type: "button",
                            text: expect.objectContaining({ text: "Snooze 1h" }),
                            action_id: "mission:snooze:999:60"
                        })
                    ])
                })
            ]),
            undefined
        );
    });

    it("should process verification_request and render challenge button", async () => {
        const mockResponse = {
            response: `Auth needed.\n{"type": "verification_request", "reason": "Prod Deployment", "runId": 999}`
        };
        (agentService.chat as any).mockResolvedValue(mockResponse);

        const message = {
            platform: "slack" as const,
            channelId: "C123",
            userId: "U123",
            text: "Deploy to prod",
            timestamp: Date.now().toString()
        };

        await conversationalBridgeService.handleAgentChat(message, testOrgId, testUserId, mockClient);

        expect(mockClient.postMessage).toHaveBeenCalledWith(
            "C123",
            expect.any(String),
            expect.arrayContaining([
                expect.objectContaining({
                    type: "actions",
                    elements: expect.arrayContaining([
                        expect.objectContaining({
                            type: "button",
                            text: expect.objectContaining({ text: "Enter 2FA Code" }),
                            action_id: "mission:otp_modal:999"
                        })
                    ])
                })
            ]),
            undefined
        );
    });

    it("should answer Slack help without invoking the agent", async () => {
        const message = {
            platform: "slack" as const,
            channelId: "C123",
            userId: "U123",
            text: "<@BOT123> help",
            timestamp: Date.now().toString()
        };

        const handled = await conversationalBridgeService.tryHandleFastPath(message, mockClient, testOrgId);

        expect(handled).toBe(true);
        expect(agentService.chat).not.toHaveBeenCalled();
        expect(mockClient.postMessage).toHaveBeenCalledWith(
            "C123",
            "Oddjob Assistant help",
            expect.arrayContaining([
                expect.objectContaining({
                    type: "section",
                    text: expect.objectContaining({
                        text: expect.stringContaining("Current mode")
                    })
                })
            ]),
            undefined
        );
    });

    it("should chunk long default responses into Slack-safe section blocks", async () => {
        const longResponse = Array.from({ length: 120 }, (_, i) => `Paragraph ${i}: ${"x".repeat(80)}`).join("\n\n");
        (agentService.chat as any).mockResolvedValue({ response: longResponse });

        const message = {
            platform: "slack" as const,
            channelId: "C123",
            userId: "U123",
            text: "Summarize the migration plan",
            timestamp: Date.now().toString()
        };

        await conversationalBridgeService.handleAgentChat(message, testOrgId, testUserId, mockClient);

        const blocks = mockClient.postMessage.mock.calls[0][2];
        const sectionBlocks = blocks.filter((block: any) => block.type === "section");

        expect(sectionBlocks.length).toBeGreaterThan(1);
        expect(sectionBlocks.every((block: any) => block.text.text.length <= 2800)).toBe(true);
    });

    it("should pass Slack interface guidance into agent chat context", async () => {
        (agentService.chat as any).mockResolvedValue({ response: "Ready." });

        const message = {
            platform: "slack" as const,
            channelId: "C123",
            userId: "U123",
            text: "Plan a release",
            timestamp: "123.456",
            attachments: [{ id: "file-1" }]
        };

        await conversationalBridgeService.handleAgentChat(message, testOrgId, testUserId, mockClient);

        expect(agentService.chat).toHaveBeenCalledWith(expect.objectContaining({
            context: expect.objectContaining({
                interface: expect.objectContaining({
                    surface: "slack",
                    responseStyle: "concise_threaded",
                    supportsBlocks: true
                }),
                message: expect.objectContaining({
                    timestamp: "123.456",
                    hasAttachments: true
                })
            })
        }));
    });

    it("should trigger ngrok start fast-path command", async () => {
        const message = {
            platform: "slack" as const,
            channelId: "C123",
            userId: "U123",
            text: "start ngrok",
            timestamp: Date.now().toString()
        };

        const ensureSpy = vi.spyOn(conversationalBridgeService, "ensureNgrokTunnel").mockResolvedValue("https://mock-tunnel.ngrok-free.app");

        const handled = await conversationalBridgeService.tryHandleFastPath(message, mockClient, testOrgId);

        expect(handled).toBe(true);
        expect(ensureSpy).toHaveBeenCalled();
        expect(mockClient.postMessage).toHaveBeenCalledWith(
            "C123",
            expect.stringContaining("https://mock-tunnel.ngrok-free.app"),
            expect.any(Array),
            undefined
        );
        ensureSpy.mockRestore();
    });

    it("should trigger ngrok stop fast-path command", async () => {
        const message = {
            platform: "slack" as const,
            channelId: "C123",
            userId: "U123",
            text: "stop ngrok",
            timestamp: Date.now().toString()
        };

        const stopSpy = vi.spyOn(conversationalBridgeService, "stopNgrokTunnel").mockResolvedValue(true);

        const handled = await conversationalBridgeService.tryHandleFastPath(message, mockClient, testOrgId);

        expect(handled).toBe(true);
        expect(stopSpy).toHaveBeenCalled();
        expect(mockClient.postMessage).toHaveBeenCalledWith(
            "C123",
            expect.stringContaining("closed successfully"),
            undefined,
            undefined
        );
        stopSpy.mockRestore();
    });
});
