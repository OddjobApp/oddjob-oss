/** @vitest-environment node */

/**
 * The Bot Exchange puts one org's agent card in front of every other org, so the
 * question these tests answer is who may do what: publishing and withdrawing are
 * admin decisions, installing is not, and a listing id that is not a number must
 * not reach the service as NaN.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { service, orgContext } = vi.hoisted(() => ({
    service: {
        listPublic: vi.fn(),
        listByOrg: vi.fn(),
        getById: vi.fn(),
        publish: vi.fn(),
        install: vi.fn(),
        unpublish: vi.fn(),
    },
    orgContext: {
        userId: "user-7",
        organizationId: 42,
        isAdmin: false,
        isSuperAdmin: false,
        isOrgAdmin: false,
    } as any,
}));

vi.mock("../core/marketplace-listing.service.js", () => ({
    marketplaceListingService: service,
}));

vi.mock("@domain/core/auth/security.service.js", () => ({
    requireAuth: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("@server/utils/auth-context.js", async (importOriginal) => {
    const actual: any = await importOriginal();
    return { ...actual, getUserOrgContext: vi.fn(async () => orgContext) };
});

const { marketplaceRouter } = await import("../api/marketplace.routes.js");
const { errorHandler } = await import("@server/middleware/error-handler.js");

function app() {
    const server = express();
    server.use(express.json());
    server.use("/api/marketplace", marketplaceRouter);
    server.use(errorHandler);
    return server;
}

const LISTING = { id: 3, name: "Daily Jira Bot", organizationId: 9, isPublic: true, installCount: 4 };

beforeEach(() => {
    vi.clearAllMocks();
    orgContext.isAdmin = false;
    service.listPublic.mockResolvedValue([LISTING]);
    service.listByOrg.mockResolvedValue([]);
    service.getById.mockResolvedValue(LISTING);
    service.publish.mockResolvedValue({ ...LISTING, organizationId: 42 });
    service.install.mockResolvedValue({ agentCardId: 88, agentCardName: "Daily Jira Bot" });
    service.unpublish.mockResolvedValue(undefined);
});

describe("marketplace routes", () => {
    it("serves the public catalogue to a member", async () => {
        const res = await request(app()).get("/api/marketplace/listings");
        expect(res.status).toBe(200);
        expect(res.body.listings).toEqual([LISTING]);
        expect(service.listPublic).toHaveBeenCalledWith(undefined, undefined);
    });

    it("passes a category through and caps the limit", async () => {
        await request(app()).get("/api/marketplace/listings?category=research&limit=9000");
        expect(service.listPublic).toHaveBeenCalledWith("research", 100);
    });

    it("lists this organization's own listings, published or not", async () => {
        await request(app()).get("/api/marketplace/listings/mine");
        expect(service.listByOrg).toHaveBeenCalledWith(42);
    });

    it("installs for an ordinary member - installing only writes into their own org", async () => {
        const res = await request(app()).post("/api/marketplace/listings/3/install").send({});
        expect(res.status).toBe(201);
        expect(res.body).toEqual({ agentCardId: 88, agentCardName: "Daily Jira Bot" });
        expect(service.install).toHaveBeenCalledWith(3, 42);
    });

    it("refuses to publish for a member", async () => {
        const res = await request(app()).post("/api/marketplace/listings").send({ agentCardId: 5, name: "Mine" });
        expect(res.status).toBe(403);
        expect(service.publish).not.toHaveBeenCalled();
    });

    it("publishes for an admin", async () => {
        orgContext.isAdmin = true;
        const res = await request(app()).post("/api/marketplace/listings").send({ agentCardId: 5, name: "Mine" });
        expect(res.status).toBe(201);
        expect(service.publish).toHaveBeenCalledWith(42, "user-7", { agentCardId: 5, name: "Mine" });
    });

    it("refuses to withdraw for a member", async () => {
        const res = await request(app()).delete("/api/marketplace/listings/3");
        expect(res.status).toBe(403);
        expect(service.unpublish).not.toHaveBeenCalled();
    });

    it("withdraws for an admin, scoped to their org", async () => {
        orgContext.isAdmin = true;
        const res = await request(app()).delete("/api/marketplace/listings/3");
        expect(res.status).toBe(200);
        expect(service.unpublish).toHaveBeenCalledWith(42, 3);
    });

    it("rejects a listing id that is not a positive integer", async () => {
        const res = await request(app()).post("/api/marketplace/listings/not-a-number/install").send({});
        expect(res.status).toBe(400);
        expect(service.install).not.toHaveBeenCalled();
    });
});
