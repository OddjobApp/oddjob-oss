import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ results: [] as any[], select: vi.fn() }));
vi.mock("@server/database_service.js", () => ({ db: { select: (...args: any[]) => {
    mocks.select(...args);
    return { from: () => ({ where: () => ({ limit: async () => mocks.results.shift() ?? [] }), limit: async () => mocks.results.shift() ?? [] }) };
} } }));
vi.mock("@server/utils/security-logger.js", () => ({ logSecurityEvent: vi.fn().mockResolvedValue(undefined) }));
import { getUserOrgContext } from "@server/utils/auth-context.js";

describe("organization identity for BYOK", () => {
    beforeEach(() => { mocks.results = []; mocks.select.mockClear(); });
    const request = (orgId: unknown = 7) => ({ session: { userId: "u1" }, headers: {}, query: { orgId } }) as any;

    it("denies a supplied organization without membership", async () => {
        mocks.results = [[{ id: "u1", username: "member" }], [], []];
        await expect(getUserOrgContext(request())).rejects.toThrow("do not belong");
    });
    it("does not turn an administrator of one org into an administrator of another", async () => {
        mocks.results = [[{ id: "u1" }], [{ role: "org_admin", organizationId: 8 }], [{ orgId: 7 }]];
        expect(await getUserOrgContext(request())).toMatchObject({ organizationId: 7, isAdmin: false, isOrgAdmin: false });
    });
    it("accepts an admin role for the selected organization", async () => {
        mocks.results = [[{ id: "u1" }], [{ role: "org_admin", organizationId: 7 }]];
        expect(await getUserOrgContext(request())).toMatchObject({ organizationId: 7, isOrgAdmin: true });
    });
    it("does not grant super admin by username", async () => {
        mocks.results = [[{ id: "u1", username: "admin" }], [], []];
        await expect(getUserOrgContext(request())).rejects.toThrow("do not belong");
    });
    it("rejects malformed organization IDs rather than parsing a numeric prefix", async () => {
        mocks.results = [[{ id: "u1" }], []];
        await expect(getUserOrgContext(request("7anything"))).rejects.toThrow("Invalid organization");
    });
    it("binds API keys to their own organization despite caller-supplied scope", async () => {
        const req = request(8);
        req.apiKeyAuth = { id: 1, organizationId: 7 };
        expect(await getUserOrgContext(req)).toMatchObject({ organizationId: 7 });
        expect(mocks.select).not.toHaveBeenCalled();
    });

    describe("default organization", () => {
        const noOrgParam = () => ({ session: { userId: "u1" }, headers: {}, query: {} }) as any;

        it("ignores a default organization the user is not a member of", async () => {
            // user (default 291), admin role, default-org membership, fallback membership
            mocks.results = [[{ id: "u1", defaultOrgId: 291 }], [], [], []];
            expect(await getUserOrgContext(noOrgParam())).toMatchObject({ organizationId: null, isAdmin: false });
        });

        it("uses the default organization when the user belongs to it", async () => {
            mocks.results = [[{ id: "u1", defaultOrgId: 291 }], [], [{ orgId: 291 }]];
            expect(await getUserOrgContext(noOrgParam())).toMatchObject({ organizationId: 291 });
        });

        it("falls back to an organization the user does belong to", async () => {
            mocks.results = [[{ id: "u1", defaultOrgId: 291 }], [], [], [{ orgId: 5 }]];
            expect(await getUserOrgContext(noOrgParam())).toMatchObject({ organizationId: 5 });
        });
    });
});

