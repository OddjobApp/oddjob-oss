import { z } from "zod";
import type { ToolDefinition } from "./types.js";
import { agentMailService } from "../../../integrations/core/agentmail.service.js";
import { requireToolOrgId } from "./org-context.js";
import { agentMailThreadScope, threadScopeCtx } from "../../../integrations/core/agentmail-thread-scope.service.js";

/** Who is asking, as project access sees it. */
function scopeOf(context: any) {
    const orgId = requireToolOrgId(context);
    return { orgId, ctx: threadScopeCtx(context, orgId) };
}

export const AGENTMAIL_TOOLS: Record<string, ToolDefinition> = {
    send_agentmail: {
        name: "send_agentmail",

        idempotency: "none",
        label: "Send AgentMail Email",
        group: "Integrations",
        description: "Send an outbound email from the configured AgentMail inbox. Supports rich styling, CC/BCC, and labels.",
        parameters: z.object({
            to: z.union([z.string(), z.array(z.string())]).describe("Recipient email address or list of addresses"),
            subject: z.string().describe("Email subject line"),
            body: z.string().optional().describe("Email body content (alias for text)"),
            message: z.string().optional().describe("Email message content (alias for text)"),
            text: z.string().optional().describe("Plain text content"),
            html: z.string().optional().describe("HTML content"),
            threadId: z.string().optional().describe("Optional thread ID to group messages"),
            cc: z.union([z.string(), z.array(z.string())]).optional().describe("CC recipients"),
            bcc: z.union([z.string(), z.array(z.string())]).optional().describe("BCC recipients"),
            labels: z.array(z.string()).optional().describe("Labels to apply to the message"),
            clientId: z.string().optional().describe("Optional unique client ID for idempotency")
        }),
        execute: async (params: any, context?: any) => {
            try {
                const { orgId, ctx } = scopeOf(context);
                // Writing into a thread is reading it: its quoted history goes with the reply.
                if (params.threadId) await agentMailThreadScope.assertReadable(ctx, params.threadId);
                const mail = await agentMailService.forOrg(orgId);
                const toList = Array.isArray(params.to) ? params.to : [params.to];
                const contentText = params.text || params.body || params.message || "";

                const result = await mail.send({
                    to: toList,
                    subject: params.subject,
                    text: contentText,
                    html: params.html,
                    thread_id: params.threadId,
                    cc: params.cc ? (Array.isArray(params.cc) ? params.cc : [params.cc]) : undefined,
                    bcc: params.bcc ? (Array.isArray(params.bcc) ? params.bcc : [params.bcc]) : undefined,
                    labels: params.labels,
                    client_id: params.clientId
                });

                // A thread started from a project's room or mission is that project's.
                if (result.thread_id && context?.projectId) {
                    await agentMailThreadScope.record(orgId, result.thread_id, {
                        projectId: Number(context.projectId),
                        crewSessionId: context?.sessionId ?? null,
                        missionRunId: context?.missionRunId ?? null,
                    });
                } else if (result.thread_id && context?.missionRunId) {
                    await agentMailThreadScope.recordForMissionRun(orgId, result.thread_id, Number(context.missionRunId));
                }

                if (context?.sessionKey && result.thread_id) {
                    try {
                        const { agentMailThreadSync } = await import("../../../integrations/core/agentmail-thread-sync.service.js");
                        await agentMailThreadSync.linkThreadToCrewSession(
                            result.thread_id,
                            context.sessionKey,
                            toList[0],
                            orgId
                        );
                    } catch {
                        // non-blocking
                    }
                }

                return `Email sent successfully to ${toList.join(", ")}. Message ID: ${result.message_id}, Thread ID: ${result.thread_id}`;
            } catch (err: any) {
                return `Error: Failed to send email via AgentMail: ${err.message}`;
            }
        }
    },
    send_email: {
        name: "send_email",

        idempotency: "none",
        label: "Send Outbound Email",
        group: "Integrations",
        description: "Send an outbound email via AgentMail. Specify recipient (to), subject, and body/text.",
        parameters: z.object({
            to: z.union([z.string(), z.array(z.string())]).describe("Recipient email address or list of addresses"),
            subject: z.string().describe("Email subject line"),
            body: z.string().optional().describe("Email body content"),
            message: z.string().optional().describe("Email message content"),
            text: z.string().optional().describe("Plain text content"),
            html: z.string().optional().describe("HTML content"),
            cc: z.union([z.string(), z.array(z.string())]).optional().describe("CC recipients"),
            bcc: z.union([z.string(), z.array(z.string())]).optional().describe("BCC recipients")
        }),
        execute: async (params, context) => {
            return AGENTMAIL_TOOLS.send_agentmail.execute(params, context);
        }
    },
    reply_agentmail: {
        name: "reply_agentmail",
        // Sends a message. Not repeatable: a retry is a second reply.
        idempotency: "none",
        group: "Integrations",
        description: "Reply to a specific AgentMail message. This ensures the message is correctly threaded.",
        parameters: z.object({
            messageId: z.string().describe("The ID of the message to reply to"),
            text: z.string().describe("Plain text content of the reply"),
            html: z.string().optional().describe("HTML content of the reply"),
            cc: z.array(z.string()).optional().describe("CC recipients"),
            bcc: z.array(z.string()).optional().describe("BCC recipients"),
            replyAll: z.boolean().optional().describe("Whether to reply to all original recipients"),
            clientId: z.string().optional().describe("Optional unique client ID for idempotency")
        }),
        execute: async (params, context) => {
            try {
                const { orgId, ctx } = scopeOf(context);
                const mail = await agentMailService.forOrg(orgId);
                const original = await mail.getMessage(params.messageId);
                await agentMailThreadScope.assertReadable(ctx, original.thread_id);
                const result = await mail.reply(params.messageId, {
                    text: params.text,
                    html: params.html,
                    cc: params.cc,
                    bcc: params.bcc,
                    reply_all: params.replyAll,
                    client_id: params.clientId
                });
                return `Reply sent successfully. Message ID: ${result.message_id}, Thread ID: ${result.thread_id}`;
            } catch (err: any) {
                return `Error: Failed to reply via AgentMail: ${err.message}`;
            }
        }
    },
    list_agentmail_threads: {
        name: "list_agentmail_threads",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "List AgentMail Threads",
        group: "Integrations",
        description: "List recent conversation threads from the AgentMail inbox.",
        parameters: z.object({
            limit: z.number().optional().default(10).describe("Number of threads to retrieve")
        }),
        execute: async (params, context) => {
            try {
                const { orgId, ctx } = scopeOf(context);
                const mail = await agentMailService.forOrg(orgId);
                const result = await mail.listThreads(params.limit);
                const threads = await agentMailThreadScope.filterThreads(ctx, result.threads ?? []);
                return JSON.stringify({ ...result, count: threads.length, threads }, null, 2);
            } catch (err: any) {
                return `Error: Failed to list AgentMail threads: ${err.message}`;
            }
        }
    },
    get_agentmail_thread: {
        name: "get_agentmail_thread",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Get AgentMail Thread",
        group: "Integrations",
        description: "Retrieve all messages in a specific AgentMail thread.",
        parameters: z.object({
            threadId: z.string().describe("The ID of the thread to retrieve")
        }),
        execute: async (params, context) => {
            try {
                const { orgId, ctx } = scopeOf(context);
                await agentMailThreadScope.assertReadable(ctx, params.threadId);
                const mail = await agentMailService.forOrg(orgId);
                const result = await mail.getThread(params.threadId);
                return JSON.stringify(result, null, 2);
            } catch (err: any) {
                return `Error: Failed to get AgentMail thread: ${err.message}`;
            }
        }
    }
};
