/** @vitest-environment node */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPropose = vi.fn();
const mockApply = vi.fn();
const mockEnsureSession = vi.fn();
const mockSeedCopilot = vi.fn();
const mockAddMembers = vi.fn();
const mockGetTranscript = vi.fn();
const mockPostTurn = vi.fn();
const mockPublish = vi.fn();

vi.mock("@server/domain/agent-cards/core/agent-studio.service.js", () => ({
    agentStudioService: { propose: mockPropose, apply: mockApply },
}));

vi.mock("@server/domain/crew/core/crew-session.service.js", () => ({
    ensureSession: mockEnsureSession,
    seedCopilotMember: mockSeedCopilot,
}));

vi.mock("@server/domain/crew/core/crew-repository.js", () => ({
    crewRepository: {
        addMembers: mockAddMembers,
        getTranscript: mockGetTranscript,
        postTurn: mockPostTurn,
    },
}));

vi.mock("@server/domain/crew/core/crew-stream.service.js", () => ({
    crewStreamService: { publish: mockPublish },
}));

const { BotFactoryService, botDefinitionFromBlueprint } = await import("../core/bot-factory.service.js");
const { AGENT_STUDIO_POD } = await import("@shared/agent-studio.js");
const { parseBotBlueprint } = await import("../core/bot-interpreter.service.js");

import type { BotBlueprint } from "../core/bot-interpreter.service.js";
import type { AgentChangeProposal } from "@shared/agent-studio.js";

const ORG_ID = 42;
const CTX = {
    userId: "user-7",
    organizationId: ORG_ID,
    isAdmin: false,
    isSuperAdmin: false,
    isOrgAdmin: false,
};

const INSTRUCTION = "Monitor my Jira board every weekday and post a Slack summary.";

const SCHEDULED_BLUEPRINT: BotBlueprint = {
    name: "Daily Jira Bot",
    description: "Posts a Jira summary to Slack every weekday.",
    persona: "analyst",
    schedule: "0 9 * * 1-5",
    integrations: ["jira", "slack"],
    capabilities: ["jira-integration", "slack-notification", "scheduled-task"],
    isAiGenerated: true,
};

const CHAT_BLUEPRINT: BotBlueprint = {
    name: "Support Bot",
    description: "Answers product questions.",
    persona: "general",
    schedule: null,
    integrations: [],
    capabilities: ["general-assistant"],
    isAiGenerated: false,
};

function proposalFor(blueprint: BotBlueprint, instruction = INSTRUCTION, proposalId = "proposal-1"): AgentChangeProposal {
    return {
        proposalId,
        agentName: blueprint.name,
        instruction,
        changes: [],
        cost: { model: null, centsPerRun: null, note: "No model is bound." },
        cautions: [],
        definition: botDefinitionFromBlueprint(blueprint, instruction),
    };
}

function createInput(blueprint: BotBlueprint, instruction = INSTRUCTION, proposalId = "proposal-1") {
    return { instruction, blueprint, proposal: proposalFor(blueprint, instruction, proposalId) };
}

describe("BotFactoryService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockApply.mockResolvedValue({ agentId: 99, created: true });
        mockEnsureSession.mockResolvedValue({ id: 10, sessionKey: "bot-99-daily-jira-bot" });
        mockAddMembers.mockResolvedValue([{ id: 99, name: "Daily Jira Bot" }]);
        mockGetTranscript.mockResolvedValue([]);
        mockPostTurn.mockResolvedValue({ id: 77 });
        mockPropose.mockImplementation(async (_ctx, input) => proposalFor(SCHEDULED_BLUEPRINT, input.instruction));
    });

    it("turns a blueprint into an Agent Studio proposal without creating anything", async () => {
        const svc = new BotFactoryService();
        const proposal = await svc.propose(CTX as never, INSTRUCTION, SCHEDULED_BLUEPRINT);

        expect(mockPropose).toHaveBeenCalledOnce();
        const [ctx, input] = mockPropose.mock.calls[0];
        expect(ctx.organizationId).toBe(ORG_ID);
        expect(input.instruction).toBe(INSTRUCTION);
        expect(input.draft).toMatchObject({
            name: "Daily Jira Bot",
            personaType: "analyst",
            capabilities: ["jira-integration", "slack-notification", "scheduled-task"],
        });
        expect(input.draft.tools).toEqual(expect.arrayContaining([
            "list_jira_projects",
            "jira_jql_search",
            "slack_post_message",
            "create_scheduled_job",
        ]));
        expect(input.draft.tools).not.toContain("create_jira_issue");
        expect(proposal.cautions.at(-1)).toContain("scheduled execution is not provisioned");
        expect(mockApply).not.toHaveBeenCalled();
    });

    it("applies the reviewed proposal, joins the room, and mounts Agent Studio", async () => {
        const svc = new BotFactoryService();
        const input = createInput(SCHEDULED_BLUEPRINT);
        const result = await svc.create(CTX as never, input);

        expect(mockApply).toHaveBeenCalledWith(CTX, input.proposal);
        expect(mockEnsureSession).toHaveBeenCalledWith(ORG_ID, "bot-99-daily-jira-bot", CTX.userId);
        expect(mockSeedCopilot).toHaveBeenCalledWith(ORG_ID, 10);
        expect(mockAddMembers).toHaveBeenCalledWith(ORG_ID, 10, [99]);
        expect(mockPostTurn).toHaveBeenCalledOnce();

        const artifact = mockPostTurn.mock.calls[0][2].artifacts[0];
        expect(artifact.payload).toMatchObject({
            type: AGENT_STUDIO_POD,
            proposalId: "proposal-1",
            props: { agentId: 99, agentName: "Daily Jira Bot", view: "identity" },
        });
        expect(mockPublish).toHaveBeenCalledWith(expect.objectContaining({
            type: "turn-content",
            organizationId: ORG_ID,
            sessionKey: "bot-99-daily-jira-bot",
        }));

        expect(result).toMatchObject({
            proposalId: "proposal-1",
            agentCardId: 99,
            agentCardName: "Daily Jira Bot",
            agentCardUrl: "/api/agent-cards/99",
            crewRoomKey: "bot-99-daily-jira-bot",
            crewRoomUrl: "/workspace/chat/bot-99-daily-jira-bot",
            agentStudioUrl: "/workspace/chat/bot-99-daily-jira-bot",
            schedule: {
                expression: "0 9 * * 1-5",
                status: "not_provisioned",
            },
        });
    });

    it("rejects a proposal whose definition no longer matches the reviewed blueprint", async () => {
        const svc = new BotFactoryService();
        const input = createInput(CHAT_BLUEPRINT, "Answer support questions");
        input.proposal.definition.tools.push("send_agentmail");

        await expect(svc.create(CTX as never, input)).rejects.toThrow(/definition changed/i);
        expect(mockApply).not.toHaveBeenCalled();
        expect(mockEnsureSession).not.toHaveBeenCalled();
    });

    it("rejects malformed blueprints before apply", async () => {
        const svc = new BotFactoryService();
        const input = createInput({ ...CHAT_BLUEPRINT, schedule: "not a cron" }, "Answer support questions");

        await expect(svc.create(CTX as never, input)).rejects.toThrow(/invalid bot blueprint/i);
        expect(mockApply).not.toHaveBeenCalled();
    });

    it("is idempotent for the same reviewed proposal", async () => {
        const svc = new BotFactoryService();
        const input = createInput(CHAT_BLUEPRINT, "Answer support questions");

        const first = await svc.create(CTX as never, input);
        const second = await svc.create(CTX as never, input);

        expect(second.agentCardId).toBe(first.agentCardId);
        expect(mockApply).toHaveBeenCalledOnce();
        expect(mockPostTurn).toHaveBeenCalledOnce();
    });

    it("does not post a duplicate Agent Studio mount when one already exists", async () => {
        mockGetTranscript.mockResolvedValue([{
            artifacts: [{
                payload: { type: AGENT_STUDIO_POD, proposalId: "proposal-1" },
            }],
        }]);

        const svc = new BotFactoryService();
        await svc.create(CTX as never, createInput(CHAT_BLUEPRINT, "Answer support questions"));

        expect(mockPostTurn).not.toHaveBeenCalled();
        expect(mockPublish).not.toHaveBeenCalled();
    });

    it("reuses the applied card when room provisioning is retried", async () => {
        mockEnsureSession
            .mockRejectedValueOnce(new Error("room unavailable"))
            .mockResolvedValueOnce({ id: 10, sessionKey: "bot-99-support-bot" });

        const svc = new BotFactoryService();
        const input = createInput(CHAT_BLUEPRINT, "Answer support questions");

        await expect(svc.create(CTX as never, input)).rejects.toThrow(/could not be provisioned/i);
        const result = await svc.create(CTX as never, input);

        expect(result.agentCardId).toBe(99);
        expect(mockApply).toHaveBeenCalledOnce();
        expect(mockEnsureSession).toHaveBeenCalledTimes(2);
    });

    it("rejects the same proposal id when it points at a different definition", async () => {
        const svc = new BotFactoryService();
        await svc.create(CTX as never, createInput(CHAT_BLUEPRINT, "Answer support questions", "same-id"));

        const other = createInput({ ...CHAT_BLUEPRINT, name: "Other Bot" }, "Answer support questions", "same-id");
        await expect(svc.create(CTX as never, other)).rejects.toThrow(/different agent definition/i);
        expect(mockApply).toHaveBeenCalledOnce();
    });
});

describe("parseBotBlueprint", () => {
    it("accepts a valid five-field cron", () => {
        expect(parseBotBlueprint(SCHEDULED_BLUEPRINT).schedule).toBe("0 9 * * 1-5");
    });

    it("rejects unsupported integrations and duplicate capabilities", () => {
        expect(() => parseBotBlueprint({ ...CHAT_BLUEPRINT, integrations: ["slack", "salesforce"] })).toThrow(/invalid bot blueprint/i);
        expect(() => parseBotBlueprint({ ...CHAT_BLUEPRINT, capabilities: ["one", "one"] })).toThrow(/invalid bot blueprint/i);
    });
});
