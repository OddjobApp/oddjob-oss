
import { db, pool } from "@server/database_service.js";
import { missions, missionRuns, orgs, pipelineExecutions, jobs, missionMembers, apps, skills, users, sourcePerformanceLogs, missionTemplates } from "@shared/schema/index.js";
import { predictions, predictionBranches } from "@shared/schema/prediction/predictions.js";

import { eq, sql, and, inArray, gte } from "drizzle-orm";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";

import { createLogger } from "@server/utils/logger.js";
import { missionRunService } from "./mission-run.service.js";
import { missionService } from "./mission.service.js"; // Import missionService for blackboard updates
import { approvalService } from "../../integrations/core/approval.service.js"; // Import approvalService for HIL
import { systemAiService } from "../../ai/core/system-ai.service.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { AGENT_TOOLS, normalizeToolName } from "../../tools/v1/tool-registry.service.js";
import { handleToolCall } from "@server/mcp/handlers.js";
import { safeJsonParse } from "@server/utils/json-repair.js";
import { skillService } from "../../agents/core/skill-service.js";
import { SkillManager } from "../../agents/core/skill-manager.js";
import { HermesProtocolService } from "@domain/agents/core/hermes-protocol.service.js";
import { reasoningAuditService } from "@domain/audit/core/reasoning-audit.service.js";


import { decisionRouter } from "../../governor/core/decision-router.js";
import { redis } from "@domain/core/infrastructure/redis/redis-client.js";
import { queueMissionCycle } from "../infrastructure/dynamic-mission-queue.js";
import { strategyMLService } from "../../agents/core/ml-strategy-predictor/strategy-ml.service.js";
import { institutionalMemoryService } from "../../learning/core/institutional-memory.service.js";
import { crisisOrchestrationService } from "./crisis-orchestration.service.js";
import { orchestrationThinkingService } from "./orchestration/thinking.service.js";
import { orchestrationExecutionService } from "./orchestration/execution.service.js";
import { orchestrationGovernanceService } from "./orchestration/governance.service.js";
import { OrchestrationContext } from "./orchestration/types.js";

import { ConcludeHandler } from "./actions/conclude-handler.js";
import { FailHandler } from "./actions/fail-handler.js";
import { HilRequestHandler } from "./actions/hil-request-handler.js";
import { LaunchSubmissionHandler } from "./actions/launch-submission-handler.js";
import { ExtractBlueprintHandler } from "./actions/extract-blueprint-handler.js";
import { ArchiveAssetHandler } from "./actions/archive-asset-handler.js";
import { SynthesizeToolHandler } from "./actions/synthesize-tool-handler.js";
import { CallToolHandler } from "./actions/call-tool-handler.js";
import { DelegateHandler } from "./actions/delegate-handler.js";
import { ThinkStepHandler } from "./actions/think-step-handler.js";
import { ActionContext } from "./actions/action-handler.js";
import { createRuntimeSnapshot, runActionWithRuntimeKernel } from "./actions/action-runtime-kernel.js";
import { assertOrgId } from "@server/utils/auth-context.js";

const actionHandlers: Record<string, any> = {
    "CONCLUDE": new ConcludeHandler(),
    "CONCLUDE_MISSION": new ConcludeHandler(),
    "FAIL": new FailHandler(),
    "HIL_REQUEST": new HilRequestHandler(),
    "LAUNCH_SUBMISSION": new LaunchSubmissionHandler(),
    "EXTRACT_BLUEPRINT": new ExtractBlueprintHandler(),
    "ARCHIVE_ASSET": new ArchiveAssetHandler(),
    "SYNTHESIZE_TOOL": new SynthesizeToolHandler(),
    "CALL_TOOL": new CallToolHandler(),
    "DELEGATE": new DelegateHandler(),
    "THINK_STEP": new ThinkStepHandler(),
};

const logger = createLogger("DynamicOrchestrator");

const TRACE_BUFFER_TTL = 3600; // 1 hour buffer retention

// ── Source performance logging helper ────────────────────────────────────────
async function logSourcePerformance(
    missionContext: Record<string, unknown> | null | undefined,
    missionType: string,
    orgId: number | null,
    success: boolean,
    log: ReturnType<typeof createLogger>,
): Promise<void> {
    try {
        const trackedAssets = (missionContext as any)?.tracked_assets ?? [];
        const uniqueTools = [...new Set<string>(
            trackedAssets.filter((a: any) => a.type === "tool").map((a: any) => String(a.name))
        )];
        if (uniqueTools.length === 0) return;
        await db.insert(sourcePerformanceLogs).values(
            uniqueTools.map(tool => ({ source: tool, missionType, success, yieldedInfo: success, organizationId: orgId }))
        );
        log.info(`[DynamicOrchestrator] Logged ${success ? "success" : "failure"} for ${uniqueTools.length} sources`);
    } catch (err: any) {
        log.warn(`[DynamicOrchestrator] Failed to log source performance: ${err.message}`);
    }
}

// ── Branch weight training (async, non-blocking, uses fs/promises + Redis lock) ─
const WEIGHTS_REDIS_KEY = "prediction:branch_ranker_weights";
const WEIGHTS_LOCK_KEY = "prediction:branch_ranker_weights:lock";

async function trainBranchWeights(
    missionId: number,
    missionContext: Record<string, unknown> | null | undefined,
    log: ReturnType<typeof createLogger>,
): Promise<void> {
    try {
        const { redis } = await import("../../core/infrastructure/redis/redis-client.js");

        // Distributed lock — skip if another node is training
        const locked = await redis.set(WEIGHTS_LOCK_KEY, "1", "EX", 30, "NX");
        if (!locked) return;

        try {
            const mappingPath = join(process.cwd(), "server/domain/prediction-intelligence/prediction/prediction_mission_mapping.json");
            let mapping: Record<string, number> = {};
            try {
                mapping = JSON.parse(await readFile(mappingPath, "utf-8"));
            } catch { return; }

            const contextIds = Object.keys(mapping).filter(k => mapping[k] === missionId);
            if (contextIds.length === 0) return;

            const branches = await db.select().from(predictionBranches)
                .where(inArray(predictionBranches.contextId, contextIds));

            const usedTools = [...new Set<string>(
                ((missionContext as any)?.tracked_assets ?? [])
                    .filter((a: any) => a.type === "tool")
                    .map((a: any) => String(a.name))
            )];

            // Load weights from Redis first, fallback to file
            let weights: Record<string, number>;
            const cached = await redis.get(WEIGHTS_REDIS_KEY);
            if (cached) {
                weights = JSON.parse(cached);
            } else {
                const weightsPath = join(process.cwd(), "server/domain/prediction-intelligence/prediction/branch_ranker_weights.json");
                weights = JSON.parse(await readFile(weightsPath, "utf-8"));
            }

            const learningRate = 0.05;
            let updated = false;

            for (const branch of branches) {
                const features = (branch.payload as any)?.features;
                if (!features) continue;
                const label = usedTools.some(t => branch.predicate.includes(t)) ? 1 : 0;
                const z = Object.keys(weights).reduce((acc, k) =>
                    k !== "bias" ? acc + weights[k] * (features[k] ?? 0) : acc, weights.bias ?? 0);
                const error = 1 / (1 + Math.exp(-z)) - label;
                for (const k of Object.keys(features)) {
                    if (k in weights) weights[k] -= learningRate * error * features[k];
                }
                if ("bias" in weights) weights.bias -= learningRate * error;
                updated = true;
            }

            if (updated) {
                // Persist to Redis (cluster-safe) and file (fallback for single-node)
                await redis.set(WEIGHTS_REDIS_KEY, JSON.stringify(weights), "EX", 86400);
                const weightsPath = join(process.cwd(), "server/domain/prediction-intelligence/prediction/branch_ranker_weights.json");
                await writeFile(weightsPath, JSON.stringify(weights, null, 4));
                log.info(`[DynamicOrchestrator] Updated branch ranker weights for mission ${missionId}`);
            }
        } finally {
            await redis.del(WEIGHTS_LOCK_KEY);
        }
    } catch (err: any) {
        log.warn(`[DynamicOrchestrator] Weight training error: ${err.message}`);
    }
}

export const dynamicOrchestratorService = {
    /**
     * Initializes and launches a mission in 'dynamic_autonomous' mode.
     */
    async launchDynamicMission(missionId: number, userId: string, orgId: number | null, initialContext: any = {}, parentId?: number): Promise<{ success: boolean; missionRunId?: number; missionId?: number; error?: string }> {
        logger.info(`[DynamicOrchestrator] Launching dynamic mission ${missionId} for user ${userId}`);

        // 1. Get mission details
        const [mission] = await db.select().from(missions).where(eq(missions.id, missionId)).limit(1);
        if (!mission) {
            return { success: false, error: "Mission not found" };
        }

        const blackboard = (mission.blackboard as Record<string, any>) || {};

        // Speculative Knowledge Prefetching using Prediction Engine
        try {
            const { PrefetchKnowledgeService } = await import("@domain/knowledge/core/prefetch-knowledge.service.js");
            const missionPrompt = mission.name || "Research mission"; 
            PrefetchKnowledgeService.prefetchForMission(missionPrompt, orgId, userId).catch(e => logger.error("[DynamicOrchestrator] Prefetch failed:", e));
        } catch (e) {
            logger.error("[DynamicOrchestrator] Failed to import PrefetchKnowledgeService:", e);
        }

        // Billing guard
        if (orgId && blackboard.viaAppSlug) {
            const { appRegistryService } = await import("../../apps/app-registry.service.js");
            const deploymentInfo = await appRegistryService.findDeploymentBySlug(blackboard.viaAppSlug, orgId);

            if (deploymentInfo) {
                const { app, deployment } = deploymentInfo;
                const price = parseFloat(app.pricePerLaunchUsd || '0');

                if (price > 0) {
                    const [org] = await db.select().from(orgs).where(eq(orgs.id, orgId)).limit(1);
                    if (!org || org.subscriptionStatus !== 'active') {
                        return {
                            success: false,
                            error: `This app requires an active subscription. Current status: ${org?.subscriptionStatus || 'No subscription found'}. Please visit organization billing settings.`
                        };
                    }
                }

                const { analyticsService } = await import("../../analytics/core/analytics.service.js");
                analyticsService.recordLaunch(deployment.id, userId).catch(err => {
                    logger.error(`Failed to record analytics for deployment ${deployment.id}: ${err.message}`);
                });
            }
        }

        // 2. Create Mission Run
        const missionName = mission.name?.startsWith("Mission:") ? mission.name : `Mission: ${mission.name || "Dynamic Mission"}`;
        const run = await missionRunService.create({
            missionId,
            organizationId: orgId ?? undefined,
            name: missionName,
            createdBy: userId,
            pipelineSequence: [], // dynamic has no predefined sequence
            currentPipelineId: undefined,
            parentId,
            reasoningProtocol: mission.reasoningProtocol
        });

        // 2. Fetch mission tools (heuristic: tools from all job members)
        const missionTools = await db
            .select({ toolName: jobs.tool })
            .from(missionMembers)
            .innerJoin(jobs, eq(missionMembers.entityId, jobs.id))
            .where(and(eq(missionMembers.missionId, missionId), eq(missionMembers.entityType, 'job')));
        
        const allowedTools = Array.from(new Set(missionTools.map((t: any) => t.toolName).filter(Boolean)));
        
        // Add core tools by default to empower autonomous orchestrators
        const CORE_CAPABILITIES = [
            'get_blackboard', 
            'update_blackboard', 
            'file_list', 
            'file_read', 
            'file_write', 
            'google_search', 
            'browse_web',
            'http_request',
            'ai_translate',
            'shell',
            'python',
            'generate_excel',
            'list_jobs',
            'list_failed_jobs',
            'get_system_health'
        ];
        
        for (const tool of CORE_CAPABILITIES) {
            if (!allowedTools.includes(tool)) allowedTools.push(tool);
        }

        // Merge mission blackboard with execution context
        const missionBlackboard = (mission.blackboard as Record<string, any>) || {};
        const context = {
            ...missionBlackboard, // Include mission blackboard for shared state
            ...initialContext, // Merge with passed context (discovered tools, intent, etc)
            intent: initialContext.intent || mission.objective,
            executionStrategy: 'dynamic_autonomous',
            launchedByUserId: userId, // Persist so sub-missions can inherit the correct user identity
            rulesOfEngagement: {
                maxBudgetUsd: mission.budgetLimitUsd ? parseFloat(String(mission.budgetLimitUsd)) : 50.00,
                maxCostPerCycleUsd: mission.dynamicCycleBudgetLimitUsd ? parseFloat(String(mission.dynamicCycleBudgetLimitUsd)) : 5.00,
                hilStrictness: mission.hilStrictness || "moderate", // lenient, moderate, strict
                notificationChannels: mission.hilNotificationChannels || ["inbox"]
            },
            cycleCount: 0,
            allowedTools: Array.from(new Set([...allowedTools, ...(initialContext.discoveredTools || [])]))
        };

        // Initialize Golden State with rules
        await missionRunService.update(run.id, {
            missionContext: context,
            dynamicTrace: [{ type: "system", event: "mission_launched", timestamp: new Date().toISOString() }]
        });

        // 3. Trigger initial orchestrator cycle via distributed queue
        console.log(`[DynamicOrchestrator] Dispatching initial cycle for run ${run.id}`);
        await queueMissionCycle({ missionRunId: run.id, userId, orgId }, 0);
        logger.info(`[DynamicOrchestrator] Dispatched initial cycle for run ${run.id} to queue`);

        return {
            success: true,
            missionId,
            missionRunId: run.id
        };
    },

    /**
     * Executes a single orchestration cycle.
     * Triggered by the distributed MissionWorker.
     */
    async processMissionCycle(missionRunId: number, userId: string, orgId: number | null) {
        logger.info(`[DynamicOrchestrator] Processing cycle for run ${missionRunId}`);
        
        // --- HEARTBEAT ---
        await missionRunService.heartbeat(missionRunId).catch(e => logger.warn(`[DynamicOrchestrator] Heartbeat failed: ${e.message}`));

        // Add to dynamic trace
        await this.appendTrace(missionRunId, { type: "system", event: "cycle_started", timestamp: new Date().toISOString() });
        await this.flushTraces(missionRunId).catch(e => logger.warn(`[DynamicOrchestrator] Initial flush failed: ${e.message}`));

        try {
            // Performance enhancement: Consolidate run and mission fetch into one query
            const [data] = await db.select({
                run: missionRuns,
                mission: missions
            })
            .from(missionRuns)
            .innerJoin(missions, eq(missionRuns.missionId, missions.id))
            .where(eq(missionRuns.id, missionRunId))
            .limit(1);

            if (!data || data.run.status !== "active") {
                logger.info(`[DynamicOrchestrator] Run ${missionRunId} is no longer active (status: ${data?.run?.status}). Stopping loop.`);
                return;
            }

            const { run, mission } = data;
            const missionContext = (run.missionContext as Record<string, any>) || {};


            // --- RESOLVE EFFECTIVE USER IDENTITY ---
            // Prefer queue-supplied userId, fall back to launchedByUserId from context, then createdBy
            const effectiveUserId = (userId && userId !== 'system')
                ? userId
                : missionContext.launchedByUserId || run.createdBy || userId;
            let effectiveUserEmail = "admin@example.com";
            if (effectiveUserId && effectiveUserId !== 'system') {
                try {
                    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, effectiveUserId.toString())).limit(1);
                    if (user?.email) effectiveUserEmail = user.email;
                } catch (userLookupErr: any) {
                    logger.warn(`[DynamicOrchestrator] Failed to look up user email for userId=${effectiveUserId}: ${userLookupErr.message}`);
                }
            }

            const currentCycle = (missionContext?.cycleCount || 0) + 1;
            const maxCycles = (missionContext?.maxCycles || 20);

            if (currentCycle > maxCycles) {
                logger.warn(`[DynamicOrchestrator] Run ${missionRunId} exceeded max cycles (${maxCycles}). Failing.`);
                await missionRunService.update(missionRunId, { status: "failed" });
                await this.appendTrace(missionRunId, { type: "error", event: "max_cycles_exceeded", note: `Exceeded ${maxCycles} cycles.`, timestamp: new Date().toISOString() });
                return;
            }

            // Update cycle count
            await missionRunService.update(missionRunId, { missionContext: { ...missionContext, cycleCount: currentCycle } });
            const traceCycleId = `${missionRunId}:${currentCycle}`;

            const blackboard = (mission.blackboard as Record<string, any>) || {};
            const rawBlackboard = blackboard;

            // Fetch potential student model configs from mission agents
            let studentModelConfig = undefined;
            try {
                const missionAgents = await db
                    .select({ config: jobs.config })
                    .from(missionMembers)
                    .innerJoin(jobs, eq(missionMembers.entityId, jobs.id))
                    .where(and(eq(missionMembers.missionId, mission.id), eq(missionMembers.entityType, 'job')));
                
                for (const agent of missionAgents) {
                    const config = (agent.config as any) || {};
                    if (config.studentModel?.adapterPath) {
                        studentModelConfig = config.studentModel;
                        break; // Use the first one found for now
                    }
                }
            } catch (err) {
                logger.warn(`Failed to resolve student model config: ${err}`);
            }

            // --- DECOUPLED THINKING LAYER ---
            // Resolve step sequence from mission template or pipeline steps
            let stepSequence: any[] = [];
            let currentStepIndex = missionContext?.currentStepIndex ?? 0;
            try {
                const templateConfig = await db.select({ config: missionTemplates.config })
                    .from(missionTemplates)
                    .where(and(eq(missionTemplates.name, mission.name), eq(missionTemplates.organizationId, orgId!)))
                    .limit(1);
                if (templateConfig.length > 0) {
                    const config = templateConfig[0].config as any;
                    stepSequence = (config?.sequence || []).map((step: any) => ({
                        stepCode: step.stepCode || step.step_code,
                        action: step.action,
                        description: step.description,
                        agent: step.agent,
                        tool: step.tool,
                        inputs: step.inputs,
                        outputs: step.outputs,
                        requiresHuman: step.requiresHuman || step.requires_human,
                        estimatedDurationMinutes: step.estimatedDurationMinutes || step.estimated_duration_minutes,
                    }));
                }
            } catch (err: any) {
                logger.warn(`[DynamicOrchestrator] Failed to resolve step sequence: ${err.message}`);
            }

            const orchestrationCtx: OrchestrationContext = {
                missionRunId,
                missionId: mission.id,
                userId: effectiveUserId,
                orgId,
                blackboard,
                missionContext,
                objective: mission.objective || "",
                allowedTools: missionContext?.allowedTools || (mission as any).allowedTools || [],
                cycleCount: currentCycle,
                maxCycles,
                dynamicTrace: run.dynamicTrace as any[],
                effectiveUserEmail,
                studentModelConfig,
                stepSequence,
                currentStepIndex,
                executionStrategy: mission.executionStrategy,
                estimatedDurationHours: (mission as any).estimatedDurationHours ?? null,
            };

            const mlCycleStartMs = Date.now();
            const mlPredictedStrategy = "dynamic_hybrid"; 

            const decisionThought = await orchestrationThinkingService.determineNextAction(orchestrationCtx);
            
            // Map to decision object used by legacy switch below
            const decision = {
                action: decisionThought.action,
                thought_process: decisionThought.reasoning,
                action_details: decisionThought.params,
                params: decisionThought.params
            };

            // --- AUDIT: Capture reasoning ---
            try {
                await reasoningAuditService.capture(missionRunId, "00000000000000000000000000000000", 'hermes_xml', decisionThought.rawResponse);
                await this.appendTrace(missionRunId, { 
                    type: "decision", 
                    cycle: currentCycle,
                    traceCycleId,
                    action: decision.action, 
                    thought: decision.thought_process,
                    params: decision.params,
                    timestamp: new Date().toISOString() 
                });
                await this.flushTraces(missionRunId).catch(e => logger.warn(`[DynamicOrchestrator] Decision flush failed: ${e.message}`));
            } catch (auditErr) {
                logger.warn(`Failed to audit reasoning: ${auditErr}`);
            }

            // --- GOVERNANCE LAYER ---
            const governance = await orchestrationGovernanceService.checkRisk(orchestrationCtx, decisionThought);
            if (governance.needsApproval) {
                const approval = await orchestrationGovernanceService.requestApproval(orchestrationCtx, decisionThought);
                if (!approval.approved) {
                    logger.info(`[DynamicOrchestrator] Action ${decision.action} rejected by user. Reason: ${approval.reason}`);
                    await this.appendTrace(missionRunId, { type: "system", event: "action_rejected", cycle: currentCycle, traceCycleId, note: approval.reason, timestamp: new Date().toISOString() });
                    // Enqueue next cycle so AI can react to rejection
                    await queueMissionCycle({ missionRunId, userId: effectiveUserId, orgId }, 1000);
                    return;
                }
                // If approved but modified, update decision
                if (approval.modifiedOutput) {
                    decision.params = approval.modifiedOutput;
                    decision.action_details = approval.modifiedOutput;
                }
            }

            // --- EXECUTION LAYER ---
            const executionStartTime = Date.now();
            const execution = await orchestrationExecutionService.executeAction(orchestrationCtx, decisionThought);
            const executionLatency = Date.now() - executionStartTime;

            await this.appendTrace(missionRunId, { 
                type: "execution", 
                cycle: currentCycle,
                traceCycleId,
                action: decision.action, 
                success: execution.success,
                result: execution.result,
                error: execution.error,
                latencyMs: executionLatency,
                timestamp: new Date().toISOString() 
            });
            await this.flushTraces(missionRunId).catch(e => logger.warn(`[DynamicOrchestrator] Execution flush failed: ${e.message}`));

            if (execution.concluded) {
                logger.info(`[DynamicOrchestrator] Run ${missionRunId} concluded successfully.`);
                const product = execution.result || "Objective achieved.";
                // Completed, not parked. This set "waiting_on_human" for a deliverable
                // review that nothing ever requested — no approval, no notification — so
                // successful runs sat there indefinitely. Completion now fires the terminal
                // hooks, which complete the mission and notify for review.
                await missionRunService.update(missionRunId, {
                    status: "completed",
                    isSuccess: true,
                    missionContext: { ...missionContext, result: product }
                });
                const productNote = typeof product === 'string' ? product : JSON.stringify(product);
                await this.appendTrace(missionRunId, { type: "system", event: "mission_concluded", note: productNote, timestamp: new Date().toISOString() });
                await this.flushTraces(missionRunId);
                return;
            }

            if (!execution.success && !AGENT_TOOLS[normalizeToolName(decision.action)]) {
                logger.error(`[DynamicOrchestrator] Execution failed: ${execution.error}`);
                await this.appendTrace(missionRunId, { type: "error", event: "execution_failed", cycle: currentCycle, traceCycleId, action: decision.action, error: execution.error, timestamp: new Date().toISOString() });
            }

            // --- PENTAGONAL OODA: SYNTHESIS/CONCLUDE PHASE ---
            // Run synthesis after execution to analyze, learn, and determine next steps
            try {
                const { synthesisGovernorService } = await import("./synthesis-governor.service.js");
                
                // Build execution trace from dynamic trace
                const [updatedRun] = await db.select({ dynamicTrace: missionRuns.dynamicTrace }).from(missionRuns).where(eq(missionRuns.id, missionRunId)).limit(1);
                const currentTrace = (updatedRun?.dynamicTrace as any[]) || [];
                const executionTrace = this.buildExecutionTraceFromDynamicTrace(currentTrace);

                const synthesisContext = {
                    missionRunId,
                    missionId: mission.id,
                    organizationId: assertOrgId(orgId),
                    objective: mission.objective || "",
                    blackboard: blackboard as Record<string, any>,
                    executionTrace,
                    budgetUsed: parseFloat(String(missionContext?.budgetUsed || 0)),
                    budgetLimit: parseFloat(String(mission.budgetLimitUsd || 50)),
                    cycleCount: currentCycle,
                    maxCycles
                };

                const synthesis = await synthesisGovernorService.synthesize(synthesisContext);
                
                logger.info(`[DynamicOrchestrator] Synthesis complete for run ${missionRunId}`, {
                    recommendation: synthesis.conclusion.recommendation,
                    confidence: synthesis.conclusion.confidence,
                    completionStatus: synthesis.conclusion.completionStatus
                });

                await this.appendTrace(missionRunId, { 
                    type: "system", 
                    event: "synthesis_complete", 
                    note: `Synthesis: ${synthesis.conclusion.recommendation} (${Math.round(synthesis.conclusion.confidence * 100)}% confidence)`,
                    synthesis: {
                        recommendation: synthesis.conclusion.recommendation,
                        completionStatus: synthesis.conclusion.completionStatus,
                        confidence: synthesis.conclusion.confidence
                    },
                    timestamp: new Date().toISOString() 
                });

                // Handle synthesis conclusion
                if (synthesis.conclusion.recommendation === 'conclude') {
                    const product = synthesis.conclusion.finalOutputs?.[0] || "Objective achieved via synthesis.";
                    await missionRunService.update(missionRunId, { 
                        status: "completed",
                        missionContext: { ...missionContext, result: product }
                    });
                    await this.appendTrace(missionRunId, { 
                        type: "system", 
                        event: "mission_concluded_synthesis", 
                        note: `Mission concluded by synthesis: ${synthesis.conclusion.reasoning}`,
                        timestamp: new Date().toISOString() 
                    });
                    await this.flushTraces(missionRunId);
                    return;
                }

                if (synthesis.conclusion.recommendation === 'escalate') {
                    await missionRunService.update(missionRunId, { 
                        status: "waiting_on_human",
                        missionContext: { 
                            ...missionContext, 
                            synthesisResult: synthesis,
                            escalationReason: synthesis.conclusion.reasoning 
                        }
                    });
                    await this.appendTrace(missionRunId, { 
                        type: "system", 
                        event: "mission_escalated_synthesis", 
                        note: `Escalated: ${synthesis.conclusion.reasoning}`,
                        timestamp: new Date().toISOString() 
                    });
                    await this.flushTraces(missionRunId);
                    return;
                }

                // For 'continue' or 'retry', apply adjustments to next cycle
                if (synthesis.conclusion.nextCycleAdjustments && synthesis.conclusion.nextCycleAdjustments.length > 0) {
                    await missionRunService.update(missionRunId, {
                        missionContext: {
                            ...missionContext,
                            synthesisAdjustments: synthesis.conclusion.nextCycleAdjustments,
                            lastSynthesisResult: synthesis
                        }
                    });
                }

                // --- PSBS: Feed synthesis confidence back to steering α ---
                // Low confidence → steer harder next cycle; high → relax
                try {
                    const confidence = synthesis.conclusion.confidence ?? 0.5;
                    const currentAlpha = missionContext._steeringAlpha;
                    const humanOverride = typeof currentAlpha === "number";

                    if (!humanOverride) {
                        const defaultAlpha = 0.6;
                        let nextAlpha = defaultAlpha;
                        if (confidence < 0.4) {
                            // Low confidence: increase steering (steer harder toward proven paths)
                            nextAlpha = Math.min(1.0, defaultAlpha + 0.15);
                        } else if (confidence > 0.75) {
                            // High confidence: relax steering (agent is on track)
                            nextAlpha = Math.max(0.2, defaultAlpha - 0.1);
                        }

                        // Resolve the active golden path ID for caching (avoid re-query next cycle)
                        const steeringGpId = orchestrationCtx.steeringVector?.goldenPathId;
                        const steeringGpSnippet = orchestrationCtx.steeringVector?.goldenPathSnippet;

                        await missionRunService.update(missionRunId, {
                            missionContext: {
                                ...missionContext,
                                _lastSynthesisConfidence: confidence,
                                _steeringAlphaAuto: nextAlpha,
                                ...(steeringGpId ? { _steeringGoldenPathId: steeringGpId } : {}),
                                ...(steeringGpSnippet ? { _steeringGoldenPathSnippet: steeringGpSnippet } : {}),
                            }
                        });
                        logger.info(`[DynamicOrchestrator] PSBS: Steering α updated to ${nextAlpha.toFixed(2)} (synthesis confidence: ${(confidence * 100).toFixed(0)}%)`);
                    }
                } catch (steeringFeedbackErr: any) {
                    logger.warn(`[DynamicOrchestrator] PSBS: Steering α feedback failed (non-fatal): ${steeringFeedbackErr.message}`);
                }

            } catch (synthesisError: any) {
                logger.warn(`[DynamicOrchestrator] Synthesis phase failed, continuing without synthesis`, synthesisError);
                // Non-blocking: continue with normal flow if synthesis fails
            }

            // If it was a tool call, orchestrationExecutionService already handled it.
            // We just need to enqueue the next cycle and exit this one.
            if (AGENT_TOOLS[normalizeToolName(decision.action)]) {
                await queueMissionCycle({ missionRunId, userId: effectiveUserId, orgId }, 3000);
                await this.flushTraces(missionRunId);
                return;
            }

            const normalizedAction = decision.action.toUpperCase();
            let actionHandled = true;
            
            const actionCtx: ActionContext = {
                ...orchestrationCtx,
                mlPredictedStrategy,
                mlCycleStartMs,
                currentCycle,
                appendTrace: this.appendTrace.bind(this),
                trackAsset: this.trackAsset.bind(this),
            };

            // Store predicted tool for outcome tracking
            try {
                const { missionReplayService } = await import("./mission-replay.service.js");
                const nextPredictedTool = await missionReplayService.predictNextTool(missionRunId, mission.id, decision.action);
                if (nextPredictedTool) {
                    await missionService.updateBlackboard(mission.id, {
                        _predictedTool: nextPredictedTool.tool,
                        _predictedToolConfidence: nextPredictedTool.confidence,
                    }, "agent:predictor", "prediction");
                }
            } catch { /* non-blocking */ }

            const handler = actionHandlers[normalizedAction];
            if (handler) {
                const result = await runActionWithRuntimeKernel({
                    ctx: actionCtx,
                    decision,
                    handler,
                    traceCycleId,
                    loadSnapshot: () => this.captureActionRuntimeSnapshot(missionRunId, mission.id, {
                        status: run.status,
                        blackboard: actionCtx.blackboard,
                        missionContext: actionCtx.missionContext,
                    }),
                });
                if (result && result.status === "paused") {
                    await this.flushTraces(missionRunId).catch(e => logger.warn(`[DynamicOrchestrator] Pause flush failed: ${e.message}`));
                    return result; // Propagate pause
                }
            } else {
                if (normalizedAction !== "CALL_TOOL") {
                    logger.warn(`[DynamicOrchestrator] Unrecognized action: ${decision.action}`);
                    await this.appendTrace(missionRunId, { 
                        type: "error", 
                        event: "unknown_action", 
                        error: `The action '${decision.action}' is not recognized by the system. Please verify the tool name and choose from the available tools list: ${orchestrationCtx.allowedTools.join(', ')}`, 
                        timestamp: new Date().toISOString() 
                    });
                    actionHandled = false;
                }
            }

            // --- SELF-HEALING: Enqueue recovery cycle for unrecognized or failed non-tool actions ---
            if (!actionHandled || !execution.success) {
                logger.info(`[DynamicOrchestrator] Enqueuing recovery cycle for run ${missionRunId}`);
                await queueMissionCycle({ missionRunId, userId, orgId }, 2000);
            }

            // --- STRUCTURED CYCLE TELEMETRY ---
            this.emitCycleTelemetry({
                missionRunId,
                missionId: mission.id,
                orgId,
                cycle: currentCycle,
                action: decision.action,
                toolName: decision.action === "CALL_TOOL" ? (decision as any).action_details?.tool_name : undefined,
                success: execution.success,
                latencyMs: Date.now() - mlCycleStartMs,
            }).catch(() => {}); // Non-blocking; never fail the cycle for telemetry

            // --- FINAL FLUSH ---
            await this.flushTraces(missionRunId).catch(e => logger.error(`Final flush failed: ${e.message}`));

        } catch (error: any) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`[DynamicOrchestrator] Terminal error in cycle loop for run ${missionRunId}: ${errorMessage}`);
            
            // 1. IMMEDIATE TRACE: Cap the trace first before anything else that might fail
            await this.appendTrace(missionRunId, { 
                type: "error", 
                event: "loop_failed", 
                error: errorMessage, 
                stack: error?.stack,
                timestamp: new Date().toISOString() 
            });

            // 2. Try to record the error in context for UI visibility
            try {
                const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, missionRunId)).limit(1);
                const context = (run?.missionContext as any) || {};
                await this.updateContextWithError(missionRunId, context, errorMessage);
            } catch (inner: any) {
                logger.error(`[DynamicOrchestrator] Failed to update context with error: ${inner.message}`);
            }

            // 3. Mark run as failed
            await missionRunService.update(missionRunId, { 
                status: "failed",
                failureReason: errorMessage
            }).catch(e => logger.error(`[DynamicOrchestrator] Failed to set failed status for ${missionRunId}: ${e.message}`));
        }
    },

    async captureActionRuntimeSnapshot(
        missionRunId: number,
        missionId: number,
        fallback: { status?: string; blackboard?: unknown; missionContext?: unknown }
    ) {
        try {
            const [missionRow] = await db
                .select({ blackboard: missions.blackboard })
                .from(missions)
                .where(eq(missions.id, missionId))
                .limit(1);
            const [runRow] = await db
                .select({ status: missionRuns.status, missionContext: missionRuns.missionContext })
                .from(missionRuns)
                .where(eq(missionRuns.id, missionRunId))
                .limit(1);

            return createRuntimeSnapshot({
                status: runRow?.status ?? fallback.status,
                blackboard: missionRow?.blackboard ?? fallback.blackboard,
                missionContext: runRow?.missionContext ?? fallback.missionContext,
            });
        } catch (snapshotErr: any) {
            logger.warn(`[DynamicOrchestrator] Failed to capture action runtime snapshot: ${snapshotErr.message}`);
            return createRuntimeSnapshot(fallback);
        }
    },


    buildExecutionTraceFromDynamicTrace(dynamicTrace: any[] = []) {
        const traceWithIndex = dynamicTrace.map((entry, index) => ({ entry, index }));
        const usedExecutions = new Set<number>();
        const usedErrors = new Set<number>();
        const executionTrace: Array<{
            cycle: number;
            action: string;
            params: Record<string, unknown>;
            result: "failure" | "success";
            output: any;
            error: string | undefined;
            latencyMs: number;
            costUsd: number;
        }> = [];

        const sameTraceCycle = (left: any, right: any) => {
            if (left.traceCycleId && right.traceCycleId) return left.traceCycleId === right.traceCycleId;
            if (left.cycle != null && right.cycle != null) return left.cycle === right.cycle;
            return left.action && right.action && left.action === right.action;
        };

        for (const { entry: decision, index: decisionIndex } of traceWithIndex) {
            if (decision.type !== "decision") continue;

            const executionMatch = traceWithIndex.find(({ entry, index }) =>
                index > decisionIndex &&
                entry.type === "execution" &&
                !usedExecutions.has(index) &&
                sameTraceCycle(decision, entry)
            );
            if (executionMatch) usedExecutions.add(executionMatch.index);

            const errorMatch = traceWithIndex.find(({ entry, index }) =>
                index > decisionIndex &&
                entry.type === "error" &&
                !usedErrors.has(index) &&
                sameTraceCycle(decision, entry)
            );
            if (errorMatch) usedErrors.add(errorMatch.index);

            const execution = executionMatch?.entry;
            const error = errorMatch?.entry;
            const latencyMs = Number(execution?.latencyMs);

            executionTrace.push({
                cycle: Number(decision.cycle ?? execution?.cycle ?? executionTrace.length + 1),
                action: decision.action || "unknown",
                params: decision.params || {},
                result: execution ? (execution.success ? "success" : "failure") : (error ? "failure" : "success"),
                output: execution?.result ?? execution?.output ?? decision.note ?? decision.result ?? "",
                error: execution?.error ?? error?.error,
                latencyMs: Number.isFinite(latencyMs) && latencyMs > 0 ? latencyMs : 0,
                costUsd: Number(execution?.costUsd ?? decision.costUsd ?? 0) || 0
            });
        }

        return executionTrace;
    },


    async appendTrace(missionRunId: number, traceEntry: any) {
        try {
            // Buffer trace in Redis to reduce DB I/O
            const bufferKey = `mission:trace:buffer:${missionRunId}`;
            await redis.rpush(bufferKey, JSON.stringify(traceEntry));
            await redis.expire(bufferKey, TRACE_BUFFER_TTL);
            
            logger.debug(`[DynamicOrchestrator] Buffered trace for run ${missionRunId}`);
        } catch (err: any) {
            logger.error(`[DynamicOrchestrator] Trace buffer failed for run ${missionRunId}: ${err.message}`);
        }
    },

    /**
     * Flushes buffered traces from Redis to PostgreSQL.
     */
    async flushTraces(missionRunId: number) {
        const bufferKey = `mission:trace:buffer:${missionRunId}`;
        try {
            const buffered = await redis.lrange(bufferKey, 0, -1);
            if (!buffered || buffered.length === 0) return;

            const traceEntries = buffered.map(t => JSON.parse(t));
            
            await db.update(missionRuns)
                .set({ 
                    dynamicTrace: sql`COALESCE(dynamic_trace, '[]'::jsonb) || ${JSON.stringify(traceEntries)}::jsonb`,
                    updatedAt: new Date() 
                })
                .where(eq(missionRuns.id, missionRunId));

            // Only remove from Redis what we actually persisted
            await redis.ltrim(bufferKey, buffered.length, -1);

            logger.info(`[DynamicOrchestrator] Flushed ${traceEntries.length} traces to DB for run ${missionRunId}`);
        } catch (err: any) {
            logger.error(`[DynamicOrchestrator] Trace flush failed for run ${missionRunId}: ${err.message}`);
        }
    },

    async trackAsset(missionRunId: number, asset: any) {
        try {
            const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, missionRunId)).limit(1);
            if (!run) return;
            
            const context = (run.missionContext as any) || {};
            const tracked = context.tracked_assets || [];
            
            // Check for duplicates
            const isDuplicate = tracked.some((a: any) => 
                a.type === asset.type && 
                (asset.id ? a.id === asset.id : a.name === asset.name || a.description === asset.description)
            );

            if (!isDuplicate) {
                const updatedContext = {
                    ...context,
                    tracked_assets: [...tracked, { ...asset, timestamp: new Date().toISOString() }]
                };
                await missionRunService.update(missionRunId, { missionContext: updatedContext });
                logger.info(`[DynamicOrchestrator] Tracked new asset for run ${missionRunId}: ${asset.type} ${asset.name || asset.id || ''}`);
            }
        } catch (err: any) {
            logger.error(`[DynamicOrchestrator] Failed to track asset: ${err.message}`);
        }
    },

    async emitCycleTelemetry(data: {
        missionRunId: number;
        missionId: number;
        orgId: number | null;
        cycle: number;
        action: string;
        toolName?: string;
        success: boolean;
        latencyMs: number;
    }) {
        try {
            await db.insert(sourcePerformanceLogs).values({
                source: data.toolName || data.action,
                missionType: "orchestrator_cycle",
                success: data.success,
                yieldedInfo: data.success,
                organizationId: data.orgId,
            });
        } catch {
            // Telemetry is non-fatal
        }
    },

    async updateContextWithError(missionRunId: number, currentContext: any, errorMsg: string) {
        try {
            await missionRunService.update(missionRunId, {
                missionContext: {
                    ...currentContext,
                    last_error: {
                        message: errorMsg,
                        timestamp: new Date().toISOString()
                    }
                }
            });
        } catch (err: any) {
            logger.error(`[DynamicOrchestrator] Failed to update context with error: ${err.message}`);
        }
    }

};


