/**
 * Audit Service Unit Tests
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

// Helper to create a chainable mock query
const createMockQuery = (result: any = []) => {
    const query = {
        returning: vi.fn().mockResolvedValue(result),
        then: (onFulfilled: any) => Promise.resolve(result).then(onFulfilled),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
    };
    return query;
};

// Mock database
vi.mock("@server/database_service.js", () => {
    return {
        db: {
            insert: vi.fn(() => createMockQuery()),
            select: vi.fn(() => createMockQuery()),
        },
    };
});

vi.mock("../../server/utils/logger", () => ({
    createLogger: vi.fn(() => ({
        info: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
    })),
}));

import { auditService, auditMiddleware, AuditEvents } from "@domain/audit/core/audit-service.js";
import { db } from "@server/database_service.js";

describe("AuditService", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        (db.insert as Mock).mockImplementation(() => createMockQuery());
        (db.select as Mock).mockImplementation(() => createMockQuery());
    });

    it("should log an entry", async () => {
        const entry = { action: "test", entityType: "user", organizationId: 1 };
        await auditService.log(entry as any);
        expect(db.insert).toHaveBeenCalled();
    });

    it("should log from request context", async () => {
        const mockReq = {
            user: { id: 1, organizationId: 1 },
            ip: "127.0.0.1",
            method: "GET",
            path: "/test",
            headers: { "user-agent": "test-agent" }
        };

        await auditService.logFromRequest(mockReq as any, "view", "page");
        expect(db.insert).toHaveBeenCalled();
        const callArgs = (db.insert as Mock).mock.calls[0][0];
        // Check if values were called (in drizzle it would be db.insert(table).values(data))
        // Our mock db.insert returns the query object which has values()
    });

    it("should retrieve logs with filtering", async () => {
        const mockLogs = [{ id: 1, action: "test" }];
        (db.select as Mock)
            .mockReturnValueOnce(createMockQuery(mockLogs)) // logs
            .mockReturnValueOnce(createMockQuery([{ count: 1 }])); // count

        const result = await auditService.getLogs(1, { entityType: "auth" });
        expect(result.data).toHaveLength(1);
        expect(result.total).toBe(1);
    });

    describe("AuditEvents", () => {
        it("should have LOGIN_SUCCESS event helper", async () => {
            const mockReq = { user: { id: 1 }, headers: {} };
            const spy = vi.spyOn(auditService, "logFromRequest").mockResolvedValue();
            await AuditEvents.LOGIN_SUCCESS(mockReq as any);
            expect(spy).toHaveBeenCalledWith(mockReq, "login_success", "auth");
        });
    });

    describe("AuditMiddleware", () => {
        it("should log on successful response completion", async () => {
            const mockReq = { params: { id: "100" }, headers: {} };
            const mockRes = {
                statusCode: 200,
                end: vi.fn()
            };
            const next = vi.fn();
            const logSpy = vi.spyOn(auditService, "logFromRequest").mockResolvedValue();

            const middleware = auditMiddleware("update", "item");
            middleware(mockReq as any, mockRes as any, next);

            expect(next).toHaveBeenCalled();

            // Simulate response end
            (mockRes.end as any)();
            expect(logSpy).toHaveBeenCalledWith(mockReq, "update", "item", "100");
        });

        it("should not log on failed response", async () => {
            const mockReq = { params: {}, headers: {} };
            const mockRes = {
                statusCode: 500,
                end: vi.fn()
            };
            const next = vi.fn();
            const logSpy = vi.spyOn(auditService, "logFromRequest").mockResolvedValue();

            const middleware = auditMiddleware("delete", "user");
            middleware(mockReq as any, mockRes as any, next);

            (mockRes.end as any)();
            expect(logSpy).not.toHaveBeenCalled();
        });
    });
});
