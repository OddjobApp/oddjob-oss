import { z } from "zod";
import type { ToolDefinition } from "./types.js";
import { getTwilioConfig, twilioRequest } from "./twilio-helpers.js";

export const TWILIO_TOOLS: Record<string, ToolDefinition> = {
    sms_send: {
        name: "sms_send",

        idempotency: "none",
        label: "Send SMS",
        group: "Twilio / SMS",
        description: "Send an SMS text message via Twilio. Requires a Twilio credential with account SID, auth token, and from number.",
        parameters: z.object({
            to: z.string().describe("Recipient phone number in E.164 format (e.g. +15550001234)"),
            message: z.string().max(1600).describe("SMS message body (max 1600 chars)"),
            from: z.string().optional().describe("Sender phone number (overrides default configured number)"),
        }),
        execute: async (params, context) => {
            const config = await getTwilioConfig(context?.organizationId);
            if (!config) return "Twilio is not configured. Add a Twilio credential in Settings.";
            const fromNumber = params.from || config.fromNumber;
            if (!fromNumber) return "No sender phone number configured. Provide a 'from' number or configure one in your Twilio credential.";
            const data = await twilioRequest(config, "/Messages.json", {
                To: params.to,
                From: fromNumber,
                Body: params.message,
            });
            return JSON.stringify({ sid: data.sid, status: data.status, to: data.to, from: data.from });
        },
    },

    sms_send_bulk: {
        name: "sms_send_bulk",

        idempotency: "none",
        label: "Send Bulk SMS",
        group: "Twilio / SMS",
        description: "Send the same SMS to multiple recipients. Use sparingly — confirm recipient list before sending.",
        parameters: z.object({
            recipients: z.array(z.string()).max(50).describe("List of recipient phone numbers in E.164 format"),
            message: z.string().max(1600).describe("SMS message body"),
        }),
        execute: async (params, context) => {
            const config = await getTwilioConfig(context?.organizationId);
            if (!config) return "Twilio is not configured. Add a Twilio credential in Settings.";
            if (!config.fromNumber) return "No sender phone number configured in Twilio credential.";
            const results: any[] = [];
            for (const to of params.recipients) {
                try {
                    const data = await twilioRequest(config, "/Messages.json", {
                        To: to,
                        From: config.fromNumber,
                        Body: params.message,
                    });
                    results.push({ to, sid: data.sid, status: data.status });
                } catch (err: any) {
                    results.push({ to, error: err.message });
                }
            }
            const sent = results.filter(r => !r.error).length;
            const failed = results.filter(r => r.error).length;
            return JSON.stringify({ sent, failed, results }, null, 2);
        },
    },

    sms_list_messages: {
        name: "sms_list_messages",

        idempotency: "read-safe",
        label: "List Twilio Messages",
        group: "Twilio / SMS",
        description: "List recent SMS messages sent or received via Twilio.",
        parameters: z.object({
            to: z.string().optional().describe("Filter by recipient number"),
            from: z.string().optional().describe("Filter by sender number"),
            limit: z.number().min(1).max(100).default(20).optional(),
        }),
        execute: async (params, context) => {
            const config = await getTwilioConfig(context?.organizationId);
            if (!config) return "Twilio is not configured. Add a Twilio credential in Settings.";
            let path = `/Messages.json?PageSize=${params.limit || 20}`;
            if (params.to) path += `&To=${encodeURIComponent(params.to)}`;
            if (params.from) path += `&From=${encodeURIComponent(params.from)}`;
            const data = await twilioRequest(config, path);
            const messages = (data.messages || []).map((m: any) => ({
                sid: m.sid,
                from: m.from,
                to: m.to,
                body: m.body,
                status: m.status,
                date_sent: m.date_sent,
                direction: m.direction,
            }));
            return JSON.stringify(messages, null, 2);
        },
    },
};
