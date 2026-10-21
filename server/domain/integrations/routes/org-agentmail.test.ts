/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const mocks = vi.hoisted(() => ({ context: { organizationId: 9 as number | null, isOrgAdmin: true, isSuperAdmin: false },
    status: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), forOrg: vi.fn(), authenticated: true }));
vi.mock("@server/domain/auth/core/security.service.js", () => ({ requireAuth: (req: unknown, res: express.Response, next: express.NextFunction) => mocks.authenticated ? next() : res.status(401).end() }));
vi.mock("@server/utils/auth-context.js", () => ({
    getUserOrgContext: async () => mocks.context,
    requireOrgId: (context: typeof mocks.context) => { if (!context.organizationId) throw Object.assign(new Error("Organization context required"), { status: 403 }); return context.organizationId; },
}));
vi.mock("../core/org-agentmail.service.js", () => ({ orgAgentMailService: { status: mocks.status, connect: mocks.connect, disconnect: mocks.disconnect } }));
vi.mock("../core/agentmail.service.js", () => ({ agentMailService: { forOrg: mocks.forOrg } }));
import router from "./org-agentmail.js";

function app() {
    const app = express(); app.use(express.json()); app.use(router);
    app.use((error: { status?: number; message: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.status ?? 500).json({ message: error.message }));
    return app;
}
beforeEach(() => {
    vi.clearAllMocks(); mocks.authenticated = true;
    mocks.context = { organizationId: 9, isOrgAdmin: true, isSuperAdmin: false };
    mocks.status.mockResolvedValue({ configured: true, inboxId: "nine@agentmail.to" });
    mocks.connect.mockResolvedValue({ configured: true, inboxId: "nine@agentmail.to" });
});
describe("organization AgentMail API", () => {
    it("requires authentication", async () => {
        mocks.authenticated = false;
        await request(app()).get("/connection").expect(401);
        expect(mocks.status).not.toHaveBeenCalled();
    });
    it("returns only the current organization's connection", async () => {
        const response = await request(app()).get("/connection?orgId=77").expect(200);
        expect(mocks.status).toHaveBeenCalledWith(9);
        expect(response.body.canManage).toBe(true);
        expect(response.headers["cache-control"]).toBe("no-store");
    });
    it("requires a resolved organization even for a super administrator", async () => {
        mocks.context.organizationId = null; mocks.context.isSuperAdmin = true;
        await request(app()).get("/connection").expect(403);
        expect(mocks.status).not.toHaveBeenCalled();
    });
    it.each(["put", "delete"] as const)("prevents members from changing connections using %s", async method => {
        mocks.context.isOrgAdmin = false;
        await request(app())[method]("/connection").send({ inboxId: "nine@agentmail.to", apiKey: "secret" }).expect(403);
        expect(mocks.connect).not.toHaveBeenCalled(); expect(mocks.disconnect).not.toHaveBeenCalled();
    });
    it("connects using server-resolved organization context", async () => {
        await request(app()).put("/connection").send({ inboxId: "nine@agentmail.to", apiKey: "secret" }).expect(200);
        expect(mocks.connect).toHaveBeenCalledWith(9, { inboxId: "nine@agentmail.to", apiKey: "secret" });
    });
    it("disconnects only the current organization", async () => {
        await request(app()).delete("/connection?orgId=77").expect(204);
        expect(mocks.disconnect).toHaveBeenCalledWith(9);
    });
    it("reads a thread using the current organization's client", async () => {
        const getThread = vi.fn().mockResolvedValue({ thread_id: "thread-1", messages: [] });
        mocks.forOrg.mockResolvedValue({ getThread });
        await request(app()).get("/threads/thread-1?orgId=77").expect(200);
        expect(mocks.forOrg).toHaveBeenCalledWith(9); expect(getThread).toHaveBeenCalledWith("thread-1");
    });
});
