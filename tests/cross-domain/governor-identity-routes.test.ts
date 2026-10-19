/** @vitest-environment node */
/**
 * The agent identity routes are thin adapters over agentIdentityAdminService:
 * they pass the caller's org, map the service's null / failure results onto
 * HTTP statuses, and validate input before the service is reached.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("ioredis", async () => {
    const { ioredisMockModule } = await import("../helpers/ioredis-mock.js");
    return ioredisMockModule({ get: vi.fn().mockResolvedValue(null), xread: vi.fn().mockResolvedValue(null) });
});

vi.mock("../../server/utils/auth-context.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../server/utils/auth-context.js")>()),
    getUserOrgContext: vi.fn(async () => ({ userId: "u1", organizationId: 5, isAdmin: true, isSuperAdmin: false, isOrgAdmin: true })),
}));

const admin = vi.hoisted(() => ({
    listBundles: vi.fn(), createBundle: vi.fn(), updateBundle: vi.fn(), applyBundle: vi.fn(),
    listIdentities: vi.fn(), getIdentityDetail: vi.fn(), createIdentity: vi.fn(), updateIdentityStatus: vi.fn(),
    createGrant: vi.fn(), expireGrant: vi.fn(), listAuditEvents: vi.fn(), reportingSummary: vi.fn(),
}));
vi.mock("../../server/domain/governance/core/agent-identity-admin.service.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../server/domain/governance/core/agent-identity-admin.service.js")>()),
    agentIdentityAdminService: admin,
}));

// @ts-ignore
import supertest from "supertest";
import express from "express";
import { governorRouter } from "../../server/routes/governor";

const app = express();
app.use(express.json());
app.use((req: any, _res, next) => { req.user = { id: "u1" }; next(); });
app.use("/api/governor", governorRouter);
const api = supertest(app);

beforeEach(() => vi.clearAllMocks());

describe("POST /agent-identities/:id/apply-policy-bundle", () => {
    it.each([
        ["identity-not-found", 404, "Agent identity not found"],
        ["bundle-not-found", 404, "Agent policy bundle not found"],
        ["bundle-inactive", 400, "Only active policy bundles can be applied"],
    ])("maps %s to %i", async (failure, status, message) => {
        admin.applyBundle.mockResolvedValue({ ok: false, failure });
        const res = await api.post("/api/governor/agent-identities/id-1/apply-policy-bundle").send({ policyBundleId: "b-1" });
        expect(res.status).toBe(status);
        expect(res.body.error).toBe(message);
    });

    it("applies within the caller's org and reports the grant count", async () => {
        admin.applyBundle.mockResolvedValue({ ok: true, identity: { id: "id-1" }, bundle: { id: "b-1" }, grants: [{}, {}] });
        const res = await api.post("/api/governor/agent-identities/id-1/apply-policy-bundle").send({ policyBundleId: "b-1" });
        expect(res.status).toBe(200);
        expect(res.body.appliedGrantCount).toBe(2);
        expect(admin.applyBundle).toHaveBeenCalledWith(5, "id-1", "b-1", "u1");
    });

    it("rejects a missing bundle id before reaching the service", async () => {
        const res = await api.post("/api/governor/agent-identities/id-1/apply-policy-bundle").send({});
        expect(res.status).toBe(400);
        expect(admin.applyBundle).not.toHaveBeenCalled();
    });
});

describe("not-found results become 404s", () => {
    it.each([
        ["get", "/api/governor/agent-identities/x", "getIdentityDetail", undefined],
        ["patch", "/api/governor/agent-policy-bundles/x", "updateBundle", { name: "n" }],
        ["patch", "/api/governor/agent-identities/x/status", "updateIdentityStatus", { status: "active" }],
        ["post", "/api/governor/agent-identities/x/grants", "createGrant", { tool: "t", action: "a" }],
        ["patch", "/api/governor/agent-identities/x/grants/g/expire", "expireGrant", undefined],
    ] as const)("%s %s", async (method, url, fn, body) => {
        (admin as any)[fn].mockResolvedValue(null);
        const req = (api as any)[method](url);
        const res = await (body ? req.send(body) : req);
        expect(res.status).toBe(404);
        expect((admin as any)[fn].mock.calls[0][0]).toBe(5);
    });
});

describe("listing", () => {
    it("clamps an unparseable audit limit instead of passing NaN to the query", async () => {
        admin.listAuditEvents.mockResolvedValue([]);
        const res = await api.get("/api/governor/agent-governance/audit-events?limit=abc");
        expect(res.status).toBe(200);
        expect(admin.listAuditEvents).toHaveBeenCalledWith(5, { limit: 100 });
    });

    it("scopes an identity's audit events to that identity and org", async () => {
        admin.listAuditEvents.mockResolvedValue([{ id: "e" }]);
        const res = await api.get("/api/governor/agent-identities/id-9/audit-events?limit=900");
        expect(res.body.count).toBe(1);
        expect(admin.listAuditEvents).toHaveBeenCalledWith(5, { identityId: "id-9", limit: 500 });
    });
});
