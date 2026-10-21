/**
 * Inbound mail for one organization's AgentMail inbox.
 *
 * AgentMail delivers to /api/integrations/agentmail/webhooks/<token>. The token
 * picks the organization; that organization's own signing secret must verify the
 * delivery; the message must be for that organization's inbox. Everything after
 * that is confined to the organization: a reply reaches only its rooms, its
 * missions and its approvals, however the thread or request ID in the mail reads.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { agentmailWebhookEvents, forensicEventLog } from "@shared/schema/index.js";
import { createLogger } from "@server/utils/logger.js";
import { orgAgentMailService } from "./org-agentmail.service.js";
import { verifyAgentMailWebhook } from "./agentmail-webhook-signature.js";

const logger = createLogger("OrgAgentMailInbound");

export interface DeliveryHeaders { id?: string; timestamp?: string; signature?: string }
export interface DeliveryResult { status: number; body: Record<string, unknown> }

/** `Name <addr@x>` or `addr@x`, lower-cased. */
export function senderAddress(from: unknown): string {
    const raw = typeof from === "string" ? from : Array.isArray(from) ? String(from[0] ?? "") : "";
    return (raw.match(/<([^>]+)>/)?.[1] ?? raw).trim().toLowerCase();
}

function plainText(message: Record<string, any>): string {
    if (typeof message.text === "string" && message.text.trim()) return message.text;
    if (typeof message.html === "string" && message.html.trim()) {
        return message.html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/p>/gi, "\n")
            .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
            .replace(/[ \t]+/g, " ").trim();
    }
    return typeof message.preview === "string" ? message.preview : "";
}

export async function handleOrgAgentMailDelivery(token: string, rawBody: Buffer, headers: DeliveryHeaders): Promise<DeliveryResult> {
    const connection = await orgAgentMailService.resolveWebhook(token);
    if (!connection) return { status: 404, body: { error: "Unknown webhook" } };
    const orgId = connection.organizationId;

    if (!verifyAgentMailWebhook(connection.secret, rawBody, headers)) {
        logger.warn("[OrgAgentMailInbound] Rejected a delivery that this organization's secret does not sign", { orgId });
        return { status: 401, body: { error: "Invalid webhook signature" } };
    }

    // The signed bytes, not a re-serialized body: what was verified is what is read.
    let event: Record<string, any>;
    try { event = JSON.parse(rawBody.toString("utf8")); }
    catch { return { status: 400, body: { error: "Invalid JSON" } }; }

    if (event?.event_type !== "message.received") return { status: 200, body: { ok: true, skipped: "event type" } };
    const message = event.message as Record<string, any> | undefined;
    const eventId = typeof event.event_id === "string" ? event.event_id : "";
    if (!message || !eventId) return { status: 400, body: { error: "Malformed message event" } };

    // The webhook is registered for this inbox alone. Anything else is not this
    // organization's mail, whatever signed it.
    if (message.inbox_id !== connection.inboxId) {
        logger.warn("[OrgAgentMailInbound] Delivery for an inbox this organization does not own", { orgId });
        return { status: 403, body: { error: "Message is not for this organization's inbox" } };
    }

    // AgentMail retries with the same event_id; handle each event once.
    const [fresh] = await db.insert(agentmailWebhookEvents).values({ organizationId: orgId, eventId })
        .onConflictDoNothing().returning({ eventId: agentmailWebhookEvents.eventId });
    if (!fresh) return { status: 200, body: { ok: true, duplicate: true } };

    try {
        return await processMessage(orgId, message);
    } catch (error) {
        // Not handled after all: release the event so AgentMail's retry is processed.
        await forgetDeliveredEvent(orgId, eventId).catch(() => {});
        throw error;
    }
}

async function processMessage(orgId: number, message: Record<string, any>): Promise<DeliveryResult> {
    const fromEmail = senderAddress(message.from);
    const bodyText = plainText(message);
    const threadId = typeof message.thread_id === "string" ? message.thread_id : "";
    const subject = typeof message.subject === "string" ? message.subject : "";
    if (!fromEmail || !bodyText) return { status: 200, body: { ok: true, skipped: "missing sender or body" } };

    const { agentMailThreadSync } = await import("./agentmail-thread-sync.service.js");
    const { parseEmailIntent, getApprovalByRequestId, getLatestPendingApprovalForEmail, verifyHighRiskAction } =
        await import("./agentmail-intent.service.js");
    const ack = async (text: string) => {
        try {
            const { agentMailService } = await import("./agentmail.service.js");
            await (await agentMailService.forOrg(orgId)).sendAck(fromEmail, threadId, text);
        } catch (error) {
            logger.warn("[OrgAgentMailInbound] Acknowledgement not sent", { orgId, error: (error as Error).message });
        }
    };

    // 1. A reply on a thread a CREW room sent goes back into that room.
    if (threadId) {
        const room = await agentMailThreadSync.routeReplyToCrewSession(threadId, fromEmail, bodyText, subject, orgId);
        if (room.success) {
            await audit(orgId, { fromEmail, threadId, subject, destination: "crew" });
            return { status: 200, body: { ok: true, destination: "crew", sessionKey: room.sessionKey, turnId: room.turnId } };
        }
    }

    const parsed = await parseEmailIntent(bodyText);
    await audit(orgId, { fromEmail, threadId, subject, intent: parsed.intent, requestId: parsed.requestId, hasPasscode: !!parsed.passcode });

    // 2. STEER on a mission's own thread steers that mission. Steering by email
    // outside a mission thread is not accepted: there is no mission to apply it to.
    if (parsed.intent === "steer") {
        const routed = threadId
            ? await agentMailThreadSync.routeReplyToMission(threadId, fromEmail, parsed.payload || bodyText, orgId)
            : { success: false };
        await ack(routed.success
            ? "✅ Your reply has been applied to the mission. The agent will factor it in on the next evaluation."
            : "This reply could not be matched to a mission. Reply on the mission's own email thread to steer it.");
        return { status: 200, body: { ok: true, intent: "steer", threadRouted: routed.success } };
    }

    // 3. APPROVE / REJECT with the one-time passcode, for this organization's approvals only.
    if (parsed.intent === "approve" || parsed.intent === "reject") {
        const approval = parsed.requestId
            ? await getApprovalByRequestId(parsed.requestId, orgId)
            : await getLatestPendingApprovalForEmail(fromEmail, orgId);
        if (!approval) {
            await ack("No pending approval was found for your account. Check the Decision Inbox in Oddjob.");
            return { status: 200, body: { ok: true, intent: parsed.intent, decided: false } };
        }
        if (approval.status !== "pending") {
            await ack(`Request #${approval.id} has already been ${approval.status}. No action taken.`);
            return { status: 200, body: { ok: true, intent: parsed.intent, decided: false } };
        }
        if (approval.approverEmail && approval.approverEmail.toLowerCase() !== fromEmail) {
            await ack("This approval was sent to a different address. Action not taken.");
            return { status: 200, body: { ok: true, intent: parsed.intent, decided: false } };
        }
        const gate = await verifyHighRiskAction(fromEmail, approval.executionId, parsed.passcode, orgId);
        if (!gate.ok) {
            await ack(`⚠️ Could not process your request: ${gate.reason}`);
            return { status: 200, body: { ok: true, intent: parsed.intent, decided: false } };
        }
        const decision = parsed.intent === "approve" ? "approved" : "rejected";
        try {
            // The same decision path as the Decision Inbox and Slack: approver
            // authority, escalated sends and the follow-on actions all apply.
            const { approvalService } = await import("./approval.service.js");
            await approvalService.processDecision(approval.id, { decision, comments: `Decided by email reply from ${fromEmail}` }, gate.userId, fromEmail);
        } catch (error) {
            await ack(`⚠️ Could not ${parsed.intent} request #${approval.id}: ${(error as Error).message}`);
            return { status: 200, body: { ok: true, intent: parsed.intent, decided: false } };
        }
        await ack(`✅ Request #${approval.id} has been ${decision}.`);
        return { status: 200, body: { ok: true, intent: parsed.intent, decided: true, requestId: approval.id } };
    }

    return { status: 200, body: { ok: true, intent: "unknown" } };
}

async function audit(organizationId: number, attributes: Record<string, unknown>) {
    const now = Date.now();
    await db.insert(forensicEventLog).values({
        traceId: `agentmail-${organizationId}-${now}`,
        spanId: `inbound-${now}`,
        startTimeNs: BigInt(now) * 1000000n,
        jobType: "agentmail_inbound",
        status: "info",
        organizationId,
        attributes,
    } as any).catch(() => {});
}

async function forgetDeliveredEvent(organizationId: number, eventId: string) {
    await db.delete(agentmailWebhookEvents)
        .where(and(eq(agentmailWebhookEvents.organizationId, organizationId), eq(agentmailWebhookEvents.eventId, eventId)));
}
