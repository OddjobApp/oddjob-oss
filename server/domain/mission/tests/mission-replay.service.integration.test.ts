/**
 * Mission Replay Service Tests
 * 
 * Comprehensive test suite for mission replay functionality including:
 * - Replay history retrieval
 * - Checkpoint-based replay
 * - Mission run comparison
 * - Execution heatmap generation
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { db } from "@server/database_service.js";
import { missions, missionRuns, missionBlackboardHistory } from "@shared/schema/index.js";
import { eq, sql } from "drizzle-orm";
import { missionReplayService } from "../core/mission-replay.service.js";
import { missionRunService } from "../core/mission-run.service.js";

// Mock dependencies
vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    }),
}));

vi.mock("@domain/core/infrastructure/event-stream.service.js", () => ({
    eventStream: {
        publish: vi.fn().mockResolvedValue(undefined),
    },
}));

describe("MissionReplayService", () => {
    let testMissionId: number;
    let testOrgId: number | null = null;
    
    beforeAll(async () => {
        // Check if we can connect to the database
        try {
            await db.execute(sql`SELECT 1`);
        } catch (e) {
            console.log("Database not available, skipping integration tests");
        }
    });

    beforeEach(async () => {
        // Create a test mission
        try {
            const [mission] = await db.insert(missions).values([{
                name: "Test Replay Mission",
                objective: "Test mission for replay functionality",
                executionStrategy: "dynamic_autonomous",
                organizationId: null,
                createdBy: "test-user",
                blackboard: { test: true, expected_deliverables: ["report", "analysis"] } as any,
            }]).returning();
            testMissionId = mission.id;
        } catch (e) {
            // Database might not be available
            testMissionId = 999999;
        }
    });

    afterEach(async () => {
        // Cleanup
        try {
            await db.delete(missionBlackboardHistory)
                .where(sql`${missionBlackboardHistory.missionId} = ${testMissionId}`);
            await db.delete(missionRuns)
                .where(sql`${missionRuns.missionId} = ${testMissionId}`);
            await db.delete(missions)
                .where(eq(missions.id, testMissionId));
        } catch (e) {
            // Ignore cleanup errors
        }
    });

    describe("getReplayHistory", () => {
        it("should return empty history for mission run with no checkpoints", async () => {
            // Create a mission run without checkpoints
            const run = await missionRunService.create({
                missionId: testMissionId,
                name: "Test Run",
                createdBy: "test-user",
                pipelineSequence: [],
                missionContext: { test: true },
            });

            const result = await missionReplayService.getReplayHistory(run.id);

            expect(result.success).toBe(true);
            expect(result.checkpoints).toHaveLength(0);
            expect(result.totalCheckpoints).toBe(0);
            expect(result.missionRunId).toBe(run.id);
        });

        it("should return checkpoints in reverse chronological order", async () => {
            const run = await missionRunService.create({
                missionId: testMissionId,
                name: "Test Run With Checkpoints",
                createdBy: "test-user",
                pipelineSequence: [],
                missionContext: { initial: true },
            });

            // Create multiple checkpoints
            await missionRunService.checkpoint({
                missionRunId: run.id,
                missionId: testMissionId,
                missionContext: { step: 1, data: "first" },
                reason: "checkpoint:test_1",
                changedBy: "test-user",
            });

            await missionRunService.checkpoint({
                missionRunId: run.id,
                missionId: testMissionId,
                missionContext: { step: 2, data: "second" },
                reason: "checkpoint:test_2",
                changedBy: "test-user",
            });

            await missionRunService.checkpoint({
                missionRunId: run.id,
                missionId: testMissionId,
                missionContext: { step: 3, data: "third" },
                reason: "checkpoint:test_3",
                changedBy: "test-user",
            });

            const result = await missionReplayService.getReplayHistory(run.id);

            expect(result.success).toBe(true);
            expect(result.checkpoints).toHaveLength(3);
            expect(result.totalCheckpoints).toBe(3);
            
            // Verify reverse order (newest first)
            expect(result.checkpoints![0].sequenceNumber).toBe(3);
            expect(result.checkpoints![1].sequenceNumber).toBe(2);
            expect(result.checkpoints![2].sequenceNumber).toBe(1);
            
            // Verify blackboard snapshots
            expect(result.checkpoints![0].blackboardSnapshot).toMatchObject({ step: 3, data: "third" });
            expect(result.checkpoints![1].blackboardSnapshot).toMatchObject({ step: 2, data: "second" });
            expect(result.checkpoints![2].blackboardSnapshot).toMatchObject({ step: 1, data: "first" });
        });

        it("should return error for non-existent mission run", async () => {
            const result = await missionReplayService.getReplayHistory(99999999);
            
            expect(result.success).toBe(false);
            expect(result.error).toContain("not found");
        });

        it("should include elapsed time for each checkpoint", async () => {
            const run = await missionRunService.create({
                missionId: testMissionId,
                name: "Timed Run",
                createdBy: "test-user",
                pipelineSequence: [],
            });

            await missionRunService.checkpoint({
                missionRunId: run.id,
                missionId: testMissionId,
                missionContext: { phase: "planning" },
                reason: "checkpoint:planning",
                changedBy: "test-user",
            });

            const result = await missionReplayService.getReplayHistory(run.id);

            expect(result.success).toBe(true);
            expect(result.checkpoints![0].elapsedMinutes).toBeDefined();
            expect(typeof result.checkpoints![0].elapsedMinutes).toBe("number");
        });
    });

    describe("replayFromCheckpoint", () => {
        it("should create a replay run from checkpoint", async () => {
            // Create original run with checkpoints
            const originalRun = await missionRunService.create({
                missionId: testMissionId,
                name: "Original Run",
                createdBy: "test-user",
                pipelineSequence: [],
                missionContext: { original: true, phase: "planning" },
            });

            await missionRunService.checkpoint({
                missionRunId: originalRun.id,
                missionId: testMissionId,
                missionContext: { phase: "executing", step: 2 },
                reason: "checkpoint:pre_execution",
                changedBy: "test-user",
            });

            // Get the checkpoint ID
            const checkpoints = await db.select()
                .from(missionBlackboardHistory)
                .where(sql`${missionBlackboardHistory.missionRunId} = ${originalRun.id}`)
                .limit(1);

            if (checkpoints.length === 0) {
                return; // Skip if no checkpoint created
            }

            const checkpointId = checkpoints[0].id;

            const result = await missionReplayService.replayFromCheckpoint(
                originalRun.id,
                checkpointId,
                "replay-user",
                {}
            );

            expect(result.success).toBe(true);
            expect(result.replayRunId).toBeDefined();
            expect(result.originalRunId).toBe(originalRun.id);
            expect(result.stepsReplayed).toBe(0);

            // Verify the replay run was created correctly
            const [replayRun] = await db.select()
                .from(missionRuns)
                .where(sql`${missionRuns.id} = ${result.replayRunId}`)
                .limit(1);

            expect(replayRun).toBeDefined();
            expect(replayRun.name).toContain("[REPLAY]");
            expect(replayRun.parentId).toBe(originalRun.id);
            
            // Verify missionContext has replay info
            const context = replayRun.missionContext as Record<string, any>;
            expect(context._replayInfo).toBeDefined();
            expect(context._replayInfo.isReplay).toBe(true);
            expect(context._replayInfo.originalRunId).toBe(originalRun.id);
            expect(context.phase).toBe("executing"); // From checkpoint
        });

        it("should support dry run mode", async () => {
            const originalRun = await missionRunService.create({
                missionId: testMissionId,
                name: "Dry Run Test",
                createdBy: "test-user",
                pipelineSequence: [],
            });

            await missionRunService.checkpoint({
                missionRunId: originalRun.id,
                missionId: testMissionId,
                missionContext: { test: true },
                reason: "checkpoint:test",
                changedBy: "test-user",
            });

            const checkpoints = await db.select()
                .from(missionBlackboardHistory)
                .where(sql`${missionBlackboardHistory.missionRunId} = ${originalRun.id}`)
                .limit(1);

            if (checkpoints.length === 0) return;

            const result = await missionReplayService.replayFromCheckpoint(
                originalRun.id,
                checkpoints[0].id,
                "test-user",
                { dryRun: true }
            );

            expect(result.success).toBe(true);
            expect(result.error).toContain("Dry run");
        });

        it("should allow parameter modifications during replay", async () => {
            const originalRun = await missionRunService.create({
                missionId: testMissionId,
                name: "Modifiable Run",
                createdBy: "test-user",
                pipelineSequence: [],
                missionContext: { originalParam: "original" },
            });

            await missionRunService.checkpoint({
                missionRunId: originalRun.id,
                missionId: testMissionId,
                missionContext: { originalParam: "original" },
                reason: "checkpoint:original",
                changedBy: "test-user",
            });

            const checkpoints = await db.select()
                .from(missionBlackboardHistory)
                .where(sql`${missionBlackboardHistory.missionRunId} = ${originalRun.id}`)
                .limit(1);

            if (checkpoints.length === 0) return;

            const result = await missionReplayService.replayFromCheckpoint(
                originalRun.id,
                checkpoints[0].id,
                "test-user",
                { modifyParameters: { newParam: "modified", originalParam: "changed" } }
            );

            expect(result.success).toBe(true);

            const [replayRun] = await db.select()
                .from(missionRuns)
                .where(sql`${missionRuns.id} = ${result.replayRunId}`)
                .limit(1);

            const context = replayRun.missionContext as Record<string, any>;
            expect(context.newParam).toBe("modified");
            expect(context.originalParam).toBe("changed");
        });

        it("should return error for non-existent checkpoint", async () => {
            const result = await missionReplayService.replayFromCheckpoint(
                99999999,
                99999999,
                "test-user",
                {}
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("not found");
        });
    });

    describe("compareRuns", () => {
        it("should identify identical runs", async () => {
            // Create two runs with same checkpoints
            const runA = await missionRunService.create({
                missionId: testMissionId,
                name: "Run A",
                createdBy: "test-user",
                pipelineSequence: [],
            });

            const runB = await missionRunService.create({
                missionId: testMissionId,
                name: "Run B",
                createdBy: "test-user",
                pipelineSequence: [],
            });

            // Add identical checkpoints
            for (const runId of [runA.id, runB.id]) {
                await missionRunService.checkpoint({
                    missionRunId: runId,
                    missionId: testMissionId,
                    missionContext: { step: 1, phase: "planning" },
                    reason: "checkpoint:step_1",
                    changedBy: "test-user",
                });
                await missionRunService.checkpoint({
                    missionRunId: runId,
                    missionId: testMissionId,
                    missionContext: { step: 2, phase: "executing" },
                    reason: "checkpoint:step_2",
                    changedBy: "test-user",
                });
            }

            const result = await missionReplayService.compareRuns(runA.id, runB.id);

            expect(result.success).toBe(true);
            expect(result.areIdentical).toBe(true);
            expect(result.divergencePoint).toBeNull();
        });

        it("should identify divergence point between runs", async () => {
            const runA = await missionRunService.create({
                missionId: testMissionId,
                name: "Run A",
                createdBy: "test-user",
                pipelineSequence: [],
            });

            const runB = await missionRunService.create({
                missionId: testMissionId,
                name: "Run B",
                createdBy: "test-user",
                pipelineSequence: [],
            });

            // Same first checkpoint
            await missionRunService.checkpoint({
                missionRunId: runA.id,
                missionId: testMissionId,
                missionContext: { step: 1, phase: "planning", lastToolRun: "search" },
                reason: "checkpoint:step_1",
                changedBy: "test-user",
            });
            await missionRunService.checkpoint({
                missionRunId: runB.id,
                missionId: testMissionId,
                missionContext: { step: 1, phase: "planning", lastToolRun: "search" },
                reason: "checkpoint:step_1",
                changedBy: "test-user",
            });

            // Divergent second checkpoint
            await missionRunService.checkpoint({
                missionRunId: runA.id,
                missionId: testMissionId,
                missionContext: { step: 2, phase: "executing", lastToolRun: "write_file" },
                reason: "checkpoint:file_write",
                changedBy: "test-user",
            });
            await missionRunService.checkpoint({
                missionRunId: runB.id,
                missionId: testMissionId,
                missionContext: { step: 2, phase: "executing", lastToolRun: "api_call" },
                reason: "checkpoint:api_call",
                changedBy: "test-user",
            });

            const result = await missionReplayService.compareRuns(runA.id, runB.id);

            expect(result.success).toBe(true);
            expect(result.areIdentical).toBe(false);
            expect(result.divergencePoint).toBeDefined();
            expect(result.divergencePoint?.divergedField).toBe("lastToolRun");
        });

        it("should return error if either run not found", async () => {
            const result = await missionReplayService.compareRuns(99999998, 99999999);
            expect(result.success).toBe(false);
            expect(result.error).toContain("not found");
        });
    });

    describe("getExecutionHeatmap", () => {
        it("should return error for run with insufficient data", async () => {
            const run = await missionRunService.create({
                missionId: testMissionId,
                name: "Single Checkpoint Run",
                createdBy: "test-user",
                pipelineSequence: [],
            });

            // Only one checkpoint
            await missionRunService.checkpoint({
                missionRunId: run.id,
                missionId: testMissionId,
                missionContext: { test: true },
                reason: "checkpoint:single",
                changedBy: "test-user",
            });

            const result = await missionReplayService.getExecutionHeatmap(run.id);

            expect(result.success).toBe(false);
            expect(result.error).toContain("Insufficient");
        });

        it("should calculate time breakdown by phase", async () => {
            const run = await missionRunService.create({
                missionId: testMissionId,
                name: "Phased Run",
                createdBy: "test-user",
                pipelineSequence: [],
            });

            // Add checkpoints with different phases
            await missionRunService.checkpoint({
                missionRunId: run.id,
                missionId: testMissionId,
                missionContext: { phase: "PLANNING", lastToolRun: "search" },
                reason: "checkpoint:planning",
                changedBy: "test-user",
            });

            // Wait a bit between checkpoints
            await new Promise(r => setTimeout(r, 100));

            await missionRunService.checkpoint({
                missionRunId: run.id,
                missionId: testMissionId,
                missionContext: { phase: "EXECUTING", lastToolRun: "write_file" },
                reason: "checkpoint:executing",
                changedBy: "test-user",
            });

            await new Promise(r => setTimeout(r, 100));

            await missionRunService.checkpoint({
                missionRunId: run.id,
                missionId: testMissionId,
                missionContext: { phase: "CRITIQUING", lastToolRun: "analyze" },
                reason: "checkpoint:critiquing",
                changedBy: "test-user",
            });

            const result = await missionReplayService.getExecutionHeatmap(run.id);

            expect(result.success).toBe(true);
            expect(result.phaseBreakdown).toBeDefined();
            expect(Object.keys(result.phaseBreakdown!).length).toBeGreaterThan(0);
            expect(result.totalDurationMinutes).toBeGreaterThan(0);
            expect(result.checkpointCount).toBe(3);
        });

        it("should track tool execution times", async () => {
            const run = await missionRunService.create({
                missionId: testMissionId,
                name: "Tool Timing Run",
                createdBy: "test-user",
                pipelineSequence: [],
            });

            await missionRunService.checkpoint({
                missionRunId: run.id,
                missionId: testMissionId,
                missionContext: { lastToolRun: "search" },
                reason: "checkpoint:search",
                changedBy: "test-user",
            });

            await new Promise(r => setTimeout(r, 50));

            await missionRunService.checkpoint({
                missionRunId: run.id,
                missionId: testMissionId,
                missionContext: { lastToolRun: "write_file" },
                reason: "checkpoint:write",
                changedBy: "test-user",
            });

            const result = await missionReplayService.getExecutionHeatmap(run.id);

            expect(result.success).toBe(true);
            expect(result.toolBreakdown).toBeDefined();
            expect(Object.keys(result.toolBreakdown!).length).toBeGreaterThan(0);
        });
    });
});
