// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const mocks = vi.hoisted(() => ({ context: vi.fn(), access: vi.fn(), find: vi.fn() }));
vi.mock("@server/utils/auth-context.js", () => ({
    getUserOrgContext: mocks.context,
    validateOrgAccess: mocks.access,
    requireOrgId: (context: { organizationId: number | null }) => {
        if (!context.organizationId) throw Object.assign(new Error("Organization context required"), { status: 403 });
        return context.organizationId;
    },
}));
vi.mock("@domain/core/auth/security.service.js", () => ({ requireAuth: (req: any, res: any, next: any) => req.headers.authorization ? next() : res.sendStatus(401) }));
vi.mock("@server/domain/mission/core/mission.service.js", () => ({ missionService: {} }));
vi.mock("@server/domain/mission/core/mission-query.service.js", () => ({ missionQueryService: {} }));
vi.mock("@server/domain/mission/core/memory.service.js", () => ({ memoryService: {} }));
vi.mock("@server/domain/mission/core/mission-dependency-resolver.service.js", () => ({ missionDependencyResolver: {} }));
vi.mock("@server/domain/mission/core/mission-analyst.service.js", () => ({ MissionAnalystService: class {} }));
vi.mock("@server/domain/mission/utils/graph-mapper.js", () => ({ graphMapper: {} }));
vi.mock("@server/domain/mission/core/mission-knowledge-bridge.js", () => ({ missionKnowledgeBridge: { findSimilarMissions: mocks.find } }));

import { missionsRouter } from "../../server/domain/mission/routes/missions.route";

const app = express();
app.use("/api/missions", missionsRouter);
app.use((error: any, _req: any, res: any, _next: any) => res.status(error.name === "ZodError" ? 400 : error.statusCode ?? error.status ?? 500).json({ error: error.message }));
const lookup = () => request(app).get("/api/missions/similar").set("Authorization", "test").query({ objective: "Review renewal accounts", orgId: 99 });

beforeEach(() => {
    vi.clearAllMocks();
    mocks.context.mockResolvedValue({ userId: "user-1", organizationId: 7, isSuperAdmin: false });
    mocks.access.mockResolvedValue(true);
    mocks.find.mockResolvedValue([{ id: 1, missionId: 12, strategy: "rolling_wave" }]);
});

describe("GET /api/missions/similar", () => {
    it("uses the resolved organization after access validation, not the raw query id", async () => {
        const res = await lookup();
        expect(res.status).toBe(200);
        expect(mocks.access).toHaveBeenCalledWith(7, "user-1");
        expect(mocks.find).toHaveBeenCalledWith(7, "Review renewal accounts");
        expect(res.body.missions[0].missionId).toBe(12);
    });
    it("rejects non-members before reading mission outcomes", async () => {
        mocks.access.mockResolvedValue(false);
        expect((await lookup()).status).toBe(403);
        expect(mocks.find).not.toHaveBeenCalled();
    });
    it("does not fall back to another organization", async () => {
        mocks.context.mockResolvedValue({ userId: "user-1", organizationId: null, isSuperAdmin: false });
        expect((await lookup()).status).toBe(403);
        expect(mocks.find).not.toHaveBeenCalled();
    });
    it("requires authentication", async () => {
        expect((await request(app).get("/api/missions/similar").query({ objective: "Review renewal accounts" })).status).toBe(401);
        expect(mocks.find).not.toHaveBeenCalled();
    });
    it("rejects short objectives without searching", async () => {
        expect((await request(app).get("/api/missions/similar").set("Authorization", "test").query({ objective: "short" })).status).toBe(400);
        expect(mocks.find).not.toHaveBeenCalled();
    });
});
