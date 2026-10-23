import { GOOGLE_MAIL_DOCS_TOOLS } from './google-mail-docs.js';
import { calendarRange } from './calendar-time.js';
import { gmailDayQuery } from './gmail-time.js';
import { z } from "zod";
import type { ToolDefinition } from "./types.js";
import { getGoogleWorkspaceToken } from '@domain/integrations/google-workspace-connector-bridge.js';

async function gmailRequest(token: string, path: string, method = "GET", body?: any) {
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Gmail API error ${res.status}: ${await res.text()}`);
    if (res.status === 204) return { success: true };
    return res.json();
}

async function driveRequest(token: string, path: string, method = "GET", body?: any) {
    const res = await fetch(`https://www.googleapis.com/drive/v3${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Drive API error ${res.status}: ${await res.text()}`);
    return res.json();
}

import { GOOGLE_CALENDAR_TOOLS } from './google-calendar.js';

export const GOOGLE_WORKSPACE_TOOLS: Record<string, ToolDefinition> = {
    ...GOOGLE_CALENDAR_TOOLS,
    ...GOOGLE_MAIL_DOCS_TOOLS,
    gcal_list_calendars: {
        name: 'gcal_list_calendars', idempotency: 'read-safe', label: 'List Google Calendars', group: 'Google Workspace',
        description: 'List calendars from the connected Google account. This is Google Calendar, not Microsoft Calendar.',
        parameters: z.object({ page_token: z.string().optional() }),
        execute: async (_params, context) => {
            const token = await getGoogleWorkspaceToken(context?.organizationId, context?.projectId, 'calendar_read');
            if (!token) throw new Error('Google Calendar permission is missing. Use connect_platform with platform google_calendar and approve Calendar access.');
            const res = await fetch(`https://www.googleapis.com/calendar/v3/users/me/calendarList${_params.page_token ? '?pageToken=' + encodeURIComponent(_params.page_token) : ''}`, { headers: { Authorization: `Bearer ${token}` } });
            if (!res.ok) throw new Error(`Google Calendar API error ${res.status}`);
            const data = await res.json();
            return JSON.stringify({ calendars: data.items ?? [], nextPageToken: data.nextPageToken ?? null });
        },
    },
    gcal_list_events: {
        name: 'gcal_list_events', idempotency: 'read-safe', label: 'List Google Calendar Events', group: 'Google Workspace',
        description: 'Read Google Calendar events. Prefer time_range today/this_week/next_week resolved in the calendar time zone; this_week starts Monday. Or provide an explicit time range. Use RFC3339 timestamps with timezone offsets. Reports pagination; does not create or change events.',
        parameters: z.object({ calendar_id: z.string().min(1).default('primary'), time_min: z.string().datetime({ offset: true }).optional(), time_max: z.string().datetime({ offset: true }).optional(), time_range: z.enum(['today', 'this_week', 'next_week']).optional(), query: z.string().optional(), max_results: z.number().int().min(1).max(100).default(20), page_token: z.string().optional() }),
        execute: async (params, context) => {

            const token = await getGoogleWorkspaceToken(context?.organizationId, context?.projectId, 'calendar_read');
            if (!token) throw new Error('Google Calendar permission is missing. Use connect_platform with platform google_calendar and approve Calendar access.');
            if (params.time_range) {
                const calendar = JSON.parse(await GOOGLE_CALENDAR_TOOLS.gcal_get_calendar.execute({ calendar_id: params.calendar_id ?? 'primary' }, context));
                Object.assign(params, calendarRange(params.time_range, calendar.timeZone));
            }
            if (!params.time_min || !params.time_max || Date.parse(params.time_max) <= Date.parse(params.time_min)) throw new Error('Provide time_range or valid time_min and time_max.');
            const query = new URLSearchParams({ timeMin: params.time_min, timeMax: params.time_max, maxResults: String(params.max_results ?? 20), singleEvents: 'true', orderBy: 'startTime' });
            if (params.query) query.set('q', params.query);
            if (params.page_token) query.set('pageToken', params.page_token);
            const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(params.calendar_id ?? 'primary')}/events?${query}`, { headers: { Authorization: `Bearer ${token}` } });
            if (!res.ok) throw new Error(`Google Calendar API error ${res.status}`);
            const data = await res.json();
            return JSON.stringify({ timeMin: params.time_min, timeMax: params.time_max, calendar: data.summary, timeZone: data.timeZone, events: data.items ?? [], nextPageToken: data.nextPageToken ?? null });
        },
    },
    gmail_get_profile: {
        name: 'gmail_get_profile',
        idempotency: 'read-safe',
        label: 'Identify Connected Gmail Account',
        group: 'Google Workspace',
        description: 'Identify the connected Gmail account before reading a named mailbox. AgentMail is a separate inbox and must not substitute for Gmail.',
        parameters: z.object({}),
        execute: async (_params, context) => {
            const token = await getGoogleWorkspaceToken(context?.organizationId, context?.projectId, 'gmail_read');
            if (!token) throw new Error('Gmail reading is not connected. Use connect_platform with platform gmail.');
            const profile = await gmailRequest(token, '/users/me/profile');
            return JSON.stringify({ emailAddress: profile.emailAddress, messagesTotal: profile.messagesTotal, threadsTotal: profile.threadsTotal });
        },
    },
    gmail_send: {
        name: "gmail_send",

        idempotency: "none",
        label: "Send Gmail",
        group: "Google Workspace",
        description: "Send an email via Gmail.",
        parameters: z.object({
            to: z.string().describe("Recipient email address(es), comma-separated"),
            subject: z.string().describe("Email subject"),
            body: z.string().describe("Email body (plain text or HTML)"),
            cc: z.string().optional().describe("CC recipients, comma-separated"),
            is_html: z.boolean().optional().default(false).describe("Whether body is HTML"),
        }),
        execute: async (params, context) => {
            const token = await getGoogleWorkspaceToken(context?.organizationId, context?.projectId, 'gmail_send');
            if (!token) throw new Error("Gmail sending is not connected. Use connect_platform with platform gmail, or connect Gmail in Integrations.");
            const contentType = params.is_html ? "text/html" : "text/plain";
            const headers = [
                `To: ${params.to}`,
                `Subject: ${params.subject}`,
                `Content-Type: ${contentType}; charset=utf-8`,
                params.cc ? `Cc: ${params.cc}` : "",
            ].filter(Boolean).join("\r\n");
            const raw = Buffer.from(`${headers}\r\n\r\n${params.body}`).toString("base64url");
            const data = await gmailRequest(token, "/users/me/messages/send", "POST", { raw });
            return JSON.stringify({ id: data.id, threadId: data.threadId, sent: true });
        },
    },

    gmail_search: {
        name: "gmail_search",

        idempotency: "read-safe",
        label: "Search Gmail",
        group: "Google Workspace",
        description: "Search the connected Gmail mailbox, not AgentMail. For a requested account, pass mailbox to verify identity. For today use time_range today and time_zone with the user's IANA zone, leaving date operators out of query; the server computes exact local-day boundaries. A successful empty result is not a permission failure.",
        parameters: z.object({
            query: z.string().describe("Gmail search query"),
            time_range: z.literal('today').optional(),
            time_zone: z.string().optional().describe('IANA time zone, for example America/Los_Angeles. Required with time_range.'),
            mailbox: z.string().email().optional().describe('Requested mailbox account, not a sender filter. Refuses results from a different connected account.'),
            max_results: z.number().min(1).max(50).default(10).optional(),
        }),
        execute: async (params, context) => {
            const token = await getGoogleWorkspaceToken(context?.organizationId, context?.projectId, 'gmail_read');
            if (!token) throw new Error("Gmail reading is not connected. Use connect_platform with platform gmail, or reconnect Gmail in Integrations to grant email access.");
            const requestedMailbox = params.mailbox ?? String(context?.message ?? '').match(/([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\s+(?:account|mailbox|inbox)\b/i)?.[1];
            if (requestedMailbox) {
                const profile = await gmailRequest(token, '/users/me/profile');
                if (String(profile.emailAddress).toLowerCase() !== requestedMailbox.toLowerCase()) {
                    throw new Error(`Connected Gmail account is ${profile.emailAddress}, not ${requestedMailbox}. Connect the requested account in this project's Integrations. No messages were read.`);
                }
            }
            const encoded = encodeURIComponent(gmailDayQuery(params.query, params.time_range, params.time_zone));
            const data = await gmailRequest(token, `/users/me/messages?q=${encoded}&maxResults=${params.max_results || 10}`);
            if (!data.messages?.length) return "No messages found.";
            const details = await Promise.all(
                data.messages.slice(0, 5).map((m: any) => gmailRequest(token, `/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject,From,Date`))
            );
            const results = details.map((m: any) => {
                const headers: Record<string, string> = {};
                for (const h of m.payload?.headers || []) headers[h.name] = h.value;
                return { id: m.id, subject: headers.Subject, from: headers.From, date: headers.Date, snippet: m.snippet };
            });
            return JSON.stringify(results, null, 2);
        },
    },

    gdrive_list_files: {
        name: "gdrive_list_files",

        idempotency: "read-safe",
        label: "List Google Drive Files",
        group: "Google Workspace",
        description: "List files in Google Drive, optionally filtered by name or folder. Sort with order_by (e.g. 'modifiedTime desc' for most recent first) — never put ordering inside query; Drive rejects it.",
        parameters: z.object({
            query: z.string().optional().describe("Drive search query (e.g. 'name contains \"report\"' or \"mimeType = 'application/vnd.google-apps.document'\"). Filters only — ordering belongs in order_by."),
            order_by: z.string().optional().describe("Comma-separated Drive sort keys with optional ' asc'/'desc' — e.g. 'modifiedTime desc'. Valid keys: createdTime, modifiedTime, modifiedByMeTime, name, name_natural, recency, sharedWithMeTime, starred, viewedByMeTime."),
            folder_id: z.string().optional().describe("ID of folder to list files in"),
            page_token: z.string().optional().describe('Continuation token from the preceding file result.'),
            max_results: z.number().min(1).max(100).default(20).optional(),
        }),
        execute: async (params, context) => {
            const token = await getGoogleWorkspaceToken(context?.organizationId, context?.projectId, 'drive_read');
            if (!token) throw new Error("Google Drive is not connected. Use connect_platform with platform google_drive, or connect Drive in Integrations.");
            let q = params.query || 'trashed = false';
            let orderBy = params.order_by;
            // Models reach for SQL when asked for "the most recent" file and put
            // `order by ...` inside the query string, which Drive answers with a
            // bare 400 "Invalid Value". Move the clause to the orderBy parameter
            // it belongs to instead of failing the call.
            const embeddedOrder = q.match(/\border\s+by\b\s+(.+)$/i);
            if (embeddedOrder?.index != null) {
                q = q.slice(0, embeddedOrder.index).trim() || 'trashed = false';
                orderBy = orderBy ?? embeddedOrder[1].trim();
            }
            if (params.folder_id) {
                const folder = params.folder_id.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                q = `(${q}) and '${folder}' in parents`;
            }
            const encoded = encodeURIComponent(q);
            let path = `/files?q=${encoded}&pageSize=${params.max_results || 20}&fields=nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink,size)`;
            if (params.page_token) path += `&pageToken=${encodeURIComponent(params.page_token)}`;
            if (orderBy) {
                const valid = orderBy.split(',').map((s: string) => s.trim()).every((s: string) =>
                    /^(createdTime|folder|modifiedByMeTime|modifiedTime|name|name_natural|quotaBytesUsed|recency|sharedWithMeTime|starred|viewedByMeTime)( (asc|desc))?$/i.test(s));
                if (!valid) throw new Error(`Invalid order_by '${orderBy}'. Use Drive sort keys like 'modifiedTime desc' — see the order_by parameter description for the full list.`);
                path += `&orderBy=${encodeURIComponent(orderBy)}`;
            }
            const data = await driveRequest(token, path);
            return JSON.stringify({ files: data.files ?? [], nextPageToken: data.nextPageToken ?? null }, null, 2);
        },
    },

    gdrive_read_file: {
        name: "gdrive_read_file",

        idempotency: "read-safe",
        label: "Read Google Drive File",
        group: "Google Workspace",
        description: "Read the text content of a Google Drive file (Docs, Sheets exported as text, or plain text files).",
        parameters: z.object({
            file_id: z.string().describe("Google Drive file ID"),
            export_mime: z.string().optional().default("text/plain").describe("MIME type to export as (default: text/plain)"),
        }),
        execute: async (params, context) => {
            const token = await getGoogleWorkspaceToken(context?.organizationId, context?.projectId, 'drive_read');
            if (!token) throw new Error("Google Drive is not connected. Use connect_platform with platform google_drive, or connect Drive in Integrations.");
            const mime = encodeURIComponent(params.export_mime || "text/plain");
            const res = await fetch(`https://www.googleapis.com/drive/v3/files/${params.file_id}/export?mimeType=${mime}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) {
                // Try direct download if export fails (binary/non-Google files)
                const res2 = await fetch(`https://www.googleapis.com/drive/v3/files/${params.file_id}?alt=media`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (!res2.ok) throw new Error(`Drive read error ${res2.status}`);
                const text = await res2.text();
                return text.substring(0, 8000);
            }
            const text = await res.text();
            return text.substring(0, 8000);
        },
    },

    gdrive_create_file: {
        name: "gdrive_create_file",

        idempotency: "none",
        label: "Create Google Drive File",
        group: "Google Workspace",
        description: "Create a new text file in Google Drive.",
        parameters: z.object({
            name: z.string().describe("File name"),
            content: z.string().describe("File content"),
            folder_id: z.string().optional().describe("Parent folder ID (defaults to root)"),
            mime_type: z.string().optional().default("text/plain").describe("MIME type of the file"),
        }),
        execute: async (params, context) => {
            const token = await getGoogleWorkspaceToken(context?.organizationId, context?.projectId, 'drive_write');
            if (!token) throw new Error("Google Drive writing is not connected. Reconnect Google Drive in Integrations to grant file creation access.");
            const metadata: any = { name: params.name, mimeType: params.mime_type || "text/plain" };
            if (params.folder_id) metadata.parents = [params.folder_id];
            const boundary = "oddjob_boundary";
            const multipart = [
                `--${boundary}`,
                "Content-Type: application/json; charset=UTF-8",
                "",
                JSON.stringify(metadata),
                `--${boundary}`,
                `Content-Type: ${params.mime_type || "text/plain"}`,
                "",
                params.content,
                `--${boundary}--`,
            ].join("\r\n");
            const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": `multipart/related; boundary=${boundary}`,
                },
                body: multipart,
            });
            if (!res.ok) throw new Error(`Drive create error ${res.status}: ${await res.text()}`);
            const data = await res.json();
            return JSON.stringify({ id: data.id, name: data.name, webViewLink: data.webViewLink });
        },
    },
};
