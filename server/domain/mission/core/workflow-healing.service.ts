import { createLogger } from "@server/utils/logger.js";
import { swarmCommunicationService } from "../../agents/core/swarm-communication.service.js";
import { missionLifecycleService } from "./mission-lifecycle.service.js";
import { db } from "@server/database_service.js";
import { missions, missionRuns, pipelineExecutions } from "@shared/schema/index.js";
import { eq, desc, and, lt, isNull } from "drizzle-orm";

const logger = createLogger("WorkflowHealer");

/** Runs idle this long are candidates for a wake-up. */
export const STALE_RUN_MINUTES = 10;

/**
 * Consecutive wake-ups allowed without the run checkpointing in between. After that
 * the healer stops touching the run, so its `updated_at` ages and the maintenance
 * reaper (60 min) can fail it. Uncapped, every wake-up refreshed `updated_at` and
 * the reaper could never reach a run the healer kept relaunching.
 */
export const MAX_WATCHDOG_RESUMES = 3;

/** The execution is legitimately waiting — on a person, or on an async job. */
const WAITING_EXECUTION_STATUSES = new Set(["waiting_external_input", "waiting_async"]);

/** The execution finished; the run only missed hearing about it. */
const FINISHED_EXECUTION_STATUSES = new Set(["completed", "failed"]);

/** The execution was ended on purpose; relaunching it would override that. */
const ENDED_EXECUTION_STATUSES = new Set(["cancelled", "timeout"]);

export type StaleRunAction =
    | "reconciled" | "skipped_waiting" | "skipped_ended" | "skipped_resume_cap" | "skipped_no_mission" | "resumed";

interface WatchdogState {
    resumeAttempts: number;
    /** The run's lastCheckpointAt when counting began; a newer checkpoint resets the count. */
    sinceCheckpointAt: string | null;
}

export class WorkflowHealingService {
    private eventCounter: Map<string, { count: number, lastAction: string }> = new Map();
    private readonly REPEAT_THRESHOLD = 5;

    /**
     * Watches for "Reasoning Resonance" where an agent repeats 
     * the same unsuccessful action sequence.
     */
    async handleMissionEvent(missionId: number, event: any) {
        if (event.type === 'tool_execution_failed' || event.type === 'agent_reasoning_step') {
            const key = `m-${missionId}-a-${event.agentId || 'default'}`;
            const actionStr = JSON.stringify({ tool: event.tool, input: event.input });
            
            const stats = this.eventCounter.get(key) || { count: 0, lastAction: '' };
            
            if (stats.lastAction === actionStr) {
                stats.count++;
            } else {
                stats.count = 1;
                stats.lastAction = actionStr;
            }
            
            this.eventCounter.set(key, stats);

            // Proactive Lazarus Integration: If it's a selector error, trigger async healing early
            if (event.error && (event.error.includes("Selector timeout") || event.error.includes("Unable to find element")) && event.pageHtml) {
                this.proactivelyHealSelector(missionId, event);
            }
            
            if (stats.count >= this.REPEAT_THRESHOLD) {
                await this.initiateHealing(missionId, event.agentId, "Resonance detected: Agent repeating failed pattern.");
                this.eventCounter.delete(key);
            }
        }
    }

    /**
     * Proactively triggers distributed healing for a selector failure.
     */
    private async proactivelyHealSelector(missionId: number, event: any) {
        const { aiHealingService } = await import("@domain/ai/core/ai-healing.service.js");
        const brokenSelector = event.input?.selector || event.tool_param_selector;
        
        if (!brokenSelector) return;

        logger.info(`Lazarus detected selector failure in mission ${missionId}. Queueing async repair...`, { brokenSelector });

        // Offload to Distributed Healing Swarm
        const healedSelector = await aiHealingService.healSelectorAsync(
            missionId,
            brokenSelector,
            event.pageHtml,
            event.error,
            'proximity'
        );

        if (healedSelector) {
            logger.info(`Lazarus successfully repaired selector via distributed worker. Injecting into blackboard.`, { missionId, newSelector: healedSelector });
            
            const patch = {
                lazarus_repair: {
                    timestamp: new Date().toISOString(),
                    broken_selector: brokenSelector,
                    fixed_selector: healedSelector,
                    target_agent: event.agentId
                }
            };
            
            await missionLifecycleService.updateBlackboard(missionId, patch, "lazarus-distributed-worker", "selector_repair");
        } else {
            // Lazarus Failed: Formal Escalation to Antigravity
            logger.warn(`Lazarus failed to repair selector in mission ${missionId}. Escalating to Antigravity swarm...`);
            
            const { escalateToAntigravity } = await import("@server/mcp/handlers/antigravity.js");
            
            // Resolve missionRunId (latest active run for mission)
            const [latestRun] = await db.select()
                .from(missionRuns)
                .where(eq(missionRuns.missionId, missionId))
                .orderBy(desc(missionRuns.createdAt))
                .limit(1);

            if (latestRun) {
                await escalateToAntigravity({
                    missionRunId: latestRun.id,
                    description: `Critical Selector Failure: Autonomous healing could not repair '${brokenSelector}'.`,
                    context: {
                        lastError: event.error,
                        htmlSnapshot: event.pageHtml,
                        brokenSelector,
                        agentId: event.agentId,
                        blackboardSnapshot: (latestRun.missionContext as any)
                    }
                });
            }
        }
    }

    /**
     * Injects a correction event into the swarm blackboard.
     */
    private async initiateHealing(missionId: number, agentId: string, reason: string) {
        logger.warn(`Lazarus Workflow Healing initiated for Mission ${missionId}`, { reason });

        const patch = {
            lazarus_intervention: {
                timestamp: new Date().toISOString(),
                reason,
                suggested_pivot: "The previous action is failing repeatedly. Please reconsider the objective or try an alternative tool/parameter set.",
                target_agent: agentId
            }
        };

        // 1. Update the mission blackboard with the intervention
        await missionLifecycleService.updateBlackboard(missionId, patch, "lazarus-resilience", " resonance_detected");

        // 2. Broadcast the alert to the swarm
        await swarmCommunicationService.broadcast(`mission-${missionId}`, "lazarus-resilience", {
            type: "intervention_alert",
            reason,
            agentId
        });
    }

    /**
     * Wake up `active` runs that have been idle for STALE_RUN_MINUTES — but only runs
     * that are actually stuck.
     *
     * This used to resume every idle active run unconditionally. A run whose pipeline
     * execution had already FINISHED (the executor missed the pipeline-complete hook
     * on the resume-after-approval path) was relaunched, which put the same step back
     * up for human approval — about a dozen times over four days for runs 160 and 177.
     * Each wake-up also refreshed `updated_at`, so the 60-minute reaper never reached
     * a run the healer kept relaunching.
     *
     * Now, by the state of the run's linked pipeline execution:
     * - finished (completed/failed): close the run as the hook would have; never relaunch.
     * - waiting on a person or an async job: not stale; leave it.
     * - cancelled/timeout: ended on purpose; leave it for the reaper.
     * - otherwise: resume, at most MAX_WATCHDOG_RESUMES times without a checkpoint in
     *   between, then stop touching it so the reaper can fail it.
     *
     * @returns the number of stale runs examined.
     */
    async scanForStaleMissions() {
        logger.info("[WorkflowHealer] Scanning for stale missions...");
        const cutoff = new Date(Date.now() - STALE_RUN_MINUTES * 60 * 1000);

        const staleRuns = await db.select({ run: missionRuns, execution: pipelineExecutions })
            .from(missionRuns)
            .leftJoin(pipelineExecutions, eq(missionRuns.pipelineExecutionId, pipelineExecutions.id))
            .where(and(
                eq(missionRuns.status, 'active'),
                lt(missionRuns.updatedAt, cutoff),
                isNull(missionRuns.deletedAt),
            ));

        for (const { run, execution } of staleRuns) {
            try {
                await this.handleStaleRun(run, execution);
            } catch (err: any) {
                logger.error(`[WorkflowHealer] Failed to handle stale run ${run.id}: ${err.message}`);
            }
        }

        return staleRuns.length;
    }

    async handleStaleRun(run: any, execution: any | null): Promise<StaleRunAction> {
        const execStatus: string | undefined = execution?.status;

        if (execStatus && FINISHED_EXECUTION_STATUSES.has(execStatus)) {
            // Same decision the pipeline-complete hook makes: complete, fail, or advance
            // to the next pipeline in the run's sequence.
            logger.warn(`[WorkflowHealer] Run ${run.id} is active but its execution ${execution.id} already ${execStatus}. Reconciling instead of relaunching.`);
            const { MissionCheckpointHook } = await import("../../pipeline/hooks/mission-checkpoint-hook.js");
            await new MissionCheckpointHook().onPipelineComplete({
                pipeline: null,
                pipelineExecution: execution,
                stepResults: [],
                orgId: run.organizationId,
            } as any);
            return "reconciled";
        }

        if (execStatus && WAITING_EXECUTION_STATUSES.has(execStatus)) {
            logger.info(`[WorkflowHealer] Run ${run.id} is waiting (execution ${execution.id} ${execStatus}); not stale.`);
            return "skipped_waiting";
        }

        if (execStatus && ENDED_EXECUTION_STATUSES.has(execStatus)) {
            logger.warn(`[WorkflowHealer] Run ${run.id}'s execution ${execution.id} was ${execStatus}; not relaunching. Leaving it for the reaper.`);
            return "skipped_ended";
        }

        // Unchanged: a run with no mission has nothing to restart against.
        if (!run.missionId) return "skipped_no_mission";

        const ctx = (run.missionContext as Record<string, any>) || {};
        const checkpointMark = run.lastCheckpointAt ? new Date(run.lastCheckpointAt).toISOString() : null;
        const previous: WatchdogState | undefined = ctx._watchdog;
        const attempts = previous && previous.sinceCheckpointAt === checkpointMark ? previous.resumeAttempts : 0;

        if (attempts >= MAX_WATCHDOG_RESUMES) {
            // Deliberately no write: letting updated_at age is what hands the run to the reaper.
            logger.warn(`[WorkflowHealer] Run ${run.id} was woken ${attempts} times without progress; leaving it for the reaper.`);
            return "skipped_resume_cap";
        }

        logger.warn(`[WorkflowHealer] Run ${run.id} is stale (last updated: ${run.updatedAt}). Wake-up ${attempts + 1}/${MAX_WATCHDOG_RESUMES}...`);

        const watchdog: WatchdogState = { resumeAttempts: attempts + 1, sinceCheckpointAt: checkpointMark };
        await db.update(missionRuns)
            .set({ missionContext: { ...ctx, _watchdog: watchdog } })
            .where(eq(missionRuns.id, run.id));

        await missionLifecycleService.updateBlackboard(run.missionId, {
            lazarus_stagnation_alert: {
                timestamp: new Date().toISOString(),
                reason: `Mission has been inactive for > ${STALE_RUN_MINUTES} minutes.`,
                suggested_action: "Resume orchestration cycle and verify progress toward objective."
            }
        }, "lazarus-watchdog", "stagnation_detected");

        const { missionRunService } = await import("./mission-run.service.js");
        await missionRunService.resumeMissionRun(run.id);
        return "resumed";
    }
}

export const workflowHealingService = new WorkflowHealingService();
