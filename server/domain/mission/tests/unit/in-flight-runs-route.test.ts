// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const mocks = vi.hoisted(() => ({
    context: vi.fn(),
    listInFlightRuns: vi.fn(),
}));

vi.mock("@server/utils/auth-context.js", () => ({
    getUserOrgContext: mocks.context,
    requireOrgId: (context: { organizationId: number | null }) => {
        if (!context.organizationId) {
            throw Object.assign(new Error("Organization context required"), { status: 403, statusCode: 403 });
        }
        return context.organizationId;
    },
}));

vi.mock("@domain/core/auth/security.service.js", () => ({
    requireAuth: (req: any, res: any, next: any) => (req.headers.authorization ? next() : res.sendStatus(401)),
}));

vi.mock("@server/domain/mission/core/mission-query.service.js", () => ({
    missionQueryService: {
        listInFlightRuns: mocks.listInFlightRuns,
    },
}));

// Mock the rest of dependencies needed by mission-runs.route
vi.mock("@server/domain/mission/core/mission-run.service.js", () => ({ missionRunService: {} }));
vi.mock("@server/domain/mission/core/mission.service.js", () => ({ missionService: {} }));
vi.mock("@server/domain/mission/core/mission-replay.service.js", () => ({ missionReplayService: {} }));
vi.mock("@server/domain/mission/core/mission-evidence-timeline.service.js", () => ({ missionEvidenceTimelineService: {} }));
vi.mock("@server/domain/mission/core/mission-audit-integrity.js", () => ({
    buildEvidenceIntegrityManifest: vi.fn(),
    classifyMissionEvidence: vi.fn(),
}));
vi.mock("@server/domain/mission/core/mission-reliability-evidence.service.js", () => ({ getOrganizationReliabilityEvidence: vi.fn() }));
vi.mock("@server/domain/mission/core/mission-audit-report.js", () => ({ attestAuditReport: vi.fn(), renderAuditReportHtml: vi.fn() }));
vi.mock("@server/domain/mission/core/reasoning-assessment.service.js", () => ({ reasoningAssessmentService: {} }));
vi.mock("@server/mcp/auth.js", () => ({ mcpAuthMiddleware: (_req: any, _res: any, next: any) => next(), checkLocalRunnerScope: vi.fn() }));
vi.mock("@server/utils/organization-permissions.js", () => ({
    requireOrganizationPermission: () => (_req: any, _res: any, next: any) => next(),
}));

import { missionRunsRouter } from "../../routes/mission-runs.route";

const app = express();
app.use(express.json());
app.use("/api/mission-runs", missionRunsRouter);
app.use((error: any, _req: any, res: any, _next: any) => res.status(error.statusCode ?? error.status ?? 500).json({ error: error.message }));

describe("GET /api/mission-runs/in-flight", () => {
    const ORG_ID = 342;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.context.mockResolvedValue({ userId: "user-1", organizationId: ORG_ID, isSuperAdmin: false });
        mocks.listInFlightRuns.mockResolvedValue([
            {
                runId: 10,
                missionId: 5,
                name: "AI Chief of Staff Research",
                status: "active",
                costUsd: 0.85,
                budgetLimitUsd: 15.00,
                lastEvent: "tool completed · web_search",
                lastActivityAt: new Date().toISOString(),
                stale: false,
            },
        ]);
    });

    it("serves in-flight runs strictly scoped to the caller's organization", async () => {
        const res = await request(app)
            .get("/api/mission-runs/in-flight")
            .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(200);
        expect(mocks.listInFlightRuns).toHaveBeenCalledWith(ORG_ID);
        expect(res.body).toHaveLength(1);
        expect(res.body[0].runId).toBe(10);
        expect(res.body[0].costUsd).toBe(0.85);
    });

    it("requires organization context and refuses un-scoped requests with 403", async () => {
        mocks.context.mockResolvedValue({ userId: "user-1", organizationId: null, isSuperAdmin: false });

        const res = await request(app)
            .get("/api/mission-runs/in-flight")
            .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(403);
        expect(mocks.listInFlightRuns).not.toHaveBeenCalled();
    });

    it("requires authentication and returns 401 when unauthenticated", async () => {
        const res = await request(app).get("/api/mission-runs/in-flight");

        expect(res.status).toBe(401);
        expect(mocks.listInFlightRuns).not.toHaveBeenCalled();
    });
});
