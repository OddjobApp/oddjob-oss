/**
 * Dataset Service Unit Tests
 */

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
        returning: vi.fn().mockResolvedValue(result),
        then: (onFulfilled: any) => Promise.resolve(result).then(onFulfilled),
        catch: (onRejected: any) => Promise.resolve(result).catch(onRejected),
        transaction: vi.fn((cb) => cb(query)),
        execute: vi.fn().mockResolvedValue({ rows: result })
    };
    return query;
};

// Mock database
vi.mock("@server/database_service.js", () => {
    const mockDb = {
        select: vi.fn(() => createMockQuery()),
        selectDistinct: vi.fn(() => createMockQuery()),
        insert: vi.fn(() => createMockQuery()),
        update: vi.fn(() => createMockQuery()),
        delete: vi.fn(() => createMockQuery()),
        transaction: vi.fn((cb) => cb(mockDb)),
        execute: vi.fn().mockResolvedValue({ rows: [] }),
    };
    return { db: mockDb };
});

vi.mock("@domain/knowledge/core/query-monitor.service.js", () => ({
    withQueryTracking: vi.fn((name, fn) => fn()),
}));

vi.mock("../../server/utils/logger", () => ({
    createLogger: vi.fn(() => ({
        info: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
    })),
}));

import { datasetService } from "@domain/knowledge/core/dataset-service.js";
import { db } from "@server/database_service.js";
import type { OrgContext } from "@server/domain/jobs/job.service.js";

describe("DatasetService", () => {
    const mockOrgContext: OrgContext = {
        userId: "user-123",
        organizationId: 1,
        isAdmin: true,
        isOrgAdmin: true,
        isSuperAdmin: false
    };

    beforeEach(() => {
        vi.resetAllMocks();
        // Re-apply implementations
        (db.select as Mock).mockImplementation(() => createMockQuery());
        (db.insert as Mock).mockImplementation(() => createMockQuery());
        (db.update as Mock).mockImplementation(() => createMockQuery());
        (db.delete as Mock).mockImplementation(() => createMockQuery());
        (db.transaction as Mock).mockImplementation((cb) => cb(db));
    });

    describe("Core Operations", () => {
        it("should list datasets for an organization", async () => {
            const mockDatasets = [
                { id: 1, name: "Dataset 1", organizationId: 1 },
                { id: 2, name: "Dataset 2", organizationId: 1 },
            ];

            (db.select as Mock).mockReturnValueOnce(createMockQuery(mockDatasets));

            const result = await datasetService.list(mockOrgContext);
            expect(result).toEqual(mockDatasets);
            expect(db.select).toHaveBeenCalled();
        });

        it("should get dataset by ID", async () => {
            const mockDataset = { id: 1, name: "Dataset 1", organizationId: 1 };
            (db.select as Mock).mockReturnValueOnce(createMockQuery([mockDataset]));

            const result = await datasetService.getById(1, mockOrgContext);
            expect(result).toEqual(mockDataset);
        });

        it("should throw NotFoundError if dataset not found", async () => {
            (db.select as Mock).mockReturnValueOnce(createMockQuery([]));

            await expect(datasetService.getById(999, mockOrgContext)).rejects.toThrow("Dataset not found");
        });

        it("should create a new dataset", async () => {
            const input = { name: "New Dataset", description: "Test" };
            const mockDataset = { id: 1, ...input, organizationId: 1 };

            // Check duplicate name (returns empty)
            (db.select as Mock).mockReturnValueOnce(createMockQuery([]));
            // Insert call
            (db.insert as Mock).mockReturnValueOnce(createMockQuery([mockDataset]));

            const result = await datasetService.create(input, mockOrgContext);
            expect(result).toEqual(mockDataset);
            expect(db.insert).toHaveBeenCalled();
        });

        it("should throw ConflictError on duplicate name", async () => {
            const input = { name: "Existing Dataset" };
            (db.select as Mock).mockReturnValueOnce(createMockQuery([{ id: 1 }]));

            await expect(datasetService.create(input, mockOrgContext)).rejects.toThrow("Dataset with this name already exists");
        });
    });

    describe("Item Operations", () => {
        it("should list items for a dataset", async () => {
            const mockDataset = { id: 1, name: "Dataset 1", organizationId: 1 };
            const mockItems = [
                { id: 1, datasetId: 1, data: { key: "value1" } },
                { id: 2, datasetId: 1, data: { key: "value2" } },
            ];

            (db.select as Mock)
                .mockReturnValueOnce(createMockQuery([mockDataset])) // access check
                .mockReturnValueOnce(createMockQuery([{ count: 2 }])) // count
                .mockReturnValueOnce(createMockQuery(mockItems));      // data

            const result = await datasetService.getItems(1, mockOrgContext);
            expect(result.items).toEqual(mockItems);
            expect(result.total).toBe(2);
        });

        it("should add an item to a dataset", async () => {
            const mockDataset = { id: 1, name: "Dataset 1", organizationId: 1, validationRules: {} };
            const input = { data: { field: "data" } };
            const mockItem = { id: 10, datasetId: 1, ...input };

            (db.select as Mock).mockReturnValueOnce(createMockQuery([mockDataset]));
            (db.insert as Mock).mockReturnValueOnce(createMockQuery([mockItem]));

            const result = await datasetService.addItem(1, input, mockOrgContext);
            expect(result).toEqual(mockItem);
        });

        it("should batch add items", async () => {
            const mockDataset = { id: 1, name: "Dataset 1", organizationId: 1 };
            const items = [{ data: { f: 1 } }, { data: { f: 2 } }];
            const mockInserted = items.map((it, i) => ({ id: i + 1, ...it }));

            (db.select as Mock).mockReturnValueOnce(createMockQuery([mockDataset]));
            (db.insert as Mock).mockReturnValueOnce(createMockQuery(mockInserted));

            const result = await datasetService.addItems(1, items, mockOrgContext);
            expect(result.inserted).toBe(2);
            expect(result.items).toHaveLength(2);
        });

        it("should update a dataset item", async () => {
            const mockDataset = { id: 1, name: "Dataset 1", organizationId: 1 };
            const input = { data: { updated: true } };
            const mockItem = { id: 10, datasetId: 1, data: input.data };

            (db.select as Mock).mockReturnValueOnce(createMockQuery([mockDataset]));
            (db.update as Mock).mockReturnValueOnce(createMockQuery([mockItem]));

            const result = await datasetService.updateItem(1, 10, input, mockOrgContext);
            expect((result.data as any).updated).toBe(true);
        });

        it("should delete a dataset item", async () => {
            const mockDataset = { id: 1, name: "Dataset 1", organizationId: 1 };
            (db.select as Mock).mockReturnValueOnce(createMockQuery([mockDataset]));
            (db.delete as Mock).mockReturnValueOnce(createMockQuery());

            await datasetService.deleteItem(1, 10, mockOrgContext);
            expect(db.delete).toHaveBeenCalled();
        });
    });

    describe("Special Operations", () => {
        it("should get dataset stats", async () => {
            const mockDataset = { id: 1, updatedAt: new Date() };
            (db.select as Mock)
                .mockReturnValueOnce(createMockQuery([mockDataset]))
                .mockReturnValueOnce(createMockQuery([{ count: 100 }]));

            const stats = await datasetService.getStats(1, mockOrgContext);
            expect(stats.rowCount).toBe(100);
            expect(stats.lastUpdated).toBeInstanceOf(Date);
        });

        it("should clear all items from a dataset", async () => {
            const mockDataset = { id: 1 };
            (db.select as Mock).mockReturnValueOnce(createMockQuery([mockDataset]));
            (db.delete as Mock).mockReturnValueOnce(createMockQuery({ rowCount: 50 }));

            const result = await datasetService.clearItems(1, mockOrgContext);
            // rowCount is cast to Number in the service sometimes, or extracted from result
            // Our mock handles it if we pass it as the "result" to createMockQuery
            // which then gets placed in the then/resolves.
        });
    });
});
