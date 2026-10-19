import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

export const AgentMailSendInput = z.object({
    to: z.array(z.string().email()).min(1).describe("Recipient email addresses"),
    subject: z.string().describe("Email subject line"),
    text: z.string().optional().describe("Plain-text body"),
    html: z.string().optional().describe("HTML body (overrides text if both provided)"),
    thread_id: z.string().optional().describe("Thread ID to reply into an existing conversation"),
});

export const AgentMailListThreadsInput = z.object({
    limit: z.number().int().min(1).max(100).default(20).describe("Max threads to return"),
});

export const AgentMailGetThreadInput = z.object({
    thread_id: z.string().describe("Thread ID to retrieve"),
});

export const agentMailToolDefinitions: Tool[] = [
    {
        name: "agentmail_send",
        description:
            "Send an email from the configured AgentMail inbox (AGENTMAIL_INBOX). " +
            "Use this to notify humans, request approvals, deliver mission results, or initiate " +
            "agent-to-agent communication over email. Replies to this inbox are automatically " +
            "processed — recipients can reply APPROVE/REJECT <passcode> to resolve HIL requests, " +
            "or STEER <guidance> to nudge an active mission.",
        inputSchema: {
            type: "object",
            properties: {
                to:        { type: "array", items: { type: "string" }, description: "Recipient email addresses" },
                subject:   { type: "string", description: "Subject line" },
                text:      { type: "string", description: "Plain-text body" },
                html:      { type: "string", description: "HTML body" },
                thread_id: { type: "string", description: "Reply into an existing thread" },
            },
            required: ["to", "subject"],
        },
    },
    {
        name: "agentmail_list_threads",
        description:
            "List recent email threads in the Oddjob agentmail inbox. " +
            "Use this to check for pending replies, review conversation history, or audit inbound messages.",
        inputSchema: {
            type: "object",
            properties: {
                limit: { type: "number", description: "Max threads to return (1–100, default 20)" },
            },
        },
    },
    {
        name: "agentmail_get_thread",
        description:
            "Retrieve the full message history for a specific email thread. " +
            "Use this to read a reply before deciding how to continue a workflow.",
        inputSchema: {
            type: "object",
            properties: {
                thread_id: { type: "string", description: "Thread ID to retrieve" },
            },
            required: ["thread_id"],
        },
    },
];
