
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

// Mock logger
vi.mock("../../server/utils/logger", () => ({
    createLogger: vi.fn(() => ({
        info: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
    })),
}));

import { organizationService } from "@server/domain/org/core/organization.service.js";
import { db } from "@server/database_service.js";
import { ontologyService } from "@server/domain/knowledge/core/ontology.service.js";

describe("OrganizationService", () => {
    const adminContext = {
        userId: "admin-1",
        organizationId: null,
        isAdmin: true,
        isSuperAdmin: true,
        isOrgAdmin: false
    };

    const userContext = {
        userId: "user-1",
        organizationId: 1,
        isAdmin: false,
        isSuperAdmin: false,
        isOrgAdmin: false
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("listOrganizations", () => {
        it("should list organizations with stats for admin", async () => {
            const mockOrgs = [{ id: 1, name: "Org 1" }];
            (db.select as Mock)
                .mockReturnValueOnce(createMockQuery(mockOrgs)) // allOrgs
                .mockReturnValueOnce(createMockQuery([{ count: 5 }])) // userCount
                .mockReturnValueOnce(createMockQuery([{ count: 10 }])); // jobCount

            const result = await organizationService.listOrganizations(adminContext);

            expect(result[0].userCount).toBe(5);
            expect(result[0].jobCount).toBe(10);
        });

        it("should throw ForbiddenError for non-admin", async () => {
            await expect(organizationService.listOrganizations(userContext)).rejects.toThrow("Admin access required");
        });
    });

    describe("createOrganization", () => {
        it("should create new organization for admin", async () => {
            const mockOrg = { id: 2, name: "New Org" };
            (db.insert as Mock).mockReturnValueOnce(createMockQuery([mockOrg]));

            const result = await organizationService.createOrganization({ name: "New Org" }, adminContext);

            expect(result).toEqual(mockOrg);
            expect(db.insert).toHaveBeenCalled();
        });

        it("should validate organization name", async () => {
            await expect(organizationService.createOrganization({ name: "" }, adminContext)).rejects.toThrow("name is required");
        });

        it("auto-seeds the default ontology Object Types for the new org", async () => {
            const mockOrg = { id: 2, name: "New Org" };
            (db.insert as Mock).mockReturnValueOnce(createMockQuery([mockOrg]));
            const seedSpy = vi.spyOn(ontologyService, "seedDefaultObjectTypes").mockResolvedValue(4);

            await organizationService.createOrganization({ name: "New Org" }, adminContext);

            expect(seedSpy).toHaveBeenCalledWith({ organizationId: 2, userId: "admin-1" });
            seedSpy.mockRestore();
        });
    });

    describe("deleteOrganization", () => {
        it("should delete organization if it has no users", async () => {
            (db.select as Mock).mockReturnValueOnce(createMockQuery([{ count: 0 }]));

            await organizationService.deleteOrganization(1, adminContext);
            expect(db.delete).toHaveBeenCalled();
        });

        it("should throw error if organization has users", async () => {
            (db.select as Mock).mockReturnValueOnce(createMockQuery([{ count: 3 }]));

            await expect(organizationService.deleteOrganization(1, adminContext)).rejects.toThrow("with users");
        });
    });

    describe("membership", () => {
        it("should add user to organization", async () => {
            (db.select as Mock)
                .mockReturnValueOnce(createMockQuery([])) // existing membership check
                .mockReturnValueOnce(createMockQuery([{ id: "u1" }])); // user lookup for default org check

            await organizationService.addUserToOrganization(1, "u1", adminContext);
            expect(db.insert).toHaveBeenCalled();
        });

        it("should throw error if user already in organization", async () => {
            (db.select as Mock).mockReturnValueOnce(createMockQuery([{ id: "u1" }])); // existing membership found

            await expect(organizationService.addUserToOrganization(1, "u1", adminContext)).rejects.toThrow("already in organization");
        });
    });

    describe("tenant boundaries", () => {
        // An org admin of org 1, and org 1's API key: both arrive with isAdmin.
        const orgAdmin = { userId: "oa-1", organizationId: 1, isAdmin: true, isSuperAdmin: false, isOrgAdmin: true };
        const orgApiKey = { userId: "apikey:9", organizationId: 1, isAdmin: true, isSuperAdmin: false, isOrgAdmin: true };
        const superAdminOfOwnOrg = { userId: "sa-1", organizationId: 1, isAdmin: true, isSuperAdmin: true, isOrgAdmin: true };

        it("does not let an org admin create, delete, read or rename another organization", async () => {
            await expect(organizationService.createOrganization({ name: "Mine" }, orgAdmin as any)).rejects.toThrow(/Platform administrator/);
            await expect(organizationService.deleteOrganization(2, orgAdmin as any)).rejects.toThrow(/Platform administrator/);
            await expect(organizationService.getOrganization(2, orgAdmin as any)).rejects.toThrow(/Access denied/);
            await expect(organizationService.updateOrganization(2, { name: "Taken" }, orgAdmin as any)).rejects.toThrow(/Access denied/);
        });

        it("does not let an org's API key manage another organization's members", async () => {
            await expect(organizationService.listOrganizationUsers(2, orgApiKey as any)).rejects.toThrow(/Access denied/);
            await expect(organizationService.addUserToOrganization(2, "u-7", orgApiKey as any)).rejects.toThrow(/Access denied/);
            await expect(organizationService.removeUserFromOrganization(2, "u-7", orgApiKey as any)).rejects.toThrow(/Access denied/);
        });

        it("lists only the caller's own organization for an org admin", async () => {
            const query = createMockQuery([{ id: 1, name: "Own" }]);
            (db.select as Mock).mockReturnValueOnce(query);
            await organizationService.listOrganizations(orgAdmin as any);
            expect(query.where).toHaveBeenCalled();
        });

        it("lets a super admin manage another organization's members", async () => {
            (db.select as Mock).mockReturnValueOnce(createMockQuery([]));
            await expect(organizationService.listOrganizationUsers(2, superAdminOfOwnOrg as any)).resolves.toBeDefined();
        });
    });
});
