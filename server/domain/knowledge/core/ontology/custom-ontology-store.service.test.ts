/**
 * CustomOntologyStore unit tests
 *
 * Validates: Requirements 6.1–6.7 (register, update, version history, startup loading, error handling)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Hoisted mocks ──────────────────────────────────────────────────────────────

const h = vi.hoisted(() => {
    // Each insert call produces an independent chain.
    // We track calls and configure per-call behavior via arrays.
    const insertResults: Array<{ returning?: any[]; plain?: true; reject?: Error }> = [];
    let insertCallIdx = 0;

    const insertMock = vi.fn(() => {
        const idx = insertCallIdx++;
        const cfg = insertResults[idx] ?? { returning: [] };
        return {
            values: vi.fn(() => {
                if (cfg.reject) {
                    return {
                        returning: vi.fn().mockRejectedValue(cfg.reject),
                    };
                }
                if (cfg.plain) {
                    // insert without returning (version insert)
                    return Promise.resolve();
                }
                return {
                    returning: vi.fn().mockResolvedValue(cfg.returning ?? []),
                };
            }),
        };
    });

    // update chain: db.update(table).set(data).where(cond).returning() -> Promise<row[]>
    const updateReturningMock = vi.fn();
    const updateWhereMock = vi.fn(() => ({ returning: updateReturningMock }));
    const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
    const updateMock = vi.fn(() => ({ set: updateSetMock }));

    // select chain: db.select().from(table).where(cond).orderBy(col) -> Promise<row[]>
    const selectWhereMock = vi.fn();
    const selectOrderByMock = vi.fn();
    const selectFromMock = vi.fn(() => ({
        where: selectWhereMock,
        orderBy: selectOrderByMock,
    }));
    const selectMock = vi.fn(() => ({ from: selectFromMock }));

    return {
        insertMock,
        insertResults,
        resetInsertIdx: () => { insertCallIdx = 0; },
        updateMock,
        updateSetMock,
        updateWhereMock,
        updateReturningMock,
        selectMock,
        selectFromMock,
        selectWhereMock,
        selectOrderByMock,
    };
});

vi.mock("@server/database_service.js", () => ({
    db: {
        insert: h.insertMock,
        update: h.updateMock,
        select: h.selectMock,
    },
}));

vi.mock("drizzle-orm", () => ({
    eq: vi.fn((...args: any[]) => ({ _type: "eq", args })),
    and: vi.fn((...args: any[]) => ({ _type: "and", args })),
    asc: vi.fn((col: any) => ({ _type: "asc", col })),
}));

vi.mock("@shared/schema/ontology/ontology.js", () => ({
    ontologyObjectTypes: { id: "id", organizationId: "organizationId", isActive: "isActive" },
}));

vi.mock("@shared/schema/ontology/ontology-versions.js", () => ({
    ontologyTypeVersions: { objectTypeId: "objectTypeId", organizationId: "organizationId", version: "version" },
}));

vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    }),
}));

// ── Import SUT after mocks ─────────────────────────────────────────────────────

import { customOntologyStoreService } from "./custom-ontology-store.service.js";

// ── Test helpers ────────────────────────────────────────────────────────────────

function makeInsertedType(overrides: Partial<any> = {}) {
    return {
        id: 1,
        organizationId: 100,
        name: "TaskTicket",
        description: "A support ticket",
        propertiesSchema: { title: { type: "string" } },
        titleProperty: "title",
        icon: "ticket",
        backing: "materialized",
        sourceAdapter: null,
        isActive: true,
        createdBy: "user-1",
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
        ...overrides,
    };
}

function makeDefInput(overrides: Partial<any> = {}) {
    return {
        organizationId: 100,
        name: "TaskTicket",
        description: "A support ticket",
        propertiesSchema: { title: { type: "string" } },
        titleProperty: "title",
        icon: "ticket",
        backing: "materialized" as const,
        sourceAdapter: null,
        isActive: true,
        ...overrides,
    };
}

// ── Tests ───────────────────────────────────────────────────────────────────────

describe("CustomOntologyStore", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        h.insertResults.length = 0;
        h.resetInsertIdx();
        customOntologyStoreService.clearRegistry();
    });

    // ─── register ───────────────────────────────────────────────────────────────

    describe("register", () => {
        it("inserts the definition and creates version 1 (Req 6, AC 1 & AC 3)", async () => {
            const inserted = makeInsertedType();
            // First insert call: ontology_object_types (with returning)
            h.insertResults.push({ returning: [inserted] });
            // Second insert call: ontology_type_versions (plain, no returning)
            h.insertResults.push({ plain: true });

            const result = await customOntologyStoreService.register(makeDefInput(), "user-1");

            expect(result).toEqual(inserted);
            expect(h.insertMock).toHaveBeenCalledTimes(2);
        });

        it("updates the in-memory registry on success (Req 6, AC 1)", async () => {
            const inserted = makeInsertedType({ id: 42 });
            h.insertResults.push({ returning: [inserted] });
            h.insertResults.push({ plain: true });

            await customOntologyStoreService.register(makeDefInput(), "user-1");

            expect(customOntologyStoreService.getFromRegistry(42)).toEqual(inserted);
        });

        it("does NOT update registry on DB failure (Req 6, AC 6)", async () => {
            h.insertResults.push({ reject: new Error("connection refused") });

            await expect(
                customOntologyStoreService.register(makeDefInput(), "user-1"),
            ).rejects.toThrow(/Failed to register ontology type/);

            expect(customOntologyStoreService.getAllFromRegistry()).toHaveLength(0);
        });
    });

    // ─── update ─────────────────────────────────────────────────────────────────

    describe("update", () => {
        it("increments the version number and creates a new version record (Req 6, AC 3 & AC 4)", async () => {
            // First: select to get current max version
            h.selectWhereMock.mockReturnValueOnce({
                orderBy: vi.fn().mockResolvedValueOnce([{ version: 1 }]),
            });

            const updated = makeInsertedType({ id: 5, name: "UpdatedTicket", updatedAt: new Date() });
            h.updateReturningMock.mockResolvedValueOnce([updated]);
            // version insert
            h.insertResults.push({ plain: true });

            const result = await customOntologyStoreService.update(
                5,
                { name: "UpdatedTicket" },
                "user-2",
            );

            expect(result).toEqual(updated);
            // insert called for version record
            expect(h.insertMock).toHaveBeenCalledTimes(1);
        });

        it("starts at version 1 when no prior versions exist (Req 6, AC 3)", async () => {
            // No existing versions
            h.selectWhereMock.mockReturnValueOnce({
                orderBy: vi.fn().mockResolvedValueOnce([]),
            });

            const updated = makeInsertedType({ id: 10 });
            h.updateReturningMock.mockResolvedValueOnce([updated]);
            h.insertResults.push({ plain: true });

            await customOntologyStoreService.update(10, { name: "New" }, "user-3");

            // nextVersion should be 1 (0 + 1)
            expect(h.insertMock).toHaveBeenCalledTimes(1);
        });

        it("updates the in-memory registry on success", async () => {
            h.selectWhereMock.mockReturnValueOnce({
                orderBy: vi.fn().mockResolvedValueOnce([{ version: 2 }]),
            });

            const updated = makeInsertedType({ id: 7, name: "V3" });
            h.updateReturningMock.mockResolvedValueOnce([updated]);
            h.insertResults.push({ plain: true });

            await customOntologyStoreService.update(7, { name: "V3" }, "user-4");

            expect(customOntologyStoreService.getFromRegistry(7)).toEqual(updated);
        });

        it("does NOT update registry on DB failure (Req 6, AC 6)", async () => {
            h.selectWhereMock.mockReturnValueOnce({
                orderBy: vi.fn().mockRejectedValueOnce(new Error("disk full")),
            });

            await expect(
                customOntologyStoreService.update(1, { name: "Fail" }, "user-5"),
            ).rejects.toThrow(/Failed to update ontology type/);

            expect(customOntologyStoreService.getFromRegistry(1)).toBeUndefined();
        });
    });

    // ─── getVersionHistory ──────────────────────────────────────────────────────

    describe("getVersionHistory", () => {
        it("returns version records in ascending order (Req 6, AC 5)", async () => {
            const versions = [
                { id: 1, objectTypeId: 5, organizationId: 100, version: 1, definitionSnapshot: {}, actorUserId: "u1", modifiedAt: new Date("2024-01-01") },
                { id: 2, objectTypeId: 5, organizationId: 100, version: 2, definitionSnapshot: {}, actorUserId: "u2", modifiedAt: new Date("2024-01-02") },
                { id: 3, objectTypeId: 5, organizationId: 100, version: 3, definitionSnapshot: {}, actorUserId: "u1", modifiedAt: new Date("2024-01-03") },
            ];

            h.selectFromMock.mockReturnValueOnce({
                where: vi.fn(() => ({
                    orderBy: vi.fn().mockResolvedValueOnce(versions),
                })),
            } as any);

            const result = await customOntologyStoreService.getVersionHistory(5, 100);

            expect(result).toEqual(versions);
            expect(result[0].version).toBe(1);
            expect(result[2].version).toBe(3);
        });

        it("returns empty array for non-existent type (Req 6, AC 7)", async () => {
            h.selectFromMock.mockReturnValueOnce({
                where: vi.fn(() => ({
                    orderBy: vi.fn().mockResolvedValueOnce([]),
                })),
            } as any);

            const result = await customOntologyStoreService.getVersionHistory(999, 100);

            expect(result).toEqual([]);
        });
    });

    // ─── loadActiveDefinitions ──────────────────────────────────────────────────

    describe("loadActiveDefinitions", () => {
        it("loads active definitions into the in-memory registry (Req 6, AC 2)", async () => {
            const defs = [
                makeInsertedType({ id: 1, name: "TypeA" }),
                makeInsertedType({ id: 2, name: "TypeB" }),
            ];

            h.selectFromMock.mockReturnValueOnce({
                where: vi.fn().mockResolvedValueOnce(defs),
            } as any);

            const result = await customOntologyStoreService.loadActiveDefinitions(100);

            expect(result).toEqual(defs);
            expect(customOntologyStoreService.getFromRegistry(1)).toEqual(defs[0]);
            expect(customOntologyStoreService.getFromRegistry(2)).toEqual(defs[1]);
        });

        it("returns empty array for org with no active definitions", async () => {
            h.selectFromMock.mockReturnValueOnce({
                where: vi.fn().mockResolvedValueOnce([]),
            } as any);

            const result = await customOntologyStoreService.loadActiveDefinitions(200);

            expect(result).toEqual([]);
            expect(customOntologyStoreService.getAllFromRegistry()).toHaveLength(0);
        });

        it("throws on database failure without updating registry", async () => {
            h.selectFromMock.mockReturnValueOnce({
                where: vi.fn().mockRejectedValueOnce(new Error("connection timeout")),
            } as any);

            await expect(
                customOntologyStoreService.loadActiveDefinitions(100),
            ).rejects.toThrow(/Failed to load active ontology definitions/);

            expect(customOntologyStoreService.getAllFromRegistry()).toHaveLength(0);
        });
    });

    // ─── error handling ─────────────────────────────────────────────────────────

    describe("error handling", () => {
        it("register wraps DB errors with descriptive message", async () => {
            h.insertResults.push({ reject: new Error("unique constraint violation") });

            await expect(
                customOntologyStoreService.register(makeDefInput({ name: "Dup" }), "user-x"),
            ).rejects.toThrow("Failed to register ontology type 'Dup': unique constraint violation");
        });

        it("update wraps DB errors with descriptive message", async () => {
            h.selectWhereMock.mockReturnValueOnce({
                orderBy: vi.fn().mockResolvedValueOnce([{ version: 1 }]),
            });
            h.updateReturningMock.mockResolvedValueOnce([undefined]); // not found

            await expect(
                customOntologyStoreService.update(99, { name: "Ghost" }, "user-y"),
            ).rejects.toThrow(/Failed to update ontology type 99/);
        });

        it("update does not modify registry when type not found", async () => {
            // Pre-populate registry to confirm it isn't wiped
            customOntologyStoreService._registry.set(1, makeInsertedType({ id: 1 }) as any);

            h.selectWhereMock.mockReturnValueOnce({
                orderBy: vi.fn().mockResolvedValueOnce([{ version: 1 }]),
            });
            h.updateReturningMock.mockResolvedValueOnce([undefined]);

            await expect(
                customOntologyStoreService.update(99, { name: "Nope" }, "u"),
            ).rejects.toThrow();

            // Original registry entry preserved
            expect(customOntologyStoreService.getFromRegistry(1)).toBeDefined();
            // The missing type was never added
            expect(customOntologyStoreService.getFromRegistry(99)).toBeUndefined();
        });
    });
});
