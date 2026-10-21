/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({ results: [] as unknown[][], predicates: [] as unknown[], transaction: vi.fn(), fetch: vi.fn() }));
vi.mock("@server/database_service.js", () => ({ db: {
    select: () => { const query = {
        from: () => query, innerJoin: () => query,
        where: (predicate: unknown) => { mocks.predicates.push(predicate); return query; },
        limit: async () => mocks.results.shift() ?? [],
    }; return query; }, transaction: mocks.transaction,
} }));
import { orgAgentMailService, requireAgentMailOrg } from "./org-agentmail.service.js";
import { AgentMailService, agentMailService } from "./agentmail.service.js";
import { encrypt, decrypt } from "@server/utils/encryption.js";
import { encryptedCredentialOwner } from "@server/utils/encrypted-credential-owner.js";

beforeEach(() => {
    mocks.results.length = 0; mocks.predicates.length = 0; vi.clearAllMocks();
    vi.stubEnv("ENCRYPTION_KEY", "31".repeat(32));
    vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("organization AgentMail boundary", () => {
    it.each([null, undefined, 0, -1, 1.5, "1", NaN])("rejects invalid tenant context %s before touching storage", async org => {
        expect(() => requireAgentMailOrg(org)).toThrow("Organization context");
        await expect(orgAgentMailService.resolve(org as number)).rejects.toThrow("Organization context");
        expect(mocks.predicates).toHaveLength(0);
    });
    it("never falls back to platform credentials when an organization has no connection", async () => {
        vi.stubEnv("AGENTMAIL_API_KEY", "platform-secret");
        vi.stubEnv("AGENTMAIL_INBOX", "platform@agentmail.to");
        await expect(agentMailService.forOrg(9)).rejects.toThrow("Connect AgentMail");
        expect(mocks.fetch).not.toHaveBeenCalled();
    });
    it("looks up the requested tenant and unseals only its owner-bound key", async () => {
        mocks.results.push([{ inboxId: "tenant-nine@agentmail.to", encryptedData: encrypt("tenant-nine-key", "organization_agentmail:9:api_key") }]);
        const connection = await orgAgentMailService.resolve(9);
        expect(connection).toEqual({ organizationId: 9, inboxId: "tenant-nine@agentmail.to", apiKey: "tenant-nine-key" });
        const query = new PgDialect().sqlToQuery(mocks.predicates[0] as never);
        expect(query.sql).toContain('"agentmail_connections"."organization_id"');
        expect(query.params).toContain(9);
    });
    it("refuses a ciphertext copied from another organization's row", async () => {
        mocks.results.push([{ inboxId: "tenant-nine@agentmail.to", encryptedData: encrypt("wrong-tenant-key", "organization_agentmail:8:api_key") }]);
        await expect(orgAgentMailService.resolve(9)).rejects.toThrow();
    });
    it("returns public status without credentials", async () => {
        mocks.results.push([{ organizationId: 9, inboxId: "tenant-nine@agentmail.to" }]);
        expect(await orgAgentMailService.status(9)).toEqual({ configured: true, inboxId: "tenant-nine@agentmail.to", inboundMode: "polling" });
    });
    it("verifies inbox access before any database mutation", async () => {
        mocks.fetch.mockResolvedValue({ ok: false, status: 401 });
        await expect(orgAgentMailService.connect(9, { inboxId: "nine@agentmail.to", apiKey: "invalid-key" })).rejects.toThrow("verify access");
        expect(mocks.transaction).not.toHaveBeenCalled();
    });
    it("rejects an API response for a different inbox", async () => {
        mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ inbox_id: "other@agentmail.to" }) });
        await expect(orgAgentMailService.connect(9, { inboxId: "nine@agentmail.to", apiKey: "key" })).rejects.toThrow("different inbox");
        expect(mocks.transaction).not.toHaveBeenCalled();
    });
    it("saves only an encrypted owner-bound key, together with the connection", async () => {
        mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ inbox_id: "nine@agentmail.to" }) });
        const rows: unknown[] = [];
        const tx = { execute: vi.fn(), delete: () => ({ where: vi.fn() }), insert: () => ({ values: (row: unknown) => {
            rows.push(row); return { onConflictDoUpdate: vi.fn() };
        } }) };
        mocks.transaction.mockImplementation(async action => action(tx));
        mocks.results.push([{ inboxId: "nine@agentmail.to" }]);
        await orgAgentMailService.connect(9, { inboxId: "nine@agentmail.to", apiKey: "tenant-nine-key" });
        const secret = rows[1] as { encryptedData: string; organizationId: number };
        expect(secret.organizationId).toBe(9);
        expect(JSON.stringify(rows)).not.toContain("tenant-nine-key");
        expect(decrypt(secret.encryptedData, "organization_agentmail:9:api_key")).toBe("tenant-nine-key");
        expect(tx.execute).toHaveBeenCalledOnce();
    });
    it("rejects an inbox already bound to another tenant", async () => {
        mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ inbox_id: "nine@agentmail.to" }) });
        mocks.transaction.mockRejectedValue({ cause: { code: "23505" } });
        await expect(orgAgentMailService.connect(9, { inboxId: "nine@agentmail.to", apiKey: "key" })).rejects.toThrow("another organization");
    });
    it("includes the new owner type in credential key rotation", () => {
        expect(encryptedCredentialOwner({ organizationId: 9, entityType: "organization_agentmail", entityId: 9, credentialType: "api_key" })).toBe("organization_agentmail:9:api_key");
    });
    it("uses separate inbox paths and Authorization values concurrently", async () => {
        const one = new AgentMailService({ organizationId: 1, inboxId: "one@agentmail.to", apiKey: "one-key" });
        const two = new AgentMailService({ organizationId: 2, inboxId: "two@agentmail.to", apiKey: "two-key" });
        mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ threads: [], count: 0 }) });
        await Promise.all([one.listThreads(), two.listThreads()]);
        expect(mocks.fetch).toHaveBeenCalledWith(expect.stringContaining("one%40agentmail.to/threads"), expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer one-key" }) }));
        expect(mocks.fetch).toHaveBeenCalledWith(expect.stringContaining("two%40agentmail.to/threads"), expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer two-key" }) }));
    });
    it("blocks legacy global credentials in production", async () => {
        vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("AGENTMAIL_API_KEY", "platform-secret"); vi.stubEnv("AGENTMAIL_INBOX", "platform@agentmail.to");
        expect(agentMailService.isConfigured()).toBe(false);
        await expect(agentMailService.listThreads()).rejects.toThrow("Connect AgentMail");
        expect(mocks.fetch).not.toHaveBeenCalled();
    });
    it("resolves a real email address when the provider inbox ID is opaque", async () => {
        const mail = new AgentMailService({ organizationId: 9, inboxId: "inbox-opaque-id", apiKey: "nine-key" });
        mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ email: "Nine@agentmail.to" }) });
        expect(await mail.getInboxAddress()).toBe("nine@agentmail.to");
        expect(mocks.fetch).toHaveBeenCalledWith("https://api.agentmail.to/v0/inboxes/inbox-opaque-id", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer nine-key" }) }));
    });
});
