
import { db } from "@server/database_service.js";
import { missions, missionRuns, jobs, missionMembers } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { vibeDetector } from "../utils/vibe-detector.js";
import { traceBuffer } from "../utils/trace-buffer.js";
import { missionEventBus, MissionEvent } from "./mission-event-bus.js";
import { missionRunService } from "./mission-run.service.js";
import { scheduleMissionWave, cancelMissionWave } from "../infrastructure/rolling-wave-queue.js";
import { systemAiService } from "../../ai/core/system-ai.service.js";
import { MissionContextSchema, MissionContext } from "../utils/mission-types.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";

// Specialized Modules (Refactored)
import { MissionWaveExecutorService } from "./mission-wave-executor.service.js";
import { MissionStrategicPlannerService } from "./mission-strategic-planner.service.js";
import { MissionGovernanceService } from "./mission-governance.service.js";
import { MissionHistoryRAGService } from "./mission-history-rag.service.js";
import { MissionContextPruningService } from "./mission-context-pruning.service.js";
import { MissionDebateService } from "./mission-debate.service.js";
import { MissionAuditorService } from "./mission-auditor.service.js";

const logger = createLogger("RollingWaveOrchestrator");

export const rollingWaveOrchestratorService = {
    activeLoops: new Set<number>(),

    async launchMission(missionId: number, userId: string, orgId: number | null, priority?: number) {
        logger.info(`[Mach 1] Launching rolling wave mission ${missionId}`);
        const [mission] = await db.select().from(missions).where(eq(missions.id, missionId)).limit(1);
        if (!mission) throw new Error("Mission not found");

        const [existingRun] = await db.select().from(missionRuns).where(and(
            eq(missionRuns.missionId, missionId),
            eq(missionRuns.status, 'active')
        )).limit(1);

        if (existingRun) {
            logger.info(`[Mach 1] Mission ${missionId} already has an active run ${existingRun.id}. Rescheduling instead of creating new.`);
            await scheduleMissionWave({ missionRunId: existingRun.id, userId, orgId, priority });
            return { success: true, missionRunId: existingRun.id, note: "Already active" };
        }

        const run = await missionRunService.create({
            missionId,
            organizationId: orgId ?? undefined,
            name: `Rolling Wave: ${mission.name}`,
            createdBy: userId,
            pipelineSequence: []
        });

        // --- AUTOMATIC WORKER SYNTHESIS FOR PREDICTION MISSIONS ---
        const isPredictionMission = mission.objective?.toLowerCase().includes("prediction") || 
                                   mission.objective?.toLowerCase().includes("churn") ||
                                   (mission.blackboard as any)?.isPrediction;

        if (isPredictionMission) {
            logger.info(`[RollingWave] Synthesizing specialized worker for Prediction Mission ${missionId}`);
            try {
                // Check if a synthesized worker already exists for this mission
                const [existingWorker] = await db.select()
                    .from(missionMembers)
                    .where(and(
                        eq(missionMembers.missionId, missionId),
                        eq(missionMembers.role, "specialist")
                    ))
                    .limit(1);

                if (!existingWorker) {
                    const aiConfig = await systemAiService.getAiConfig('copilot', orgId ?? undefined);
                    const [workerJob] = await db.insert(jobs).values({
                        name: "Synthesized Prediction Analyst",
                        type: "specialist",
                        organizationId: orgId,
                        createdBy: userId,
                        isActive: true,
                        config: {
                            systemPrompt: "You are a specialized Prediction Analyst. Your job is to analyze datasets and generate predictions using the run_prediction tool. Focus on identifying patterns in the data that lead to the target outcome.",
                            model: aiConfig?.model || "gemini-1.5-pro",
                        }
                    }).returning();

                    await db.insert(missionMembers).values({
                        missionId: missionId,
                        entityType: "job",
                        entityId: workerJob.id,
                        role: "specialist",
                        status: "active"
                    });

                    logger.info(`[RollingWave] Successfully synthesized worker ${workerJob.id} for mission ${missionId}`);
                }
            } catch (synthErr: any) {
                logger.error(`[RollingWave] Failed to synthesize worker: ${synthErr.message}`);
                // Non-blocking: continue launching the mission
            }
        }

        const initialContext = {
            ...((mission.blackboard as any) || {}),
            phase: 'PLANNING',
            current_wave: 1,
            max_waves: 10,
            intent: mission.objective,
            executionStrategy: 'rolling_wave'
        };

        await db.update(missionRuns).set({ missionContext: initialContext }).where(eq(missionRuns.id, run.id));
        await scheduleMissionWave({ missionRunId: run.id, userId, orgId, priority });

        return { success: true, missionRunId: run.id };
    },

    async processMissionCycle(missionRunId: number, userId: string, orgId: number | null) {
        try {
            const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, missionRunId)).limit(1);
            if (!run || run.status !== 'active') {
                await cancelMissionWave(missionRunId).catch(() => { });
                return;
            }

            await missionRunService.heartbeat(missionRunId);

            const parsed = MissionContextSchema.safeParse(run.missionContext);
            const context: MissionContext = parsed.success ? parsed.data : { phase: 'PLANNING', current_wave: 1, max_waves: 10 };
            
            // Circuit Breaker: Runaway Protection
            if (context.current_wave > (context.max_waves || 10)) {
                logger.warn(`[RollingWaveOrchestrator] Run ${missionRunId} exceeded max waves (${context.max_waves}). Failing.`);
                await missionRunService.update(missionRunId, { status: "failed" });
                this.appendTrace(missionRunId, { type: "error", event: "max_waves_exceeded", note: `Exceeded ${context.max_waves} waves.` });
                await cancelMissionWave(missionRunId).catch(() => { });
                return;
            }
            
            // 1. Governance Gate
            const isAllowed = await MissionGovernanceService.validate(missionRunId, context, this.appendTrace.bind(this));
            if (!isAllowed) {
                await cancelMissionWave(missionRunId).catch(() => { });
                return;
            }

            // 2. Phase Execution
            switch (context.phase) {
                case 'PLANNING':
                    try {
                        this.appendTrace(missionRunId, { type: "strategist", event: "planning", note: "Architecting next wave..." });
                        const blueprint = await MissionStrategicPlannerService.plan(missionRunId, orgId);
                        
                        // Save blueprint and transition to DEBATING
                        await db.update(missionRuns).set({
                            missionContext: {
                                ...context,
                                pendingAttachments: [],
                                lastUserCommand: null,
                                blueprint,
                                phase: 'DEBATING'
                            }
                        }).where(eq(missionRuns.id, missionRunId));
                        
                        missionEventBus.emit(MissionEvent.PHASE_TRANSITION, { missionRunId, phase: 'DEBATING' });
                    } catch (planErr: any) {
                        logger.error(`[Orchestrator] Planning failed: ${planErr.message}`);
                        this.appendTrace(missionRunId, { type: "error", event: "planning_failed", note: planErr.message });
                        await this.updatePhase(missionRunId, 'WAITING_FOR_ORDERS');
                    }
                    break;

                case 'DEBATING':
                    try {
                        const blueprint = context.blueprint;
                        if (!blueprint) {
                            await this.updatePhase(missionRunId, 'PLANNING');
                            break;
                        }

                        const refinedBlueprint = await MissionDebateService.debate(missionRunId, blueprint, orgId, this.appendTrace.bind(this));
                        
                        await db.update(missionRuns).set({
                            missionContext: {
                                ...context,
                                blueprint: refinedBlueprint,
                                phase: 'AUDITING'
                            }
                        }).where(eq(missionRuns.id, missionRunId));

                        missionEventBus.emit(MissionEvent.PHASE_TRANSITION, { missionRunId, phase: 'AUDITING' });
                    } catch (debateErr: any) {
                        logger.error(`[Orchestrator] Debate failed: ${debateErr.message}`);
                        await this.updatePhase(missionRunId, 'AUDITING'); // Fallback to original
                    }
                    break;

                case 'AUDITING':
                    try {
                        const blueprint = context.blueprint;
                        if (!blueprint) {
                            await this.updatePhase(missionRunId, 'PLANNING');
                            break;
                        }

                        const auditResult = await MissionAuditorService.audit(missionRunId, blueprint, orgId, this.appendTrace.bind(this));

                        if (auditResult.passed) {
                            await this.updatePhase(missionRunId, 'EXECUTING');
                        } else {
                            // Vetoed! Re-route back to PLANNING with the auditor's recommendation
                            this.appendTrace(missionRunId, { 
                                type: "strategist", 
                                event: "replanning", 
                                note: "Auditor vetoed the plan. Replanning with constitutional constraints..." 
                            });
                            
                            const updatedContext = {
                                ...context,
                                phase: 'PLANNING',
                                last_criticism: `CONSTITUTIONAL VETO: ${auditResult.recommendation}`
                            };

                            await db.update(missionRuns).set({ missionContext: updatedContext }).where(eq(missionRuns.id, missionRunId));
                            missionEventBus.emit(MissionEvent.PHASE_TRANSITION, { missionRunId, phase: 'PLANNING' });
                        }
                    } catch (auditErr: any) {
                        logger.error(`[Orchestrator] Audit failed: ${auditErr.message}`);
                        await this.updatePhase(missionRunId, 'EXECUTING'); // Fail-open
                    }
                    break;

                case 'EXECUTING':
                    try {
                        const blueprint = context.blueprint;
                        if (!blueprint) {
                            await this.updatePhase(missionRunId, 'PLANNING');
                            break;
                        }

                        const execResult = await MissionWaveExecutorService.execute(missionRunId, blueprint, userId, orgId, this.appendTrace.bind(this));

                        if (!execResult.success) {
                            this.appendTrace(missionRunId, { type: "error", event: "execution_failed", note: execResult.error });
                        }

                        // Surface what this wave produced (and the intended vibe) into the
                        // blackboard so the vibe critic audits the real output — without this
                        // it always sees "No output captured yet." and can never converge.
                        await db.update(missionRuns).set({
                            missionContext: {
                                ...context,
                                latest_wave_output: execResult.output || execResult.error || "No output captured yet.",
                                vibe_intent: blueprint?.vibe_intent || context.vibe_intent || context.intent,
                                phase: 'CRITIQUING',
                            },
                            updatedAt: new Date(),
                        }).where(eq(missionRuns.id, missionRunId));
                        missionEventBus.emit(MissionEvent.PHASE_TRANSITION, { missionRunId, phase: 'CRITIQUING' });
                    } catch (execErr: any) {
                        logger.error(`[Orchestrator] Execution failed: ${execErr.message}`);
                        await this.updatePhase(missionRunId, 'CRITIQUING');
                    }
                    break;

                case 'CRITIQUING': {
                    const audit = await vibeDetector.runAudit(missionRunId);
                    this.appendTrace(missionRunId, { type: "critic", event: "vibe_audit", note: audit.critique, score: audit.alignmentScore });

                    // Convergence gate. A high-alignment, drift-free audit means the wave's
                    // objective is met — mark the run successful instead of spinning to the
                    // max-waves cap. This is the ONLY success path; previously the check read
                    // a never-populated `run.audit_critique` field, so every run failed at
                    // max_waves regardless of quality.
                    //
                    // 0.85 (not 0.9): the vibe critic is conservative and slightly stochastic
                    // (Gemini @ temp 0.2), so genuinely-complete work straddles ~0.8–0.9 between
                    // calls. 0.85 + no-drift reliably separates "done" from partial waves
                    // (which score 0.2–0.7) without waiting on a lucky 0.9 roll. Validated
                    // against cycle-95 run 115 (final output re-audits to 0.9/no-drift).
                    const CONVERGENCE_THRESHOLD = 0.85;
                    const converged = !audit.driftDetected && audit.alignmentScore >= CONVERGENCE_THRESHOLD;
                    if (converged) {
                        this.appendTrace(missionRunId, {
                            type: "strategist",
                            event: "objective_met",
                            note: `Vibe audit converged (alignment ${audit.alignmentScore.toFixed(2)}, no drift). Objective met.`,
                            score: audit.alignmentScore,
                        });
                        await missionRunService.update(missionRunId, { status: "completed", isSuccess: true });

                        // Signal the parent cycle's success criteria so downstream waves/phases proceed.
                        if (run.cycleId) {
                            try {
                                const { CycleManagerService } = await import("./cycle-manager.service.js");
                                await CycleManagerService.evaluateSuccessCriteria(run.cycleId, {
                                    type: "finding_confirmed",
                                    confidence: audit.alignmentScore,
                                    data: { runId: missionRunId, critique: audit.critique },
                                });
                            } catch (e) {
                                logger.warn("[Orchestrator] Failed to signal cycle manager", { e });
                            }
                        }

                        await cancelMissionWave(missionRunId).catch(() => { });
                        break;
                    }

                    // Not converged: carry the critique forward as steering for the next wave.
                    await db.update(missionRuns).set({
                        missionContext: { ...context, phase: 'REFLECTING', last_criticism: audit.critique },
                    }).where(eq(missionRuns.id, missionRunId));
                    missionEventBus.emit(MissionEvent.PHASE_TRANSITION, { missionRunId, phase: 'REFLECTING' });
                    break;
                }

                case 'REFLECTING':
                    this.appendTrace(missionRunId, { type: "strategist", event: "reflection", note: "Reflection complete. Moving to next wave strategy." });
                    
                    // Governance: Pruning & Indexing
                    await MissionContextPruningService.pruneIfLarge(missionRunId);
                    await MissionHistoryRAGService.indexNewTraces(missionRunId);

                    // Note: run success / cycle success-criteria signalling is handled in the
                    // CRITIQUING phase, where the fresh vibe-audit result is in hand. Reaching
                    // REFLECTING means the run did NOT converge this wave, so we advance.

                    const nextWave = (context.current_wave || 1) + 1;
                    await db.update(missionRuns).set({ 
                        missionContext: { ...context, current_wave: nextWave, phase: 'PLANNING' } 
                    }).where(eq(missionRuns.id, missionRunId));
                    
                    missionEventBus.emit(MissionEvent.PHASE_TRANSITION, { missionRunId, phase: 'PLANNING' });
                    break;

                case 'EXECUTING_LEGACY':
                    // Recovery path: run restarted mid-execution. Push to CRITIQUING so the cycle continues.
                    logger.warn(`[Orchestrator] Run ${missionRunId} found in EXECUTING phase on startup — recovering to CRITIQUING.`);
                    await this.updatePhase(missionRunId, 'CRITIQUING');
                    break;

                case 'WAITING_FOR_ORDERS':
                    break;
            }
        } catch (err: any) {
            logger.error(`[Mach 1] Error in mission cycle ${missionRunId}: ${err.message}`);
        }
    },

    async updatePhase(missionRunId: number, phase: string) {
        const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, missionRunId)).limit(1);
        const currentContext = (run?.missionContext as Record<string, any>) || {};

        await db.update(missionRuns).set({
            status: phase === 'WAITING_FOR_ORDERS' ? 'paused' : 'active',
            missionContext: { ...currentContext, phase },
            updatedAt: new Date()
        }).where(eq(missionRuns.id, missionRunId));

        missionEventBus.emit(MissionEvent.PHASE_TRANSITION, { missionRunId, phase });
        eventStream.publish('mission.phase_changed', { missionRunId, phase }, {
            organizationId: run?.organizationId ?? undefined,
            subject: `mission-run:${missionRunId}`,
        }, 'rolling-wave').catch(() => {});
    },

    appendTrace(missionRunId: number, traceEntry: any) {
        traceBuffer.append(missionRunId, traceEntry);
        missionEventBus.emit(MissionEvent.TRACE_APPENDED, { missionRunId, traceEntry });
        eventStream.publish('mission.trace', { missionRunId, traceEntry }, {
            subject: `mission-run:${missionRunId}`,
        }, 'rolling-wave').catch(() => {});
    }
};
