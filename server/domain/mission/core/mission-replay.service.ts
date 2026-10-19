/**
 * Mission Replay Service
 * 
 * Enables replaying mission execution from checkpoints for debugging,
 * recovery, and deterministic re-execution scenarios.
 */

import { db } from "@server/database_service.js";
import { missionRuns, missionBlackboardHistory, missions } from "@shared/schema/index.js";
import { eq, and, desc, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { missionRunService } from "./mission-run.service.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";

const logger = createLogger("MissionReplay");

export interface ReplayOptions {
    fromCheckpointId?: number;
    modifyParameters?: Record<string, any>;
    stopBeforeTools?: string[]; // Stop replay before executing these tools
    dryRun?: boolean; // If true, don't actually execute, just simulate
}

export interface ReplayResult {
    success: boolean;
    replayRunId?: number;
    originalRunId: number;
    stepsReplayed: number;
    error?: string;
    divergedAtStep?: number;
    divergedReason?: string;
}

export const missionReplayService = {
    /**
     * Get replay history for a mission run - all checkpoints with context snapshots
     */
    async getReplayHistory(missionRunId: number) {
        try {
            const [run] = await db.select()
                .from(missionRuns)
                .where(eq(missionRuns.id, missionRunId))
                .limit(1);

            if (!run) {
                return { success: false, error: "Mission run not found" };
            }

            // Get checkpoint history
            const history = await db.select()
                .from(missionBlackboardHistory)
                .where(eq(missionBlackboardHistory.missionRunId, missionRunId))
                .orderBy(desc(missionBlackboardHistory.createdAt));

            // Get associated mission details
            const [mission] = await db.select()
                .from(missions)
                .where(eq(missions.id, run.missionId!))
                .limit(1);

            return {
                success: true,
                missionRunId,
                missionId: run.missionId,
                missionName: mission?.name,
                originalStatus: run.status,
                checkpoints: history.map((h, index) => ({
                    checkpointId: h.id,
                    sequenceNumber: history.length - index,
                    timestamp: h.createdAt,
                    changedBy: h.changedBy,
                    changeReason: h.changeReason,
                    blackboardSnapshot: h.blackboard,
                    elapsedMinutes: run.createdAt 
                        ? Math.round((new Date(h.createdAt!).getTime() - new Date(run.createdAt).getTime()) / (1000 * 60))
                        : null
                })),
                totalCheckpoints: history.length
            };
        } catch (err: any) {
            logger.error(`[Replay] Error getting history for run ${missionRunId}: ${err.message}`);
            return { success: false, error: err.message };
        }
    },

    /**
     * Replay a mission run from a specific checkpoint
     */
    async replayFromCheckpoint(
        originalRunId: number,
        checkpointId: number,
        userId: string,
        options: ReplayOptions = {}
    ): Promise<ReplayResult> {
        try {
            logger.info(`[Replay] Starting replay of run ${originalRunId} from checkpoint ${checkpointId}`);

            // Get the checkpoint data
            const [checkpoint] = await db.select()
                .from(missionBlackboardHistory)
                .where(and(
                    eq(missionBlackboardHistory.id, checkpointId),
                    eq(missionBlackboardHistory.missionRunId, originalRunId)
                ))
                .limit(1);

            if (!checkpoint) {
                return {
                    success: false,
                    originalRunId,
                    stepsReplayed: 0,
                    error: `Checkpoint ${checkpointId} not found for mission run ${originalRunId}`
                };
            }

            // Get original run details
            const [originalRun] = await db.select()
                .from(missionRuns)
                .where(eq(missionRuns.id, originalRunId))
                .limit(1);

            if (!originalRun) {
                return {
                    success: false,
                    originalRunId,
                    stepsReplayed: 0,
                    error: `Original mission run ${originalRunId} not found`
                };
            }

            // Create replay run
            const replayRun = await missionRunService.create({
                missionId: originalRun.missionId!,
                organizationId: originalRun.organizationId ?? undefined,
                name: `[REPLAY] ${originalRun.name}`,
                createdBy: userId,
                pipelineSequence: originalRun.pipelineSequence as number[] || [],
                parentId: originalRunId, // Link to parent
                missionContext: {
                    ...(checkpoint.blackboard as Record<string, any> || {}),
                    ...(options.modifyParameters || {}),
                    _replayInfo: {
                        isReplay: true,
                        originalRunId,
                        checkpointId,
                        replayStartedAt: new Date().toISOString(),
                        dryRun: options.dryRun || false,
                        // stopBeforeTools feeds into call-tool-handler.ts debug pause logic
                        stopBeforeTools: options.stopBeforeTools || [],
                    }
                }
            });

            logger.info(`[Replay] Created replay run ${replayRun.id} from checkpoint ${checkpointId}`);

            // Emit replay event
            await eventStream.publish('mission.replay_started', {
                originalRunId,
                replayRunId: replayRun.id,
                checkpointId,
                userId,
                dryRun: options.dryRun || false
            }, {
                organizationId: originalRun.organizationId ?? undefined,
                subject: `mission-run:${replayRun.id}`,
            }, 'mission-replay');

            return {
                success: true,
                replayRunId: replayRun.id,
                originalRunId,
                stepsReplayed: 0, // Will be updated as replay progresses
                error: options.dryRun ? "Dry run - execution not started" : undefined
            };

        } catch (err: any) {
            logger.error(`[Replay] Error starting replay: ${err.message}`);
            return {
                success: false,
                originalRunId,
                stepsReplayed: 0,
                error: err.message
            };
        }
    },

    /**
     * Compare two mission runs to identify divergence points.
     * Uses both checkpoint blackboard state AND action runtime diffs from dynamicTrace.
     */
    async compareRuns(runIdA: number, runIdB: number) {
        try {
            const [runA] = await db.select()
                .from(missionRuns)
                .where(eq(missionRuns.id, runIdA))
                .limit(1);

            const [runB] = await db.select()
                .from(missionRuns)
                .where(eq(missionRuns.id, runIdB))
                .limit(1);

            if (!runA || !runB) {
                return { success: false, error: "One or both mission runs not found" };
            }

            // Compare via action runtime records in dynamicTrace (cycle-by-cycle)
            const traceA = (Array.isArray(runA.dynamicTrace) ? runA.dynamicTrace : []) as Array<Record<string, any>>;
            const traceB = (Array.isArray(runB.dynamicTrace) ? runB.dynamicTrace : []) as Array<Record<string, any>>;

            const actionsA = traceA.filter(e => e.type === "action_execution" || e.actionId);
            const actionsB = traceB.filter(e => e.type === "action_execution" || e.actionId);

            let runtimeDivergence: any = null;
            const minActions = Math.min(actionsA.length, actionsB.length);
            for (let i = 0; i < minActions; i++) {
                const a = actionsA[i];
                const b = actionsB[i];
                if (a.action !== b.action || a.toolName !== b.toolName || a.status !== b.status) {
                    runtimeDivergence = {
                        cycle: Math.min(a.cycle ?? i, b.cycle ?? i),
                        stepIndex: i,
                        actionA: { action: a.action, toolName: a.toolName, status: a.status, cycle: a.cycle },
                        actionB: { action: b.action, toolName: b.toolName, status: b.status, cycle: b.cycle },
                        diffA: a.diff,
                        diffB: b.diff,
                    };
                    break;
                }
            }

            // Fall back to checkpoint-based comparison
            const historyA = await db.select()
                .from(missionBlackboardHistory)
                .where(eq(missionBlackboardHistory.missionRunId, runIdA))
                .orderBy(missionBlackboardHistory.createdAt);

            const historyB = await db.select()
                .from(missionBlackboardHistory)
                .where(eq(missionBlackboardHistory.missionRunId, runIdB))
                .orderBy(missionBlackboardHistory.createdAt);

            let checkpointDivergence: any = null;
            const minLength = Math.min(historyA.length, historyB.length);
            for (let i = 0; i < minLength; i++) {
                const checkpointA = (historyA[i].blackboard as Record<string, any>) || {};
                const checkpointB = (historyB[i].blackboard as Record<string, any>) || {};
                const keysToCompare = ['last_tool_run', 'lastToolRun', 'tool', 'cycleCount', 'phase', 'current_wave'];
                for (const key of keysToCompare) {
                    if (JSON.stringify(checkpointA[key]) !== JSON.stringify(checkpointB[key])) {
                        checkpointDivergence = {
                            stepIndex: i,
                            checkpointA: historyA[i].id,
                            checkpointB: historyB[i].id,
                            divergedField: key,
                            valueA: checkpointA[key],
                            valueB: checkpointB[key],
                            reasonA: historyA[i].changeReason,
                            reasonB: historyB[i].changeReason,
                        };
                        break;
                    }
                }
                if (checkpointDivergence) break;
            }

            const divergencePoint = runtimeDivergence ?? checkpointDivergence;

            return {
                success: true,
                runA: { id: runIdA, status: runA.status, checkpointCount: historyA.length, actionCount: actionsA.length },
                runB: { id: runIdB, status: runB.status, checkpointCount: historyB.length, actionCount: actionsB.length },
                divergencePoint,
                divergenceSource: runtimeDivergence ? "action_trace" : checkpointDivergence ? "blackboard_checkpoint" : null,
                areIdentical: !divergencePoint && historyA.length === historyB.length && actionsA.length === actionsB.length,
                totalStepsA: historyA.length,
                totalStepsB: historyB.length,
            };

        } catch (err: any) {
            logger.error(`[Replay] Error comparing runs: ${err.message}`);
            return { success: false, error: err.message };
        }
    },

    /**
     * Start a replay and immediately return a divergence report comparing
     * the new replay run against the original once it completes.
     * Note: the replay runs asynchronously; callers should poll compareRuns().
     */
    async replayWithDivergenceReport(
        originalRunId: number,
        checkpointId: number,
        userId: string,
        options: ReplayOptions = {},
    ) {
        const replayResult = await this.replayFromCheckpoint(originalRunId, checkpointId, userId, options);
        if (!replayResult.success || !replayResult.replayRunId) {
            return replayResult;
        }

        logger.info(`[Replay] Replay run ${replayResult.replayRunId} started — divergence can be checked via compareRuns(${originalRunId}, ${replayResult.replayRunId})`);

        return {
            ...replayResult,
            divergenceCheckUrl: `/api/mission-runs/${replayResult.replayRunId}/replay/compare/${originalRunId}`,
            message: "Replay started. Poll divergenceCheckUrl to see action-level diff once the replay run completes.",
        };
    },

    /**
     * Predict the next tool that will be called based on current action and branch ranker weights.
     */
    async predictNextTool(missionRunId: number, missionId: number, currentAction: string): Promise<{ tool: string; confidence: number } | null> {
        try {
            const { redis } = await import("@domain/core/infrastructure/redis/redis-client.js");
            const WEIGHTS_KEY = "prediction:branch_ranker_weights";
            const cached = await redis.get(WEIGHTS_KEY);
            if (!cached) return null;
            const weights = JSON.parse(cached) as Record<string, number>;
            // Simple heuristic: use action name to select likely next tool
            const toolHints: Record<string, string> = {
                "CALL_TOOL": currentAction, "THINK_STEP": "search_unified_knowledge",
                "DELEGATE": "run_pipeline", "CONCLUDE": "synthesize",
            };
            const tool = toolHints[currentAction] ?? null;
            if (!tool) return null;
            const confidence = weights[tool] ?? 0.5;
            return { tool, confidence };
        } catch { return null; }
    },

    /**
     * Get execution heatmap - time spent per phase/tool
     */
    async getExecutionHeatmap(missionRunId: number) {
        try {
            const history = await db.select()
                .from(missionBlackboardHistory)
                .where(eq(missionBlackboardHistory.missionRunId, missionRunId))
                .orderBy(missionBlackboardHistory.createdAt);

            if (history.length < 2) {
                return { success: false, error: "Insufficient checkpoint data for heatmap" };
            }

            // Calculate time between checkpoints
            const phaseTimes: Record<string, number> = {};
            const toolTimes: Record<string, number> = {};

            for (let i = 1; i < history.length; i++) {
                const prev = history[i - 1];
                const curr = history[i];
                
                const timeMs = new Date(curr.createdAt!).getTime() - new Date(prev.createdAt!).getTime();
                const timeMinutes = timeMs / (1000 * 60);

                // Track by phase
                const currContext = curr.blackboard as Record<string, any> || {};
                const phase = currContext.phase || 'unknown';
                phaseTimes[phase] = (phaseTimes[phase] || 0) + timeMinutes;

                // Track by tool
                const tool = currContext.lastToolRun || 'unknown';
                if (tool !== 'unknown') {
                    toolTimes[tool] = (toolTimes[tool] || 0) + timeMinutes;
                }
            }

            return {
                success: true,
                missionRunId,
                totalDurationMinutes: Object.values(phaseTimes).reduce((a, b) => a + b, 0),
                phaseBreakdown: phaseTimes,
                toolBreakdown: toolTimes,
                checkpointCount: history.length
            };

        } catch (err: any) {
            logger.error(`[Replay] Error generating heatmap: ${err.message}`);
            return { success: false, error: err.message };
        }
    }
};
