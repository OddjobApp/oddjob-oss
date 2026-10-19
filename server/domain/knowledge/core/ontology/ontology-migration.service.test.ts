import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for OntologyMigrationService.
 *
 * Validates:
 * - Req 7, AC 1: addProperty updates propertiesSchema, existing instances unchanged
 * - Req 7, AC 2: removeProperty marks deprecated, instances retain data
 * - Req 7, AC 3: changePropertyType validates lossless conversion
 * - Req 7, AC 4: Incompatibility returns up to 100 instances with IDs and values
 * - Req 7, AC 5: 30s timeout aborts and reports remaining count
 */

// --- Hoisted mocks ---

vi.mock("@server/database_service.js", () => ({
    db: {
        select: vi.fn(),
    },
}));

vi.mock("./custom-ontology-store.service.js", () => ({
    customOntologyStoreService: {
        getFromRegistry: vi.fn(),
        update: vi.fn(),
    },
}));

vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    }),
}));

import { ontologyMigrationService } from "./ontology-migration.service.js";
import { customOntologyStoreService } from "./custom-ontology-store.service.js";
import { db } from "@server/database_service.js";

// Helper to build a mock OntologyObjectType
function mockTypeDef(overrides: Record<string, any> = {}) {
    return {
        id: 1,
        organizationId: 1,
        name: "TestType",
        description: null,
        propertiesSchema: { name: { type: "string" }, age: { type: "integer" } },
        titleProperty: "name",
        icon: null,
        backing: "materialized",
        sourceAdapter: null,
        isActive: true,
        createdBy: "user-1",
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    };
}

describe("OntologyMigrationService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ─────────────────────────────────────────────────
    // addProperty
    // ─────────────────────────────────────────────────
    describe("addProperty", () => {
        it("updates propertiesSchema with the new property", async () => {
            const typeDef = mockTypeDef();
            vi.mocked(customOntologyStoreService.getFromRegistry).mockReturnValue(typeDef as any);
            vi.mocked(customOntologyStoreService.update).mockResolvedValue(typeDef as any);

            await ontologyMigrationService.addProperty(1, "email", { type: "string" }, "actor-1");

            expect(customOntologyStoreService.update).toHaveBeenCalledWith(
                1,
                {
                    propertiesSchema: {
                        name: { type: "string" },
                        age: { type: "integer" },
                        email: { type: "string" },
                    },
                },
                "actor-1",
            );
        });

        it("throws if type not found in registry", async () => {
            vi.mocked(customOntologyStoreService.getFromRegistry).mockReturnValue(undefined);

            await expect(
                ontologyMigrationService.addProperty(999, "email", { type: "string" }, "actor-1"),
            ).rejects.toThrow(/not found in registry/);
        });

        it("throws if property already exists", async () => {
            const typeDef = mockTypeDef();
            vi.mocked(customOntologyStoreService.getFromRegistry).mockReturnValue(typeDef as any);

            await expect(
                ontologyMigrationService.addProperty(1, "name", { type: "string" }, "actor-1"),
            ).rejects.toThrow(/already exists/);
        });
    });

    // ─────────────────────────────────────────────────
    // removeProperty
    // ─────────────────────────────────────────────────
    describe("removeProperty", () => {
        it("marks property as deprecated with _deprecated flag", async () => {
            const typeDef = mockTypeDef();
            vi.mocked(customOntologyStoreService.getFromRegistry).mockReturnValue(typeDef as any);
            vi.mocked(customOntologyStoreService.update).mockResolvedValue(typeDef as any);

            await ontologyMigrationService.removeProperty(1, "age", "actor-1");

            expect(customOntologyStoreService.update).toHaveBeenCalledWith(
                1,
                {
                    propertiesSchema: {
                        name: { type: "string" },
                        age: { type: "integer", _deprecated: true },
                    },
                },
                "actor-1",
            );
        });

        it("throws if property not found on type", async () => {
            const typeDef = mockTypeDef();
            vi.mocked(customOntologyStoreService.getFromRegistry).mockReturnValue(typeDef as any);

            await expect(
                ontologyMigrationService.removeProperty(1, "nonExistent", "actor-1"),
            ).rejects.toThrow(/does not exist/);
        });

        it("throws if type not found in registry", async () => {
            vi.mocked(customOntologyStoreService.getFromRegistry).mockReturnValue(undefined);

            await expect(
                ontologyMigrationService.removeProperty(999, "name", "actor-1"),
            ).rejects.toThrow(/not found in registry/);
        });
    });

    // ─────────────────────────────────────────────────
    // changePropertyType — compatible values
    // ─────────────────────────────────────────────────
    describe("changePropertyType with compatible values", () => {
        it("returns success=true when all values convert losslessly", async () => {
            const typeDef = mockTypeDef();
            vi.mocked(customOntologyStoreService.getFromRegistry).mockReturnValue(typeDef as any);
            vi.mocked(customOntologyStoreService.update).mockResolvedValue(typeDef as any);

            // Mock DB: instances with integer age values being converted to string (always lossless)
            const mockInstances = [
                { id: 1, properties: { name: "Alice", age: 30 } },
                { id: 2, properties: { name: "Bob", age: 25 } },
            ];

            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(mockInstances),
                }),
            } as any);

            const result = await ontologyMigrationService.changePropertyType(1, "age", "string", "actor-1");

            expect(result.success).toBe(true);
            expect(result.incompatibleInstances).toBeUndefined();
            expect(result.checkedCount).toBe(2);
            expect(result.remainingCount).toBe(0);
        });

        it("treats null/undefined property values as compatible", async () => {
            const typeDef = mockTypeDef();
            vi.mocked(customOntologyStoreService.getFromRegistry).mockReturnValue(typeDef as any);
            vi.mocked(customOntologyStoreService.update).mockResolvedValue(typeDef as any);

            const mockInstances = [
                { id: 1, properties: { name: "Alice", age: null } },
                { id: 2, properties: { name: "Bob" } }, // age not present
            ];

            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(mockInstances),
                }),
            } as any);

            const result = await ontologyMigrationService.changePropertyType(1, "age", "integer", "actor-1");

            expect(result.success).toBe(true);
            expect(result.checkedCount).toBe(2);
        });

        it("updates the schema on successful migration", async () => {
            const typeDef = mockTypeDef();
            vi.mocked(customOntologyStoreService.getFromRegistry).mockReturnValue(typeDef as any);
            vi.mocked(customOntologyStoreService.update).mockResolvedValue(typeDef as any);

            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
                }),
            } as any);

            await ontologyMigrationService.changePropertyType(1, "age", "string", "actor-1");

            expect(customOntologyStoreService.update).toHaveBeenCalledWith(
                1,
                { propertiesSchema: expect.objectContaining({ age: { type: "string" } }) },
                "actor-1",
            );
        });
    });

    // ─────────────────────────────────────────────────
    // changePropertyType — incompatible values
    // ─────────────────────────────────────────────────
    describe("changePropertyType with incompatible values", () => {
        it("returns success=false with list of incompatible instances", async () => {
            const typeDef = mockTypeDef();
            vi.mocked(customOntologyStoreService.getFromRegistry).mockReturnValue(typeDef as any);

            // "hello" cannot be parsed as integer
            const mockInstances = [
                { id: 1, properties: { name: "Alice", age: 30 } },
                { id: 2, properties: { name: "Bob", age: "hello" } },
                { id: 3, properties: { name: "Charlie", age: "world" } },
            ];

            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(mockInstances),
                }),
            } as any);

            // Changing name (string) to integer — "Alice", "Bob", "Charlie" are incompatible
            const result = await ontologyMigrationService.changePropertyType(1, "name", "integer", "actor-1");

            expect(result.success).toBe(false);
            expect(result.incompatibleInstances).toBeDefined();
            expect(result.incompatibleInstances!.length).toBe(3);
            expect(result.incompatibleInstances![0]).toEqual({ instanceId: 1, currentValue: "Alice" });
            expect(result.incompatibleInstances![1]).toEqual({ instanceId: 2, currentValue: "Bob" });
            expect(result.incompatibleInstances![2]).toEqual({ instanceId: 3, currentValue: "Charlie" });
        });

        it("caps incompatible instances at 100 entries (Req 7, AC 4)", async () => {
            const typeDef = mockTypeDef();
            vi.mocked(customOntologyStoreService.getFromRegistry).mockReturnValue(typeDef as any);

            // Generate 150 instances with incompatible values
            const mockInstances = Array.from({ length: 150 }, (_, i) => ({
                id: i + 1,
                properties: { name: `text_${i}`, age: `not-a-number-${i}` },
            }));

            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(mockInstances),
                }),
            } as any);

            // Changing age (currently strings) to integer — all are incompatible
            const result = await ontologyMigrationService.changePropertyType(1, "age", "integer", "actor-1");

            expect(result.success).toBe(false);
            expect(result.incompatibleInstances).toBeDefined();
            expect(result.incompatibleInstances!.length).toBe(100);
            // Should not call update since migration was rejected
            expect(customOntologyStoreService.update).not.toHaveBeenCalled();
        });

        it("does not update schema when incompatible instances are found", async () => {
            const typeDef = mockTypeDef();
            vi.mocked(customOntologyStoreService.getFromRegistry).mockReturnValue(typeDef as any);

            const mockInstances = [
                { id: 1, properties: { name: "not-a-boolean", age: 30 } },
            ];

            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(mockInstances),
                }),
            } as any);

            const result = await ontologyMigrationService.changePropertyType(1, "name", "boolean", "actor-1");

            expect(result.success).toBe(false);
            expect(customOntologyStoreService.update).not.toHaveBeenCalled();
        });
    });

    // ─────────────────────────────────────────────────
    // changePropertyType — timeout
    // ─────────────────────────────────────────────────
    describe("changePropertyType timeout (Req 7, AC 5)", () => {
        it("returns timedOut=true when validation exceeds 30 seconds", async () => {
            const typeDef = mockTypeDef();
            vi.mocked(customOntologyStoreService.getFromRegistry).mockReturnValue(typeDef as any);

            // Generate a large dataset of instances
            const mockInstances = Array.from({ length: 1000 }, (_, i) => ({
                id: i + 1,
                properties: { name: `item_${i}`, age: i },
            }));

            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(mockInstances),
                }),
            } as any);

            // Mock Date.now() to simulate timeout
            // First call returns a start time, then subsequent calls return a time > 30s later
            const realDateNow = Date.now;
            let callCount = 0;
            const startTime = 1000000;
            vi.spyOn(Date, "now").mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    // Initial start time capture
                    return startTime;
                }
                // All subsequent checks return past the 30s timeout
                return startTime + 30_001;
            });

            const result = await ontologyMigrationService.changePropertyType(1, "age", "string", "actor-1");

            expect(result.success).toBe(false);
            expect(result.timedOut).toBe(true);
            expect(result.remainingCount).toBeDefined();
            expect(result.remainingCount!).toBeGreaterThan(0);
            expect(result.checkedCount).toBeDefined();
            // Should not call update since migration was aborted
            expect(customOntologyStoreService.update).not.toHaveBeenCalled();

            // Restore Date.now
            vi.spyOn(Date, "now").mockRestore();
        });

        it("reports remaining count when timed out", async () => {
            const typeDef = mockTypeDef();
            vi.mocked(customOntologyStoreService.getFromRegistry).mockReturnValue(typeDef as any);

            const totalInstances = 500;
            const mockInstances = Array.from({ length: totalInstances }, (_, i) => ({
                id: i + 1,
                properties: { name: `item_${i}`, age: i },
            }));

            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(mockInstances),
                }),
            } as any);

            // Simulate timeout immediately on first check inside the loop
            const startTime = 1000000;
            let callCount = 0;
            vi.spyOn(Date, "now").mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    return startTime;
                }
                // Timeout immediately on first iteration
                return startTime + 30_001;
            });

            const result = await ontologyMigrationService.changePropertyType(1, "age", "string", "actor-1");

            expect(result.timedOut).toBe(true);
            expect(result.checkedCount).toBe(0);
            expect(result.remainingCount).toBe(totalInstances);

            vi.spyOn(Date, "now").mockRestore();
        });
    });

    // ─────────────────────────────────────────────────
    // changePropertyType — error cases
    // ─────────────────────────────────────────────────
    describe("changePropertyType error cases", () => {
        it("throws if type not found in registry", async () => {
            vi.mocked(customOntologyStoreService.getFromRegistry).mockReturnValue(undefined);

            await expect(
                ontologyMigrationService.changePropertyType(999, "name", "integer", "actor-1"),
            ).rejects.toThrow(/not found in registry/);
        });

        it("throws if property does not exist on type", async () => {
            const typeDef = mockTypeDef();
            vi.mocked(customOntologyStoreService.getFromRegistry).mockReturnValue(typeDef as any);

            await expect(
                ontologyMigrationService.changePropertyType(1, "nonExistent", "string", "actor-1"),
            ).rejects.toThrow(/does not exist/);
        });
    });
});
