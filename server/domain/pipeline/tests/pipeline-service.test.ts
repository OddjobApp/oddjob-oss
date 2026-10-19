/**
 * Pipeline Service Unit Tests
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
        groupBy: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue(result),
        then: (onFulfilled: any) => Promise.resolve(result).then(onFulfilled),
        catch: (onRejected: any) => Promise.resolve(result).catch(onRejected),
        transaction: vi.fn((cb) => cb(query)),
    };
    return query;
};

// Mock database
vi.mock("@server/database_service.js", () => {
    const mockDb = {
        select: vi.fn(() => createMockQuery()),
        insert: vi.fn(() => createMockQuery()),
        update: vi.fn(() => createMockQuery()),
        delete: vi.fn(() => createMockQuery()),
        transaction: vi.fn((cb) => cb(mockDb)),
    };
    return { db: mockDb };
});

vi.mock("@domain/knowledge/core/query-monitor.service.js", () => ({
    withQueryTracking: vi.fn((name, fn) => fn()),
}));

vi.mock("@server/utils/logger.js", () => ({
    createLogger: vi.fn(() => ({
        info: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
    })),
}));

// Mock Pipeline Graph Service
vi.mock("@domain/pipeline/core/pipeline-graph.js", () => ({
    pipelineGraph: {
        validateSteps: vi.fn(),
        validateGraph: vi.fn().mockResolvedValue({ valid: true, errors: [], warnings: [] }),
    },
}));

import { pipelineService } from "@domain/pipeline/core/pipeline.service.js";
import { db } from "@server/database_service.js";
import { pipelineGraph as graphService } from "@domain/pipeline/core/pipeline-graph.js";
import type { OrgContext } from "@domain/jobs/job.service.js";

describe("PipelineService", () => {
    const mockOrgContext: OrgContext = {
        userId: "user-123",
        organizationId: 1,
        isAdmin: false,
        isSuperAdmin: false,
        isOrgAdmin: false,
    };

    beforeEach(() => {
        vi.resetAllMocks();
        // Re-apply implementations
        (db.select as Mock).mockImplementation(() => createMockQuery());
        (db.insert as Mock).mockImplementation(() => createMockQuery());
        (db.update as Mock).mockImplementation(() => createMockQuery());
        (db.delete as Mock).mockImplementation(() => createMockQuery());
        (db.transaction as Mock).mockImplementation((cb) => cb(db));

        (graphService.validateGraph as Mock).mockResolvedValue({ valid: true, errors: [], warnings: [] });
    });

    describe("Core CRUD", () => {
        it("should list pipelines for an organization", async () => {
            const mockPipelines = [{ id: 1, name: "Pipeline 1", organizationId: 1 }];
            (db.select as Mock).mockReturnValueOnce(createMockQuery(mockPipelines));

            const result = await pipelineService.list(mockOrgContext);
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("Pipeline 1");
        });

        it("should get pipeline by ID with steps", async () => {
            const mockPipeline = { id: 1, name: "Pipeline 1", organizationId: 1 };
            const mockSteps = [{ id: 10, pipelineId: 1, order: 1 }];

            (db.select as Mock)
                .mockReturnValueOnce(createMockQuery([mockPipeline])) // pipeline
                .mockReturnValueOnce(createMockQuery(mockSteps));    // steps

            const result = await pipelineService.getById(1, mockOrgContext);
            expect(result.id).toBe(1);
            expect(result.steps).toHaveLength(1);
        });

        it("should throw NotFoundError if pipeline not found", async () => {
            (db.select as Mock).mockReturnValueOnce(createMockQuery([]));

            await expect(pipelineService.getById(999, mockOrgContext)).rejects.toThrow("Pipeline not found");
        });

        it("should create a new pipeline", async () => {
            const input = {
                name: "New Pipeline",
                triggerType: "manual",
                steps: [{ jobId: 1, order: 1 }]
            };
            const mockPipeline = { id: 5, name: "New Pipeline", organizationId: 1 };
            const mockJob = { id: 1, organizationId: 1 };

            (db.select as Mock).mockReturnValueOnce(createMockQuery([mockJob])); // job verification
            (db.insert as Mock)
                .mockReturnValueOnce(createMockQuery([mockPipeline])) // pipeline insert
                .mockReturnValueOnce(createMockQuery([{ id: 10 }]))    // step insert
                .mockReturnValueOnce(createMockQuery([{ id: 1 }]));    // snapshot insert (in transaction)

            // For snapshot transaction
            (db.transaction as Mock).mockImplementation(async (cb) => {
                return await cb({
                    select: vi.fn(() => createMockQuery([mockPipeline])) // inner select for snapshot
                        .mockReturnValueOnce(createMockQuery([mockPipeline])) // pipeline
                        .mockReturnValueOnce(createMockQuery([{ id: 10 }])) // steps
                        .mockReturnValueOnce(createMockQuery([])), // versions
                    insert: vi.fn(() => createMockQuery([{ id: 1 }])), // version insert
                    update: vi.fn(() => createMockQuery()), // pipeline update
                });
            });

            const result = await pipelineService.create(input as any, mockOrgContext);
            expect(result.id).toBe(5);
            expect(db.insert).toHaveBeenCalled();
        });

        it("should update a pipeline", async () => {
            const mockPipeline = { id: 1, name: "Original", organizationId: 1 };
            const input = { name: "Updated" };

            (db.select as Mock).mockReturnValueOnce(createMockQuery([mockPipeline])); // existence check
            (db.update as Mock).mockReturnValueOnce(createMockQuery([{ ...mockPipeline, name: "Updated" }]));

            const result = await pipelineService.update(1, input, mockOrgContext);
            expect(result.name).toBe("Updated");
        });

        it("should delete a pipeline and its related entities", async () => {
            // delete() verifies ownership first and throws NotFoundError on an empty
            // result, so the existence check must be mocked — as the update test above
            // already does. Without it the whole test failed with "Pipeline not found"
            // before reaching a single delete.
            (db.select as Mock).mockReturnValueOnce(createMockQuery([{ id: 1 }])); // existence check

            (db.delete as Mock).mockReturnValueOnce(createMockQuery()); // input params
            (db.delete as Mock).mockReturnValueOnce(createMockQuery()); // output params
            (db.delete as Mock).mockReturnValueOnce(createMockQuery()); // tool hints
            (db.delete as Mock).mockReturnValueOnce(createMockQuery()); // steps
            (db.delete as Mock).mockReturnValueOnce(createMockQuery()); // triggers
            (db.delete as Mock).mockReturnValueOnce(createMockQuery()); // pipeline

            await pipelineService.delete(1, mockOrgContext);
            // Six tables: input params, output params, tool hints, steps, triggers,
            // pipeline. pipelineOutputParams was added to the cascade after this
            // assertion was written.
            expect(db.delete).toHaveBeenCalledTimes(6);
        });
    });

    describe("Snapshots & Versions", () => {
        it("should create a snapshot", async () => {
            const mockPipeline = { id: 1, name: "Pipeline", organizationId: 1 };
            const mockSteps = [{ id: 10, jobId: 1, order: 1 }];
            const mockNewVersion = { id: 1, versionNumber: 2 };

            (db.transaction as Mock).mockImplementation(async (cb) => {
                const tx = {
                    select: vi.fn()
                        .mockReturnValueOnce(createMockQuery([mockPipeline])) // pipeline
                        .mockReturnValueOnce(createMockQuery(mockSteps))    // steps
                        .mockReturnValueOnce(createMockQuery([{ versionNumber: 1 }])), // last version
                    insert: vi.fn(() => createMockQuery([mockNewVersion])),
                    update: vi.fn(() => createMockQuery()),
                };
                return await cb(tx);
            });

            const result = await pipelineService.createSnapshot(1, "user-1", "Test Snapshot", mockOrgContext);
            expect(result.versionNumber).toBe(2);
        });
    });
});


