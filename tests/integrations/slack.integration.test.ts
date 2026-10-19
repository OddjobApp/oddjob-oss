/**
 * Slack Integration Tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { slackService } from "@domain/integrations/core/slack.service.js";
import { db } from "@server/database_service.js";
import { slackWorkspaces, slackCommands, slackNotifications } from "@shared/schema/index.js";

// Mock conversational bridge for mission handling
vi.mock("@domain/integrations/conversational-bridge.service.js", () => ({
    conversationalBridgeService: {
        handleSlackAction: vi.fn().mockImplementation((slackPayload) => {
            const actionId = slackPayload.actions?.[0]?.action_id;
            if (actionId?.startsWith("mission:steer:")) {
                return { text: "Opening steering dialog" };
            }
            if (actionId?.startsWith("mission:approve:")) {
                return { text: "Mission Resumed" };
            }
            return { text: "Action processed" };
        }),
    },
}));

const mockWorkspaceData = {
    id: 1,
    organizationId: 1,
    defaultChannel: "#general",
    notifyOnMissionComplete: true,
    notifyOnAppLaunched: true,
    notifyOnApproval: true,
    botToken: "xoxb-test",
    teamId: "T123",
    isActive: true,
};

const createMockChain = (data: any = []) => {
    const chain = {
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        offset: vi.fn().mockReturnThis(),
        then: (onFullfilled: any) => Promise.resolve(data).then(onFullfilled),
    };
    return chain;
};

const createMockCommandPayload = (command: string, text: string) => ({
    token: "test",
    team_id: "T123",
    team_domain: "test",
    channel_id: "C123",
    channel_name: "general",
    user_id: "U123",
    user_name: "testuser",
    command,
    text,
    response_url: "https://hooks.slack.com/test",
    trigger_id: "test",
});

describe("Slack Service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        
        // Default DB Select Mock
        vi.spyOn(db, "select").mockImplementation(((fields: any) => {
            return {
                from: vi.fn().mockImplementation((table) => {
                    if (table === slackWorkspaces) {
                        return createMockChain([mockWorkspaceData]);
                    }
                    return createMockChain([]);
                }),
            };
        }) as any);

        // Default DB Insert Mock
        vi.spyOn(db, "insert").mockReturnValue({
            values: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{ id: 1 }]),
            }),
        } as any);

        // Default Fetch Mock
        global.fetch = vi.fn().mockResolvedValue({
            json: vi.fn().mockResolvedValue({ ok: true, ts: "1234567890.123456" }),
        });
    });

    describe("handleCommand", () => {
        it('should handle /oddjob instruct command', async () => {
            const payload = createMockCommandPayload('/oddjob', 'instruct run a security audit');
            const result = await slackService.handleCommand(payload);

            expect(result.text).toContain('Instruction Queued');
            expect(db.insert).toHaveBeenCalled(); 
        });

        it("should handle /oddjob help command", async () => {
            const result = await slackService.handleCommand({
                token: "test",
                team_id: "T123",
                team_domain: "test",
                channel_id: "C123",
                channel_name: "general",
                user_id: "U123",
                user_name: "testuser",
                command: "/oddjob",
                text: "help",
                response_url: "https://hooks.slack.com/test",
                trigger_id: "test",
            });

            expect(result.text).toContain("Slack Commands");
            expect(result.blocks).toBeDefined();
        });

        it("should handle /oddjob teach command with missing goal", async () => {
            const payload = createMockCommandPayload("/oddjob", "teach");
            const result = await slackService.handleCommand(payload);
            expect(result.text).toContain("Please specify what task you want to teach");
        });

        it("should handle /oddjob teach command when computer use is disabled", async () => {
            const payload = createMockCommandPayload("/oddjob", "teach Search Wikipedia for Paris");
            const result = await slackService.handleCommand(payload);
            expect(result.text).toContain("Computer Use is not enabled");
        });

        it("should handle /oddjob teach command when computer use is enabled", async () => {
            const { trycuaService } = await import("@domain/integrations/trycua/trycua-service.js");
            vi.spyOn(trycuaService, "assertEnabled").mockResolvedValue(undefined as any);

            const payload = createMockCommandPayload("/oddjob", "teach Search Wikipedia for Paris");
            const result = await slackService.handleCommand(payload);

            expect(result.text).toContain("Teach-a-Task session prepared for *Search Wikipedia for Paris*");
            expect(result.blocks).toBeDefined();
            const actionBlock = result.blocks?.find((b: any) => b.type === "actions");
            expect(actionBlock).toBeDefined();
            const button = actionBlock.elements[0];
            expect(button.text.text).toContain("Open Desktop in Teach Mode");
            expect(button.url).toContain("/workspace/computer?teach=1&goal=Search%20Wikipedia%20for%20Paris");
        });

        it("should handle /oddjob run command", async () => {
            // Mock job service
            const mockJob = { id: 123, name: "Test Job", status: "active" };
            vi.doMock("@domain/jobs/job.service.js", () => ({
                jobService: {
                    getById: vi.fn().mockResolvedValue(mockJob),
                    list: vi.fn().mockResolvedValue({ items: [mockJob] }),
                },
            }));

            // Mock job-test service
            vi.doMock("@domain/jobs/job-test.service.js", () => ({
                jobTestService: {
                    testGenericJob: vi.fn().mockResolvedValue({ success: true }),
                },
            }));

            const result = await slackService.handleCommand({
                token: "test",
                team_id: "T123",
                team_domain: "test",
                channel_id: "C123",
                channel_name: "general",
                user_id: "U123",
                user_name: "testuser",
                command: "/oddjob",
                text: "run TestJob",
                response_url: "https://hooks.slack.com/test",
                trigger_id: "test",
            });

            expect(result.text).toContain("started");
        });

        it("should reject unknown workspace", async () => {
            vi.spyOn(db, "select").mockImplementation(((fields: any) => {
                return {
                    from: vi.fn().mockReturnValue(createMockChain([])),
                };
            }) as any);

            const result = await slackService.handleCommand({
                token: "test",
                team_id: "UNKNOWN",
                team_domain: "test",
                channel_id: "C123",
                channel_name: "general",
                user_id: "U123",
                user_name: "testuser",
                command: "/oddjob",
                text: "help",
                response_url: "https://hooks.slack.com/test",
                trigger_id: "test",
            });

            expect(result.text).toContain("not connected");
        });
    });

    describe("handleInteraction", () => {
        it("should process approval action", async () => {
            // Mock approval service
            vi.doMock("@domain/integrations/core/approval.service.js", () => ({
                approvalService: {
                    processDecision: vi.fn().mockResolvedValue({ success: true }),
                },
            }));

            const result = await slackService.handleInteraction({
                type: "block_actions",
                user: { id: "U123", username: "testuser" },
                channel: { id: "C123", name: "general" },
                team: { id: "T123", domain: "test" },
                actions: [{
                    action_id: "approve_123",
                    block_id: "block1",
                    value: "123",
                    text: { type: "plain_text", text: "Approve" },
                }],
                trigger_id: "test",
                response_url: "https://hooks.slack.com/test",
            });

            expect(result.text).toContain("Approved");
        });

        it("should process mission:approve action and resume mission run", async () => {
            const result = await slackService.handleInteraction({
                type: "block_actions",
                user: { id: "U123" },
                channel: { id: "C123" },
                team: { id: "T123" },
                actions: [{
                    action_id: "mission:approve:456",
                    value: "approve",
                }],
            } as any);

            expect(result.text).toContain("Mission Resumed");
        });

        it("should open steering modal when mission:steer is clicked", async () => {
            const result = await slackService.handleInteraction({
                type: "block_actions",
                user: { id: "U123" },
                channel: { id: "C123" },
                team: { id: "T123" },
                actions: [{
                    action_id: "mission:steer:456",
                    value: "steer",
                }],
                trigger_id: "trigger_123",
            } as any);

            expect(result.text).toContain("Opening steering dialog");
        });
    });

    describe("getAuthorizedChannels", () => {
        it("should return channels based on active subscriptions", async () => {
            const mockSubscriptions = [
                { channelId: "C_MISSIONS", notifyMissions: true, isActive: true },
                { channelId: "C_JOBS", notifyJobs: true, isActive: true },
            ];

            vi.spyOn(db, "select").mockImplementation(((fields: any) => ({
                from: vi.fn().mockReturnValue(createMockChain(mockSubscriptions)),
            })) as any);

            const channels = await slackService.getAuthorizedChannels(1, "mission_complete", { missionId: 123 });
            
            expect(channels).toContain("C_MISSIONS");
            expect(channels).not.toContain("C_JOBS");
        });
    });

    describe("sendNotification", () => {
        it("should send mission complete notification", async () => {
            const result = await slackService.sendNotification(1, "mission_complete", {
                missionId: 123,
                missionName: "Test Mission",
                duration: 45,
                jobCount: 5,
            });

            expect(result).toHaveLength(1);
            expect(fetch).toHaveBeenCalled();
        });

        it("should not send when notification disabled", async () => {
            vi.spyOn(db, "select").mockImplementation(((fields: any) => ({
                from: vi.fn().mockReturnValue(createMockChain([{
                    ...mockWorkspaceData,
                    notifyOnMissionComplete: false
                }])),
            })) as any);

            const result = await slackService.sendNotification(1, "mission_complete", {});
            expect(result).toHaveLength(0);
        });

        it("should send app launched notification", async () => {
            const result = await slackService.sendNotification(1, "app_launched", {
                appId: 123,
                slug: "test-dashboard",
                name: "Test Dashboard",
                organizationId: 1,
                publicUrl: "https://example.com/app/test-dashboard",
            });

            expect(result).toHaveLength(1);
            expect(fetch).toHaveBeenCalled();
        });
    });

    describe("getWorkspaceById", () => {
        it("should return workspace by ID", async () => {
            const result = await slackService.getWorkspaceById(1);
            expect(result).toEqual(mockWorkspaceData);
        });
    });
});
