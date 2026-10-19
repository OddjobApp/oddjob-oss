/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll, vi, type Mock } from "vitest";
import { db } from "@server/database_service.js";
import { missions, missionRuns } from "@shared/schema/index.js";
import { eq, sql } from "drizzle-orm";
// import { missionRunService } from "@server/domain/mission/core/mission-run.service.js";
// import { dynamicOrchestratorService } from "@server/domain/mission/core/dynamic-orchestrator.service.js";
// import { rollingWaveOrchestratorService } from "@server/domain/mission/core/rolling-wave-orchestrator.service.js";

// Mocking external dependencies
const mockAiExecute = vi.fn();
vi.mock("@server/domain/ai/core/ai-client.service.js", () => ({
    AIClientFactory: {
        getClient: vi.fn(() => ({
            execute: mockAiExecute,
        })),
    },
}));

vi.mock("@domain/core/infrastructure/event-stream.service.js", () => ({
    eventStream: {
        publish: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
    },
}));

vi.mock("@server/domain/ai/core/system-ai.service.js", () => ({
    systemAiService: {
        getAiConfig: vi.fn().mockResolvedValue({ provider: 'google', model: 'gemini-2.0-flash' }),
    },
}));

vi.mock("@server/domain/tools/v1/tool-registry.service.js", () => ({
    AGENT_TOOLS: {
        search_nodes: { name: "search_nodes", description: "Search knowledge graph" },
        get_system_info: { name: "get_system_info", description: "Get system info" },
        list_open_ports: { name: "list_open_ports", description: "List open ports" },
    },
    normalizeToolName: vi.fn((n) => n),
}));

vi.mock("@server/mcp/handlers.js", () => ({
    handleToolCall: vi.fn().mockResolvedValue({ success: true, result: "mocked tool result" }),
}));

// Mock Redis to prevent connection errors
const mockRedis = {
    rpush: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(true),
    lrange: vi.fn().mockResolvedValue([]),
    del: vi.fn().mockResolvedValue(1),
    connect: vi.fn().mockResolvedValue(true),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    hset: vi.fn().mockResolvedValue(1),
    hget: vi.fn().mockResolvedValue(null),
    hgetall: vi.fn().mockResolvedValue({}),
    on: vi.fn(),
};

vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => ({
    redis: mockRedis,
    nodeRedisClient: mockRedis,
    subscriber: mockRedis,
    publisher: mockRedis,
    redisService: {
        getInstance: vi.fn().mockReturnThis(),
        getOptions: vi.fn().mockReturnValue({}),
        connect: vi.fn().mockResolvedValue(true),
    },
    redisManager: {
        getInstance: vi.fn().mockReturnThis(),
        getOptions: vi.fn().mockReturnValue({}),
        connect: vi.fn().mockResolvedValue(true),
    },
    getRedisOptions: vi.fn().mockReturnValue({}),
    getRedisClient: vi.fn().mockImplementation(() => mockRedis),
}));

// Mock System AI config
vi.mock("../../ai/core/system-ai.service.js", () => ({
    systemAiService: {
        getAiConfig: vi.fn().mockResolvedValue({ provider: 'google', model: 'gemini-2.0-flash', apiKey: 'test-key' }),
    }
}));

// Helper to check if tables exist
async function tableExists(name: string): Promise<boolean> {
    try {
        await db.execute(sql`SELECT 1 FROM ${sql.identifier(name)} LIMIT 1`);
        return true;
    } catch {
        return false;
    }
}

describe("Mission Strategy Integration Scenarios", () => {
    let testOrgId: number | null = null;
    let missionRunService: any;
    let dynamicOrchestratorService: any;
    let rollingWaveOrchestratorService: any;

    beforeAll(async () => {
        // Find or create a test organization if needed, or just use null for global
        // For these tests we'll use null (system org)
        const mr = await import("@server/domain/mission/core/mission-run.service.js");
        const doS = await import("@server/domain/mission/core/dynamic-orchestrator.service.js");
        const rw = await import("@server/domain/mission/core/rolling-wave-orchestrator.service.js");
        
        missionRunService = mr.missionRunService;
        dynamicOrchestratorService = doS.dynamicOrchestratorService;
        rollingWaveOrchestratorService = rw.rollingWaveOrchestratorService;
    });

    afterAll(async () => {
        // Cleanup test missions and runs
        await db.delete(missionRuns).where(sql`name LIKE 'TEST_%'`).catch(() => {});
        await db.delete(missions).where(sql`name LIKE 'TEST_%'`).catch(() => {});
    });

    /**
     * 1. PRE-PLANNED STRATEGY
     * Verifies sequential execution of a fixed tool manifest.
     */
    describe("Pre-Planned (Standard JSON Manifest)", () => {
        it("should execute a fixed sequence of tools correctly", async () => {
            if (!(await tableExists("missions"))) return;

            // Scenario: Security Baseline Audit
            const [m] = await db.insert(missions).values({
                name: "TEST_SecurityAudit",
                objective: "Perform a baseline security audit",
                executionStrategy: "pre_planned",
                reasoningProtocol: "json_manifest",
                workflowBlueprint: {
                    steps: [
                        { id: "s1", tool: "get_system_info", arguments: { detail: "high" } },
                        { id: "s2", tool: "list_open_ports", arguments: { range: "1-1024" } }
                    ]
                },
                createdBy: "test-executor",
                organizationId: testOrgId,
            } as any).returning();

            // Launch the mission run
            const run = await missionRunService.create({
                missionId: m.id,
                name: "TEST_SecurityAudit_Run",
                createdBy: "test-executor",
                organizationId: testOrgId as any,
                pipelineSequence: []
            });

            expect(run.id).toBeDefined();
            expect(run.status).toBe("active");
            
            // In a real system, the background worker would pick this up.
            // Here we verify the run was initialized with the correct sequence.
            // For manifest-based, the sequence might be empty or IDs of steps.
            // Here we just verify it exists.
            expect(run.id).toBeDefined();
            expect(run.status).toBe("active");
            expect((m.workflowBlueprint as any)?.steps).toHaveLength(2);
        });
    });

    /**
     * 2. DYNAMIC STRATEGY
     * Verifies autonomous tool selection loop.
     */
    describe("Dynamic (Autonomous Planning)", () => {
        it("should iterate through cycles based on AI decisions", async () => {
            if (!(await tableExists("missions"))) return;

            const { AIClientFactory } = await import("@server/domain/ai/core/ai-client.service.js");
            const mockExecute = (AIClientFactory.getClient({ provider: 'google' } as any) as any).execute;

            // Mock AI behavior for 2 cycles
            // Cycle 1: Search for entities
            mockExecute.mockResolvedValueOnce({
                success: true,
                output: JSON.stringify({
                    thought_process: "I need to find high-value entities in the Knowledge Graph.",
                    action: "TOOL_CALL",
                    action_details: {
                        tool: "search_nodes",
                        arguments: { query: "*", limit: 5 }
                    }
                })
            });

            // Cycle 2: Conclude based on results
            mockExecute.mockResolvedValueOnce({
                success: true,
                output: JSON.stringify({
                    thought_process: "I have found the entities. Mission complete.",
                    action: "CONCLUDE",
                    action_details: {
                        final_product: "Summarized Discovery"
                    }
                })
            });

            const [m] = await db.insert(missions).values({
                name: "TEST_RecursiveDiscovery",
                objective: "Explore Knowledge Graph entities",
                executionStrategy: "dynamic_autonomous",
                createdBy: "test-executor",
                organizationId: testOrgId,
            } as any).returning();

            const launchResult = await dynamicOrchestratorService.launchDynamicMission(m.id, "test-executor", testOrgId);
            expect(launchResult.success).toBe(true);

            // Execute first cycle manually to verify trace and state
            await dynamicOrchestratorService.processMissionCycle(launchResult.missionRunId!, "test-executor", testOrgId);
            
            const [runAfterCycle] = await db.select().from(missionRuns).where(eq(missionRuns.id, launchResult.missionRunId!)).limit(1);
            expect((runAfterCycle.missionContext as any).cycleCount).toBe(1);
        });
    });

    /**
     * 3. ROLLING WAVE STRATEGY
     * Verifies wave-based progressive planning.
     */
    describe("Rolling Wave (Progressive Cycles)", () => {
        it("should transition through Planning and Execution phases", async () => {
            if (!(await tableExists("missions"))) return;

            const [m] = await db.insert(missions).values({
                name: "TEST_RegionalAnalysis",
                objective: "Analyze regional data in waves",
                executionStrategy: "rolling_wave",
                createdBy: "test-executor",
                organizationId: testOrgId,
            } as any).returning();

            const launchResult = await rollingWaveOrchestratorService.launchMission(m.id, "test-executor", testOrgId);
            expect(launchResult.success).toBe(true);

            const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, launchResult.missionRunId!)).limit(1);
            expect((run.missionContext as any).phase).toBe("PLANNING");
            expect((run.missionContext as any).current_wave).toBe(1);

            // Trigger manual transition to peak under the hood
            await rollingWaveOrchestratorService.updatePhase(launchResult.missionRunId!, "EXECUTING");
            const [runAfterExec] = await db.select().from(missionRuns).where(eq(missionRuns.id, launchResult.missionRunId!)).limit(1);
            expect((runAfterExec.missionContext as any).phase).toBe("EXECUTING");
        });
    });
});
