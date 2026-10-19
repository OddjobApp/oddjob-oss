import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
    insert: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
    where: vi.fn(),
    values: vi.fn(),
    from: vi.fn(),
    limit: vi.fn(),
    returning: vi.fn(),
    set: vi.fn(),
    innerJoin: vi.fn(),
    eq: vi.fn((a: any, b: any) => ({ column: a, value: b })),
    and: vi.fn((...args: any[]) => args),
    isNull: vi.fn((a: any) => ({ nullCheck: a })),
    hashPassword: vi.fn(async () => "hashed-password"),
}));

vi.mock("@server/database_service.js", () => ({
    db: {
        insert: mocks.insert,
        select: mocks.select,
        update: mocks.update,
        delete: vi.fn(),
        transaction: mocks.transaction,
    },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
    const actual = await importOriginal<typeof import("drizzle-orm")>();
    return {
        ...actual,
        eq: mocks.eq,
        and: mocks.and,
        isNull: mocks.isNull,
    };
});

vi.mock("@server/domain/auth/core/password-service.js", () => ({
    hashPassword: mocks.hashPassword,
}));

import { organizationInviteService } from "../core/organization-invite.service.js";

function selectChain(returnValue?: any) {
    const limit = vi.fn(() => Promise.resolve(returnValue === undefined ? [] : [returnValue]));
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    return select;
}

function insertChain(returnValue: any) {
    const returning = vi.fn(() => Promise.resolve([returnValue]));
    const values = vi.fn(() => ({ returning }));
    const insert = vi.fn(() => ({ values }));
    return insert;
}

function updateChain(claimed: unknown[] = [{ id: 1 }]) {
    const returning = vi.fn(() => Promise.resolve(claimed));
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    return update;
}

describe("organizationInviteService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("createInvite", () => {
        it("creates an invite for an organization admin", async () => {
            const orgSelect = selectChain({ id: 10, name: "Acme" });
            const orgNameSelect = selectChain({ id: 10, name: "Acme" });
            const inviteInsert = insertChain({
                id: 1,
                organizationId: 10,
                email: "ada@example.com",
                role: "operator",
                tokenHash: "hash",
                invitedBy: "admin-1",
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                createdAt: new Date(),
            });

            mocks.select
                .mockImplementationOnce(orgSelect)
                .mockImplementationOnce(orgNameSelect);
            mocks.insert.mockImplementation(inviteInsert);

            const result = await organizationInviteService.createInvite(
                { organizationId: 10, email: "ada@example.com", role: "operator" },
                { userId: "admin-1", organizationId: 10, isAdmin: true, isOrgAdmin: true, isSuperAdmin: false },
            );

            expect(result.rawToken).toHaveLength(64);
            expect(result.invite.organizationId).toBe(10);
            expect(result.invite.email).toBe("ada@example.com");
            expect(result.organization?.name).toBe("Acme");
        });

        it("rejects when the caller is not an admin of the organization", async () => {
            await expect(
                organizationInviteService.createInvite(
                    { organizationId: 10, email: "ada@example.com" },
                    { userId: "user-1", organizationId: 5, isAdmin: true, isOrgAdmin: true, isSuperAdmin: false },
                ),
            ).rejects.toThrow(/permission/);
        });
    });

    describe("validateInviteToken", () => {
        it("returns valid for an unused, unexpired invite", async () => {
            const inviteSelect = selectChain({
                id: 1,
                organizationId: 10,
                email: "ada@example.com",
                role: "operator",
                tokenHash: "hash",
                invitedBy: "admin-1",
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
                createdAt: new Date(),
            });

            const orgSelect = selectChain({ id: 10, name: "Acme" });

            mocks.select
                .mockImplementationOnce(inviteSelect)
                .mockImplementationOnce(orgSelect);

            const result = await organizationInviteService.validateInviteToken("valid-token");

            expect(result.valid).toBe(true);
            expect(result.organization?.name).toBe("Acme");
        });

        it("returns invalid for a used invite", async () => {
            const inviteSelect = selectChain({
                id: 1,
                organizationId: 10,
                usedAt: new Date(),
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
                createdAt: new Date(),
            });
            mocks.select.mockImplementation(inviteSelect);

            const result = await organizationInviteService.validateInviteToken("used-token");

            expect(result.valid).toBe(false);
            expect(result.reason).toMatch(/already used/i);
        });
    });

    describe("acceptInvite", () => {
        it("creates a user, adds them to the organization, assigns the role, and consumes the invite", async () => {
            const invite = {
                id: 1,
                organizationId: 10,
                email: "ada@example.com",
                role: "operator",
                tokenHash: "hash",
                invitedBy: "admin-1",
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
                createdAt: new Date(),
            };

            const inviteSelect = selectChain(invite);
            const userSelectByUsername = selectChain(null);
            const userSelectByEmail = selectChain(null);
            const userInsert = insertChain({
                id: "new-user",
                username: "ada",
                email: "ada@example.com",
                defaultOrgId: 10,
                password: "hashed-password",
            });
            const userOrgInsert = insertChain({ userId: "new-user", orgId: 10 });
            const roleInsert = insertChain({ id: 1, organizationId: 10, userId: "new-user", role: "operator" });
            const inviteUpdate = updateChain();

            mocks.select
                .mockImplementationOnce(inviteSelect)
                .mockImplementationOnce(userSelectByUsername)
                .mockImplementationOnce(userSelectByEmail);

            mocks.transaction.mockImplementation(async (work: any) => {
                return work({
                    insert: userInsert,
                    update: inviteUpdate,
                });
            });

            const result = await organizationInviteService.acceptInvite({
                token: "valid-token",
                username: "Ada",
                password: "Password123!",
                email: "ada@example.com",
                tosAccepted: true,
                privacyPolicyAccepted: true,
            });

            expect(result.id).toBe("new-user");
            expect(result.defaultOrgId).toBe(10);
        });

        it("rejects when a concurrent accept already claimed the invite", async () => {
            const invite = {
                id: 1,
                organizationId: 10,
                email: null,
                role: "operator",
                tokenHash: "hash",
                invitedBy: "admin-1",
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
                createdAt: new Date(),
            };
            mocks.select
                .mockImplementationOnce(selectChain(invite))
                .mockImplementationOnce(selectChain(null));
            const userInsert = insertChain({ id: "new-user" });
            mocks.transaction.mockImplementation(async (work: any) =>
                work({ insert: userInsert, update: updateChain([]) }),
            );

            await expect(
                organizationInviteService.acceptInvite({
                    token: "valid-token",
                    username: "Ada",
                    password: "Password123!",
                    tosAccepted: true,
                    privacyPolicyAccepted: true,
                }),
            ).rejects.toThrow(/already used/);
            expect(userInsert).not.toHaveBeenCalled();
        });

        it("rejects when the invite email does not match", async () => {
            const invite = {
                id: 1,
                organizationId: 10,
                email: "ada@example.com",
                role: "operator",
                tokenHash: "hash",
                invitedBy: "admin-1",
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
                createdAt: new Date(),
            };
            const inviteSelect = selectChain(invite);
            mocks.select.mockImplementation(inviteSelect);

            await expect(
                organizationInviteService.acceptInvite({
                    token: "valid-token",
                    username: "Ada",
                    password: "Password123!",
                    email: "wrong@example.com",
                    tosAccepted: true,
                    privacyPolicyAccepted: true,
                }),
            ).rejects.toThrow(/different email/);
        });
    });
});
