
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
            transaction: vi.fn((fn) => fn({
                select: vi.fn(() => createMockQuery()),
                insert: vi.fn(() => createMockQuery()),
                update: vi.fn(() => createMockQuery()),
                delete: vi.fn(() => createMockQuery()),
            })),
            execute: vi.fn().mockResolvedValue({ rows: [] }),
        },
    };
});

// Mock dependencies
vi.mock("@domain/knowledge/core/query-monitor.service.js", () => ({
    withQueryTracking: vi.fn((name, fn) => fn()),
}));

vi.mock("../../server/utils/logger.js", () => ({
    createLogger: vi.fn(() => ({
        info: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
    })),
}));

vi.mock("../../server/utils/auth-context.js", () => ({
    validateOrgAccess: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../server/knowledge/knowledge-store.js", () => ({
    storeJobOutputAsKnowledge: vi.fn().mockResolvedValue(undefined),
    getJobOutputStorageConfig: vi.fn().mockReturnValue({}),
}));

vi.mock("@server/domain/pipeline/core/pipeline.service.js", () => ({
    pipelineService: {
        getJobPipelineUsage: vi.fn().mockResolvedValue([]),
        getBulkJobPipelineUsage: vi.fn().mockResolvedValue([])
    }
}));

import { jobService } from "@server/domain/jobs/job.service.js";
import { db } from "@server/database_service.js";

describe("JobService", () => {
    const mockOrgContext = {
        userId: "user-1",
        organizationId: 1,
        isAdmin: false,
        isSuperAdmin: false,
        isOrgAdmin: false
    };

    beforeEach(() => {
        vi.clearAllMocks();
        // Default users mock
        (db.select as Mock).mockImplementation((arg) => {
            return createMockQuery([{ id: 1, username: "testuser" }]);
        });
    });

    describe("list", () => {
        it("should list jobs for an organization", async () => {
            const mockJobs = [{ id: 1, name: "Job 1" }];
            (db.select as Mock).mockReturnValueOnce(createMockQuery([{ count: 1 }])); // for count
            (db.select as Mock).mockReturnValueOnce(createMockQuery(mockJobs)); // for list

            const result = await jobService.list(mockOrgContext);

            expect(result.items).toEqual(mockJobs);
            expect(result.total).toBe(1);
        });
    });

    describe("getById", () => {
        it("should return job if found and access allowed", async () => {
            const mockJob = { id: 1, name: "Job 1", organizationId: 1 };
            (db.select as Mock).mockReturnValueOnce(createMockQuery([mockJob]));

            const result = await jobService.getById(1, mockOrgContext);
            expect(result).toEqual(mockJob);
        });

        it("should throw NotFoundError if job not found", async () => {
            // Ensure first call to select returns empty array for the job lookup
            (db.select as Mock).mockImplementationOnce(() => createMockQuery([]));

            try {
                await jobService.getById(999, mockOrgContext);
                expect.fail("Should have thrown");
            } catch (error: any) {
                expect(error.message).toContain("Job 999 not found");
            }
        });
    });

    // jobService.create/copy validate the config for anything that is not a draft
    // (see job.service.ts "Job configuration is not ready for activation"). An
    // ai_agent needs a credential and a non-empty goal, so `config: {}` no longer
    // creates an active job.
    const validAiAgentConfig = {
        model: "gemini-2.0-flash",
        goal: "Summarise the account and return a sourced brief.",
        maxIterations: 10,
        temperature: 0.7,
        supervision: "full",
        credentialId: 7,
    };

    describe("create", () => {
        it("should create a new job", async () => {
            const mockNewJob = { id: 2, name: "New Job", type: "ai_agent", organizationId: 1 };

            // getUser mock
            (db.select as Mock).mockReturnValueOnce(createMockQuery([{ id: 1, username: "testuser" }]));
            // orgSettings mock (empty allowed types)
            (db.select as Mock).mockReturnValueOnce(createMockQuery([]));
            // insert mock
            (db.insert as Mock).mockReturnValueOnce(createMockQuery([mockNewJob]));

            const result = await jobService.create({
                name: "New Job",
                type: "ai_agent",
                config: validAiAgentConfig
            }, mockOrgContext);

            expect(result).toEqual(mockNewJob);
            expect(db.insert).toHaveBeenCalled();
        });
    });

    describe("delete", () => {
        it("should delete job if no pipeline dependencies", async () => {
            // pipeline dependencies check
            (db.select as Mock).mockReturnValueOnce(createMockQuery([]));

            await jobService.delete(1, mockOrgContext);

            expect(db.delete).toHaveBeenCalled();
        });

        it("should throw ConflictError if job is used in pipelines", async () => {
            // pipeline dependencies check
            (db.select as Mock).mockReturnValueOnce(createMockQuery([{ pipelineId: 1, pipelineName: "Pipeline 1" }]));

            await expect(jobService.delete(1, mockOrgContext)).rejects.toThrow("used in pipelines");
        });
    });

    describe("copy", () => {
        it("should copy an existing job", async () => {
            const sourceJob = { id: 1, name: "Job 1", type: "ai_agent", organizationId: 1, config: validAiAgentConfig };
            const copiedJob = { id: 3, name: "Job 1 (Copy)", type: "ai_agent", organizationId: 1, config: validAiAgentConfig };

            // getUser
            (db.select as Mock).mockReturnValueOnce(createMockQuery([{ id: 1, username: "testuser" }]));
            // getById
            (db.select as Mock).mockReturnValueOnce(createMockQuery([sourceJob]));
            // orgSettings
            (db.select as Mock).mockReturnValueOnce(createMockQuery([]));
            // insert
            (db.insert as Mock).mockReturnValueOnce(createMockQuery([copiedJob]));

            const result = await jobService.copy(1, mockOrgContext);

            expect(result.name).toContain("(Copy)");
            expect(db.insert).toHaveBeenCalled();
        });
    });
});
