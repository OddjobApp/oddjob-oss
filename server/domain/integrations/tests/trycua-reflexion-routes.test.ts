/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const {
    mockGetSkill,
    mockAssertViewerAccess,
    mockAssertEnabled,
    mockRecordBuffer,
    mockGetCritiques,
} = vi.hoisted(() => ({
    mockGetSkill: vi.fn(),
    mockAssertViewerAccess: vi.fn(async () => {}),
    mockAssertEnabled: vi.fn(async () => {}),
    mockRecordBuffer: vi.fn(async () => ({ id: 1 })),
    mockGetCritiques: vi.fn(async () => [
        {
            id: 1,
            organizationId: 7,
            skillId: "skill-123",
            stepIndex: 2,
            site: "app.oddjob.ai",
            failureCategory: "modal_blocked",
            verbalCritique: "Target blocked by cookie consent overlay.",
            proposedRemediation: { action: "dismiss_modal", selector: "#cookie-accept" },
            succeededOnNextTrial: true,
            createdAt: new Date().toISOString(),
        },
    ]),
}));

vi.mock("../../auth/core/security.service.js", () => ({
    requireAuth: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../../utils/auth-context.js", () => ({
    getUserOrgContext: vi.fn(async () => ({
        userId: "user-42",
        organizationId: 7,
        isAdmin: true,
        isSuperAdmin: false,
        isOrgAdmin: true,
    })),
    requireOrgId: (ctx: any) => ctx.organizationId,
    assertOrgId: (value: any) => value,
}));

vi.mock("../trycua/desktop-viewer.js", () => ({
    assertViewerAccess: mockAssertViewerAccess,
    issueViewerTicket: vi.fn(),
    proxyViewerAsset: vi.fn(),
    resolveViewerHost: vi.fn(),
    viewerPageUrl: vi.fn(),
}));

vi.mock("../trycua/trycua-service.js", () => ({
    trycuaService: {
        assertEnabled: mockAssertEnabled,
    },
}));

vi.mock("../trycua/learned-skills.service.js", () => ({
    learnedSkillsService: {
        getSkill: mockGetSkill,
        listSkills: vi.fn(async () => []),
        isRecording: vi.fn(() => false),
    },
}));

vi.mock("../trycua/reflexion.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../trycua/reflexion.js")>();
    return {
        ...actual,
        recordReflexionBufferEntry: mockRecordBuffer,
        getReflexionCritiques: mockGetCritiques,
    };
});

const { default: trycuaRouter } = await import("../routes/trycua.js");
const { errorHandler } = await import("../../../middleware/error-handler.js");

const app = express();
app.use(express.json());
app.use("/api/integrations/trycua", trycuaRouter);
app.use(errorHandler);

describe("Trycua Reflexion API Routes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetSkill.mockResolvedValue({
            id: "skill-123",
            organizationId: 7,
            name: "Checkout flow",
            site: "app.oddjob.ai",
            status: "active",
        });
    });

    describe("POST /api/integrations/trycua/skills/:id/reflexion", () => {
        it("rejects request missing target descriptor", async () => {
            const res = await request(app)
                .post("/api/integrations/trycua/skills/skill-123/reflexion")
                .send({ stepIndex: 0 });

            expect(res.status).toBe(400);
            expect(res.body.error?.message || res.body.message).toContain("target is required");
        });

        it("evaluates DOM snippet and returns remediation prestep for modal overlay", async () => {
            const res = await request(app)
                .post("/api/integrations/trycua/skills/skill-123/reflexion")
                .send({
                    stepIndex: 2,
                    target: { tag: "button", css: ".submit-order" },
                    error: "Timeout 10000ms waiting for locator('.submit-order')",
                    currentDomSnippet: "<div class='cookie-consent'><button id='cookie-accept'>Accept</button></div>",
                });

            expect(res.status).toBe(200);
            expect(res.body.action).toBe("execute_remediation_prestep");
            expect(res.body.category).toBe("modal_blocked");
            expect(res.body.critique).toContain("modal dialog or cookie consent banner");
            expect(res.body.remediation?.selector).toBe("#cookie-accept");
            expect(mockRecordBuffer).toHaveBeenCalledWith(expect.objectContaining({
                organizationId: 7,
                skillId: "skill-123",
                stepIndex: 2,
                failureCategory: "modal_blocked",
            }));
        });

        it("evaluates auth gate and returns handoff_visual_loop", async () => {
            const res = await request(app)
                .post("/api/integrations/trycua/skills/skill-123/reflexion")
                .send({
                    stepIndex: 0,
                    target: { tag: "button", text: "Dashboard" },
                    url: "https://app.oddjob.ai/login?session_expired=1",
                });

            expect(res.status).toBe(200);
            expect(res.body.action).toBe("handoff_visual_loop");
            expect(res.body.category).toBe("auth_gate");
            expect(res.body.critique).toContain("authentication gate");
        });
    });

    describe("GET /api/integrations/trycua/skills/:id/reflexion", () => {
        it("returns buffer critiques for the skill within org scope", async () => {
            const res = await request(app)
                .get("/api/integrations/trycua/skills/skill-123/reflexion");

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.critiques)).toBe(true);
            expect(res.body.critiques[0].failureCategory).toBe("modal_blocked");
            expect(mockGetCritiques).toHaveBeenCalledWith(expect.objectContaining({
                organizationId: 7,
                skillId: "skill-123",
            }));
        });
    });
});
