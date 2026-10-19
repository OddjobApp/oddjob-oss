
import { describe, it, expect, beforeEach, vi, type Mock, afterEach } from "vitest";

// Undo the global setup.ts mock so we test the real service
vi.unmock("@domain/auth/core/credentials-service.js");

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

// Mock security utils
vi.mock("@server/domain/auth/core/security.service.js", () => ({
    validateInput: vi.fn((val: any, opts: any) => ({ valid: true, errors: [] }))
}));

// Mock logger
vi.mock("@server/utils/logger.js", () => ({
    createLogger: vi.fn(() => ({
        info: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
    })),
}));

// Mock fetch
global.fetch = vi.fn() as any;

import { credentialsService } from "@server/domain/auth/core/credentials-service.js";
import { db } from "@server/database_service.js";
import { validateInput } from "@server/domain/auth/core/security.service.js";

describe("CredentialsService", () => {
    const originalEnv = process.env;

    beforeEach(() => {
        vi.clearAllMocks();
        process.env = { ...originalEnv };
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    describe("list", () => {
        it("should list all credentials for superadmin", async () => {
            const mockCreds = [{ id: 1, name: "Key 1" }];
            (db.select as Mock).mockReturnValueOnce(createMockQuery(mockCreds));

            const result = await credentialsService.list(null, true);

            expect(result).toEqual([expect.objectContaining({ id: 1, name: "Key 1" })]);
            expect(db.select).toHaveBeenCalled();
        });

        it("should filter by orgId for non-admin", async () => {
            (db.select as Mock).mockReturnValueOnce(createMockQuery([]));

            await credentialsService.list(1, false);
            expect(db.select).toHaveBeenCalled();
        });
    });

    describe("create", () => {
        it("rejects attempts to write user secrets into the shared environment", async () => {
            const original = process.env.TEST_KEY;
            await expect(credentialsService.create({ name: "Test Key", type: "api_key",
                envVarName: "TEST_KEY", apiKeyValue: "secret123" }, 1, 1, "testuser"))
                .rejects.toThrow("Organization Settings");
            expect(process.env.TEST_KEY).toBe(original);
            expect(db.insert).not.toHaveBeenCalled();
        });

        it("should throw error if name is invalid", async () => {
            (validateInput as Mock).mockReturnValueOnce({ valid: false, errors: ["Too short"] });

            await expect(credentialsService.create({ name: "a" }, 1, 1, "u")).rejects.toThrow("Invalid name");
        });
    });

    describe("update", () => {
        it("should validate Jira baseUrl metadata", async () => {
            const existing = { id: 1, type: "jira", organizationId: 1 };
            (db.select as Mock).mockReturnValueOnce(createMockQuery([existing]));

            await expect(credentialsService.update(1, {
                type: "jira",
                metadata: { baseUrl: "invalid-url" }
            }, 1)).rejects.toThrow("Invalid URL");
        });
    });

    describe("testConnection", () => {
        it("should return success for valid JIRA connection", async () => {
            const mockCred = {
                id: 1,
                type: "jira",
                metadata: { baseUrl: "https://test.atlassian.net", email: "test@example.com" },
                envVarName: "JIRA_TOKEN"
            };
            (db.select as Mock).mockReturnValueOnce(createMockQuery([mockCred]));
            process.env.JIRA_TOKEN = "token123";

            (global.fetch as Mock).mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ accountId: "acc-1", displayName: "Test User" })
            });

            const result = await credentialsService.testConnection(1, 1);

            expect(result.success).toBe(true);
            expect(result.details.accountId).toBe("acc-1");
        });

        it("should handle JIRA API errors", async () => {
            const mockCred = {
                id: 1,
                type: "jira",
                metadata: { baseUrl: "https://test.atlassian.net", email: "test@example.com" },
                envVarName: "JIRA_TOKEN"
            };
            (db.select as Mock).mockReturnValueOnce(createMockQuery([mockCred]));
            process.env.JIRA_TOKEN = "token123";

            (global.fetch as Mock).mockResolvedValueOnce({
                ok: false,
                status: 401,
                json: () => Promise.resolve({ message: "Unauthorized" })
            });

            const result = await credentialsService.testConnection(1, 1);

            expect(result.success).toBe(false);
            expect(result.message).toBe("Unauthorized");
        });
    });
});
