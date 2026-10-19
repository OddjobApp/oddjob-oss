
import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

// total isolation mocks at the very top
vi.mock("@server/domain/mission/core/mission.service.js", () => ({
    missionService: {
        updateBlackboard: vi.fn(),
        queueBlackboardUpdate: vi.fn()
    }
}));

vi.mock("@server/core/pipeline-executor.js", () => ({
    pipelineExecutor: {
        resumePipelineExecution: vi.fn().mockResolvedValue({ success: true })
    }
}));

const mockGenerateProposal = vi.fn().mockResolvedValue({ 
    skillId: "99", 
    strategyDescription: "Test", 
    modifiedContext: {}, 
    recommendedModelId: "gpt-4", 
    newVersion: "2" 
});

vi.mock("@domain/mission/core/skill-generator.service.js", () => ({
    skillGeneratorService: {
        generateProposal: mockGenerateProposal
    }
}));

vi.mock("@server/domain/jobs/job.service.js", () => ({
    jobService: {
        getById: vi.fn().mockResolvedValue({ id: 1 }),
        create: vi.fn().mockResolvedValue({ id: 1 })
    }
}));


vi.mock("@server/utils/logger.js", () => ({
    createLogger: vi.fn(() => ({
        info: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
    })),
}));

let selectMockReturnValues: Record<string, any> = {};

// Helper to extract table name from Drizzle table object
const getTableName = (table: any) => {
    if (typeof table === 'string') return table;
    if (!table) return "default";
    const symbols = Object.getOwnPropertySymbols(table);
    const nameSymbol = symbols.find(s => s.toString().includes('drizzle:Name'));
    if (nameSymbol) return table[nameSymbol];
    return table.name || table._?.name || "default";
};

// Helper to create a chainable mock query
const createMockQuery = (defaultResult: any = [], initialTable: string = "default") => {
    let currentTable: string = initialTable;
    const query: any = {
        from: vi.fn((table) => {
            currentTable = getTableName(table);
            return query;
        }),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        onConflictDoNothing: vi.fn().mockReturnThis(),
        for: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        returning: vi.fn(() => {
            const result = selectMockReturnValues[currentTable] || selectMockReturnValues["default"] || defaultResult;
            return Promise.resolve(result);
        }),
        catch: vi.fn().mockReturnThis(),
        then: vi.fn(onFulfilled => {
            const result = selectMockReturnValues[currentTable] || selectMockReturnValues["default"] || defaultResult;
            return Promise.resolve(result).then(onFulfilled);
        })
    };
    return query;
};

const mockTx = {
    select: vi.fn(() => createMockQuery()),
    insert: vi.fn((table) => createMockQuery([], getTableName(table))),
    update: vi.fn((table) => createMockQuery([], getTableName(table))),
    delete: vi.fn((table) => createMockQuery([], getTableName(table))),
    transaction: vi.fn((innerFn) => innerFn(mockTx)),
};

// Mock database
vi.mock("@server/database_service.js", () => {
    return {
        db: {
            select: vi.fn(() => createMockQuery()),
            insert: vi.fn((table) => createMockQuery([], getTableName(table))),
            update: vi.fn((table) => createMockQuery([], getTableName(table))),
            delete: vi.fn((table) => createMockQuery([], getTableName(table))),
            transaction: vi.fn((fn) => fn(mockTx)),
            execute: vi.fn().mockResolvedValue({ rows: [] }),
        }
    };
});

import { missionRunService } from "@domain/mission/core/mission-run.service.js";
import { db } from "@server/database_service.js";

describe("MissionRunService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockTx.select.mockClear();
        mockTx.insert.mockClear();
        mockTx.update.mockClear();
        mockTx.delete.mockClear();
        selectMockReturnValues = {};
        
        // Default FLAT mock for single-table selects
        const flatRun = { id: 1, missionId: 10, status: "active", missionContext: {}, pipelineExecutionId: 100 };
        selectMockReturnValues["mission_runs"] = [flatRun];
        selectMockReturnValues["default"] = [flatRun];
    });

    describe("getTimeline", () => {
        it("should combine checkpoints and approvals into a unified timeline", async () => {
             // For getTimeline, we first get mission_runs (flat), then history (flat), then joins
             selectMockReturnValues["mission_runs"] = [{ id: 1, missionId: 10, pipelineExecutionId: 100 }];
             selectMockReturnValues["mission_blackboard_history"] = [
                { changeReason: "checkpoint: one", createdAt: new Date(), blackboard: {} }
             ];
             selectMockReturnValues["approval_requests"] = [
                { id: 1, status: "pending", createdAt: new Date() }
             ];

             const result = await missionRunService.getTimeline(1, 50);
             expect(result.some(i => i.type === "checkpoint")).toBe(true);
        });
    });

    describe("update", () => {
        it("should trigger skill evolution on failure", async () => {
            const mockRun = { id: 1, status: "active", missionId: 10, contextCoreUrl: "core-url" };
            selectMockReturnValues["mission_runs"] = [mockRun];
            selectMockReturnValues["mission_members"] = [{ entityType: 'job', entityId: 50, role: 'primary_strategist', missionId: 10 }];
            selectMockReturnValues["jobs"] = [{ id: 50, skillId: 99 }];
            
            await missionRunService.update(1, { status: "failed" });

            await vi.waitFor(() => {
                expect(mockGenerateProposal).toHaveBeenCalled();
            }, { timeout: 3500 });

            expect(mockGenerateProposal).toHaveBeenCalledWith("99", expect.any(Array), "core-url");
        });
    });

    describe("create", () => {
        it("should create a new mission run", async () => {
            const mockRun = { id: 1, name: "Test Run" };
            selectMockReturnValues["mission_runs"] = [mockRun];

            const result = await missionRunService.create({
                missionId: 1,
                name: "Test Run",
                pipelineSequence: [1],
                createdBy: "user-1"
            });

            expect(result).toEqual(mockRun);
            expect(db.insert).toHaveBeenCalled();
        });
    });
});
