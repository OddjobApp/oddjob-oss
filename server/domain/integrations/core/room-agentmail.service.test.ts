/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
const mocks = vi.hoisted(() => ({ rows: [] as unknown[][], predicates: [] as unknown[], status: vi.fn(), resolve: vi.fn(), fetch: vi.fn(), insert: vi.fn(), remove: vi.fn() }));
vi.mock("@server/database_service.js", () => ({ db: {
    select: () => { const q = { from: () => q, where: (p: unknown) => { mocks.predicates.push(p); return q; }, limit: async () => mocks.rows.shift() ?? [] }; return q; },
    insert: () => ({ values: (v: unknown) => { mocks.insert(v); return { onConflictDoUpdate: async () => undefined }; } }),
    delete: () => ({ where: mocks.remove }),
} }));
vi.mock("./org-agentmail.service.js", () => ({ requireAgentMailOrg: (id: number) => { if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Organization context required"); return id; }, orgAgentMailService: { status: mocks.status, resolve: mocks.resolve } }));
import { roomAgentMailService } from "./room-agentmail.service.js";
import { AgentMailService } from "./agentmail.service.js";
beforeEach(() => {
    vi.clearAllMocks(); mocks.rows.length = 0; mocks.predicates.length = 0;
    mocks.status.mockResolvedValue({ configured: true });
    mocks.resolve.mockResolvedValue({ organizationId: 9, inboxId: "default@agentmail.to", apiKey: "org-nine-key" });
    vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => vi.unstubAllGlobals());
describe("dedicated room AgentMail", () => {
    it("rejects missing tenant context before storage", async () => {
        await expect(roomAgentMailService.resolve(null as unknown as number, "room")).rejects.toThrow("Organization context");
        expect(mocks.predicates).toHaveLength(0);
    });
    it("does not find a room in another tenant or create a missing room", async () => {
        await expect(roomAgentMailService.assign(9, "foreign-room", { inboxId: "a@agentmail.to" })).rejects.toThrow("Room not found");
        const sql = new PgDialect().sqlToQuery(mocks.predicates[0] as never);
        expect(sql.params).toEqual([9, "foreign-room"]); expect(mocks.insert).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled();
    });
    it("rejects an empty room key instead of falling back to a default", async () => {
        await expect(new AgentMailService().forContext(9, "")).rejects.toThrow("Room context required");
        expect(mocks.resolve).not.toHaveBeenCalled();
    });
    it("never falls back to the organization inbox for an unassigned room", async () => {
        mocks.rows.push([{ id: 11 }], []);
        await expect(new AgentMailService().forContext(9, "room-a")).rejects.toThrow("Room Integrations");
        expect(mocks.resolve).not.toHaveBeenCalled();
    });
    it("resolves the room mailbox with only its organization's key", async () => {
        mocks.rows.push([{ id: 11 }], [{ inboxId: "room-a@agentmail.to" }]);
        expect(await roomAgentMailService.resolve(9, "room-a")).toEqual({ organizationId: 9, inboxId: "room-a@agentmail.to", apiKey: "org-nine-key" });
        const sql = new PgDialect().sqlToQuery(mocks.predicates[1] as never);
        expect(sql.params).toEqual([9, 11]); expect(mocks.resolve).toHaveBeenCalledWith(9);
    });
    it("requires an active organization connection even when a mapping remains", async () => {
        mocks.rows.push([{ id: 11 }], [{ inboxId: "room-a@agentmail.to" }]); mocks.status.mockResolvedValue({ configured: false });
        await expect(roomAgentMailService.resolve(9, "room-a")).rejects.toThrow("Room Integrations");
    });
    it("verifies access without provisioning or sending email before saving", async () => {
        mocks.rows.push([{ id: 11 }], [{ id: 11 }], [{ inboxId: "room-a@agentmail.to" }]);
        mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ inbox_id: "room-a@agentmail.to" }) });
        await roomAgentMailService.assign(9, "room-a", { inboxId: "room-a@agentmail.to" });
        expect(mocks.fetch).toHaveBeenCalledOnce();
        expect(mocks.fetch).toHaveBeenCalledWith("https://api.agentmail.to/v0/inboxes/room-a%40agentmail.to", expect.objectContaining({ headers: { Authorization: "Bearer org-nine-key" } }));
        expect(mocks.insert).toHaveBeenCalledWith({ organizationId: 9, sessionId: 11, inboxId: "room-a@agentmail.to" });
    });
    it("does not persist an inaccessible inbox", async () => {
        mocks.rows.push([{ id: 11 }]); mocks.fetch.mockResolvedValue({ ok: false });
        await expect(roomAgentMailService.assign(9, "room-a", { inboxId: "other@agentmail.to" })).rejects.toThrow("cannot access");
        expect(mocks.insert).not.toHaveBeenCalled();
    });
    it("rejects mismatched provider responses", async () => {
        mocks.rows.push([{ id: 11 }]); mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ inbox_id: "different" }) });
        await expect(roomAgentMailService.assign(9, "room-a", { inboxId: "room-a@agentmail.to" })).rejects.toThrow("different inbox");
        expect(mocks.insert).not.toHaveBeenCalled();
    });
    it("removes only the requested room mapping, without deleting provider resources", async () => {
        mocks.rows.push([{ id: 11 }]); await roomAgentMailService.disconnect(9, "room-a");
        const sql = new PgDialect().sqlToQuery(mocks.remove.mock.calls[0][0]); expect(sql.params).toEqual([9, 11]);
        expect(mocks.fetch).not.toHaveBeenCalled();
    });
});
