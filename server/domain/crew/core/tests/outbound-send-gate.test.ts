/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

const proposeExecute = vi.hoisted(() => vi.fn());
const selectLimit = vi.hoisted(() => vi.fn());
vi.mock("@domain/tools/v1/capabilities/crew-task-proposal-tools.js", () => ({
    CREW_TASK_PROPOSAL_TOOLS: {
        propose_outbound_message: { name: "propose_outbound_message", execute: proposeExecute },
    },
}));
vi.mock("@server/database_service.js", () => ({
    db: { select: () => ({ from: () => ({ where: () => ({ limit: selectLimit }) }) }) },
}));
vi.mock("@shared/schema/index.js", () => ({
    users: { email: "users.email" },
    agentCards: { id: "agent_cards.id", organizationId: "agent_cards.org", approvalBoundary: "agent_cards.boundary" },
}));
vi.mock("@shared/schema/agent-deployments.js", () => ({
    agentDeployments: { jobId: "agent_deployments.job", organizationId: "agent_deployments.org", approvalBoundary: "agent_deployments.boundary" },
}));

import { maybeGateOutboundSend } from "../outbound-send-gate.js";

const baseContext = { organizationId: 291, userId: "u1", sessionKey: "crew-1", userEmail: "sam@x.ai", named: {} };

const externalSend = {
    to: "dana@northwind.io",
    subject: "Three infra roles",
    body: "Hi Dana, saw Northwind opened three infra roles this month.",
};

beforeEach(() => {
    proposeExecute.mockReset().mockResolvedValue(
        JSON.stringify({ type: "approval_request", kind: "outbound_message", proposalId: 42 }),
    );
    selectLimit.mockReset().mockResolvedValue([]); // no card / no boundary by default
});

describe("outbound send gate", () => {
    it("holds an external-recipient email for review and returns the card artifact", async () => {
        const gated = await maybeGateOutboundSend("send_email", externalSend, baseContext, Date.now());
        expect(gated).not.toBeNull();
        expect(gated!.artifact?.payload.type).toBe("approval_request");
        expect(gated!.artifact?.payload.kind).toBe("outbound_message");
        expect(gated!.output).toMatch(/not sent/i);
        expect(proposeExecute).toHaveBeenCalledWith(
            expect.objectContaining({
                channel: "email",
                to: ["dana@northwind.io"],
                sensitivity: "external_first_contact",
            }),
            baseContext,
        );
    });

    it("gates internal mail carrying commitment language", async () => {
        const gated = await maybeGateOutboundSend(
            "send_agentmail",
            { ...externalSend, to: "dana@x.ai", body: "We can commit to $4,000/month starting Monday." },
            baseContext,
            Date.now(),
        );
        expect(gated).not.toBeNull();
        expect(proposeExecute).toHaveBeenCalledWith(
            expect.objectContaining({ sensitivity: "commitment_or_legal" }),
            baseContext,
        );
    });

    it("gates thread replies even without visible recipients", async () => {
        const gated = await maybeGateOutboundSend(
            "reply_agentmail",
            { messageId: "m-1", text: "Following up on our thread." },
            baseContext,
            Date.now(),
        );
        expect(gated).not.toBeNull();
        expect(proposeExecute).toHaveBeenCalledWith(
            expect.objectContaining({ sendTool: "reply_agentmail", messageId: "m-1", sensitivity: "customer_facing" }),
            baseContext,
        );
    });

    it("lets internal-domain routine mail send directly", async () => {
        const gated = await maybeGateOutboundSend(
            "send_email",
            { ...externalSend, to: "dana@x.ai" },
            baseContext,
            Date.now(),
        );
        expect(gated).toBeNull();
        expect(proposeExecute).not.toHaveBeenCalled();
    });

    it("lets a verbatim-dictated body send directly", async () => {
        const dictation = `Send exactly this: ${externalSend.body}`;
        const gated = await maybeGateOutboundSend(
            "send_email",
            externalSend,
            { ...baseContext, named: { message: dictation } },
            Date.now(),
        );
        expect(gated).toBeNull();
    });

    it("ignores non-send tools", async () => {
        expect(await maybeGateOutboundSend("render_table", { rows: [] }, baseContext, Date.now())).toBeNull();
    });

    it("gates a Slack post that broadcasts to the whole channel", async () => {
        const gated = await maybeGateOutboundSend(
            "slack_post_message",
            { channel: "#eng", message: "@channel deploy is done, please restart your clients" },
            baseContext,
            Date.now(),
        );
        expect(gated).not.toBeNull();
        expect(gated!.artifact?.payload.kind).toBe("outbound_message");
        expect(proposeExecute).toHaveBeenCalledWith(
            expect.objectContaining({ channel: "slack", to: ["#eng"], sensitivity: "broad_audience" }),
            baseContext,
        );
    });

    it("gates a Slack post into an external/shared channel", async () => {
        const gated = await maybeGateOutboundSend(
            "slack_post_message",
            { channel: "#ext-acme-shared", message: "Weekly status update is posted." },
            baseContext,
            Date.now(),
        );
        expect(gated).not.toBeNull();
        expect(proposeExecute).toHaveBeenCalledWith(
            expect.objectContaining({ channel: "slack", sensitivity: "customer_facing" }),
            baseContext,
        );
    });

    it("holds any send when the user asked to review the draft first", async () => {
        // Internal recipient that would otherwise send directly — "draft" is
        // an intent to review, not a destination signal.
        const gated = await maybeGateOutboundSend(
            "send_email",
            { ...externalSend, to: "dana@x.ai" },
            { ...baseContext, named: { message: "I'd like you to draft an email and send it to dana@x.ai" } },
            Date.now(),
        );
        expect(gated).not.toBeNull();
        expect(proposeExecute).toHaveBeenCalledWith(
            expect.objectContaining({ sensitivity: "requested_review" }),
            expect.anything(),
        );
    });

    it("blocks outright when the card's boundary forbids external contact", async () => {
        selectLimit.mockResolvedValue([{ approvalBoundary: "Never contact customers or external partners." }]);
        const gated = await maybeGateOutboundSend(
            "send_email",
            externalSend,
            { ...baseContext, agentCardId: 7 },
            Date.now(),
        );
        expect(gated).not.toBeNull();
        expect(gated!.record.ok).toBe(false);
        expect(gated!.artifact).toBeNull();
        expect(gated!.output).toMatch(/not sent/i);
        expect(gated!.output).toMatch(/approval boundary/i);
        // A "never" is not a card — nothing for a human to approve.
        expect(proposeExecute).not.toHaveBeenCalled();
    });

    it("still lets the same agent send internally under a never-external boundary", async () => {
        selectLimit.mockResolvedValue([{ approvalBoundary: "Never contact customers or external partners." }]);
        const gated = await maybeGateOutboundSend(
            "send_email",
            { ...externalSend, to: "dana@x.ai" },
            { ...baseContext, agentCardId: 7 },
            Date.now(),
        );
        expect(gated).toBeNull();
    });

    it("gates every send when the boundary says review everything", async () => {
        selectLimit.mockResolvedValue([{ approvalBoundary: "Always have a human review outbound messages." }]);
        const gated = await maybeGateOutboundSend(
            "send_email",
            { ...externalSend, to: "dana@x.ai" },
            { ...baseContext, agentCardId: 7 },
            Date.now(),
        );
        expect(gated).not.toBeNull();
        expect(proposeExecute).toHaveBeenCalledWith(
            expect.objectContaining({ sensitivity: "requested_review" }),
            expect.anything(),
        );
    });

    it("blocks all sends under a blanket no-send boundary", async () => {
        selectLimit.mockResolvedValue([{ approvalBoundary: "This is a read-only research agent — never send messages." }]);
        const gated = await maybeGateOutboundSend(
            "send_email",
            { ...externalSend, to: "dana@x.ai" },
            { ...baseContext, agentCardId: 7 },
            Date.now(),
        );
        expect(gated).not.toBeNull();
        expect(gated!.record.ok).toBe(false);
        expect(proposeExecute).not.toHaveBeenCalled();
    });

    it("resolves the boundary from the executing job's deployment when no card is attached", async () => {
        // Mission path: no agentCardId — the deployment behind context.jobId
        // carries the boundary instead.
        selectLimit.mockResolvedValue([{ approvalBoundary: "Always have a human review outbound messages." }]);
        const gated = await maybeGateOutboundSend(
            "send_email",
            { ...externalSend, to: "dana@x.ai" },
            { ...baseContext, jobId: 5 },
            Date.now(),
        );
        expect(gated).not.toBeNull();
        expect(proposeExecute).toHaveBeenCalledWith(
            expect.objectContaining({ sensitivity: "requested_review" }),
            expect.anything(),
        );
    });

    it("lets a routine internal Slack post send directly", async () => {
        const gated = await maybeGateOutboundSend(
            "slack_post_message",
            { channel: "#eng", message: "Standup notes are in the doc." },
            baseContext,
            Date.now(),
        );
        expect(gated).toBeNull();
        expect(proposeExecute).not.toHaveBeenCalled();
    });

    it("fails closed when the review card cannot be raised", async () => {
        proposeExecute.mockRejectedValue(new Error("db down"));
        const gated = await maybeGateOutboundSend("send_email", externalSend, baseContext, Date.now());
        expect(gated).not.toBeNull();
        expect(gated!.record.ok).toBe(false);
        expect(gated!.output).toMatch(/NOT sent/i);
        expect(gated!.artifact).toBeNull();
    });
});
