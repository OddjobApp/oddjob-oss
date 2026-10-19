
import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

// Helper to create a chainable mock query
const createMockQuery = (result: any = []) => {
    const query = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockReturnValue(Promise.resolve(result)),
        then: vi.fn(onFulfilled => Promise.resolve(result).then(onFulfilled))
    };
    return query;
};

// Mock database
vi.mock("@server/database_service.js", () => {
    return {
        db: {
            select: vi.fn(() => createMockQuery()),
            insert: vi.fn(() => createMockQuery()),
            update: vi.fn(() => createMockQuery()),
            delete: vi.fn(() => createMockQuery()),
        }
    };
});

// Mock password utils
vi.mock("@server/domain/auth/index.js", async (importOriginal) => {
    const actual: any = await importOriginal();
    return {
        ...actual,
        hashPassword: vi.fn().mockResolvedValue("hashed_password"),
        verifyPassword: vi.fn().mockResolvedValue(true),
        passwordService: {
            ...actual.passwordService,
            hashPassword: vi.fn().mockResolvedValue("hashed_password"),
            verifyPassword: vi.fn().mockResolvedValue(true)
        }
    };
});

import { userService } from "@server/domain/org/core/user.service.js";
import { db } from "@server/database_service.js";

describe("UserService", () => {
    const superAdminContext = {
        userId: "sa-1",
        organizationId: null,
        isSuperAdmin: true,
        isOrgAdmin: false,
        isAdmin: true
    };

    const orgAdminContext = {
        userId: "oa-1",
        organizationId: 1,
        isOrgAdmin: true,
        isSuperAdmin: false,
        isAdmin: true
    };

    const userContext = {
        userId: "u-1",
        organizationId: 1,
        isAdmin: false,
        isSuperAdmin: false,
        isOrgAdmin: false
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("listUsers", () => {
        it("should return all users for superadmin", async () => {
            const mockUsers = [{ id: "1", username: "u1" }, { id: "2", username: "u2" }];
            (db.select as Mock).mockReturnValueOnce(createMockQuery(mockUsers));

            const result = await userService.listUsers(superAdminContext);

            expect(result).toHaveLength(2);
            expect(db.select).toHaveBeenCalled();
        });

        it("should scope users to org for org admin", async () => {
            (db.select as Mock)
                .mockReturnValueOnce(createMockQuery([{ userId: "oa-1" }])) // orgUserIds
                .mockReturnValueOnce(createMockQuery([{ id: "oa-1", username: "oa1" }])); // users

            const result = await userService.listUsers(orgAdminContext);

            expect(result).toHaveLength(1);
            expect(db.select).toHaveBeenCalled();
        });
    });

    describe("getUser", () => {
        it("should return user if in same organization", async () => {
            const mockUser = { id: "u-1", username: "u1", defaultOrgId: 1 };
            (db.select as Mock)
                .mockReturnValueOnce(createMockQuery([mockUser])) // getUser
                .mockReturnValueOnce(createMockQuery([{ userId: "u-1", orgId: 1 }])); // userOrg check

            const result = await userService.getUser("u-1", userContext);
            expect(result.username).toBe("u1");
        });

        it("should throw ForbiddenError if user in different org", async () => {
            const mockUser = { id: "u-2", username: "u2", defaultOrgId: 2 };
            (db.select as Mock)
                .mockReturnValueOnce(createMockQuery([mockUser]))
                .mockReturnValueOnce(createMockQuery([])); // not in userContext.organizationId

            await expect(userService.getUser("u-2", userContext)).rejects.toThrow("Access denied");
        });
    });

    describe("createUser", () => {
        it("should create user for org admin in their org", async () => {
            (db.select as Mock).mockReturnValueOnce(createMockQuery([{ id: 1 }])); // org lookup
            (db.insert as Mock)
                .mockReturnValueOnce(createMockQuery([{ id: "new-1", username: "new" }])) // user insert
                .mockReturnValueOnce(createMockQuery([])); // userOrg insert

            const result = await userService.createUser({
                username: "new",
                password: "pw",
                organizationId: 1
            }, orgAdminContext);

            expect(result.username).toBe("new");
        });

        it("should throw ForbiddenError if org admin tries to create in different org", async () => {
            await expect(userService.createUser({
                username: "new",
                password: "pw",
                organizationId: 2
            }, orgAdminContext)).rejects.toThrow("outside your organization");
        });
    });

    describe("deleteUser", () => {
        it("should throw error if deleting last admin in org", async () => {
            const mockUser = { id: "oa-1", username: "oa1", defaultOrgId: 1 };
            const mockRole = { userId: "oa-1", role: "org_admin", organizationId: 1 };

            (db.select as Mock)
                .mockReturnValueOnce(createMockQuery([mockUser])) // existing check
                .mockReturnValueOnce(createMockQuery([{ userId: "oa-1", orgId: 1 }])) // org match check
                .mockReturnValueOnce(createMockQuery([mockRole])) // role check
                .mockReturnValueOnce(createMockQuery([])); // other admins check (none other)

            await expect(userService.deleteUser("oa-1", orgAdminContext)).rejects.toThrow("last admin");
        });
    });
});
