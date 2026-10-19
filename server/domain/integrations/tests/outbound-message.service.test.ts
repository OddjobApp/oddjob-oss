/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendExecute = vi.hoisted(() => vi.fn());
const sendMessage = vi.hoisted(() => vi.fn());
const listWorkspaces = vi.hoisted(() => vi.fn());
const findSession = vi.hoisted(() => vi.fn());
const postTurn = vi.hoisted(() => vi.fn());

vi.mock("@domain/tools/v1/capabilities/index.js", () => ({
    getAgentTools: () => ({ send_email: { name: "send_email", execute: sendExecute } }),
}));
vi.mock("../core/slack.service.js", () => ({
    slackService: { listWorkspaces, sendMessage },
}));
vi.mock("@domain/crew/core/crew-repository.js", () => ({
    crewRepository: { findSession, postTurn },
}));

import { outboundMessageService } from "../core/outbound-message.service.js";

const actor = { userId: "u1", email: "sam@x.ai" };

const emailRequest = {
    id: 55301,
    organizationId: 291,
    modifiedOutput: {
        kind: "outbound_message",
        channel: "email",
        to: ["dana@northwind.io"],
        from: "sam@x.ai",
        subject: "Three infra roles and a migration",
        body: "Hi Dana",
        sessionKey: "crew-123",
    },
};

describe("outboundMessageService.onOutboundMessageDecision", () => {
    beforeEach(() => {
        sendExecute.mockReset();
        sendMessage.mockReset();
        listWorkspaces.mockReset();
        // findSession/postTurn hit the database in this env; default to "no
        // room" so the ack path is exercised-but-inert unless a test sets it.
        findSession.mockReset().mockResolvedValue(null);
        postTurn.mockReset().mockResolvedValue({ id: 1 });
    });

    it("ignores proposals that are not outbound messages", async () => {
        const outcome = await outboundMessageService.onOutboundMessageDecision(
            { id: 1, organizationId: 291, modifiedOutput: { kind: "assembly_deployment" } },
            "approved",
            actor,
        );
        expect(outcome).toEqual({ handled: false });
        expect(sendExecute).not.toHaveBeenCalled();
    });

    it("discards without sending on reject", async () => {
        const outcome = await outboundMessageService.onOutboundMessageDecision(emailRequest, "rejected", actor);
        expect(outcome).toMatchObject({ handled: true, sent: false, discarded: true });
        expect(sendExecute).not.toHaveBeenCalled();
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it("sends the stored email draft on approve", async () => {
        sendExecute.mockResolvedValue("Email sent successfully to dana@northwind.io. Message ID: m1");
        const outcome = await outboundMessageService.onOutboundMessageDecision(emailRequest, "approved", actor);
        expect(outcome).toMatchObject({ handled: true, sent: true });
        expect(sendExecute).toHaveBeenCalledWith(
            expect.objectContaining({
                to: ["dana@northwind.io"],
                subject: "Three infra roles and a migration",
                text: "Hi Dana",
            }),
            expect.objectContaining({ organizationId: 291, sessionKey: "crew-123" }),
        );
    });

    it("reports a failed send instead of claiming success", async () => {
        sendExecute.mockResolvedValue("Error: AgentMail is not configured");
        const outcome = await outboundMessageService.onOutboundMessageDecision(emailRequest, "approved", actor);
        expect(outcome.sent).toBe(false);
        expect(outcome.error).toMatch(/AgentMail is not configured/);
    });

    it("posts the stored slack draft to the workspace channel", async () => {
        listWorkspaces.mockResolvedValue([{ id: 7, name: "Grok Bot" }]);
        sendMessage.mockResolvedValue({ ts: "1719.42" });
        const outcome = await outboundMessageService.onOutboundMessageDecision(
            {
                id: 2,
                organizationId: 291,
                modifiedOutput: {
                    kind: "outbound_message",
                    channel: "slack",
                    to: ["#sales"],
                    workspace: "Grok Bot",
                    body: "Demo env is green.",
                    threadTs: "1719.00",
                },
            },
            "approved",
            actor,
        );
        expect(outcome).toMatchObject({ handled: true, sent: true });
        expect(sendMessage).toHaveBeenCalledWith(7, {
            channel: "#sales",
            text: "Demo env is green.",
            threadTs: "1719.00",
        });
        expect(sendExecute).not.toHaveBeenCalled();
    });

    it("fails the slack send when no workspace is connected", async () => {
        listWorkspaces.mockResolvedValue([]);
        const outcome = await outboundMessageService.onOutboundMessageDecision(
            { id: 3, organizationId: 291, modifiedOutput: { kind: "outbound_message", channel: "slack", to: ["#sales"], body: "x" } },
            "approved",
            actor,
        );
        expect(outcome.sent).toBe(false);
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it("refuses to post into a different workspace than the draft names", async () => {
        listWorkspaces.mockResolvedValue([{ id: 7, name: "Grok Bot" }]);
        const outcome = await outboundMessageService.onOutboundMessageDecision(
            { id: 4, organizationId: 291, modifiedOutput: { kind: "outbound_message", channel: "slack", to: ["#sales"], workspace: "Acme Shared", body: "x" } },
            "approved",
            actor,
        );
        expect(outcome.sent).toBe(false);
        expect(outcome.error).toMatch(/Acme Shared/);
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it("refuses an unnamed workspace when several are connected", async () => {
        listWorkspaces.mockResolvedValue([{ id: 7, name: "Grok Bot" }, { id: 8, name: "Acme Shared" }]);
        const outcome = await outboundMessageService.onOutboundMessageDecision(
            { id: 5, organizationId: 291, modifiedOutput: { kind: "outbound_message", channel: "slack", to: ["#sales"], body: "x" } },
            "approved",
            actor,
        );
        expect(outcome.sent).toBe(false);
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it("applies body/subject edits but keeps the stored recipients", async () => {
        sendExecute.mockResolvedValue("Email sent successfully. Message ID: m9");
        const outcome = await outboundMessageService.onOutboundMessageDecision(
            emailRequest,
            "approved",
            actor,
            // The approver rewrote the body and tried to move the recipient —
            // the edit type rejects `to` at compile time; cast proves the
            // runtime path ignores it too.
            { body: "Hi Dana — revised per review.", subject: "Updated subject", to: ["attacker@evil.example"] } as any,
        );
        expect(outcome).toMatchObject({ handled: true, sent: true });
        expect(sendExecute).toHaveBeenCalledWith(
            expect.objectContaining({
                to: ["dana@northwind.io"],
                subject: "Updated subject",
                text: "Hi Dana — revised per review.",
            }),
            expect.anything(),
        );
    });

    it("posts a room acknowledgment turn after a successful send", async () => {
        sendExecute.mockResolvedValue("Email sent successfully. Message ID: m10");
        findSession.mockResolvedValue({ id: 77 });
        const outcome = await outboundMessageService.onOutboundMessageDecision(emailRequest, "approved", actor);
        expect(outcome.sent).toBe(true);
        expect(findSession).toHaveBeenCalledWith(291, "crew-123");
        expect(postTurn).toHaveBeenCalledWith(
            291,
            77,
            expect.objectContaining({
                speakerType: "agent",
                content: expect.stringMatching(/sent/i),
                toolsUsed: [expect.objectContaining({ name: "send_email", ok: true })],
                artifacts: [expect.objectContaining({
                    payload: expect.objectContaining({ proposalId: 55301, status: "approved" }),
                })],
            }),
        );
    });

    it("acknowledges a discard in the room without claiming a send", async () => {
        findSession.mockResolvedValue({ id: 77 });
        const outcome = await outboundMessageService.onOutboundMessageDecision(emailRequest, "rejected", actor);
        expect(outcome.discarded).toBe(true);
        expect(postTurn).toHaveBeenCalledWith(
            291,
            77,
            expect.objectContaining({ content: expect.stringMatching(/discarded/i) }),
        );
        expect(sendExecute).not.toHaveBeenCalled();
    });
});
