// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { NotFoundError } from "@server/utils/errors.js";

/**
 * These /api/mission-runs/:id routes used to check only that the caller was logged in,
 * while the service calls behind them read or write the run by id alone — so any
 * authenticated user could pause, terminate, edit, recover, advance or replay any
 * tenant's run, and read its checkpoints, reasoning and history. These pin that the run
 * is looked up in the caller's organization BEFORE the service is allowed to touch it.
 */

const mocks = vi.hoisted(() => ({
    context: vi.fn(),
    getByIdOrThrow: vi.fn(),
    pause: vi.fn(),
    resumeMissionRun: vi.fn(),
    terminate: vi.fn(),
    update: vi.fn(),
    getCheckpoints: vi.fn(),
    getTimeline: vi.fn(),
    updatePlan: vi.fn(),
    simulatePlan: vi.fn(),
    getReasoningFeed: vi.fn(),
    applyRecoveryStrategy: vi.fn(),
    getRunEvents: vi.fn(),
    getShadowRuns: vi.fn(),
    listShadowRuns: vi.fn(),
    listSkillFailureEvents: vi.fn(),
    listOptimizationProposals: vi.fn(),
    assessAndPersist: vi.fn(),
    convertToPrePlanned: vi.fn(),
    advanceSequence: vi.fn(),
    getReplayHistory: vi.fn(),
    replayFromCheckpoint: vi.fn(),
    compareRuns: vi.fn(),
}));

vi.mock("@server/utils/auth-context.js", () => ({
    getUserOrgContext: mocks.context,
    requireOrgId: (context: { organizationId: number | null }) => {
        if (!context.organizationId) throw Object.assign(new Error("Organization context required"), { status: 403 });
        return context.organizationId;
    },
}));
vi.mock("@domain/core/auth/security.service.js", () => ({
    requireAuth: (req: any, res: any, next: any) => (req.headers.authorization ? next() : res.sendStatus(401)),
}));
vi.mock("@server/domain/mission/core/mission-run.service.js", () => ({
    missionRunService: {
        getByIdOrThrow: mocks.getByIdOrThrow,
        pause: mocks.pause,
        resumeMissionRun: mocks.resumeMissionRun,
        terminate: mocks.terminate,
        update: mocks.update,
        getCheckpoints: mocks.getCheckpoints,
        getTimeline: mocks.getTimeline,
        updatePlan: mocks.updatePlan,
        simulatePlan: mocks.simulatePlan,
        getReasoningFeed: mocks.getReasoningFeed,
        applyRecoveryStrategy: mocks.applyRecoveryStrategy,
        getRunEvents: mocks.getRunEvents,
        getShadowRuns: mocks.getShadowRuns,
        listShadowRuns: mocks.listShadowRuns,
        listSkillFailureEvents: mocks.listSkillFailureEvents,
        listOptimizationProposals: mocks.listOptimizationProposals,
    },
}));
vi.mock("@server/domain/mission/core/mission.service.js", () => ({
    missionService: { convertToPrePlanned: mocks.convertToPrePlanned, advanceSequence: mocks.advanceSequence },
}));
vi.mock("@server/domain/mission/core/mission-replay.service.js", () => ({
    missionReplayService: {
        getReplayHistory: mocks.getReplayHistory,
        replayFromCheckpoint: mocks.replayFromCheckpoint,
        compareRuns: mocks.compareRuns,
    },
}));
vi.mock("@server/domain/mission/core/mission-evidence-timeline.service.js", () => ({ missionEvidenceTimelineService: {} }));
vi.mock("@server/domain/mission/core/mission-audit-integrity.js", () => ({
    buildEvidenceIntegrityManifest: vi.fn(),
    classifyMissionEvidence: vi.fn(),
}));
vi.mock("@server/domain/mission/core/mission-reliability-evidence.service.js", () => ({ getOrganizationReliabilityEvidence: vi.fn() }));
vi.mock("@server/domain/mission/core/mission-audit-report.js", () => ({ attestAuditReport: vi.fn(), renderAuditReportHtml: vi.fn() }));
vi.mock("@server/domain/mission/core/reasoning-assessment.service.js", () => ({
    reasoningAssessmentService: { assessAndPersist: mocks.assessAndPersist },
}));
vi.mock("@server/mcp/auth.js", () => ({ mcpAuthMiddleware: (_req: any, _res: any, next: any) => next(), checkLocalRunnerScope: vi.fn() }));
vi.mock("@server/utils/organization-permissions.js", () => ({
    requireOrganizationPermission: () => (_req: any, _res: any, next: any) => next(),
}));

import { missionRunsRouter } from "../../routes/mission-runs.route";

const app = express();
app.use(express.json());
app.use("/api/mission-runs", missionRunsRouter);
app.use((error: any, _req: any, res: any, _next: any) => res.status(error.statusCode ?? error.status ?? 500).json({ error: error.message }));

const RUN_ID = 42;
const OWN_ORG = 7;

/** A run that exists only in `orgId`, as the org-scoped query would see it. */
function runLivesIn(orgId: number) {
    mocks.getByIdOrThrow.mockImplementation(async (id: number, organizationId?: number) => {
        if (organizationId !== undefined && organizationId !== orgId) throw new NotFoundError("Mission Run not found");
        return { id, organizationId: orgId, status: "waiting_on_human", lastCheckpointAt: null };
    });
}

interface RouteCase {
    name: string;
    method: "get" | "post" | "put" | "patch";
    path: string;
    body?: object;
    /** Success status, when not 200. */
    ok?: number;
    /** The id-only service call that must never run for a run the caller cannot see. */
    effect: ReturnType<typeof vi.fn> | null;
}

const ROUTES: RouteCase[] = [
    { name: "POST /:id/pause", method: "post", path: "pause", effect: mocks.pause },
    { name: "POST /:id/resume", method: "post", path: "resume", effect: mocks.resumeMissionRun },
    { name: "POST /:id/terminate", method: "post", path: "terminate", effect: mocks.terminate },
    { name: "PUT /:id", method: "put", path: "", body: { status: "completed" }, effect: mocks.update },
    { name: "GET /:id/checkpoints", method: "get", path: "checkpoints", effect: mocks.getCheckpoints },
    { name: "GET /:id/timeline", method: "get", path: "timeline", effect: mocks.getTimeline },
    // Reads the run itself; nothing else to withhold beyond the 404.
    { name: "GET /:id/dwell-time", method: "get", path: "dwell-time", effect: null },
    { name: "PATCH /:id/plan", method: "patch", path: "plan", body: {}, effect: mocks.updatePlan },
    { name: "POST /:id/simulate", method: "post", path: "simulate", effect: mocks.simulatePlan },
    { name: "GET /:id/reasoning", method: "get", path: "reasoning", effect: mocks.getReasoningFeed },
    { name: "GET /:id/reasoning-assessment", method: "get", path: "reasoning-assessment", effect: mocks.assessAndPersist },
    { name: "POST /:id/reasoning-assessment", method: "post", path: "reasoning-assessment", effect: mocks.assessAndPersist },
    { name: "POST /:id/recovery", method: "post", path: "recovery", body: { strategy: "retry" }, effect: mocks.applyRecoveryStrategy },
    { name: "POST /:id/convert", method: "post", path: "convert", ok: 201, effect: mocks.convertToPrePlanned },
    { name: "POST /:id/advance", method: "post", path: "advance", effect: mocks.advanceSequence },
    { name: "GET /:id/replay/checkpoints", method: "get", path: "replay/checkpoints", effect: mocks.getReplayHistory },
    { name: "POST /:id/replay", method: "post", path: "replay", body: { checkpointId: 5 }, effect: mocks.replayFromCheckpoint },
    { name: "GET /:id/replay/compare/:compareId", method: "get", path: "replay/compare/43", effect: mocks.compareRuns },
    { name: "GET /:id/history", method: "get", path: "history", effect: mocks.getRunEvents },
    { name: "GET /:id/shadow-runs", method: "get", path: "shadow-runs", effect: mocks.getShadowRuns },
    { name: "GET /:id/autoresearch-report", method: "get", path: "autoresearch-report", effect: mocks.listShadowRuns },
];

function call(route: RouteCase, authorized = true) {
    const url = `/api/mission-runs/${RUN_ID}${route.path ? `/${route.path}` : ""}`;
    let req = request(app)[route.method](url);
    if (authorized) req = req.set("Authorization", "test");
    return route.method === "get" ? req : req.send(route.body ?? {});
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.context.mockResolvedValue({ userId: "user-1", organizationId: OWN_ORG, isSuperAdmin: false });
    mocks.update.mockResolvedValue({ id: RUN_ID });
    mocks.updatePlan.mockResolvedValue({ id: RUN_ID });
    for (const list of [mocks.getCheckpoints, mocks.getTimeline, mocks.getRunEvents, mocks.getShadowRuns,
        mocks.listShadowRuns, mocks.listSkillFailureEvents, mocks.listOptimizationProposals]) {
        list.mockResolvedValue([]);
    }
    for (const value of [mocks.simulatePlan, mocks.getReasoningFeed, mocks.assessAndPersist, mocks.convertToPrePlanned,
        mocks.getReplayHistory, mocks.replayFromCheckpoint, mocks.compareRuns]) {
        value.mockResolvedValue({});
    }
    runLivesIn(OWN_ORG);
});

describe("GET /:id/replay/compare/:compareId", () => {
    it("refuses when only the compared run is in another organization", async () => {
        mocks.getByIdOrThrow.mockImplementation(async (id: number, organizationId?: number) => {
            const orgOfRun = id === RUN_ID ? OWN_ORG : 99;
            if (organizationId !== undefined && organizationId !== orgOfRun) throw new NotFoundError("Mission Run not found");
            return { id, organizationId: orgOfRun };
        });
        const res = await request(app).get(`/api/mission-runs/${RUN_ID}/replay/compare/43`).set("Authorization", "test");
        expect(res.status).toBe(404);
        expect(mocks.getByIdOrThrow).toHaveBeenCalledWith(43, OWN_ORG);
        expect(mocks.compareRuns).not.toHaveBeenCalled();
    });
});

describe.each(ROUTES)("$name", (route) => {
    it("serves a run in the caller's organization, looked up with that organization", async () => {
        const res = await call(route);
        expect(res.status).toBe(route.ok ?? 200);
        expect(mocks.getByIdOrThrow).toHaveBeenNthCalledWith(1, RUN_ID, OWN_ORG);
        if (route.effect) expect(route.effect.mock.calls[0]?.[0]).toBe(RUN_ID);
    });

    it("reads another organization's run as not found, and never touches it", async () => {
        runLivesIn(99);
        const res = await call(route);
        expect(res.status).toBe(404);
        if (route.effect) expect(route.effect).not.toHaveBeenCalled();
    });

    it("refuses a caller with no organization instead of falling back to an unscoped lookup", async () => {
        mocks.context.mockResolvedValue({ userId: "user-1", organizationId: null, isSuperAdmin: false });
        const res = await call(route);
        expect(res.status).toBe(403);
        expect(mocks.getByIdOrThrow).not.toHaveBeenCalled();
        if (route.effect) expect(route.effect).not.toHaveBeenCalled();
    });

    it("lets a super admin reach a run in any organization", async () => {
        runLivesIn(99);
        mocks.context.mockResolvedValue({ userId: "admin", organizationId: OWN_ORG, isSuperAdmin: true });
        const res = await call(route);
        expect(res.status).toBe(route.ok ?? 200);
        expect(mocks.getByIdOrThrow).toHaveBeenNthCalledWith(1, RUN_ID);
        if (route.effect) expect(route.effect).toHaveBeenCalled();
    });

    it("requires authentication", async () => {
        const res = await call(route, false);
        expect(res.status).toBe(401);
        if (route.effect) expect(route.effect).not.toHaveBeenCalled();
    });
});
