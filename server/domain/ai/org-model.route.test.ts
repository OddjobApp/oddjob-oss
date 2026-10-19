import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const mocks = vi.hoisted(() => ({
    context: { organizationId: 7, userId: "u1", isAdmin: false, isSuperAdmin: false, isOrgAdmin: false } as any,
    authorization: { organizationId: 7, enforcement: "compatibility", roles: [], permissions: [] } as any,
    status: vi.fn(),
    resolve: vi.fn(),
    save: vi.fn(),
    remove: vi.fn(),
    setDefault: vi.fn(),
    audit: vi.fn(),
    fal: { status: vi.fn(), save: vi.fn(), remove: vi.fn() },
}));

vi.mock("@domain/auth/core/security.service.js", () => ({ requireAuth: (_req: any, _res: any, next: any) => next() }));
vi.mock("@server/utils/auth-context.js", async (importOriginal) => ({
    ...(await importOriginal<any>()),
    getUserOrgContext: vi.fn(async () => mocks.context),
}));
vi.mock("@server/utils/organization-permissions.js", () => ({
    resolveOrganizationAuthorization: vi.fn(async () => mocks.authorization),
}));
vi.mock("@domain/audit/core/audit-service.js", () => ({ auditService: { log: mocks.audit } }));
vi.mock("./core/org-model.service.js", () => ({
    orgModelService: { status: mocks.status, resolve: mocks.resolve, save: mocks.save, remove: mocks.remove, setDefault: mocks.setDefault },
}));
vi.mock("./core/org-fal-key.service.js", () => ({ orgFalKeyService: mocks.fal }));

import router from "./org-model.route.js";

const app = express().use(express.json()).use("/", router)
    .use((err: any, _req: any, res: any, _next: any) => res.status(err.statusCode ?? 500).json({ error: err.message }));

describe("org AI key route", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.context = { organizationId: 7, userId: "u1", isAdmin: false, isSuperAdmin: false, isOrgAdmin: false };
        mocks.authorization = { organizationId: 7, enforcement: "compatibility", roles: [], permissions: ["connector:manage"] };
        mocks.status.mockResolvedValue({ configured: true, provider: "google", model: "gemini-2.5-flash", keyHint: "…1111" });
        mocks.resolve.mockResolvedValue({ provider: "google", apiKey: "existing-key-1111", model: "gemini-2.5-flash" });
        mocks.save.mockResolvedValue({ configured: true, provider: "google", model: "gemini-2.5-flash", keyHint: "…2222" });
    });

    it("allows members to see status but denies key replacement and deletion", async () => {
        mocks.status.mockResolvedValue({ configured: false, model: "gemini-2.5-flash" });
        expect((await request(app).get("/")).body.canManage).toBe(false);
        expect((await request(app).put("/").send({ apiKey: "secret" })).status).toBe(403);
        expect((await request(app).delete("/")).status).toBe(403);
        expect(mocks.save).not.toHaveBeenCalled();
        expect(mocks.remove).not.toHaveBeenCalled();
    });

    it("uses verified organization scope instead of the body's organizationId", async () => {
        mocks.context.isOrgAdmin = true;
        mocks.save.mockResolvedValue({ configured: true });
        const result = await request(app).put("/").send({ organizationId: 8, apiKey: "secret" });
        expect(result.status).toBe(200);
        expect(mocks.save.mock.calls[0][0]).toBe(7);
        expect(result.headers["cache-control"]).toBe("no-store");
        expect(JSON.stringify(result.body)).not.toContain("secret");
    });

    it("keeps compatibility-mode members out even though they hold every permission", async () => {
        const res = await request(app).put("/").send({ apiKey: "x", model: "gemini-2.5-flash" });
        expect(res.status).toBe(403);
        expect(mocks.save).not.toHaveBeenCalled();
    });

    it("lets a strict-RBAC connector manager replace the key, and audits only hints", async () => {
        mocks.authorization.enforcement = "strict";
        const res = await request(app).put("/").send({ apiKey: "the-real-key-value", model: "gemini-2.5-flash" });
        expect(res.status).toBe(200);
        const [entry] = mocks.audit.mock.calls[0];
        expect(entry).toMatchObject({ action: "AI_KEY_REPLACED", organizationId: 7, entityType: "organization_ai" });
        expect(entry.metadata).toEqual({ provider: "google", model: "gemini-2.5-flash", keyHint: "…2222", previousKeyHint: "…1111" });
        expect(JSON.stringify(entry)).not.toContain("the-real-key-value");
    });

    it("refuses a strict-RBAC member without the permission", async () => {
        mocks.authorization = { organizationId: 7, enforcement: "strict", roles: ["operator"], permissions: ["mission:view"] };
        const res = await request(app).delete("/");
        expect(res.status).toBe(403);
        expect(mocks.remove).not.toHaveBeenCalled();
    });

    it("lets an org admin remove a key that no longer decrypts, and audits it", async () => {
        mocks.context.isOrgAdmin = true;
        mocks.resolve.mockRejectedValue(new Error("Failed to decrypt data"));
        const res = await request(app).delete("/");
        expect(res.status).toBe(204);
        expect(mocks.remove).toHaveBeenCalledWith(7, "google");
        expect(mocks.audit.mock.calls[0][0]).toMatchObject({ action: "AI_KEY_REMOVED" });
    });

    it("records a first connection as connected, not replaced", async () => {
        mocks.context.isOrgAdmin = true;
        mocks.resolve.mockResolvedValue(null);
        await request(app).put("/").send({ apiKey: "x", model: "gemini-2.5-flash" });
        expect(mocks.audit.mock.calls[0][0].action).toBe("AI_KEY_CONNECTED");
    });

    it("connects, removes and defaults the named provider, auditing which one", async () => {
        mocks.context.isOrgAdmin = true;
        mocks.resolve.mockResolvedValue(null);
        mocks.save.mockResolvedValue({ configured: true, provider: "xai", model: "grok-4", keyHint: "…3333" });
        await request(app).put("/").send({ provider: "xai", apiKey: "x", model: "grok-4" });
        expect(mocks.resolve).toHaveBeenCalledWith(7, "xai");
        expect(mocks.save.mock.calls[0][1]).toMatchObject({ provider: "xai" });
        expect(mocks.audit.mock.calls[0][0].metadata).toMatchObject({ provider: "xai", keyHint: "…3333" });

        expect((await request(app).delete("/?provider=anthropic")).status).toBe(204);
        expect(mocks.remove).toHaveBeenCalledWith(7, "anthropic");

        mocks.status.mockResolvedValue({ configured: true, provider: "qwen" });
        const res = await request(app).put("/default").send({ provider: "qwen" });
        expect(res.status).toBe(200);
        expect(mocks.setDefault).toHaveBeenCalledWith(7, "qwen");
        expect(mocks.audit.mock.calls.at(-1)![0]).toMatchObject({ action: "AI_DEFAULT_PROVIDER_CHANGED", metadata: { provider: "qwen" } });
    });

    it("rejects an unknown provider before touching storage", async () => {
        mocks.context.isOrgAdmin = true;
        expect((await request(app).put("/").send({ provider: "https://evil.example", apiKey: "x" })).status).toBe(400);
        expect((await request(app).delete("/?provider=nope")).status).toBe(400);
        expect((await request(app).put("/default").send({ provider: "nope" })).status).toBe(400);
        expect(mocks.save).not.toHaveBeenCalled();
        expect(mocks.remove).not.toHaveBeenCalled();
        expect(mocks.setDefault).not.toHaveBeenCalled();
    });

    it("keeps members from changing the default", async () => {
        expect((await request(app).put("/default").send({ provider: "google" })).status).toBe(403);
        expect(mocks.setDefault).not.toHaveBeenCalled();
    });

    describe("fal.ai key", () => {
        beforeEach(() => {
            mocks.fal.status.mockResolvedValue({ configured: false, provider: "fal", keyHint: null });
            mocks.fal.save.mockResolvedValue({ configured: true, provider: "fal", keyHint: "…6789" });
        });

        it("keeps members out and lets an org admin connect, auditing only hints", async () => {
            expect((await request(app).put("/fal").send({ apiKey: "x" })).status).toBe(403);
            expect(mocks.fal.save).not.toHaveBeenCalled();

            mocks.context.isOrgAdmin = true;
            const res = await request(app).put("/fal").send({ organizationId: 8, apiKey: "the-real-fal-key-value" });
            expect(res.status).toBe(200);
            expect(mocks.fal.save.mock.calls[0][0]).toBe(7);
            expect(res.headers["cache-control"]).toBe("no-store");
            const [entry] = mocks.audit.mock.calls[0];
            expect(entry).toMatchObject({ action: "AI_KEY_CONNECTED", metadata: { provider: "fal", keyHint: "…6789" } });
            expect(JSON.stringify(entry)).not.toContain("the-real-fal-key-value");
        });

        it("reports status without the key", async () => {
            mocks.fal.status.mockResolvedValue({ configured: true, provider: "fal", keyHint: "…6789" });
            const res = await request(app).get("/fal");
            expect(res.body).toEqual({ configured: true, provider: "fal", keyHint: "…6789", canManage: false });
        });
    });
});
