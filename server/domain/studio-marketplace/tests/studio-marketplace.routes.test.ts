/** @vitest-environment node */

/**
 * Studio Marketplace routes test the same permission split as the Bot Exchange:
 * any authenticated user can see the catalogue, only org admins can enable or
 * disable a studio add-on.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { service, orgContext } = vi.hoisted(() => ({
    service: {
        list: vi.fn(),
        install: vi.fn(),
        uninstall: vi.fn(),
    },
    orgContext: {
        userId: "user-7",
        organizationId: 42,
        isAdmin: false,
        isSuperAdmin: false,
        isOrgAdmin: false,
    } as any,
}));

vi.mock("../core/studio-entitlement.service.js", () => ({
    studioEntitlementService: service,
}));

vi.mock("@domain/audit/core/audit-service.js", () => ({
    auditService: {
        logFromRequest: vi.fn(),
    },
}));

vi.mock("@domain/core/auth/security.service.js", () => ({
    requireAuth: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("@server/utils/auth-context.js", async (importOriginal) => {
    const actual: any = await importOriginal();
    return { ...actual, getUserOrgContext: vi.fn(async () => orgContext) };
});

const { studioMarketplaceRouter } = await import("../api/studio-marketplace.routes.js");
const { errorHandler } = await import("@server/middleware/error-handler.js");
const { auditService } = await import("@domain/audit/core/audit-service.js");

function app() {
    const server = express();
    server.use(express.json());
    server.use("/api/studio-marketplace", studioMarketplaceRouter);
    server.use(errorHandler);
    return server;
}

const LISTING = { kind: "media", name: "Media Studio", installed: true, installedAt: null, installedByUserId: null };

beforeEach(() => {
    vi.clearAllMocks();
    orgContext.isAdmin = false;
    service.list.mockResolvedValue([LISTING]);
    service.install.mockResolvedValue({ id: 1, organizationId: 42, studioKind: "prediction" });
    service.uninstall.mockResolvedValue(undefined);
});

describe("studio marketplace routes", () => {
    it("lists studios for an authenticated member", async () => {
        const res = await request(app()).get("/api/studio-marketplace/studios");
        expect(res.status).toBe(200);
        expect(res.body.studios).toEqual([LISTING]);
        expect(service.list).toHaveBeenCalledWith(42);
    });

    it("refuses to install for a member", async () => {
        const res = await request(app()).post("/api/studio-marketplace/studios/prediction/install").send({});
        expect(res.status).toBe(403);
        expect(service.install).not.toHaveBeenCalled();
    });

    it("installs for an admin", async () => {
        orgContext.isAdmin = true;
        const res = await request(app()).post("/api/studio-marketplace/studios/prediction/install").send({});
        expect(res.status).toBe(201);
        expect(service.install).toHaveBeenCalledWith(42, "user-7", "prediction");
        expect(auditService.logFromRequest).toHaveBeenCalledWith(
            expect.anything(),
            "studio_installed",
            "organization_studio_entitlements",
            42,
            expect.objectContaining({ studioKind: "prediction", entitlementId: 1 }),
        );
    });

    it("refuses to uninstall for a member", async () => {
        const res = await request(app()).post("/api/studio-marketplace/studios/media/uninstall").send({});
        expect(res.status).toBe(403);
        expect(service.uninstall).not.toHaveBeenCalled();
    });

    it("uninstalls for an admin", async () => {
        orgContext.isAdmin = true;
        const res = await request(app()).post("/api/studio-marketplace/studios/media/uninstall").send({});
        expect(res.status).toBe(200);
        expect(service.uninstall).toHaveBeenCalledWith(42, "media");
        expect(auditService.logFromRequest).toHaveBeenCalledWith(
            expect.anything(),
            "studio_uninstalled",
            "organization_studio_entitlements",
            42,
            expect.objectContaining({ studioKind: "media" }),
        );
    });

    it("rejects an unknown studio kind", async () => {
        orgContext.isAdmin = true;
        const res = await request(app()).post("/api/studio-marketplace/studios/unknown/install").send({});
        expect(res.status).toBe(400);
        expect(service.install).not.toHaveBeenCalled();
    });
});
