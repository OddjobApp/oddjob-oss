// @vitest-environment node
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The sidecar's predictive engine holds every organization's data in one
 * process, so only a platform super administrator reaches it. The four routes
 * Node answers per organization never go to the sidecar, which has no such
 * routes and would have replaced a working answer with its 404.
 */
const mocks = vi.hoisted(() => ({
    context: { organizationId: 7, isSuperAdmin: false, isOrgAdmin: true, isAdmin: true, userId: "u" },
    sidecarFetch: vi.fn(), stats: vi.fn(),
}));
vi.mock("@domain/core/auth/security.service.js", () => ({
    requireAuth: (req: any, _res: any, next: any) => { req.organizationId = 7; next(); },
}));
vi.mock("@server/utils/auth-context.js", () => ({ getUserOrgContext: async () => mocks.context }));
vi.mock("@server/integrations/sidecar-client.js", () => ({ sidecarFetch: mocks.sidecarFetch, sidecarConfigured: () => true }));
vi.mock("@server/database_service.js", () => ({ db: {} }));
vi.mock("../domain/mission/core/cycle-predictive.service.js", () => ({ CyclePredictiveService: { getModelStats: mocks.stats } }));
vi.mock("../domain/mission/core/cycle-analytics.service.js", () => ({ CycleAnalyticsService: {} }));
import router from "./predictive.js";

function app() {
    const server = express();
    server.use(express.json());
    server.use("/api/predictive", router);
    server.use((err: any, _req: any, res: any, _next: any) => res.status(err.status ?? 500).json({ error: err.message }));
    return server;
}

describe("predictive proxy", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.context = { organizationId: 7, isSuperAdmin: false, isOrgAdmin: true, isAdmin: true, userId: "u" };
        mocks.sidecarFetch.mockImplementation(async () => new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } }));
        mocks.stats.mockReturnValue({ models: 1 });
    });

    it("refuses an organization administrator the platform-wide engine", async () => {
        const response = await request(app()).post("/api/predictive/bulk/optimize-all-workflows").send({});
        expect(response.status).toBe(403);
        expect(mocks.sidecarFetch).not.toHaveBeenCalled();
    });

    it("lets a platform super administrator through, with the token and no organization", async () => {
        mocks.context = { ...mocks.context, isSuperAdmin: true };
        const response = await request(app()).get("/api/predictive/analytics/prediction-accuracy");
        expect(response.status).toBe(200);
        expect(mocks.sidecarFetch).toHaveBeenCalledWith("/api/predictive/analytics/prediction-accuracy", expect.not.objectContaining({ organizationId: expect.anything() }));
    });

    it("answers organization-scoped stats here, without asking the sidecar", async () => {
        const response = await request(app()).get("/api/predictive/stats");
        expect(response.status).toBe(200);
        expect(mocks.stats).toHaveBeenCalledWith(7);
        expect(mocks.sidecarFetch).not.toHaveBeenCalled();
    });
});
