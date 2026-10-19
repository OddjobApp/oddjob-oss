import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { missionService } from "@domain/mission/core/mission.service.js";
import { missionRunService } from "@domain/mission/core/mission-run.service.js";
import { pipelineExecutor } from "@server/core/pipeline-executor.js";
import { db } from "@server/database_service.js";
import { hookRegistry } from "../../../pipeline/hooks/execution-hooks.js";
import { initializeHooks } from "../../../pipeline/hooks/index.js";
import {
    missionRuns, pipelineSteps, pipelineExecutions, pipelineStepExecutions,
    pipelines, jobs, missions, orgs
} from "@shared/schema/index.js";
import { eq, inArray } from "drizzle-orm";
import { beforeAll } from "vitest";

vi.mock("@server/utils/logger.js", () => {
    const mockLogger = {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
        child: vi.fn(() => mockLogger),
        time: vi.fn(() => vi.fn()),
        withTiming: vi.fn((label, op) => op()),
    };
    return {
        logger: mockLogger,
        createLogger: vi.fn(() => mockLogger),
        pipelineLogger: mockLogger,
        jobLogger: mockLogger,
        apiLogger: mockLogger,
        authLogger: mockLogger,
        dbLogger: mockLogger,
        aiLogger: mockLogger,
        schedulerLogger: mockLogger,
        webhookLogger: mockLogger,
        knowledgeLogger: mockLogger,
    };
});

async function waitFor<T>(
    fn: () => Promise<T>,
    predicate: (val: T) => boolean,
    { timeoutMs = 5000, intervalMs = 200 } = {}
): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const val = await fn();
        if (predicate(val)) return val;
        await new Promise(r => setTimeout(r, intervalMs));
    }
    return fn();
}

/**
 * Mission Deliverables Integration Tests
 *
 * PRINCIPLE: surgical data management — never truncate.
 * Each test run uses a unique `createdBy` marker so cleanup is always scoped.
 */
describe("Mission Deliverables Integration", () => {
    let testOrgId: number;
    let testUserId: string;
    let createdJobIds: number[] = [];
    let createdPipelineIds: number[] = [];
    let createdMissionIds: number[] = [];
    let createdRunIds: number[] = [];

    beforeAll(async () => {
        // Job executors are discovered by jobExecutorRegistry.autoRegister(),
        // which runs inside BootstrapService.initialize. Without awaiting that,
        // the registry is empty and every step dies on "Unknown or unsupported
        // job type: static_response" — which is what failed all three tests
        // here, since each of them executes a pipeline.
        const { jobExecutorRegistry } = await import("@domain/jobs/core/executors/index.js");
        await (jobExecutorRegistry as any).autoRegister();

        const [org] = await db.select().from(orgs).limit(1);
        if (org) {
            testOrgId = org.id;
        } else {
            const [newOrg] = await db.insert(orgs).values({
                name: 'Mission Deliverables Org',
                slug: 'mission-deliverables-org'
            } as any).returning();
            testOrgId = newOrg.id;
        }
    });

    beforeEach(() => {
        // Unique marker per test so parallel runs don't collide
        testUserId = `test_user_deliverables_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        createdJobIds = [];
        createdPipelineIds = [];
        createdMissionIds = [];
        createdRunIds = [];
        // Initialize hooks. MissionCheckpointHook is what maps deliverables and closes runs;
        // the event-based MissionReportingService this also initialized listened for
        // pipeline events nothing ever emitted, and has been deleted.
        hookRegistry.hooks = [];
        initializeHooks();
    });

    afterEach(async () => {
        // Surgical cleanup in reverse-FK order — only rows this test created

        // Delete mission runs
        if (createdRunIds.length > 0) {
            await db.delete(missionRuns).where(inArray(missionRuns.id, createdRunIds));
        }

        // Delete pipeline executions created by this test user
        const execRows = await db.select({ id: pipelineExecutions.id })
            .from(pipelineExecutions)
            .where(eq(pipelineExecutions.createdBy, testUserId));
        if (execRows.length > 0) {
            const execIds = execRows.map(r => r.id);
            await db.delete(pipelineStepExecutions).where(inArray(pipelineStepExecutions.pipelineExecutionId, execIds));
            await db.delete(pipelineExecutions).where(inArray(pipelineExecutions.id, execIds));
        }

        // Delete pipeline steps, then pipelines
        if (createdPipelineIds.length > 0) {
            await db.delete(pipelineSteps).where(inArray(pipelineSteps.pipelineId, createdPipelineIds));
            await db.delete(pipelines).where(inArray(pipelines.id, createdPipelineIds));
        }

        // Delete jobs
        if (createdJobIds.length > 0) {
            await db.delete(jobs).where(inArray(jobs.id, createdJobIds));
        }

        // Delete missions
        if (createdMissionIds.length > 0) {
            await db.delete(missions).where(inArray(missions.id, createdMissionIds));
        }
    });

    async function createTestJob(name: string, content: string) {
        const [job] = await db.insert(jobs).values({
            name,
            type: "static_response",
            config: { content },
            createdBy: testUserId,
            tool: "None",
            lifecycleStatus: "active",
        }).returning();
        createdJobIds.push(job.id);
        return job;
    }

    async function createTestPipeline(name: string, jobId: number, outputName: string) {
        const [pipeline] = await db.insert(pipelines).values({
            name,
            organizationId: testOrgId,
            triggerType: "manual",
            createdBy: testUserId,
            lifecycleStatus: "active",
        }).returning();
        await db.insert(pipelineSteps).values({
            pipelineId: pipeline.id,
            jobId,
            order: 1,
            outputName,
        });
        createdPipelineIds.push(pipeline.id);
        return pipeline;
    }

    it("should map 'final_product' to missionContext.result by default", async () => {
        const job = await createTestJob("Test Job - final_product", "deliverable content");
        const pipeline = await createTestPipeline("Test Pipeline - final_product", job.id, "final_product");

        const mission = await missionService.createMission({
            name: "Test Mission - deliverables",
            objective: "Test mission - deliverables",
            organizationId: testOrgId,
            status: "active",
        }, testUserId);
        createdMissionIds.push(mission.id);

        const run = await missionRunService.create({
            missionId: mission.id,
            organizationId: testOrgId as any,
            name: "Test Run",
            pipelineSequence: [pipeline.id],
            createdBy: testUserId,
            currentPipelineId: pipeline.id,
        });
        createdRunIds.push(run.id);
        await missionRunService.update(run.id, { status: "active" });

        const result = await pipelineExecutor.executePipeline(
            pipeline.id, testUserId, undefined, null,
            { named: {}, positional: {} } as any,
            undefined, undefined, mission.id, run.id
        );

        expect(result.success).toBe(true);

        const updatedRun = await waitFor(
            () => missionRunService.getById(run.id),
            (r) => !!(r?.missionContext as any)?.result,
            { timeoutMs: 5000 }
        );
        expect(updatedRun?.missionContext).toBeDefined();
        expect((updatedRun?.missionContext as any)?.result).toBeDefined();
    });

    it("should map custom deliverable name via [Target Product: name]", async () => {
        const objective = "Do something [Target Product: custom_output]";
        const mission = await missionService.createMission({
            name: "Test Mission - custom deliverable",
            objective,
            organizationId: testOrgId,
            status: "active",
        }, testUserId);
        createdMissionIds.push(mission.id);

        // Sync deliverables from objective to blackboard
        await missionService.syncDeliverablesToBlackboard(mission.id, objective, testUserId);

        const updatedMission = await missionService.getMissionDetail(mission.id);
        expect((updatedMission?.blackboard as any)?.expected_deliverables).toContain("custom_output");

        const job = await createTestJob("Custom Job - custom_output", "custom content");
        const pipeline = await createTestPipeline("Custom Pipeline - custom_output", job.id, "custom_output");

        const run = await missionRunService.create({
            missionId: mission.id,
            organizationId: testOrgId as any,
            name: "Custom Run",
            pipelineSequence: [pipeline.id],
            createdBy: testUserId,
            currentPipelineId: pipeline.id,
        });
        createdRunIds.push(run.id);
        await missionRunService.update(run.id, { status: "active" });

        await pipelineExecutor.executePipeline(
            pipeline.id, testUserId, undefined, null,
            { named: {}, positional: {} } as any,
            undefined, undefined, mission.id, run.id
        );

        const updatedRun = await waitFor(
            () => missionRunService.getById(run.id),
            (r) => !!(r as any)?.missionContext?.result,
            { timeoutMs: 5000 }
        );
        expect((updatedRun as any)?.missionContext?.result).toBeDefined();
    });

    it("should not mark mission completed if pipeline sequence has more steps", async () => {
        const jobA = await createTestJob("Job A - sequence", "output a");
        const pipelineA = await createTestPipeline("Pipeline A - sequence", jobA.id, "final_product");

        const jobB = await createTestJob("Job B - sequence", "output b");
        const pipelineB = await createTestPipeline("Pipeline B - sequence", jobB.id, "final_product");

        const mission = await missionService.createMission({
            name: "Test Mission - sequence",
            objective: "Test mission - sequence",
            organizationId: testOrgId,
            status: "active",
        }, testUserId);
        createdMissionIds.push(mission.id);

        const run = await missionRunService.create({
            missionId: mission.id,
            organizationId: testOrgId as any,
            name: "Sequence Run",
            pipelineSequence: [pipelineA.id, pipelineB.id],
            createdBy: testUserId,
            currentPipelineId: pipelineA.id,
        });
        createdRunIds.push(run.id);
        await missionRunService.update(run.id, { status: "active" });

        await pipelineExecutor.executePipeline(
            pipelineA.id, testUserId, undefined, null,
            { named: {}, positional: {} } as any,
            undefined, undefined, mission.id, run.id
        );

        const midRun = await missionRunService.getById(run.id);
        expect(midRun?.status).toBe("active");

        await pipelineExecutor.executePipeline(
            pipelineB.id, testUserId, undefined, null,
            { named: {}, positional: {} } as any,
            undefined, undefined, mission.id, run.id
        );

        const finalRun = await waitFor(
            () => missionRunService.getById(run.id),
            (r) => (r as any)?.status === "completed",
            { timeoutMs: 5000 }
        );
        expect((finalRun as any)?.status).toBe("completed");
    });
});
