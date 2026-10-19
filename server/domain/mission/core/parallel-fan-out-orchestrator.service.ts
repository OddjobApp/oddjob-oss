/**
 * Parallel Fan-Out Orchestrator Service
 * 
 * Execution strategy: "parallel_fan_out"
 * 
 * Leverages the mission dependency graph (mission-dependencies.service.ts) to
 * execute N child missions in parallel and merge results on completion.
 * 
 * Flow:
 *   1. Read the mission's dependency graph from blackboard.dependencyGraph
 *   2. Identify root nodes (no dependencies) — launch them all in parallel
 *   3. As each child completes, check if downstream dependents are unblocked
 *   4. When all fan_in/all_of gates are satisfied, launch the next wave
 *   5. When the final mission completes, merge all results into the parent blackboard
 * 
 * Each child mission runs as its own dynamic_autonomous (or pre_planned) run.
 * The parent mission stays "active" and polls child statuses via the queue.
 * 
 * Dependency graph format in blackboard:
 *   dependencyGraph: [
 *     { missionId: 10, dependsOn: [], type: "fan_out" },     // root — launches immediately
 *     { missionId: 11, dependsOn: [], type: "fan_out" },     // root — launches immediately
 *     { missionId: 12, dependsOn: [10, 11], type: "fan_in" } // waits for both 10 & 11
 *   ]
 */

import { db } from "@server/database_service.js";
import { missions, missionRuns } from "@shared/schema/index.js";
import { eq, inArray } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { queueMissionCycle } from "../infrastructure/dynamic-mission-queue.js";

const logger = createLogger("ParallelFanOutOrchestrator");

const POLL_INTERVAL_MS = 5000;

interface DependencyNode {
    missionId: number;
    dependsOn: number[];
    type: 'fan_out' | 'fan_in' | 'all_of' | 'any_of' | 'sequential';
    condition?: 'completed' | 'succeeded' | 'failed' | 'any';
}

export const parallelFanOutOrchestratorService = {

    async launchMission(missionId: number, userId: string, orgId: number | null, parentId?: number) {
        const [mission] = await db.select().from(missions).where(eq(missions.id, missionId)).limit(1);
        if (!mission) throw new Error("Mission not found");

        const { missionRunService } = await import("./mission-run.service.js");

        const blackboard = (mission.blackboard as Record<string, any>) || {};
        const dependencyGraph: DependencyNode[] = blackboard.dependencyGraph || [];

        if (dependencyGraph.length === 0) {
            return { success: false, error: "parallel_fan_out requires blackboard.dependencyGraph to be defined with child mission IDs" };
        }

        // Validate all referenced missions exist
        const childMissionIds = dependencyGraph.map(n => n.missionId);
        const existingMissions = await db.select({ id: missions.id })
            .from(missions)
            .where(inArray(missions.id, childMissionIds));
        const existingIds = new Set(existingMissions.map(m => m.id));
        const missing = childMissionIds.filter(id => !existingIds.has(id));
        if (missing.length > 0) {
            return { success: false, error: `Dependency graph references non-existent missions: ${missing.join(", ")}` };
        }

        // Create the parent orchestrator run
        const run = await missionRunService.create({
            missionId,
            organizationId: orgId ?? undefined,
            name: `Fan-Out: ${mission.name}`,
            createdBy: userId,
            pipelineSequence: [],
            parentId
        });

        const initialContext: Record<string, any> = {
            ...blackboard,
            intent: mission.objective,
            executionStrategy: 'parallel_fan_out',
            launchedByUserId: userId,
            dependencyGraph,
            childRunMap: {},       // missionId → { runId, status }
            launchedChildren: [],  // missionIds already launched
            completedChildren: [], // missionIds completed
            phase: 'LAUNCHING'
        };

        await db.update(missionRuns)
            .set({ missionContext: initialContext })
            .where(eq(missionRuns.id, run.id));

        // Queue the first orchestration cycle
        await queueMissionCycle({ missionRunId: run.id, userId, orgId }, 0);
        logger.info(`[FanOut] Launched fan-out orchestrator run ${run.id} for mission ${missionId} with ${dependencyGraph.length} nodes`);

        return { success: true, missionRunId: run.id, missionId };
    },

    /**
     * Process a single orchestration cycle for the fan-out mission.
     * Called by the DynamicMissionWorker (shares the same queue).
     * 
     * This is NOT an AI reasoning loop — it's a deterministic graph executor.
     */
    async processFanOutCycle(missionRunId: number, userId: string, orgId: number | null) {
        const { missionRunService } = await import("./mission-run.service.js");
        const { missionExecutionService } = await import("./mission-execution.service.js");
        const { missionService } = await import("./mission.service.js");

        const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, missionRunId)).limit(1);
        if (!run || run.status !== "active") return;

        const context = (run.missionContext as Record<string, any>) || {};
        const graph: DependencyNode[] = context.dependencyGraph || [];
        const childRunMap: Record<number, { runId: number; status: string }> = context.childRunMap || {};
        const launchedChildren: number[] = context.launchedChildren || [];
        const completedChildren: number[] = context.completedChildren || [];

        // --- PHASE 1: Identify launchable children ---
        const launchable: DependencyNode[] = [];
        for (const node of graph) {
            if (launchedChildren.includes(node.missionId)) continue;

            const depsSatisfied = node.dependsOn.every(depId => {
                const depStatus = childRunMap[depId]?.status;
                const condition = node.condition || 'completed';
                if (condition === 'any') return !!depStatus && depStatus !== 'active';
                if (condition === 'succeeded' || condition === 'completed') return depStatus === 'completed';
                if (condition === 'failed') return depStatus === 'failed';
                return depStatus === 'completed';
            });

            if (node.dependsOn.length === 0 || depsSatisfied) {
                launchable.push(node);
            }
        }

        // --- PHASE 2: Launch ready children ---
        for (const node of launchable) {
            try {
                const result = await missionExecutionService.launchMission(node.missionId, userId, orgId, undefined, missionRunId);
                if (result.success && result.missionRunId) {
                    childRunMap[node.missionId] = { runId: result.missionRunId, status: "active" };
                    launchedChildren.push(node.missionId);
                    logger.info(`[FanOut] Launched child mission ${node.missionId} (run ${result.missionRunId})`);
                } else {
                    childRunMap[node.missionId] = { runId: 0, status: "failed" };
                    launchedChildren.push(node.missionId);
                    completedChildren.push(node.missionId);
                    logger.error(`[FanOut] Failed to launch child mission ${node.missionId}: ${result.error}`);
                }
            } catch (err: any) {
                childRunMap[node.missionId] = { runId: 0, status: "failed" };
                launchedChildren.push(node.missionId);
                completedChildren.push(node.missionId);
                logger.error(`[FanOut] Error launching child ${node.missionId}: ${err.message}`);
            }
        }

        // --- PHASE 3: Poll active children for completion ---
        const activeChildIds = Object.entries(childRunMap)
            .filter(([_, v]) => v.status === "active" && v.runId > 0)
            .map(([k, v]) => v.runId);

        if (activeChildIds.length > 0) {
            const activeRuns = await db.select({ id: missionRuns.id, status: missionRuns.status, missionId: missionRuns.missionId, missionContext: missionRuns.missionContext })
                .from(missionRuns)
                .where(inArray(missionRuns.id, activeChildIds));

            for (const childRun of activeRuns) {
                const childMissionId = childRun.missionId!;
                if (childRun.status === "completed" || childRun.status === "failed") {
                    childRunMap[childMissionId] = { runId: childRun.id, status: childRun.status };
                    if (!completedChildren.includes(childMissionId)) {
                        completedChildren.push(childMissionId);
                    }

                    // Merge child result into parent blackboard
                    const childResult = (childRun.missionContext as any)?.result || `Child ${childMissionId} ${childRun.status}`;
                    if (run.missionId) {
                        await missionService.updateBlackboard(run.missionId, {
                            [`child_result_${childMissionId}`]: childResult,
                            [`child_status_${childMissionId}`]: childRun.status
                        }, "agent:fan_out", `child_${childRun.status}`);
                    }
                    logger.info(`[FanOut] Child ${childMissionId} (run ${childRun.id}) ${childRun.status}`);
                }
            }
        }

        // --- PHASE 4: Check if all done ---
        const allChildMissionIds = graph.map(n => n.missionId);
        const allDone = allChildMissionIds.every(id => completedChildren.includes(id));

        // Save updated context
        await missionRunService.update(missionRunId, {
            missionContext: {
                ...context,
                childRunMap,
                launchedChildren,
                completedChildren,
                phase: allDone ? 'COMPLETED' : 'RUNNING'
            }
        });

        if (allDone) {
            // All children finished — complete the parent
            const allSucceeded = allChildMissionIds.every(id => childRunMap[id]?.status === 'completed');
            await missionRunService.update(missionRunId, {
                status: allSucceeded ? "completed" : "failed",
                missionContext: {
                    ...context,
                    childRunMap,
                    launchedChildren,
                    completedChildren,
                    phase: 'COMPLETED',
                    result: allSucceeded
                        ? `All ${allChildMissionIds.length} child missions completed successfully.`
                        : `Fan-out completed with failures. ${completedChildren.filter(id => childRunMap[id]?.status === 'failed').length} failed.`
                }
            });
            logger.info(`[FanOut] All children done for run ${missionRunId}. Status: ${allSucceeded ? 'completed' : 'failed'}`);
        } else {
            // Still waiting — re-queue poll cycle
            await queueMissionCycle({ missionRunId, userId, orgId }, POLL_INTERVAL_MS);
        }
    }
};
