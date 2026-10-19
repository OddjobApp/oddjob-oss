
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DB 
vi.mock("@server/database_service.js", () => {
    const createMockQuery = (result: any = []) => ({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue(result),
        values: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
    });

    const db = {
        select: vi.fn(() => createMockQuery()),
        insert: vi.fn(() => createMockQuery()),
        update: vi.fn(() => createMockQuery()),
        transaction: vi.fn(async (fn) => fn(db)),
    };
    return { db };
});

// Mock mission run service
vi.mock("@domain/mission/core/mission-run.service.js", () => ({
    missionRunService: {
        getByIdOrThrow: vi.fn(),
        update: vi.fn().mockResolvedValue(undefined),
        checkpoint: vi.fn().mockResolvedValue(undefined),
        create: vi.fn(),
    }
}));

// Mock pipeline executor
vi.mock("@server/core/pipeline-executor.js", () => ({
    pipelineExecutor: {
        resumePipelineExecution: vi.fn().mockResolvedValue({ success: true })
    }
}));

// Mock logger to avoid spam
vi.mock("@server/utils/logger.js", () => ({
    createLogger: vi.fn(() => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    }))
}));

import { DISCOVERY_TOOLS } from "@domain/tools/v1/capabilities/discovery.js";
import { missionRunService } from "@domain/mission/core/mission-run.service.js";
import { RescueStrategyFactory } from "@domain/mission/utils/rescue-strategy-factory.js";
import { db } from "@server/database_service.js";

describe("Agentic Maturity Comprehensive Suite", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("JIT Tool Discovery", () => {
        it("should browse inactive capabilities", async () => {
            const mockServers = [{ id: 1, name: "jira", description: "Jira sync" }];
            (db.select as any).mockReturnValue({
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockResolvedValue(mockServers),
            });

            const result = await DISCOVERY_TOOLS.list_available_mcp_capabilities.execute({ search: "jira" }, {} as any);
            expect(result).toContain("jira");
        });

        it("should route activation requests to Triage", async () => {
            const insertSpy = vi.fn().mockResolvedValue([]);
            (db.insert as any).mockReturnValue({ values: insertSpy });

            const result = await DISCOVERY_TOOLS.request_mcp_tool.execute({ toolName: "jira", reason: "testing" }, { missionId: 1, jobId: 100 } as any);
            expect(result).toContain("SUCCESS");
            expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({
                serviceType: "tool_discovery",
                missionId: 1,
                status: "REQUESTED",
            }));
        });

        // This used to assert `missionRunId: 100`, mapping the context's jobId onto
        // the mission-run column. That expectation was wrong twice over:
        // rescueSessions.missionRunId is a FK to missionRuns.id, so a job id would be
        // a bogus reference, and the handler reads context.missionRunId, which no tool
        // context ever carries — AgentContext has no such field and ToolExecutor only
        // spreads what is on it.
        //
        // So the capability-gap card reaches the Decision Inbox with a null run link,
        // and its approve/reject recoveryOptions carry `missionRunId: undefined`,
        // leaving an approver with no run to enable the tool for. Pinned as-is so the
        // gap is visible in the suite rather than silently asserted away; whoever
        // threads missionRunId through will see this fail and update it deliberately.
        it("records no mission-run link today, because tool contexts never carry one", async () => {
            const insertSpy = vi.fn().mockResolvedValue([]);
            (db.insert as any).mockReturnValue({ values: insertSpy });

            await DISCOVERY_TOOLS.request_mcp_tool.execute(
                { toolName: "jira", reason: "testing" },
                { missionId: 1, jobId: 100 } as any,
            );

            const inserted = insertSpy.mock.calls[0][0];
            expect(inserted.missionRunId).toBeUndefined();
            expect(inserted.recoveryOptions.every((o: any) => o.params.missionRunId === undefined)).toBe(true);
        });
    });

    describe("Sub-Agent Hierarchy", () => {
        it("should handle parentId during mission run creation", async () => {
             const mockRun = { id: 11, parentId: 5 };
             (missionRunService.create as any).mockResolvedValue(mockRun);

             const result = await missionRunService.create({
                 missionId: 1,
                 name: "Sub Task",
                 pipelineSequence: [1],
                 createdBy: "user-1",
                 parentId: 5
             });

             expect(result.parentId).toBe(5);
        });
    });

    describe("Rescue Strategy Triage", () => {
        it("should apply approve_tool strategy successfully", async () => {
            const mockMission = { id: 100, missionId: 1, organizationId: 1, missionContext: { existing: "context" } };
            (missionRunService.getByIdOrThrow as any).mockResolvedValue(mockMission);

            await RescueStrategyFactory.apply(100, {
                strategy: "approve_tool",
                proposedAction: { toolName: "google_search" },
                userId: "user-1"
            });

            expect(missionRunService.checkpoint).toHaveBeenCalled();
            expect(missionRunService.update).toHaveBeenCalledWith(100, expect.objectContaining({
                status: "active"
            }));
        });
    });
});
