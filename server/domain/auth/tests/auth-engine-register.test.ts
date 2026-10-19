import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    createUser: vi.fn(),
    exists: vi.fn(),
    insertOrg: vi.fn(),
    seed: vi.fn(),
    inserts: [] as Array<{ table: string; values: any }>,
    updates: [] as any[],
}));

vi.mock("../core/user-manager.js", () => ({
    userManager: { createUser: mocks.createUser, exists: mocks.exists },
}));
vi.mock("@domain/org/core/organization.service.js", () => ({
    organizationService: { insertOrganizationRecord: mocks.insertOrg, seedOrganizationDefaults: mocks.seed },
}));
vi.mock("@server/database_service.js", () => {
    const tx: any = {
        insert: (table: any) => ({ values: async (values: any) => { mocks.inserts.push({ table: table?.[Symbol.for("drizzle:Name")] ?? "?", values }); } }),
        update: () => ({ set: (v: any) => ({ where: async () => { mocks.updates.push(v); } }) }),
        transaction: async (work: any) => work(tx),
    };
    return { db: { transaction: async (work: any) => work(tx) } };
});

import { authEngine } from "../core/auth-engine.js";

describe("self-serve registration", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.inserts = []; mocks.updates = [];
        mocks.exists.mockResolvedValue(false);
        mocks.createUser.mockImplementation(async (v: any) => ({ id: "new-user", ...v }));
        mocks.insertOrg.mockResolvedValue({ id: 501, name: "Acme" });
    });

    it("provisions the user's own organization and makes them its admin", async () => {
        const user = await authEngine.register({ username: "Ada", email: "ada@example.com", password: "Password123!", organizationName: " Acme " });

        expect(mocks.insertOrg.mock.calls[0][1]).toEqual({ name: "Acme" });
        expect(mocks.inserts.map((i) => i.values)).toEqual([
            { userId: "new-user", orgId: 501 },
            { userId: "new-user", role: "org_admin", organizationId: 501 },
        ]);
        expect(mocks.updates).toEqual([{ defaultOrgId: 501 }]);
        expect(user).toMatchObject({ id: "new-user", defaultOrgId: 501 });
        expect(mocks.seed).toHaveBeenCalledWith(501, "new-user");
    });

    it("never takes an organization, or any other column, from the request", async () => {
        await authEngine.register({
            username: "Mallory", email: "m@example.com", password: "Password123!",
            defaultOrgId: 291, id: "victim-id", pin: "0000", isSuperAdmin: true,
            firstName: "Mal", tosAccepted: true,
        });
        const values = mocks.createUser.mock.calls[0][0];
        for (const key of ["defaultOrgId", "id", "pin", "isSuperAdmin"]) expect(values).not.toHaveProperty(key);
        expect(values).toMatchObject({ username: "mallory", email: "m@example.com", firstName: "Mal", tosAccepted: true });
        expect(values.password).not.toBe("Password123!");
        // Their organization is a new one, never 291.
        expect(mocks.updates).toEqual([{ defaultOrgId: 501 }]);
    });

    it("names the organization after the user when none is given", async () => {
        await authEngine.register({ username: "newbie", email: "n@example.com", password: "Password123!" });
        expect(mocks.insertOrg.mock.calls[0][1]).toEqual({ name: "newbie's organization" });
    });

    it("reports a taken name the user chose, and retries a taken default", async () => {
        const taken = Object.assign(new Error("duplicate"), { code: "23505", constraint: "orgs_name_unique" });
        mocks.insertOrg.mockRejectedValueOnce(taken);
        await expect(authEngine.register({ username: "ada", email: "a@example.com", password: "Password123!", organizationName: "Acme" }))
            .rejects.toThrow(/already taken/);

        mocks.insertOrg.mockRejectedValueOnce(taken).mockResolvedValueOnce({ id: 502 });
        await authEngine.register({ username: "bob", email: "b@example.com", password: "Password123!" });
        expect(mocks.insertOrg.mock.calls.at(-1)![1].name).toMatch(/^bob's organization [a-z0-9]+$/);
    });

    it("rejects an over-long organization name before creating anything", async () => {
        await expect(authEngine.register({ username: "ada", email: "a@example.com", password: "Password123!", organizationName: "x".repeat(121) }))
            .rejects.toThrow(/120/);
        expect(mocks.createUser).not.toHaveBeenCalled();
    });
});
