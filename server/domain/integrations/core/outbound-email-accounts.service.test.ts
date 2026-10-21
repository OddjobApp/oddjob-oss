/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
const m = vi.hoisted(() => ({ rows: [] as any[][], predicates: [] as any[], retrieve: vi.fn(), google: vi.fn(), microsoft: vi.fn(), fetch: vi.fn(), insert: vi.fn(), remove: vi.fn(), save: vi.fn() }));
vi.mock("@server/database_service.js", () => ({ db: {
    select: () => { const q = { from: () => q, where: (p: any) => { m.predicates.push(p); return q; }, limit: async () => m.rows.shift() ?? [], then: (done: any) => Promise.resolve(m.rows.shift() ?? []).then(done) }; return q; },
    insert: () => ({ values: (v: any) => { m.insert(v); return { onConflictDoUpdate: m.save }; } }),
    delete: () => ({ where: m.remove }),
} }));
vi.mock("@domain/auth/core/encrypted-credentials.service.js", () => ({ encryptedCredentialsService: { retrieve: m.retrieve } }));
vi.mock("./oauth/google-oauth.adapter.js", () => ({ googleOAuthAdapter: { getValidAccessToken: m.google } }));
vi.mock("./oauth/microsoft-oauth.adapter.js", () => ({ microsoftOAuthAdapter: { getValidAccessToken: m.microsoft } }));
import { outboundEmailAccounts } from "./outbound-email-accounts.service.js";
const google = { id: 11, orgId: 9, platform: "google", projectId: null, status: "connected" };
const choice = { connectorId: 11, email: "me@example.com", provider: "google" as const };
const draft = { to: ["recipient@example.com"], subject: "Résumé", body: "Hello" };
beforeEach(() => {
    vi.clearAllMocks(); m.rows.length = 0; m.predicates.length = 0;
    m.retrieve.mockResolvedValue({ scopes: ["https://www.googleapis.com/auth/gmail.send"] });
    m.google.mockResolvedValue("private-google-token"); m.microsoft.mockResolvedValue("private-microsoft-token"); m.save.mockResolvedValue(undefined);
    vi.stubGlobal("fetch", m.fetch); m.fetch.mockImplementation(async (url: string) => ({ ok: true, status: url.endsWith("sendMail") ? 202 : 200, json: async () => url.includes("userinfo") ? { email: "me@example.com" } : url.includes("/me?") ? { mail: "me@example.com" } : { id: "accepted" } }));
});
afterEach(() => vi.unstubAllGlobals());
describe("authored email sender confirmation", () => {
    it.each([null, undefined, "", 0])("requires authenticated user context %s", async user => {
        await expect(outboundEmailAccounts.options(9, user as string)).rejects.toThrow("user context"); expect(m.fetch).not.toHaveBeenCalled();
    });
    it("never reads a foreign tenant connector or uses a global fallback", async () => {
        await expect(outboundEmailAccounts.confirm(9, "u1", choice)).rejects.toThrow("not connected");
        const sql = new PgDialect().sqlToQuery(m.predicates[0]); expect(sql.params).toContain(9); expect(sql.params).toContain(11); expect(sql.sql).toContain('"project_id" is null');
        expect(m.retrieve).not.toHaveBeenCalled(); expect(m.fetch).not.toHaveBeenCalled();
    });
    it("requires an explicit sender instead of AgentMail", async () => {
        await expect(outboundEmailAccounts.confirm(9, "u1", undefined)).rejects.toThrow("AgentMail is reserved"); expect(m.fetch).not.toHaveBeenCalled();
    });
    it("rejects a changed sender identity before any send", async () => {
        m.rows.push([google]); await expect(outboundEmailAccounts.confirm(9, "u1", { ...choice, email: "previous@example.com" })).rejects.toThrow("account changed");
        expect(m.fetch).toHaveBeenCalledOnce(); expect(m.insert).not.toHaveBeenCalled();
    });
    it("does not treat file access or Mail.Read as sending permission", async () => {
        m.rows.push([{ ...google, platform: "microsoft365" }]); m.retrieve.mockResolvedValue({ scopes: ["Files.ReadWrite.All", "Mail.Read"] });
        await expect(outboundEmailAccounts.confirm(9, "u1", choice)).rejects.toThrow("sending permission"); expect(m.fetch).not.toHaveBeenCalled();
    });
    it("sends with the exact confirmed Google account and preserves recipients and Unicode", async () => {
        m.rows.push([google]); const result = await outboundEmailAccounts.send(9, "u1", choice, { ...draft, cc: ["cc@example.com"], bcc: ["bcc@example.com"] });
        const call = m.fetch.mock.calls.find(([url]) => url.endsWith("/messages/send"));
        if (!call) throw new Error("Expected a Gmail send request");
        expect(call[1].headers.Authorization).toBe("Bearer private-google-token");
        const mime = Buffer.from(JSON.parse(call[1].body).raw, "base64url").toString();
        expect(mime).toContain("From: me@example.com"); expect(mime).toContain("Bcc: bcc@example.com"); expect(mime).toContain(Buffer.from("Résumé").toString("base64"));
        expect(result).toMatchObject({ sent: true, preferenceSaved: false }); expect(m.insert).not.toHaveBeenCalled();
    });
    it("remembers only after explicit opt-in and an accepted send, scoped to org and user", async () => {
        m.rows.push([google]); await outboundEmailAccounts.send(9, "u1", { ...choice, remember: true }, draft);
        expect(m.insert).toHaveBeenCalledWith({ organizationId: 9, userId: "u1", connectorId: 11, email: "me@example.com", provider: "google" });
    });
    it("uses Microsoft Graph with CC/BCC and Sent Items", async () => {
        m.rows.push([{ ...google, platform: "microsoft365" }]); m.retrieve.mockResolvedValue({ scopes: ["Mail.Send"] });
        const result = await outboundEmailAccounts.send(9, "u1", { ...choice, provider: "microsoft" }, { ...draft, cc: ["cc@example.com"], bcc: ["bcc@example.com"], bodyFormat: "html", body: "<b>Hello</b>" });
        const call = m.fetch.mock.calls.find(([url]) => url.endsWith("/sendMail"));
        if (!call) throw new Error("Expected a Microsoft send request");
        expect(JSON.parse(call[1].body)).toMatchObject({ saveToSentItems: true, message: { body: { contentType: "HTML" }, bccRecipients: [{ emailAddress: { address: "bcc@example.com" } }] } });
        expect(result.result).toContain("Microsoft accepted");
    });
    it("does not save a preference or fall back when a provider rejects the send", async () => {
        m.rows.push([google]); m.fetch.mockImplementation(async (url: string) => url.includes("userinfo") ? { ok: true, status: 200, json: async () => ({ email: choice.email }) } : { ok: false, status: 403 });
        await expect(outboundEmailAccounts.send(9, "u1", { ...choice, remember: true }, draft)).rejects.toThrow("HTTP 403"); expect(m.insert).not.toHaveBeenCalled();
        expect(m.fetch.mock.calls.every(([url]) => !url.includes("agentmail"))).toBe(true);
    });
    it("reports an unknown outcome after a send timeout, without retrying or saving a preference", async () => {
        m.rows.push([google]); m.fetch.mockImplementation(async (url: string) => {
            if (url.includes("userinfo")) return { ok: true, status: 200, json: async () => ({ email: choice.email }) };
            throw new Error("private-token must never be reflected");
        });
        await expect(outboundEmailAccounts.send(9, "u1", { ...choice, remember: true }, draft)).rejects.toMatchObject({ outcomeUnknown: true, message: expect.stringContaining("Check Sent Items") });
        expect(m.fetch).toHaveBeenCalledTimes(2); expect(m.insert).not.toHaveBeenCalled();
    });
    it("keeps a successful send successful if preference storage fails", async () => {
        m.rows.push([google]); m.save.mockRejectedValue(new Error("database unavailable"));
        expect(await outboundEmailAccounts.send(9, "u1", { ...choice, remember: true }, draft)).toMatchObject({ sent: true, preferenceSaved: false, warning: expect.stringContaining("could not be saved") });
    });
    it("ignores stale saved preferences while never returning tokens", async () => {
        m.rows.push([{ id: 11 }], [google], [{ connectorId: 11, email: "old@example.com" }]);
        const options = await outboundEmailAccounts.options(9, "u1");
        expect(options.preferredConnectorId).toBeNull(); expect(options.accounts[0].email).toBe(choice.email); expect(JSON.stringify(options)).not.toContain("token");
        expect(new PgDialect().sqlToQuery(m.predicates.at(-1)).params).toEqual([9, "u1"]);
    });
    it("forgets only this user's preference in this organization", async () => {
        await outboundEmailAccounts.clearPreference(9, "u1"); expect(new PgDialect().sqlToQuery(m.remove.mock.calls[0][0]).params).toEqual([9, "u1"]);
    });
});
