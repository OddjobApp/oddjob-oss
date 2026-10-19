/** @vitest-environment node */
/**
 * The global settings row and /api/execute act on the whole platform, so an
 * org admin — `isAdmin` is true for any org admin and any org API key — must
 * not reach them. Only a super admin may.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const ctx = vi.hoisted(() => ({ current: null as any }));
vi.mock("../../server/utils/auth-context.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../server/utils/auth-context.js")>()),
    getUserOrgContext: vi.fn(async () => ctx.current),
}));
vi.mock("@domain/core/auth/security.service.js", () => ({ requireAuth: (_req: any, _res: any, next: any) => next() }));

const settings = vi.hoisted(() => ({
    getGlobalSettings: vi.fn(), saveGlobalSettings: vi.fn(),
    getBrowserNotificationPreferences: vi.fn(), saveBrowserNotificationPreferences: vi.fn(), countActiveJobs: vi.fn(),
}));
vi.mock("@domain/system/platform-settings.service.js", () => ({ platformSettingsService: settings }));

const python = vi.hoisted(() => ({ executeScript: vi.fn() }));
vi.mock("@domain/integrations/core/gateway/python.gateway.js", () => ({ pythonBridge: python }));

// @ts-ignore
import supertest from "supertest";
import express from "express";
import { registerSystemRoutes } from "../../server/routes/system";
import { errorHandler } from "../../server/middleware/error-handler";

const ORG_ADMIN = { userId: "u1", organizationId: 5, isAdmin: true, isOrgAdmin: true, isSuperAdmin: false };
const SUPER = { ...ORG_ADMIN, isSuperAdmin: true };

const app = express();
app.use(express.json());
app.use((req: any, _res, next) => { req.session = { userId: "u1" }; next(); });
registerSystemRoutes(app);
app.use(errorHandler);
const api = supertest(app);

beforeEach(() => {
    vi.clearAllMocks();
    settings.getGlobalSettings.mockResolvedValue({ smtp: { host: "mail", pass: "secret" } });
    settings.saveGlobalSettings.mockImplementation(async (data: any) => data);
    python.executeScript.mockResolvedValue({ ok: true });
});

describe("PUT /api/settings (the platform-wide row)", () => {
    it("refuses an org admin and saves nothing", async () => {
        ctx.current = ORG_ADMIN;
        const res = await api.put("/api/settings").send({ maintenanceMode: true, smtp: { host: "evil" } });
        expect(res.status).toBe(403);
        expect(settings.saveGlobalSettings).not.toHaveBeenCalled();
    });

    it("lets a super admin save, keeps the stored SMTP password, and never returns it", async () => {
        ctx.current = SUPER;
        const res = await api.put("/api/settings").send({ maintenanceMode: true, smtp: { host: "mail2" } });
        expect(res.status).toBe(200);
        expect(settings.saveGlobalSettings).toHaveBeenCalledWith(
            expect.objectContaining({ maintenanceMode: true, smtp: { host: "mail2", pass: "secret" } }), "u1");
        expect(res.body.smtp).toEqual({ host: "mail2" });
    });
});

describe("POST /api/execute", () => {
    it("refuses an org admin without reaching the Python service", async () => {
        ctx.current = ORG_ADMIN;
        const res = await api.post("/api/execute").send({ script: "print(1)" });
        expect(res.status).toBe(403);
        expect(python.executeScript).not.toHaveBeenCalled();
    });

    it("runs for a super admin", async () => {
        ctx.current = SUPER;
        const res = await api.post("/api/execute").send({ script: "print(1)" });
        expect(res.status).toBe(200);
        expect(python.executeScript).toHaveBeenCalledWith("print(1)", {});
    });
});

describe("GET /api/settings", () => {
    it("never returns the SMTP password", async () => {
        ctx.current = ORG_ADMIN;
        const res = await api.get("/api/settings");
        expect(res.status).toBe(200);
        expect(res.body.smtp).toEqual({ host: "mail", smtpPasswordConfigured: true });
    });
});
