/**
 * AgentMail Service
 *
 * Wraps the AgentMail REST API (https://api.agentmail.to/v0).
 * Provides: send, list threads/messages, HMAC webhook signature verification.
 *
 * Credentials (set in environment):
 *   AGENTMAIL_API_KEY   — Bearer token
 *   AGENTMAIL_INBOX     — the inbox to send from, e.g. your-inbox@agentmail.to
 *   AGENTMAIL_WEBHOOK_SECRET — whsec_... returned when the webhook was registered
 */

import crypto from "crypto";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("AgentMailService");

const BASE_URL = "https://api.agentmail.to/v0";

export interface AgentMailMessage {
    message_id: string;
    thread_id: string;
    from: string;
    to: string[];
    subject: string;
    text?: string;
    html?: string;
    created_at: string;
}

export interface AgentMailThread {
    thread_id: string;
    subject: string;
    messages: AgentMailMessage[];
    updated_at: string;
    created_at: string;
}

export interface SendMessageParams {
    to: string[];
    subject: string;
    text?: string;
    html?: string;
    thread_id?: string;  // reply into existing thread
    cc?: string[];
    bcc?: string[];
    reply_to?: string;
    labels?: string[];
    client_id?: string;
    attachments?: Array<{
        filename: string;
        content_base64: string;
        content_type: string;
    }>;
}

export interface ReplyMessageParams {
    text: string;
    html?: string;
    cc?: string[];
    bcc?: string[];
    reply_all?: boolean;
    client_id?: string;
    attachments?: Array<{
        filename: string;
        content_base64: string;
        content_type: string;
    }>;
}

export interface ForwardMessageParams {
    to: string[];
    subject?: string;
    text?: string;
    html?: string;
    client_id?: string;
}

export interface SendMessageResult {
    message_id: string;
    thread_id: string;
}

class AgentMailService {
    private get apiKey(): string {
        return process.env.AGENTMAIL_API_KEY ?? "";
    }

    private get inbox(): string {
        return process.env.AGENTMAIL_INBOX ?? "";
    }

    private get webhookSecret(): string {
        return process.env.AGENTMAIL_WEBHOOK_SECRET ?? "";
    }

    isConfigured(): boolean {
        return !!this.apiKey && !!this.inbox;
    }

    private headers(): Record<string, string> {
        return {
            "Authorization": `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
        };
    }

    private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
        const res = await fetch(`${BASE_URL}${path}`, {
            method,
            headers: this.headers(),
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });

        const json = await res.json() as any;
        if (!res.ok) {
            throw new Error(`AgentMail API error [${res.status}]: ${json?.message ?? JSON.stringify(json)}`);
        }
        return json as T;
    }

    // ── Send ────────────────────────────────────────────────────────────────

    async send(params: SendMessageParams): Promise<SendMessageResult> {
        logger.info("[AgentMail] Sending message", { to: params.to, subject: params.subject });
        return this.request<SendMessageResult>(
            "POST",
            `/inboxes/${encodeURIComponent(this.inbox)}/messages/send`,
            params,
        );
    }

    // ── Reply and Forward ───────────────────────────────────────────────────

    /**
     * Reply to a specific message using the explicit reply endpoint
     */
    async reply(messageId: string, params: ReplyMessageParams): Promise<SendMessageResult> {
        logger.info("[AgentMail] Replying to message", { messageId });
        return this.request<SendMessageResult>(
            "POST",
            `/inboxes/${encodeURIComponent(this.inbox)}/messages/${encodeURIComponent(messageId)}/reply`,
            params,
        );
    }

    /**
     * Forward a message
     */
    async forward(messageId: string, params: ForwardMessageParams): Promise<SendMessageResult> {
        logger.info("[AgentMail] Forwarding message", { messageId, to: params.to });
        return this.request<SendMessageResult>(
            "POST",
            `/inboxes/${encodeURIComponent(this.inbox)}/messages/${encodeURIComponent(messageId)}/forward`,
            params,
        );
    }

    /**
     * Update message labels (add/remove)
     */
    async updateLabels(messageId: string, addLabels?: string[], removeLabels?: string[]): Promise<any> {
        return this.request(
            "PATCH",
            `/inboxes/${encodeURIComponent(this.inbox)}/messages/${encodeURIComponent(messageId)}`,
            { add_labels: addLabels, remove_labels: removeLabels },
        );
    }

    // ── Read ─────────────────────────────────────────────────────────────────

    async listThreads(limit = 50): Promise<{ count: number; threads: AgentMailThread[] }> {
        return this.request("GET", `/inboxes/${encodeURIComponent(this.inbox)}/threads?limit=${limit}`);
    }

    async listMessages(limit = 50): Promise<{ count: number; messages: AgentMailMessage[] }> {
        return this.request("GET", `/inboxes/${encodeURIComponent(this.inbox)}/messages?limit=${limit}`);
    }

    async getMessage(messageId: string): Promise<AgentMailMessage> {
        return this.request("GET", `/inboxes/${encodeURIComponent(this.inbox)}/messages/${encodeURIComponent(messageId)}`);
    }

    async getThread(threadId: string): Promise<AgentMailThread> {
        return this.request("GET", `/inboxes/${encodeURIComponent(this.inbox)}/threads/${encodeURIComponent(threadId)}`);
    }

    // ── Webhook HMAC verification ─────────────────────────────────────────────
    // AgentMail sends: svix-id, svix-timestamp, svix-signature headers
    // Signature = HMAC-SHA256(secret, "${svix-id}.${svix-timestamp}.${rawBody}")

    verifyWebhookSignature(
        rawBody: Buffer,
        svixId: string,
        svixTimestamp: string,
        svixSignature: string,
    ): boolean {
        if (!this.webhookSecret) {
            logger.warn("[AgentMail] No webhook secret configured — skipping HMAC verification");
            return false;
        }

        try {
            // The secret is base64url-encoded after the "whsec_" prefix
            const secretBytes = Buffer.from(this.webhookSecret.replace(/^whsec_/, ""), "base64");
            const toSign = `${svixId}.${svixTimestamp}.${rawBody.toString("utf8")}`;
            const computed = crypto.createHmac("sha256", secretBytes).update(toSign).digest("base64");

            // svix-signature may be prefixed with "v1,"
            const incoming = Buffer.from(svixSignature.replace(/^v1,/, ""), "base64");
            const computedBuf = Buffer.from(computed, "base64");

            if (incoming.length !== computedBuf.length) {
                logger.warn("[AgentMail] Webhook HMAC length mismatch");
                return false;
            }

            const match = crypto.timingSafeEqual(computedBuf, incoming);

            if (!match) logger.warn("[AgentMail] Webhook HMAC mismatch");
            return match;
        } catch (err: any) {
            logger.error("[AgentMail] Webhook HMAC verification error", err);
            return false;
        }
    }

    // ── Convenience: send an actionable HIL email ─────────────────────────────

    async sendHilEmail(opts: {
        to: string;
        subject: string;
        actionSummary: string;
        passcode: string;
        approvalToken: string;
        requestId: number;
        appUrl: string;
        threadId?: string;
        missionRunId?: number; // NEW: link email thread to mission for reply routing
    }): Promise<SendMessageResult> {
        const { to, subject, actionSummary, passcode, approvalToken, requestId, appUrl, threadId, missionRunId } = opts;

        const text = [
            `Oddjob needs your approval for the following action:`,
            ``,
            `  ${actionSummary}`,
            ``,
            `─────────────────────────────────────────`,
            `To APPROVE, reply with:`,
            `  APPROVE ${passcode}`,
            ``,
            `To REJECT, reply with:`,
            `  REJECT ${passcode}`,
            ``,
            `You can also reply with guidance: STEER <your guidance here>`,
            ``,
            `Your passcode is valid for 10 minutes and can only be used once.`,
            `─────────────────────────────────────────`,
            `Or click here to review in the app: ${appUrl}/control/decisions/${requestId}?token=${approvalToken}`,
            ``,
            `Request ID: ${requestId}`,
        ].join("\n");

        const html = `
<div style="font-family:sans-serif;max-width:540px;margin:0 auto;padding:24px">
  <h2 style="color:#7c3aed;margin-bottom:4px">Oddjob — Action Required</h2>
  <p style="color:#71717a;font-size:12px;margin-top:0">Request #${requestId}</p>
  <div style="background:#f4f4f5;border-radius:8px;padding:16px;margin:16px 0">
    <p style="margin:0;font-size:14px;color:#18181b">${actionSummary}</p>
  </div>
  <div style="border:1px solid #e4e4e7;border-radius:8px;padding:16px;margin:16px 0">
    <p style="margin:0 0 8px;font-size:13px;color:#3f3f46">Reply to this email with one of:</p>
    <code style="display:block;padding:8px;background:#18181b;color:#4ade80;border-radius:4px;font-size:14px;margin-bottom:8px">APPROVE ${passcode}</code>
    <code style="display:block;padding:8px;background:#18181b;color:#f87171;border-radius:4px;font-size:14px">REJECT ${passcode}</code>
    <p style="margin:12px 0 0;font-size:11px;color:#a1a1aa">Passcode valid for 10 minutes · one-time use</p>
  </div>
  <p style="font-size:12px;color:#a1a1aa">
    Or <a href="${appUrl}/control/decisions/${requestId}?token=${approvalToken}" style="color:#7c3aed">review in the app</a>.
  </p>
</div>`.trim();

        const result = await this.send({ to: [to], subject, text, html, ...(threadId ? { thread_id: threadId } : {}) });
        
        // Link thread to mission for reply routing (Quick Win: AgentMail Thread Sync)
        if (missionRunId && result.thread_id) {
            const { agentMailThreadSync } = await import("./agentmail-thread-sync.service.js");
            await agentMailThreadSync.linkThreadToMission(result.thread_id, missionRunId, to);
        }
        
        return result;
    }

    // ── Convenience: send a steering nudge acknowledgement ────────────────────

    async sendAck(to: string, threadId: string, message: string): Promise<SendMessageResult> {
        return this.send({
            to: [to],
            subject: "Re: Oddjob",
            text: message,
            html: `<p style="font-family:sans-serif;font-size:14px">${message}</p>`,
            thread_id: threadId,
        });
    }

    // ── Convenience: send Slack Onboarding Invite ─────────────────────────────

    async sendSlackInvite(opts: {
        to: string;
        userName: string;
        appUrl: string;
    }): Promise<SendMessageResult> {
        const { to, userName, appUrl } = opts;
        const subject = "🚀 Welcome to Oddjob Conversational Assistant";

        const html = `
<div style="font-family:sans-serif;max-width:540px;margin:0 auto;padding:24px;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px">
  <div style="text-align:center;margin-bottom:24px">
    <div style="display:inline-block;padding:12px;background:#7c3aed;border-radius:12px;margin-bottom:16px">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
    </div>
    <h1 style="color:#18181b;font-size:24px;font-weight:800;margin:0;letter-spacing:-0.5px">Join the Mission</h1>
  </div>
  
  <p style="color:#3f3f46;font-size:16px;line-height:1.6">
    Hi ${userName},<br><br>
    Oddjob is now ready to assist you directly in Slack. You can now launch missions, approve plans, and receive Sentinel insights without leaving your chat thread.
  </p>

  <div style="background:#f4f4f5;border-radius:8px;padding:20px;margin:24px 0">
    <h3 style="margin:0 0 12px;font-size:14px;color:#18181b;text-transform:uppercase;letter-spacing:1px">Ready to go?</h3>
    <ul style="margin:0;padding-left:20px;color:#71717a;font-size:14px;line-height:1.8">
      <li>Pair your account in one click</li>
      <li>Launch missions via voice or text</li>
      <li>Approve milestones with interactive buttons</li>
    </ul>
  </div>

  <div style="text-align:center;margin:32px 0">
    <a href="${appUrl}/profile" style="background:#18181b;color:#ffffff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px;display:inline-block;box-shadow:0 4px 12px rgba(0,0,0,0.15)">
      Pair My Slack Identity
    </a>
  </div>

  <p style="font-size:12px;color:#a1a1aa;text-align:center;margin-top:32px">
    Requires an active Oddjob account. Questions? Reply to this thread.
  </p>
</div>`.trim();

        return this.send({ 
            to: [to], 
            subject, 
            text: `Hi ${userName}, join Oddjob in Slack here: ${appUrl}/profile`,
            html 
        });
    }
}


export const agentMailService = new AgentMailService();
