/** @vitest-environment node */
/**
 * A Cycle Builder draft becomes a live cycle only when the server says so.
 *
 * - The stored `readiness.test` is client-writable (PATCH /drafts/:id saves the
 *   definition as sent), and the readiness probe is the only check that the
 *   app deployments, form agents and pipelines a draft names belong to the
 *   org. create-cycle and publish-revision re-run it.
 * - Creating or rewriting a cycle needs cycle:write or org admin, as it does
 *   on the cycles API; any member used to be able to.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const ctx = vi.hoisted(() => ({ current: null as any }));
vi.mock("@server/utils/auth-context.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../server/utils/auth-context.js")>()),
    getUserOrgContext: vi.fn(async () => ctx.current),
    // The real guard calls the module-internal getUserOrgContext, which the
    // export mock above does not reach; same rule, read from the mocked context.
    requireOrgAdminOrSuper: vi.fn((_req: any, res: any, next: any) =>
        ctx.current.isAdmin ? next() : res.status(403).json({ message: "Admin access required" })),
}));

const drafts = vi.hoisted(() => ({
    findDraft: vi.fn(), findCycle: vi.fn(), createCycle: vi.fn(), reviseCycleInPlace: vi.fn(),
    findEditDraft: vi.fn(), findDraftThatBuiltCycle: vi.fn(), insertDraft: vi.fn(), listBlueprints: vi.fn(),
}));
vi.mock("@domain/mission/core/cycle-builder-draft.service.js", () => ({ cycleBuilderDraftService: drafts }));

const studio = vi.hoisted(() => ({ verifyStudioResources: vi.fn() }));
vi.mock("@domain/mission/core/cycle-manager.service.js", () => ({ CycleManagerService: studio }));
vi.mock("@domain/ai/core/system-ai.service.js", () => ({ systemAiService: {} }));
vi.mock("@domain/auth/core/security.service.js", () => ({ requireAuth: (_req: any, _res: any, next: any) => next() }));

// @ts-ignore
import supertest from "supertest";
import express from "express";
import router from "../../server/routes/cycle-builder-drafts";
import { quarterlyAccessReviewDraft } from "../../shared/schema/cycle-builder-draft.fixtures";

const MEMBER = { userId: "u1", organizationId: 5, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false };
const ADMIN = { ...MEMBER, isAdmin: true, isOrgAdmin: true };

const passedDefinition = {
    ...quarterlyAccessReviewDraft,
    phases: quarterlyAccessReviewDraft.phases.map((p: any) => ({
        ...p,
        ownerAgentId: p.ownerAgentId || (p.type === "mission" ? "assigned-agent" : undefined),
    })),
    // What a client can write through PATCH /drafts/:id.
    readiness: { validation: "valid", test: "passed" },
};

const app = express();
app.use(express.json());
app.use((req: any, _res, next) => { req.user = { id: "u1", mcpPermissions: [] }; next(); });
app.use("/api/cycle-builder", router);
const api = supertest(app);

beforeEach(() => {
    vi.clearAllMocks();
    ctx.current = ADMIN;
    drafts.findDraft.mockResolvedValue({
        id: 3, organizationId: 5, version: 1, createdCycleId: null, sourceType: "edit", sourceId: "77",
        definition: passedDefinition,
    });
    drafts.createCycle.mockResolvedValue({ id: 88 });
    drafts.reviseCycleInPlace.mockResolvedValue({ id: 77 });
    drafts.findCycle.mockResolvedValue({ id: 77, status: "planning", metadata: {}, updatedAt: new Date() });
    studio.verifyStudioResources.mockResolvedValue([]);
});

describe("create-cycle", () => {
    it("re-runs readiness and refuses a draft whose resources do not belong to the org", async () => {
        studio.verifyStudioResources.mockResolvedValue(["Workbench deployment 4242 is unavailable."]);
        const res = await api.post("/api/cycle-builder/drafts/3/create-cycle").send({});
        expect(res.status).toBe(422);
        expect(res.body.errors).toContain("Workbench deployment 4242 is unavailable.");
        expect(studio.verifyStudioResources).toHaveBeenCalledWith(5, expect.anything());
        expect(drafts.createCycle).not.toHaveBeenCalled();
    });

    it("creates the cycle in the caller's org when readiness passes on the server", async () => {
        const res = await api.post("/api/cycle-builder/drafts/3/create-cycle").send({});
        expect(res.status).toBe(201);
        expect(drafts.createCycle).toHaveBeenCalledWith(5, 3, expect.objectContaining({ createdBy: "u1" }), expect.any(Function));
    });

    it("refuses a member without cycle:write", async () => {
        ctx.current = MEMBER;
        const res = await api.post("/api/cycle-builder/drafts/3/create-cycle").send({});
        expect(res.status).toBe(403);
        expect(drafts.createCycle).not.toHaveBeenCalled();
    });
});

describe("publish-revision", () => {
    it("re-runs readiness before rewriting the source cycle", async () => {
        studio.verifyStudioResources.mockResolvedValue(["Data Pipeline 'x' (ID: 9) is unavailable or does not belong to this organization."]);
        const res = await api.post("/api/cycle-builder/drafts/3/publish-revision").send({ version: 1 });
        expect(res.status).toBe(422);
        expect(drafts.reviseCycleInPlace).not.toHaveBeenCalled();
        expect(drafts.createCycle).not.toHaveBeenCalled();
    });

    it("refuses a member without cycle:write", async () => {
        ctx.current = MEMBER;
        const res = await api.post("/api/cycle-builder/drafts/3/publish-revision").send({ version: 1 });
        expect(res.status).toBe(403);
        expect(drafts.reviseCycleInPlace).not.toHaveBeenCalled();
    });

    it("revises a planning cycle in place, scoped to the caller's org", async () => {
        const res = await api.post("/api/cycle-builder/drafts/3/publish-revision").send({ version: 1 });
        expect(res.status).toBe(200);
        expect(res.body.mode).toBe("in_place");
        expect(drafts.reviseCycleInPlace).toHaveBeenCalledWith(5, 3, 77, expect.any(Object), expect.any(Array));
    });
});

describe("edit-draft", () => {
    it("refuses a member without cycle:write", async () => {
        ctx.current = MEMBER;
        const res = await api.post("/api/cycle-builder/cycles/77/edit-draft").send({});
        expect(res.status).toBe(403);
        expect(drafts.findCycle).not.toHaveBeenCalled();
    });
});
