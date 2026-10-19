import { createLogger } from "@server/utils/logger.js";
import { credentialsService } from "../auth/core/credentials-service.js";

const logger = createLogger("Microsoft365Service");

export class Microsoft365Client {
    private accessToken: string;
    private graphUrl = "https://graph.microsoft.com/v1.0";

    constructor(accessToken: string) {
        this.accessToken = accessToken;
    }

    private async request(path: string, options: RequestInit = {}): Promise<any> {
        const url = `${this.graphUrl}${path}`;
        const res = await fetch(url, {
            ...options,
            headers: {
                Authorization: `Bearer ${this.accessToken}`,
                "Content-Type": "application/json",
                ...(options.headers || {}),
            },
        });
        if (!res.ok) {
            const body = await res.text();
            throw new Error(`Microsoft Graph API error ${res.status}: ${body}`);
        }
        if (res.status === 204) return {};
        return res.json();
    }

    // ── Teams ──────────────────────────────────────────────────────────────

    async listTeams(): Promise<any[]> {
        const data = await this.request("/me/joinedTeams");
        return data.value || [];
    }

    async listChannels(teamId: string): Promise<any[]> {
        const data = await this.request(`/teams/${teamId}/channels`);
        return data.value || [];
    }

    async postTeamsMessage(teamId: string, channelId: string, message: string, isHtml = false, subject?: string): Promise<any> {
        const body = { contentType: isHtml ? "html" : "text", content: message };
        const payload: any = { body };
        if (subject) payload.subject = subject;
        return this.request(`/teams/${teamId}/channels/${channelId}/messages`, {
            method: "POST",
            body: JSON.stringify(payload),
        });
    }

    async getTeamsMessages(teamId: string, channelId: string, limit = 20): Promise<any[]> {
        const data = await this.request(`/teams/${teamId}/channels/${channelId}/messages?$top=${limit}`);
        return data.value || [];
    }

    // ── SharePoint ─────────────────────────────────────────────────────────

    async listSharepointSites(): Promise<any[]> {
        const data = await this.request("/sites?search=*");
        return data.value || [];
    }

    async listDriveItems(siteId: string, driveId?: string, folderPath = "/"): Promise<any[]> {
        const base = driveId
            ? `/sites/${siteId}/drives/${driveId}`
            : `/sites/${siteId}/drive`;
        const path = folderPath === "/" ? `${base}/root/children` : `${base}/root:${folderPath}:/children`;
        const data = await this.request(path);
        return data.value || [];
    }

    async downloadDriveItem(siteId: string, itemId: string, driveId?: string): Promise<string> {
        const base = driveId ? `/sites/${siteId}/drives/${driveId}` : `/sites/${siteId}/drive`;
        const url = `${this.graphUrl}${base}/items/${itemId}/content`;
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${this.accessToken}` },
            redirect: "follow",
        });
        if (!res.ok) throw new Error(`Failed to download item ${itemId}: ${res.status}`);
        return res.text();
    }

    // ── Calendar ───────────────────────────────────────────────────────────

    async listCalendars(): Promise<any[]> {
        const data = await this.request("/me/calendars");
        return data.value || [];
    }

    async listEvents(calendarId?: string, startDateTime?: string, endDateTime?: string, top = 10): Promise<any[]> {
        const base = calendarId ? `/me/calendars/${calendarId}/events` : "/me/events";
        let qs = `?$top=${top}&$orderby=start/dateTime`;
        if (startDateTime) qs += `&$filter=start/dateTime ge '${startDateTime}'`;
        const data = await this.request(`${base}${qs}`);
        return data.value || [];
    }

    async createEvent(subject: string, body: string, startDateTime: string, endDateTime: string, attendees: string[] = [], calendarId?: string): Promise<any> {
        const base = calendarId ? `/me/calendars/${calendarId}/events` : "/me/events";
        const payload = {
            subject,
            body: { contentType: "text", content: body },
            start: { dateTime: startDateTime, timeZone: "UTC" },
            end: { dateTime: endDateTime, timeZone: "UTC" },
            attendees: attendees.map(email => ({ emailAddress: { address: email }, type: "required" })),
        };
        return this.request(base, { method: "POST", body: JSON.stringify(payload) });
    }

    // ── Outlook ────────────────────────────────────────────────────────────

    async sendEmail(to: string[], subject: string, body: string, isHtml = false): Promise<void> {
        const payload = {
            message: {
                subject,
                body: { contentType: isHtml ? "html" : "text", content: body },
                toRecipients: to.map(addr => ({ emailAddress: { address: addr } })),
            },
        };
        await this.request("/me/sendMail", { method: "POST", body: JSON.stringify(payload) });
    }
}

export async function getMicrosoft365Client(credentialId: number, orgId: number | null): Promise<Microsoft365Client> {
    const cred = await credentialsService.getById(credentialId, orgId);
    const token = (cred as any).accessToken || (cred as any).token;
    if (!token) throw new Error("Microsoft 365 credential must have an accessToken or token field");
    return new Microsoft365Client(token);
}
