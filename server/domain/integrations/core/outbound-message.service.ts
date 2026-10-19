import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("OutboundMessageService");

/**
 * Executes the send half of a `propose_outbound_message` approval.
 *
 * The proposal stores the full draft on `approval_requests.toolArgs` — to,
 * subject, body, channel — because that row is the send contract. The
 * approver's own `modifiedOutput` is consulted ONLY for `body`/`subject`
 * edits (Edit & approve): recipients and channel are read from the stored
 * proposal so an approval-time edit cannot redirect where the message goes.
 *
 * After the send attempt the outcome is written back onto the request's
 * modifiedOutput (`sendResult`) and a turn is posted into the originating
 * room, so crew_turns carries what actually happened rather than a card that
 * silently went nowhere.
 *
 * Mirrors the decision-handler shape used by formStudioRuntime.onActionDecision
 * and mediaStudio.onTakeDecision: { handled } tells the caller this request was
 * ours, and the rest reports what actually happened.
 */

export interface OutboundMessageMeta {
    kind: string;
    channel?: string;
    to?: string[];
    from?: string | null;
    subject?: string | null;
    body?: string;
    cc?: string[] | null;
    workspace?: string | null;
    threadTs?: string | null;
    thread?: string | null;
    sendTool?: string | null;
    messageId?: string | null;
    sessionKey?: string | null;
    agentCardId?: number | null;
    agentName?: string | null;
}

interface SendOutcome {
    sent: boolean;
    result?: string;
    error?: string;
}

export const outboundMessageService = {
    async onOutboundMessageDecision(
        request: { id: number; organizationId: number | null; modifiedOutput: any; toolArgs?: any },
        decision: "approved" | "rejected",
        actor: { userId: string; email: string | null },
        /** Reviewer edits. Only body/subject are honored — recipients and
         * channel always come from the stored proposal. */
        edits?: { body?: string; subject?: string } | null,
    ): Promise<{ handled: boolean; sent?: boolean; discarded?: boolean; error?: string }> {
        const meta = (request.modifiedOutput ?? request.toolArgs ?? {}) as OutboundMessageMeta;
        if (meta?.kind !== "outbound_message") return { handled: false };
        if (!request.organizationId) {
            return { handled: true, sent: false, error: "The proposal has no organization to send from." };
        }

        // What was actually shown/sent is what the row keeps. Edits land only
        // on body/subject; everything else is the stored proposal verbatim.
        const effective: OutboundMessageMeta = {
            ...meta,
            body: typeof edits?.body === "string" && edits.body.trim() ? edits.body : meta.body,
            subject: typeof edits?.subject === "string" && edits.subject.trim() ? edits.subject : meta.subject,
        };

        if (decision === "rejected") {
            logger.info("Outbound message discarded by approver", { approvalId: request.id, channel: meta.channel });
            await this.recordSendResult(request.id, effective, { sent: false, discarded: true });
            await this.postRoomAck(meta, request.organizationId, request.id, { sent: false }, decision);
            return { handled: true, sent: false, discarded: true };
        }

        let outcome: SendOutcome;
        try {
            if (effective.channel === "email") {
                outcome = await this.sendEmail(request.organizationId, effective, actor);
            } else if (effective.channel === "slack") {
                outcome = await this.sendSlack(request.organizationId, effective);
            } else {
                outcome = { sent: false, error: `Unknown outbound channel '${effective.channel}'.` };
            }
        } catch (err: any) {
            logger.error("Outbound message send failed", { approvalId: request.id, channel: effective.channel, error: err?.message });
            outcome = { sent: false, error: err?.message || String(err) };
        }

        await this.recordSendResult(request.id, effective, outcome);
        await this.postRoomAck(effective, request.organizationId, request.id, outcome, decision);
        return { handled: true, ...outcome };
    },

    /** The decision row already recorded approved/rejected; this keeps the
     * delivery outcome next to it so a reloaded card can say "sent" truthfully
     * instead of implying approval and delivery are the same thing. */
    async recordSendResult(requestId: number, effective: OutboundMessageMeta, outcome: { sent: boolean; discarded?: boolean; result?: string; error?: string }) {
        try {
            const { db } = await import("@server/database_service.js");
            const { approvalRequests } = await import("@shared/schema/index.js");
            const { eq } = await import("drizzle-orm");
            const sendResult = {
                sent: outcome.sent,
                discarded: outcome.discarded === true,
                result: outcome.result ?? null,
                error: outcome.error ?? null,
                at: new Date().toISOString(),
            };
            // The row keeps the EFFECTIVE draft — post-edit body/subject — so
            // what was actually sent is what's on record, not the pre-edit text.
            await db.update(approvalRequests)
                .set({ modifiedOutput: { ...(effective as any), sendResult } })
                .where(eq(approvalRequests.id, requestId));
        } catch (err: any) {
            logger.warn("Could not persist outbound send result", { approvalId: requestId, error: err?.message });
        }
    },

    /** Post the outcome into the room that raised the draft so the ledger
     * shows the send actually happened (or failed), not just that a card was
     * rendered. The turn is attributed to the agent that drafted it and its
     * tools_used carries the send verdict — crew_turns stays the ground truth. */
    async postRoomAck(meta: OutboundMessageMeta, organizationId: number, approvalId: number, outcome: SendOutcome, decision: string) {
        if (!meta.sessionKey) return;
        try {
            const { crewRepository } = await import("@domain/crew/core/crew-repository.js");
            const room = await crewRepository.findSession(organizationId, meta.sessionKey);
            if (!room) return;

            const channel = meta.channel === "slack" ? "Slack message" : "email";
            const to = (meta.to ?? []).join(", ");
            const sendName = meta.channel === "slack" ? "slack" : meta.sendTool || "send_email";
            const content =
                decision === "rejected"
                    ? `The ${channel} draft to ${to} was discarded.`
                    : outcome.sent
                        ? `The ${channel} to ${to} was sent from the review card.`
                        : `The ${channel} to ${to} was approved but delivery failed: ${outcome.error ?? "unknown error"}.`;

            await crewRepository.postTurn(organizationId, room.id, {
                speakerType: "agent",
                agentCardId: meta.agentCardId ?? null,
                speakerName: meta.agentName ?? "Outbound",
                content,
                intent: "outbound_message_result",
                toolsUsed: [{ name: sendName, ok: outcome.sent, ms: 0 }],
                artifacts: [{
                    tool: "propose_outbound_message",
                    payload: {
                        ...meta,
                        proposalId: approvalId,
                        status: decision === "rejected" ? "rejected" : "approved",
                        sendResult: { sent: outcome.sent, error: outcome.error ?? null },
                    },
                }],
            });
        } catch (err: any) {
            logger.warn("Outbound room acknowledgment failed", { error: err?.message });
        }
    },

    async sendEmail(organizationId: number, meta: OutboundMessageMeta, actor: { userId: string }): Promise<SendOutcome> {
        const toolName = meta.sendTool && ["send_email", "send_agentmail", "gmail_send", "reply_agentmail"].includes(meta.sendTool)
            ? meta.sendTool
            : "send_email";
        const { getAgentTools } = await import("@domain/tools/v1/capabilities/index.js");
        const tool = getAgentTools()[toolName];
        if (!tool) throw new Error(`Send tool '${toolName}' is not available.`);

        if (toolName === "reply_agentmail" && meta.messageId) {
            const result = await tool.execute(
                { messageId: meta.messageId, text: meta.body ?? "", cc: meta.cc ?? undefined },
                { organizationId, userId: actor.userId, sessionKey: meta.sessionKey ?? undefined } as any,
            );
            return this.classify(result);
        }

        const result = await tool.execute(
            {
                to: meta.to ?? [],
                from: meta.from ?? undefined,
                subject: meta.subject ?? "",
                text: meta.body ?? "",
                body: meta.body ?? "",
                cc: meta.cc ?? undefined,
            },
            // sessionKey lets send_agentmail thread-link the sent email back to
            // the room it was drafted in.
            { organizationId, userId: actor.userId, sessionKey: meta.sessionKey ?? undefined } as any,
        );
        return this.classify(result);
    },

    async sendSlack(organizationId: number, meta: OutboundMessageMeta): Promise<SendOutcome> {
        const { slackService } = await import("./slack.service.js");
        const workspaces = await slackService.listWorkspaces(organizationId);
        if (workspaces.length === 0) {
            return { sent: false, error: "No Slack workspace is connected for this organization." };
        }
        // A named workspace must match. Falling back to the first connected
        // one would post the approved message into a different Slack than the
        // card showed the reviewer.
        const workspace = meta.workspace
            ? workspaces.find((w: any) => w.name === meta.workspace || w.teamName === meta.workspace)
            : workspaces.length === 1 ? workspaces[0] : undefined;
        if (!workspace) {
            return {
                sent: false,
                error: meta.workspace
                    ? `Slack workspace '${meta.workspace}' is not connected for this organization.`
                    : "Several Slack workspaces are connected and the draft names none of them.",
            };
        }

        const channel = (meta.to ?? [])[0];
        if (!channel) return { sent: false, error: "The draft names no Slack channel." };

        const result = await slackService.sendMessage(workspace.id, {
            channel,
            text: meta.body ?? "",
            threadTs: meta.threadTs ?? undefined,
        });
        return { sent: true, result: `Posted to ${channel} (ts ${result?.ts ?? "unknown"})` };
    },

    classify(result: unknown): SendOutcome {
        const output = typeof result === "string" ? result : JSON.stringify(result);
        if (/^failed|error:/i.test(output)) {
            return { sent: false, error: output.slice(0, 300) };
        }
        return { sent: true, result: output.slice(0, 300) };
    },
};
