import { z } from "zod";
import type { ToolDefinition } from "./types.js";
import { MICROSOFT_DOCUMENT_TOOLS } from './microsoft-documents.js';

async function resolveM365Credential(orgId?: number | null): Promise<number | undefined> {
    if (!orgId) return undefined;
    try {
        const { db } = await import("@server/database_service.js");
        const { saasConnectors } = await import("@shared/schema/index.js");
        const { eq, and } = await import("drizzle-orm");
        const [connector] = await db
            .select({ id: saasConnectors.id })
            .from(saasConnectors)
            .where(and(eq(saasConnectors.orgId, orgId), eq(saasConnectors.platform, "microsoft365")))
            .limit(1);
        return connector?.id;
    } catch {
        return undefined;
    }
}

export const MICROSOFT365_TOOLS: Record<string, ToolDefinition> = {
    ...MICROSOFT_DOCUMENT_TOOLS,
    teams_post_message: {
        name: "teams_post_message",

        idempotency: "none",
        label: "Post Teams Message",
        group: "Microsoft 365",
        description: "Post a message to a Microsoft Teams channel.",
        parameters: z.object({
            teamId: z.string().describe("Microsoft Teams team ID"),
            channelId: z.string().describe("Channel ID within the team"),
            message: z.string().describe("Message content"),
            isHtml: z.boolean().optional().describe("Whether the message body is HTML"),
            subject: z.string().optional().describe("Optional message subject"),
        }),
        execute: async (params, context) => {
            const { getMicrosoft365Client } = await import("../../../integrations/microsoft365-service.js");
            const credentialId = await resolveM365Credential(context?.organizationId);
            if (!credentialId) return JSON.stringify({ error: "No Microsoft 365 credential configured. Add one in Settings." });
            const client = await getMicrosoft365Client(credentialId, context?.organizationId || null);
            const result = await client.postTeamsMessage(params.teamId, params.channelId, params.message, params.isHtml, params.subject);
            return JSON.stringify({ messageId: result.id, status: "sent" });
        },
    },

    teams_list_channels: {
        name: "teams_list_channels",

        idempotency: "read-safe",
        label: "List Teams Channels",
        group: "Microsoft 365",
        description: "List all channels in a Microsoft Teams team.",
        parameters: z.object({
            teamId: z.string().describe("Microsoft Teams team ID"),
        }),
        execute: async (params, context) => {
            const { getMicrosoft365Client } = await import("../../../integrations/microsoft365-service.js");
            const credentialId = await resolveM365Credential(context?.organizationId);
            if (!credentialId) return JSON.stringify({ error: "No Microsoft 365 credential configured." });
            const client = await getMicrosoft365Client(credentialId, context?.organizationId || null);
            const channels = await client.listChannels(params.teamId);
            return JSON.stringify(channels.map((c: any) => ({ id: c.id, name: c.displayName, description: c.description })));
        },
    },

    teams_list_teams: {
        name: "teams_list_teams",

        idempotency: "read-safe",
        label: "List Teams",
        group: "Microsoft 365",
        description: "List all Microsoft Teams the authenticated user belongs to.",
        parameters: z.object({}),
        execute: async (params, context) => {
            const { getMicrosoft365Client } = await import("../../../integrations/microsoft365-service.js");
            const credentialId = await resolveM365Credential(context?.organizationId);
            if (!credentialId) return JSON.stringify({ error: "No Microsoft 365 credential configured." });
            const client = await getMicrosoft365Client(credentialId, context?.organizationId || null);
            const teams = await client.listTeams();
            return JSON.stringify(teams.map((t: any) => ({ id: t.id, name: t.displayName, description: t.description })));
        },
    },

    sharepoint_list_files: {
        name: "sharepoint_list_files",

        idempotency: "read-safe",
        label: "List SharePoint Files",
        group: "Microsoft 365",
        description: "List files in a SharePoint site drive folder.",
        parameters: z.object({
            siteId: z.string().describe("SharePoint site ID"),
            folderPath: z.string().optional().describe("Folder path (default: root /). Example: /Documents/Reports"),
        }),
        execute: async (params, context) => {
            const { getMicrosoft365Client } = await import("../../../integrations/microsoft365-service.js");
            const credentialId = await resolveM365Credential(context?.organizationId);
            if (!credentialId) return JSON.stringify({ error: "No Microsoft 365 credential configured." });
            const client = await getMicrosoft365Client(credentialId, context?.organizationId || null);
            const items = await client.listDriveItems(params.siteId, undefined, params.folderPath || "/");
            return JSON.stringify(items.map((i: any) => ({
                name: i.name,
                id: i.id,
                type: i.folder ? "folder" : "file",
                size: i.size,
                lastModified: i.lastModifiedDateTime,
                url: i.webUrl,
            })));
        },
    },

    calendar_list_events: {
        name: "calendar_list_events",

        idempotency: "read-safe",
        label: "List Calendar Events",
        group: "Microsoft 365",
        description: "List upcoming calendar events from Microsoft 365 / Outlook.",
        parameters: z.object({
            startDateTime: z.string().optional().describe("ISO 8601 start time filter (e.g. 2025-01-01T00:00:00)"),
            top: z.number().optional().describe("Maximum number of events to return (default 10)"),
        }),
        execute: async (params, context) => {
            const { getMicrosoft365Client } = await import("../../../integrations/microsoft365-service.js");
            const credentialId = await resolveM365Credential(context?.organizationId);
            if (!credentialId) return JSON.stringify({ error: "No Microsoft 365 credential configured." });
            const client = await getMicrosoft365Client(credentialId, context?.organizationId || null);
            const events = await client.listEvents(undefined, params.startDateTime, undefined, params.top || 10);
            return JSON.stringify(events.map((e: any) => ({
                id: e.id,
                subject: e.subject,
                start: e.start?.dateTime,
                end: e.end?.dateTime,
                organizer: e.organizer?.emailAddress?.address,
                attendees: e.attendees?.map((a: any) => a.emailAddress?.address),
                location: e.location?.displayName,
                webLink: e.webLink,
            })));
        },
    },

    calendar_create_event: {
        name: "calendar_create_event",

        idempotency: "none",
        label: "Create Calendar Event",
        group: "Microsoft 365",
        description: "Create a new calendar event in Microsoft 365 / Outlook.",
        parameters: z.object({
            subject: z.string().describe("Event title"),
            body: z.string().optional().describe("Event description"),
            startDateTime: z.string().describe("ISO 8601 start time in UTC (e.g. 2025-06-01T14:00:00)"),
            endDateTime: z.string().describe("ISO 8601 end time in UTC"),
            attendees: z.array(z.string()).optional().describe("List of attendee email addresses"),
        }),
        execute: async (params, context) => {
            const { getMicrosoft365Client } = await import("../../../integrations/microsoft365-service.js");
            const credentialId = await resolveM365Credential(context?.organizationId);
            if (!credentialId) return JSON.stringify({ error: "No Microsoft 365 credential configured." });
            const client = await getMicrosoft365Client(credentialId, context?.organizationId || null);
            const event = await client.createEvent(params.subject, params.body || "", params.startDateTime, params.endDateTime, params.attendees || []);
            return JSON.stringify({ id: event.id, subject: event.subject, webLink: event.webLink });
        },
    },

    outlook_send_email: {
        name: "outlook_send_email",

        idempotency: "none",
        label: "Send Outlook Email",
        group: "Microsoft 365",
        description: "Send an email via Microsoft 365 / Outlook.",
        parameters: z.object({
            to: z.array(z.string()).describe("Recipient email addresses"),
            subject: z.string().describe("Email subject"),
            body: z.string().describe("Email body content"),
            isHtml: z.boolean().optional().describe("Whether the body is HTML"),
        }),
        execute: async (params, context) => {
            const { CREW_TASK_PROPOSAL_TOOLS } = await import("./crew-task-proposal-tools.js");
            return CREW_TASK_PROPOSAL_TOOLS.propose_outbound_message.execute({ channel: "email", to: params.to, subject: params.subject, body: params.body, bodyFormat: params.isHtml ? "html" : "plain", sendTool: "outlook_send_email", sensitivity: "requested_review", reason: "Confirm the Google or Microsoft account for this email." }, context);
        },
    },
};
