/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The seam: crew calls propose_outbound_message (directly, or because the send
 * gate rewrote a send_email call into one) → an approval_requests row is the
 * send contract → the decision executes the stored draft → the outcome is
 * persisted back onto the row and acknowledged in the room.
 */

const state = vi.hoisted(() => ({
    selectQueue: [] as any[][],
    insertCalls: [] as any[],
    updateSets: [] as any[],
}));
const sendExecute = vi.hoisted(() => vi.fn());
const findSession = vi.hoisted(() => vi.fn());
const postTurn = vi.hoisted(() => vi.fn());

vi.mock("@server/database_service.js", () => ({
    db: {
        select: () => ({
            from: () => ({
                where: () => ({ limit: () => Promise.resolve(state.selectQueue.shift() ?? []) }),
            }),
        }),
        insert: () => ({
            values: (v: any) => {
                state.insertCalls.push(v);
                return { returning: () => Promise.resolve([{ id: 4242 }]) };
            },
        }),
        update: () => ({
            set: (s: any) => {
                state.updateSets.push(s);
                return { where: () => Promise.resolve([]) };
            },
        }),
    },
}));
vi.mock("@domain/tools/v1/capabilities/index.js", () => ({
    getAgentTools: () => ({ send_email: { name: "send_email", execute: sendExecute } }),
}));
vi.mock("@domain/crew/core/crew-repository.js", () => ({
    crewRepository: { findSession, postTurn },
}));

import { CREW_TASK_PROPOSAL_TOOLS } from "@domain/tools/v1/capabilities/crew-task-proposal-tools.js";
import { outboundMessageService } from "../core/outbound-message.service.js";

const crewContext = {
    organizationId: 291,
    userId: "u-1",
    sessionKey: "crew-9",
    agentCardId: 5,
    agentName: "Briefing",
} as any;

const draft = {
    channel: "email" as const,
    to: ["dana@northwind.io"],
    subject: "Migration timeline",
    body: "Hi Dana — the window we discussed opens Monday.",
    trigger: "User asked the room to confirm the migration window",
    sensitivity: "customer_facing" as const,
};

describe("outbound message seam", () => {
    beforeEach(() => {
        state.selectQueue.length = 0;
        state.insertCalls.length = 0;
        state.updateSets.length = 0;
        sendExecute.mockReset().mockResolvedValue("Email sent successfully. Message ID: m1");
        findSession.mockReset().mockResolvedValue({ id: 77 });
        postTurn.mockReset().mockResolvedValue({ id: 1 });
    });

    it("proposal → approval row → approve → send → persisted result → room ack", async () => {
        // 1. The proposal tool writes the send contract.
        state.selectQueue.push([]); // dedupe scan: no pending match
        const output = await CREW_TASK_PROPOSAL_TOOLS.propose_outbound_message.execute(draft, crewContext);
        const payload = JSON.parse(output);
        expect(payload).toMatchObject({
            type: "approval_request",
            kind: "outbound_message",
            channel: "email",
            proposalId: 4242,
        });
        expect(state.insertCalls[0]).toMatchObject({
            toolName: "propose_outbound_message",
            status: "pending",
            organizationId: 291,
        });
        expect(state.insertCalls[0].toolArgs).toMatchObject({ kind: "outbound_message", sessionKey: "crew-9" });

        // 2. Approve it — the service must send the STORED draft.
        const request = {
            id: payload.proposalId,
            organizationId: 291,
            modifiedOutput: state.insertCalls[0].toolArgs,
        };
        const outcome = await outboundMessageService.onOutboundMessageDecision(
            request,
            "approved",
            { userId: "u-1", email: "sam@x.ai" },
        );
        expect(outcome).toMatchObject({ handled: true, sent: true });
        expect(sendExecute).toHaveBeenCalledWith(
            expect.objectContaining({ to: ["dana@northwind.io"], subject: "Migration timeline" }),
            expect.objectContaining({ organizationId: 291, sessionKey: "crew-9" }),
        );

        // 3. The row records what actually happened…
        expect(state.updateSets.some((s) => s.modifiedOutput?.sendResult?.sent === true)).toBe(true);

        // …and 4. the room hears about it.
        expect(postTurn).toHaveBeenCalledWith(
            291,
            77,
            expect.objectContaining({
                speakerType: "agent",
                agentCardId: 5,
                content: expect.stringMatching(/sent/i),
            }),
        );
    });

    it("reuses the pending card when the model repeats an identical draft", async () => {
        state.selectQueue.push([]);
        await CREW_TASK_PROPOSAL_TOOLS.propose_outbound_message.execute(draft, crewContext);

        // Second pass: the dedupe scan finds the pending twin.
        state.selectQueue.push([{ id: 4242, toolArgs: state.insertCalls[0].toolArgs }]);
        const output = await CREW_TASK_PROPOSAL_TOOLS.propose_outbound_message.execute(draft, crewContext);
        const payload = JSON.parse(output);
        expect(payload.proposalId).toBe(4242);
        expect(payload.message).toMatch(/already waiting/i);
        expect(state.insertCalls).toHaveLength(1);
    });

    it("a repeat in a different room is a new draft, not a dedupe", async () => {
        state.selectQueue.push([]);
        await CREW_TASK_PROPOSAL_TOOLS.propose_outbound_message.execute(draft, crewContext);

        state.selectQueue.push([
            { id: 4242, toolArgs: { ...state.insertCalls[0].toolArgs, sessionKey: "crew-other" } },
        ]);
        await CREW_TASK_PROPOSAL_TOOLS.propose_outbound_message.execute(draft, crewContext);
        expect(state.insertCalls).toHaveLength(2);
    });

    it("flags commitment-language drafts for escalated (admin) review", async () => {
        state.selectQueue.push([]);
        const output = await CREW_TASK_PROPOSAL_TOOLS.propose_outbound_message.execute(
            { ...draft, sensitivity: "commitment_or_legal" },
            crewContext,
        );
        const payload = JSON.parse(output);
        expect(payload.escalatedReview).toBe(true);
        expect(state.insertCalls[0].toolArgs.escalatedReview).toBe(true);
    });
});
