import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@server/database_service.js";
import { saasConnectors, outboundEmailPreferences, crewSessions } from "@shared/schema/index.js";
import { encryptedCredentialsService } from "@domain/auth/core/encrypted-credentials.service.js";
import { googleOAuthAdapter } from "./oauth/google-oauth.adapter.js";
import { microsoftOAuthAdapter } from "./oauth/microsoft-oauth.adapter.js";
import { BadRequestError } from "@server/utils/errors.js";

export type EmailAccount = { connectorId: number; provider: "google" | "microsoft"; email: string; scope: "organization" | "project" };
export type EmailAccountChoice = { connectorId: number; email: string; provider: "google" | "microsoft"; remember?: boolean };
const platforms = ["google", "google_workspace", "gmail", "google_drive", "google_docs", "microsoft365"];
const choiceSchema = z.object({ connectorId: z.number().int().positive(), email: z.string().email(), provider: z.enum(["google", "microsoft"]), remember: z.boolean().optional() }).strict();
const draftSchema = z.object({ to: z.array(z.string().email()).min(1).max(100), cc: z.array(z.string().email()).max(100).nullish(), bcc: z.array(z.string().email()).max(100).nullish(), bodyFormat: z.enum(["plain", "html"]).optional(), subject: z.string().max(2000).refine(v => !/[\r\n]/.test(v)), body: z.string().max(2_000_000) });
function requireScope(orgId: number, userId?: string) {
    if (!Number.isSafeInteger(orgId) || orgId <= 0 || (userId !== undefined && !userId)) throw new BadRequestError("Organization and user context required");
}
function requireUser(orgId: number, userId: string) {
    requireScope(orgId);
    if (typeof userId !== "string" || !userId.trim()) throw new BadRequestError("Organization and user context required");
}
async function request(token: string, url: string, body?: unknown) {
    let response: Response;
    try { response = await fetch(url, { method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000) }); }
    catch {
        if (body !== undefined) throw Object.assign(new Error("Delivery status is unknown. Check Sent Items before retrying; Oddjob will not retry automatically"), { outcomeUnknown: true });
        throw new BadRequestError("Email provider request failed; check the connection before retrying");
    }
    if (body !== undefined && response.status >= 500) throw Object.assign(new Error("Delivery status is unknown after a provider error. Check Sent Items before retrying"), { outcomeUnknown: true });
    if (!response.ok) throw new BadRequestError(`Email provider rejected the request (HTTP ${response.status}); reconnect with email sending permission`);
    if (response.status === 202 || response.status === 204) return {};
    try { return await response.json(); } catch {
        if (body !== undefined) throw Object.assign(new Error("The provider accepted the request but its response could not be read. Check Sent Items before retrying"), { outcomeUnknown: true });
        throw new BadRequestError("Email provider returned an invalid response");
    }
}
async function load(orgId: number, connectorId: number, projectId?: number | null) {
    requireScope(orgId);
    const [connection] = await db.select().from(saasConnectors).where(and(eq(saasConnectors.orgId, orgId), eq(saasConnectors.id, connectorId), eq(saasConnectors.status, "connected"),
        inArray(saasConnectors.platform, platforms), projectId == null ? isNull(saasConnectors.projectId) : or(isNull(saasConnectors.projectId), eq(saasConnectors.projectId, projectId)))).limit(1);
    if (!connection) throw new BadRequestError("This email account is not connected in this organization and project");
    const provider = connection.platform === "microsoft365" ? "microsoft" as const : "google" as const;
    const credentialType = provider === "google" ? "google_oauth_token" : "microsoft365_oauth_token";
    const stored = await encryptedCredentialsService.retrieve(orgId, "saas_connector", connection.id, credentialType);
    const scopes: string[] = Array.isArray(stored?.scopes) ? stored.scopes : [];
    const canSend = provider === "google" ? scopes.some(s => ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.compose", "https://www.googleapis.com/auth/gmail.modify", "https://mail.google.com/"].includes(s))
        : scopes.some(s => /^(?:https:\/\/graph\.microsoft\.com\/)?Mail\.Send$/i.test(s));
    if (!canSend) throw new BadRequestError("Reconnect this account with email sending permission");
    let token: string;
    try { token = await (provider === "google" ? googleOAuthAdapter : microsoftOAuthAdapter).getValidAccessToken(connection.id); }
    catch { throw new BadRequestError("Reconnect this email account before sending"); }
    const profile = await request(token, provider === "google" ? "https://www.googleapis.com/oauth2/v2/userinfo" : "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName");
    const email = z.string().email().safeParse(provider === "google" ? profile.email : profile.mail ?? profile.userPrincipalName);
    if (!email.success) throw new BadRequestError("Unable to verify the connected sender address; reconnect the account");
    return { account: { connectorId: connection.id, provider, email: email.data.toLowerCase(), scope: connection.projectId == null ? "organization" as const : "project" as const }, token };
}
export const outboundEmailAccounts = {
    async projectForRoom(organizationId: number, sessionKey?: string | null) {
        requireScope(organizationId);
        if (!sessionKey) return null;
        const [room] = await db.select({ projectId: crewSessions.projectId }).from(crewSessions).where(and(eq(crewSessions.organizationId, organizationId), eq(crewSessions.sessionKey, sessionKey))).limit(1);
        if (!room) throw new BadRequestError("Room not found in this organization");
        return room.projectId;
    },
    async options(organizationId: number, userId: string, projectId?: number | null) {
        requireUser(organizationId, userId);
        const connections = await db.select({ id: saasConnectors.id }).from(saasConnectors).where(and(eq(saasConnectors.orgId, organizationId), eq(saasConnectors.status, "connected"), inArray(saasConnectors.platform, platforms),
            projectId == null ? isNull(saasConnectors.projectId) : or(isNull(saasConnectors.projectId), eq(saasConnectors.projectId, projectId))));
        const checked = await Promise.allSettled(connections.map(c => load(organizationId, c.id, projectId)));
        const accounts = checked.flatMap(result => result.status === "fulfilled" ? [result.value.account] : []);
        const [preference] = await db.select().from(outboundEmailPreferences).where(and(eq(outboundEmailPreferences.organizationId, organizationId), eq(outboundEmailPreferences.userId, userId))).limit(1);
        const preferred = accounts.find(a => a.connectorId === preference?.connectorId && a.email === preference?.email && a.provider === preference?.provider);
        return { accounts, projectId: projectId ?? null, preferredConnectorId: preferred?.connectorId ?? null, unavailable: checked.filter(c => c.status === "rejected").length };
    },
    async confirm(organizationId: number, userId: string, input: unknown, projectId?: number | null) {
        requireUser(organizationId, userId);
        const parsed = choiceSchema.safeParse(input);
        if (!parsed.success) throw new BadRequestError("Choose and confirm a connected Google or Microsoft sender before sending; AgentMail is reserved for Oddjob and room notifications");
        const { account } = await load(organizationId, parsed.data.connectorId, projectId);
        if ((account.email !== parsed.data.email.toLowerCase() || account.provider !== parsed.data.provider)) throw new BadRequestError("The sender account changed. Reload the draft and confirm its sender again");
        return { ...parsed.data, email: account.email };
    },
    async send(organizationId: number, userId: string, choice: EmailAccountChoice, input: unknown, projectId?: number | null) {
        requireUser(organizationId, userId);
        const parsedChoice = choiceSchema.parse(choice);
        const draft = draftSchema.parse(input);
        const { account, token } = await load(organizationId, parsedChoice.connectorId, projectId);
        if ((account.email !== parsedChoice.email.toLowerCase() || account.provider !== parsedChoice.provider)) throw new BadRequestError("The sender account changed. Review and confirm it again");
        if (account.provider === "google") {
            const headers = [`From: ${account.email}`, `To: ${draft.to.join(", ")}`, ...(draft.cc?.length ? [`Cc: ${draft.cc.join(", ")}`] : []), `Subject: =?UTF-8?B?${Buffer.from(draft.subject).toString("base64")}?=`, ...(draft.bcc?.length ? [`Bcc: ${draft.bcc.join(", ")}`] : []), "MIME-Version: 1.0", `Content-Type: text/${draft.bodyFormat === "html" ? "html" : "plain"}; charset=utf-8`, "Content-Transfer-Encoding: base64"];
            const raw = Buffer.from(headers.join("\r\n") + "\r\n\r\n" + (Buffer.from(draft.body).toString("base64").match(/.{1,76}/g) ?? []).join("\r\n")).toString("base64url");
            await request(token, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { raw });
        } else {
            const recipients = (addresses: string[]) => addresses.map(address => ({ emailAddress: { address } }));
            await request(token, "https://graph.microsoft.com/v1.0/me/sendMail", { message: { subject: draft.subject, body: { contentType: draft.bodyFormat === "html" ? "HTML" : "Text", content: draft.body }, toRecipients: recipients(draft.to), ccRecipients: recipients(draft.cc ?? []), bccRecipients: recipients(draft.bcc ?? []) }, saveToSentItems: true });
        }
        let preferenceSaved = false;
        if (parsedChoice.remember === true) {
            // Preference failure must never turn an accepted send into a retryable send failure.
            try {
                await db.insert(outboundEmailPreferences).values({ organizationId, userId, connectorId: account.connectorId, email: account.email, provider: account.provider })
                    .onConflictDoUpdate({ target: [outboundEmailPreferences.organizationId, outboundEmailPreferences.userId], set: { connectorId: account.connectorId, email: account.email, provider: account.provider, updatedAt: new Date() } });
                preferenceSaved = true;
            } catch { /* Report separately from delivery below. */ }
        }
        return { sent: true, result: `${account.provider === "google" ? "Google" : "Microsoft"} accepted the email from ${account.email} for sending`, preferenceSaved, ...(parsedChoice.remember && !preferenceSaved ? { warning: "Email accepted, but the sender preference could not be saved" } : {}) };
    },
    async clearPreference(organizationId: number, userId: string) {
        requireUser(organizationId, userId);
        await db.delete(outboundEmailPreferences).where(and(eq(outboundEmailPreferences.organizationId, organizationId), eq(outboundEmailPreferences.userId, userId)));
    },
};
