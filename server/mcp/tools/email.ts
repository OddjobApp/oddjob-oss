
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

export const SendEmailInput = z.object({
    from: z.string().describe("Sender email address (must be verified or use onboarding@resend.dev)"),
    to: z.array(z.string().email()).describe("List of recipient email addresses"),
    subject: z.string().describe("Subject of the email"),
    html: z.string().optional().describe("HTML content of the email"),
    text: z.string().optional().describe("Text content of the email"),
    cc: z.array(z.string().email()).optional().describe("CC recipients"),
    bcc: z.array(z.string().email()).optional().describe("BCC recipients"),
    reply_to: z.string().email().optional().describe("Reply-To address"),
});

export const emailToolDefinitions: Tool[] = [
    {
        name: "send_email",
        description: "Send an email using the Resend API. Requires a valid Resend API key configured in the SaaS connectors.",
        inputSchema: {
            type: "object",
            properties: {
                from: { type: "string", description: "Sender email address (must be verified or use user@domain.com)" },
                to: { type: "array", items: { type: "string" }, description: "List of recipient email addresses" },
                subject: { type: "string", description: "Subject of the email" },
                html: { type: "string", description: "HTML content of the email" },
                text: { type: "string", description: "Text content of the email" },
                cc: { type: "array", items: { type: "string" }, description: "CC recipients" },
                bcc: { type: "array", items: { type: "string" }, description: "BCC recipients" },
                reply_to: { type: "string", description: "Reply-To address" },
            },
            required: ["from", "to", "subject"],
        },
    },
];

