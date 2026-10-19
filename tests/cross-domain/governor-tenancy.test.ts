/** @vitest-environment node */
/**
 * Governor routes take the tenant from the caller's org context and nowhere else.
 *
 * Before this, `req.org` — assigned nowhere in the server — was the first source
 * tried, so handlers fell through to `req.body.orgId` and let the caller name the
 * tenant; `req.user.organizationId` — not a users column — made other handlers
 * answer 400 to everyone; and /capability-policy/:orgId took the org from the URL
 * unchecked, so any signed-in user could overwrite any org's policy file.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("ioredis", async () => {
    const { ioredisMockModule } = await import("../helpers/ioredis-mock.js");
    return ioredisMockModule({ get: vi.fn().mockResolvedValue(null), xread: vi.fn().mockResolvedValue(null) });
});

const orgContext = vi.hoisted(() => ({ current: null as any, error: null as any }));
vi.mock("../../server/utils/auth-context.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../server/utils/auth-context.js")>()),
    getUserOrgContext: vi.fn(async () => {
        if (orgContext.error) throw orgContext.error;
        return orgContext.current;
    }),
}));

const hr = vi.hoisted(() => ({ monitorPerformance: vi.fn(), triggerPIP: vi.fn() }));
vi.mock("../../server/domain/governor/core/agentic-hr.service.js", () => ({ AgenticHRService: hr }));

const perf = vi.hoisted(() => ({ getPerformanceSummary: vi.fn(), initiateUpskilling: vi.fn() }));
vi.mock("../../server/domain/agents/core/performance-manager.service.js", () => ({ performanceManagerService: perf }));

const violations = vi.hoisted(() => ({ summary: vi.fn() }));
vi.mock("../../server/domain/governor/core/policy-violation.service.js", () => ({ policyViolationService: violations }));

const auditor = vi.hoisted(() => ({ generateROIReport: vi.fn() }));
vi.mock("../../server/domain/governor/core/institutional-auditor.service.js", () => ({ institutionalAuditorService: auditor }));

const loader = vi.hoisted(() => ({ loadFromYaml: vi.fn() }));
vi.mock("../../server/domain/governor/core/capability-policy-loader.service.js", () => ({ capabilityPolicyLoader: loader }));

// @ts-ignore
import supertest from "supertest";
import express from "express";
import { ForbiddenError } from "../../server/utils/errors.js";
import { governorRouter } from "../../server/routes/governor";

const MEMBER = { userId: "u1", organizationId: 5, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false };
const ADMIN = { ...MEMBER, isAdmin: true, isOrgAdmin: true };
const SUPER = { ...ADMIN, isSuperAdmin: true };

const app = express();
app.use(express.json());
app.use((req: any, _res, next) => { req.user = { id: "u1" }; next(); });
app.use("/api/governor", governorRouter);
const api = supertest(app);

beforeEach(() => {
    vi.clearAllMocks();
    orgContext.current = MEMBER;
    orgContext.error = null;
    perf.getPerformanceSummary.mockResolvedValue({ topPerformers: [], atRiskAgents: [] });
    perf.initiateUpskilling.mockResolvedValue({ id: 1 });
    violations.summary.mockResolvedValue({ total: 0 });
    auditor.generateROIReport.mockResolvedValue({ ok: true });
});

describe("governor routes ignore a client-named tenant", () => {
    it("POST /hr/monitor acts on the caller's org, not body.orgId", async () => {
        const res = await api.post("/api/governor/hr/monitor").send({ orgId: 999 });
        expect(res.status).toBe(200);
        expect(hr.monitorPerformance).toHaveBeenCalledWith(5);
    });

    it("POST /hr/pip acts on the caller's org, not body.orgId", async () => {
        const res = await api.post("/api/governor/hr/pip").send({ agentId: 7, orgId: 999 });
        expect(res.status).toBe(200);
        expect(hr.triggerPIP).toHaveBeenCalledWith(7, 5, 0, expect.any(String));
    });

    it("POST /hr/upskill/initiate acts on the caller's org, not body.orgId or org 1", async () => {
        const res = await api.post("/api/governor/hr/upskill/initiate").send({ agentId: 7, pipId: 3, type: "x", orgId: 999 });
        expect(res.status).toBe(200);
        expect(perf.initiateUpskilling).toHaveBeenCalledWith(7, 5, 3, "x");
    });

    it("GET /institutional-health reports the caller's org, never the global aggregate", async () => {
        const res = await api.get("/api/governor/institutional-health");
        expect(res.status).toBe(200);
        expect(auditor.generateROIReport).toHaveBeenCalledWith(5);
    });
});

describe("governor routes that answered 400 to every signed-in user", () => {
    it("GET /hr/overview resolves the org from the session context", async () => {
        const res = await api.get("/api/governor/hr/overview");
        expect(res.status).toBe(200);
        expect(perf.getPerformanceSummary).toHaveBeenCalledWith(5);
    });

    it("GET /capability-policy/violations/summary resolves the org from the session context", async () => {
        const res = await api.get("/api/governor/capability-policy/violations/summary");
        expect(res.status).toBe(200);
        expect(violations.summary).toHaveBeenCalledWith(5);
    });
});

describe("governor routes refuse a caller with no usable org", () => {
    it("answers 403 when the caller has no org", async () => {
        orgContext.current = { ...MEMBER, organizationId: null };
        const res = await api.post("/api/governor/hr/monitor").send({ orgId: 999 });
        expect(res.status).toBe(403);
        expect(hr.monitorPerformance).not.toHaveBeenCalled();
    });

    it("passes through the 403 when the caller asks for an org they do not belong to", async () => {
        orgContext.error = new ForbiddenError("You do not belong to this organization");
        const res = await api.get("/api/governor/hr/overview");
        expect(res.status).toBe(403);
        expect(perf.getPerformanceSummary).not.toHaveBeenCalled();
    });
});

describe("capability policy is only addressable by the org that owns it", () => {
    it("refuses to read another org's policy", async () => {
        const res = await api.get("/api/governor/capability-policy/999");
        expect(res.status).toBe(403);
    });

    it("refuses to overwrite another org's policy, even as an admin of your own", async () => {
        orgContext.current = ADMIN;
        const res = await api.put("/api/governor/capability-policy/999").send({ yaml: "x: 1" });
        expect(res.status).toBe(403);
        expect(loader.loadFromYaml).not.toHaveBeenCalled();
    });

    it("refuses a non-admin writing their own org's policy", async () => {
        const res = await api.put("/api/governor/capability-policy/5").send({ yaml: "x: 1" });
        expect(res.status).toBe(403);
        expect(loader.loadFromYaml).not.toHaveBeenCalled();
    });

    it("rejects a non-numeric org id instead of writing NaN.yaml", async () => {
        orgContext.current = SUPER;
        const res = await api.put("/api/governor/capability-policy/abc").send({ yaml: "x: 1" });
        expect(res.status).toBe(400);
        expect(loader.loadFromYaml).not.toHaveBeenCalled();
    });

    it("lets a member read their own org's policy", async () => {
        const res = await api.get("/api/governor/capability-policy/5");
        expect(res.status).toBe(200);
    });

    it("lets a super admin read any org's policy", async () => {
        orgContext.current = SUPER;
        const res = await api.get("/api/governor/capability-policy/999");
        expect(res.status).toBe(200);
    });
});
