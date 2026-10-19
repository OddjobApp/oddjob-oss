import {
    CreateMissionInput,
    DeleteMissionInput,
    PlanMissionInput,
    ListMissionTemplatesInput,
    InstantiateMissionTemplateInput,
    ChatWithMissionInput,
    GetMissionMemoriesInput,
    GetMissionTimelineInput,
    GetMissionActivityInput,
    PromoteShadowRunInput,
    GetMissionSuggestionsInput,
    UpdateMissionMembersInput,
    GetMissionStatusInput,
    GetMissionReplayHistoryInput,
    ReplayMissionFromCheckpointInput,
    CompareMissionRunsInput,
    GetMissionExecutionHeatmapInput,
    StartMissionDebugSessionInput,
    PauseMissionInput,
    ResumeMissionInput,
    StepMissionInput,
    InspectMissionStateInput,
    ModifyMissionVariableInput,
    AddMissionBreakpointInput,
    RemoveMissionBreakpointInput,
    GetCircuitBreakerStatusInput,
    ResetCircuitBreakerInput,
    ConfigureCircuitBreakerInput,
    GetDeadLetterQueueInput,
    ReplayDeadLetterInput,
    RemoveDeadLetterInput,
    GetRetryStatsInput,
    AddMissionDependencyInput,
    RemoveMissionDependencyInput,
    GetMissionDependenciesInput,
    GetDependencyGraphInput,
    CheckDependenciesSatisfiedInput,
    GetExecutionOrderInput,
    CreateMissionWorkflowInput,
    GetMissionWorkflowsInput,
    GenerateMissionPlanInput,
    GetMissionPatternsInput,
    GetToolRecommendationsInput,
    EstimateMissionCompletionInput,
    AssessMissionRiskInput,
    FindSimilarMissionsInput,
    GetSelfHealingStatsInput,
    GetFailurePatternsInput,
    GetActiveEscalationsInput,
    AcknowledgeEscalationInput,
    ResolveEscalationInput,
    CreateAgentInput,
    GetAgentsInput,
    SendAgentMessageInput,
    CreateConsensusProposalInput,
    CastConsensusVoteInput,
    AssignAgentTaskInput,
    UpdateAgentTaskStatusInput,
    DetectConflictInput,
    GetMissionCoordinationStatsInput,
    CreateCoordinatorPoolInput,
    PostAgentBlackboardItemInput,
    ReadAgentBlackboardInput,
    ClaimAgentTaskInput,
    GetCoordinationTrajectoriesInput,
    RecordAffordanceObservationInput,
    QueryAffordancesInput,
    SuggestAffordanceActionsInput,
} from "../tools/missions.js";
import { missionService } from "../../domain/mission/index.js";
import { missionRunService } from "../../domain/mission/core/mission-run.service.js";
import { missionTimeoutService } from "../../domain/mission/core/mission-timeout.service.js";
import { missionReplayService } from "../../domain/mission/core/mission-replay.service.js";
import { missionDebugService } from "../../domain/mission/core/mission-debug.service.js";
import { circuitBreakerService } from "../../domain/mission/core/circuit-breaker.service.js";
import { missionRetryService } from "../../domain/mission/core/retry.service.js";
import { missionDependenciesService } from "../../domain/mission/core/mission-dependencies.service.js";
import { predictivePlanningService } from "../../domain/mission/core/predictive-planning.service.js";
import { selfHealingService } from "../../domain/mission/core/self-healing.service.js";
import { multiAgentCoordinationService } from "../../domain/mission/core/multi-agent-coordination.service.js";
import { affordanceMapService } from "../../domain/mission/core/affordance-map.service.js";
import {
    successResponse,
    errorResponse,
    getOrgContext,
    createHandlerWrapper,
    type ToolContext
} from "./utils.js";
import { db } from "../../database_service.js";
import { missions, missionRuns, missionMembers, missionShadowRuns, pipelineExecutions, missionSuggestions, aiUsageLogs } from "@shared/schema/index.js";
import { eq, and, desc, sql, isNull } from "drizzle-orm";
import { assertOrgId } from "@server/utils/auth-context.js";

export const handleCreateMission = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = CreateMissionInput.parse(args);
        const orgContext = getOrgContext(context);

        const [mission] = await db.insert(missions)
            .values({
                name: input.name,
                objective: input.objective,
                executionStrategy: input.executionStrategy || "pre_planned",
                organizationId: input.orgId || orgContext.organizationId,
                createdBy: context?.userId || "system",
                blackboard: {},
            })
            .returning();

        return successResponse(mission, `Created mission "${mission.name}" with ID ${mission.id}`);
    },
    { requireAdmin: true }
);

export const handleDeleteMission = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = DeleteMissionInput.parse(args);
        const orgContext = getOrgContext(context);

        // Verify ownership before deleting
        const [mission] = await db.select()
            .from(missions)
            .where(eq(missions.id, input.missionId))
            .limit(1);

        if (!mission) {
            throw new Error("Mission not found");
        }

        if (orgContext.organizationId && mission.organizationId !== orgContext.organizationId) {
            throw new Error("Access denied");
        }

        await db.delete(missions).where(eq(missions.id, input.missionId));
        return successResponse({ id: input.missionId }, `Deleted mission ${input.missionId}`);
    },
    { requireAdmin: true }
);

export const handlePlanMission = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = PlanMissionInput.parse(args);
        const orgContext = getOrgContext(context);

        const { missionExecutionService } = await import("../../domain/mission/core/mission-execution.service.js");
        const plan = await missionExecutionService.planMission(
            input.prompt,
            context?.userId || "system",
            assertOrgId(orgContext.organizationId),
            input.history || []
        );

        return successResponse(plan, "AI mission plan generated");
    }
);

export const handleListMissionTemplates = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = ListMissionTemplatesInput.parse(args);
        const orgContext = getOrgContext(context);

        const templates = await missionService.listTemplates(orgContext.organizationId || assertOrgId(input.orgId));
        return successResponse(templates, `Found ${templates.length} mission templates`);
    }
);

export const handleInstantiateMissionTemplate = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = InstantiateMissionTemplateInput.parse(args);
        const orgContext = getOrgContext(context);

        const newMission = await missionService.instantiateTemplate(
            input.templateId,
            input.name,
            context?.userId || "system",
            assertOrgId(orgContext.organizationId)
        );

        return successResponse(newMission, `Created mission "${newMission.name}" from template`);
    },
    { requireAdmin: true }
);

export const handleChatWithMission = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = ChatWithMissionInput.parse(args);
        const orgContext = getOrgContext(context);

        // Use the existing chat endpoint logic
        const workgroup = await missionService.getMissionDetail(input.missionId);
        if (!workgroup) {
            throw new Error("Mission not found");
        }

        // Check for active runs
        const activeRuns = await db.select()
            .from(pipelineExecutions)
            .where(sql`${pipelineExecutions.missionId} = ${input.missionId} AND ${pipelineExecutions.status} = 'running'`);

        if (activeRuns.length === 0) {
            return successResponse({
                reply: "No active mission run. Please launch the mission first.",
                hasActiveRun: false
            }, "No active run");
        }

        // Fire-and-forget the AI chat response
        const { systemAiService } = await import("../../domain/ai/core/system-ai.service.js");
        const { AIClientFactory } = await import("@domain/ai/core/ai-client.service.js");

        const aiConfig = await systemAiService.getAiConfig('copilot', workgroup.organizationId ?? undefined);
        if (!aiConfig?.apiKey) {
            throw new Error("AI not configured");
        }

        const missionRagContext = await missionService.getMissionRagContext(input.missionId);
        const client = AIClientFactory.getClient({
            provider: aiConfig.provider,
            baseUrl: aiConfig.baseUrl
        } as any);

        const aiReply = await client.execute({
            model: aiConfig.model || "gemini-1.5-pro",
            systemPrompt: `You are Mission Control. Active mission: ${workgroup.objective}. Context: ${JSON.stringify(missionRagContext)}`,
            userPrompt: input.message,
            temperature: 0.7,
            useCache: false,
            saveOutputToFile: false,
            credentialId: aiConfig.credentialId || 0,
            isPriority: true
        }, undefined, aiConfig.apiKey);

        return successResponse({
            reply: aiReply.output || "I am processing your request.",
            hasActiveRun: true
        }, "Mission Control replied");
    }
);

export const handleGetMissionMemories = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = GetMissionMemoriesInput.parse(args);
        const { memoryService } = await import("../../domain/mission/core/memory.service.js");

        const memories = await memoryService.getRelevantMemories(input.missionId, input.limit);
        return successResponse(memories, `Retrieved ${memories.length} memories`);
    }
);

export const handleGetMissionTimeline = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = GetMissionTimelineInput.parse(args);

        const timeline = await missionRunService.getTimeline(input.missionRunId, input.limit);
        return successResponse(timeline, `Retrieved ${timeline.length} timeline entries`);
    }
);

export const handleGetMissionActivity = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = GetMissionActivityInput.parse(args);

        const activity = await missionService.getActivity(input.missionId);
        return successResponse(activity, "Retrieved mission activity");
    }
);

export const handlePromoteShadowRun = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = PromoteShadowRunInput.parse(args);

        const [shadow] = await db.select()
            .from(missionShadowRuns)
            .where(eq(missionShadowRuns.id, input.shadowRunId))
            .limit(1);

        if (!shadow) return errorResponse("Shadow run not found");

        // Promote to blueprint
        await db.update(missions)
            .set({ 
                workflowBlueprint: shadow.missionContext as any,
                updatedAt: new Date()
            })
            .where(eq(missions.id, shadow.parentRunId));

        const result = { success: true };

        return successResponse(result, `Promoted shadow run to blueprint "${input.name}"`);
    },
    { requireAdmin: true }
);

export const handleGetMissionSuggestions = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = GetMissionSuggestionsInput.parse(args);

        const suggestions = await db.select()
            .from(missionSuggestions)
            .where(eq(missionSuggestions.missionId, input.missionId))
            .orderBy(desc(missionSuggestions.createdAt));
        return successResponse(suggestions, `Retrieved ${suggestions.length} suggestions`);
    }
);

export const handleUpdateMissionMembers = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = UpdateMissionMembersInput.parse(args);
        const orgContext = getOrgContext(context);

        // Add members
        if (input.addMembers && input.addMembers.length > 0) {
            for (const member of input.addMembers) {
                await db.insert(missionMembers).values({
                    missionId: input.missionId,
                    entityType: member.entityType,
                    entityId: member.entityId,
                    role: member.role,
                    status: "active",
                });
            }
        }

        // Remove members
        if (input.removeMemberIds && input.removeMemberIds.length > 0) {
            for (const memberId of input.removeMemberIds) {
                await db.delete(missionMembers)
                    .where(sql`${missionMembers.id} = ${memberId} AND ${missionMembers.missionId} = ${input.missionId}`);
            }
        }

        return successResponse({
            added: input.addMembers?.length || 0,
            removed: input.removeMemberIds?.length || 0
        }, "Updated mission members");
    },
    { requireAdmin: true }
);

export const handleGetMissionStatus = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = GetMissionStatusInput.parse(args);

        // Get mission run details
        const [run] = await db.select()
            .from(missionRuns)
            .where(eq(missionRuns.id, input.missionRunId))
            .limit(1);

        if (!run) {
            return errorResponse(`Mission run ${input.missionRunId} not found`);
        }

        // Get remaining time
        const remainingMinutes = await missionTimeoutService.getRemainingTimeMinutes(input.missionRunId);

        // Get associated mission for additional context
        const [mission] = await db.select()
            .from(missions)
            .where(eq(missions.id, run.missionId!))
            .limit(1);

        const missionContext = (run.missionContext as Record<string, any>) || {};

        return successResponse({
            missionRunId: run.id,
            missionId: run.missionId,
            missionName: mission?.name,
            status: run.status,
            executionStrategy: missionContext.executionStrategy || 'pre_planned',
            phase: missionContext.phase,
            currentWave: missionContext.current_wave,
            cycleCount: missionContext.cycleCount,
            startedAt: (run.missionContext as any)?._correlation?.startedAt || run.createdAt,
            completedAt: run.status === 'completed' ? run.updatedAt : null,
            durationMs: run.status === 'completed' ? (run.updatedAt.getTime() - run.createdAt.getTime()) : null,
            isSuccess: (run as any).isSuccess,
            failureReason: (run as any).failureReason,
            result: (run as any).isSuccess ? 'success' : (run.status === 'failed' ? 'failed' : null),
            remainingMinutes,
            maxDurationMinutes: missionContext.maxDurationMinutes || 
                               missionContext.rulesOfEngagement?.maxDurationMinutes ||
                               30,
            isTimeoutImminent: remainingMinutes !== null && remainingMinutes < 5,
            blackboardKeys: Object.keys(missionContext).filter(k => 
                !['phase', 'current_wave', 'max_waves', 'crew', 'intent', 'executionStrategy', 
                  'rulesOfEngagement', 'cycleCount', 'allowedTools'].includes(k)
            )
        }, `Mission run ${run.id} status: ${run.status}`);
    }
);

// Replay handlers
export const handleGetMissionReplayHistory = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = GetMissionReplayHistoryInput.parse(args);
        const result = await missionReplayService.getReplayHistory(input.missionRunId);
        return result.success 
            ? successResponse(result, `Retrieved replay history for run ${input.missionRunId}`)
            : errorResponse(result.error || "Failed to retrieve replay history");
    }
);

export const handleReplayMissionFromCheckpoint = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = ReplayMissionFromCheckpointInput.parse(args);
        const orgContext = getOrgContext(context);
        const result = await missionReplayService.replayFromCheckpoint(
            input.missionRunId,
            input.checkpointId,
            context?.userId || "system",
            {
                modifyParameters: input.modifyParameters,
                dryRun: input.dryRun
            }
        );
        return result.success 
            ? successResponse(result, `Replay started from checkpoint ${input.checkpointId}`)
            : errorResponse(result.error || "Failed to start replay");
    }
);

export const handleCompareMissionRuns = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = CompareMissionRunsInput.parse(args);
        const result = await missionReplayService.compareRuns(input.runIdA, input.runIdB);
        return result.success 
            ? successResponse(result, `Compared runs ${input.runIdA} and ${input.runIdB}`)
            : errorResponse(result.error || "Failed to compare runs");
    }
);

export const handleGetMissionExecutionHeatmap = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = GetMissionExecutionHeatmapInput.parse(args);
        const result = await missionReplayService.getExecutionHeatmap(input.missionRunId);
        return result.success 
            ? successResponse(result, `Retrieved execution heatmap for run ${input.missionRunId}`)
            : errorResponse(result.error || "Failed to retrieve heatmap");
    }
);

// Debug handlers
export const handleStartMissionDebugSession = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = StartMissionDebugSessionInput.parse(args);
        const session = await missionDebugService.startDebugSession(
            input.missionRunId,
            { autoPauseOnStart: input.autoPauseOnStart }
        );
        return successResponse({
            sessionId: session.correlationId,
            status: session.status,
            breakpoints: session.breakpoints,
        }, `Debug session started for run ${input.missionRunId}`);
    }
);

export const handlePauseMission = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = PauseMissionInput.parse(args);
        const session = await missionDebugService.pause(input.missionRunId);
        if (!session) {
            return errorResponse(`No debug session for run ${input.missionRunId}`);
        }
        return successResponse({ status: session.status }, `Mission ${input.missionRunId} paused`);
    }
);

export const handleResumeMission = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = ResumeMissionInput.parse(args);
        const session = await missionDebugService.resume(input.missionRunId);
        if (!session) {
            return errorResponse(`No debug session for run ${input.missionRunId}`);
        }
        return successResponse({ status: session.status }, `Mission ${input.missionRunId} resumed`);
    }
);

export const handleStepMission = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = StepMissionInput.parse(args);
        let session;
        
        switch (input.stepType) {
            case 'into':
                session = await missionDebugService.stepInto(input.missionRunId);
                break;
            case 'out':
                session = await missionDebugService.continueUntilBreakpoint(input.missionRunId);
                break;
            case 'over':
            default:
                session = await missionDebugService.stepOver(input.missionRunId);
        }
        
        if (!session) {
            return errorResponse(`No debug session for run ${input.missionRunId}`);
        }
        
        return successResponse({ 
            status: session.status,
            stepMode: session.stepMode 
        }, `Step ${input.stepType} initiated for run ${input.missionRunId}`);
    }
);

export const handleInspectMissionState = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = InspectMissionStateInput.parse(args);
        
        // Get current mission context
        const [run] = await db.select()
            .from(missionRuns)
            .where(eq(missionRuns.id, input.missionRunId))
            .limit(1);
        
        if (!run) {
            return errorResponse(`Mission run ${input.missionRunId} not found`);
        }
        
        const result = await missionDebugService.inspect(
            input.missionRunId,
            run.missionContext as Record<string, any> || {}
        );
        
        if (!result) {
            return errorResponse(`No debug session for run ${input.missionRunId}`);
        }
        
        return successResponse(result, `Mission ${input.missionRunId} state inspection`);
    }
);

export const handleModifyMissionVariable = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = ModifyMissionVariableInput.parse(args);
        const result = await missionDebugService.modifyVariable(
            input.missionRunId,
            input.path,
            input.value
        );
        
        return result.success 
            ? successResponse(result, `Variable ${input.path} modified`)
            : errorResponse(result.error || "Failed to modify variable");
    }
);

export const handleAddMissionBreakpoint = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = AddMissionBreakpointInput.parse(args);
        const breakpoint = await missionDebugService.addBreakpoint(input.missionRunId, {
            type: input.type,
            target: input.target,
            condition: input.condition,
            enabled: input.enabled,
        });
        
        if (!breakpoint) {
            return errorResponse(`No debug session for run ${input.missionRunId}`);
        }
        
        return successResponse(breakpoint, `Breakpoint added for run ${input.missionRunId}`);
    }
);

export const handleRemoveMissionBreakpoint = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = RemoveMissionBreakpointInput.parse(args);
        const success = await missionDebugService.removeBreakpoint(
            input.missionRunId,
            input.breakpointId
        );
        
        return success 
            ? successResponse({}, `Breakpoint ${input.breakpointId} removed`)
            : errorResponse(`Failed to remove breakpoint`);
    }
);

// Circuit Breaker handlers
export const handleGetCircuitBreakerStatus = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = GetCircuitBreakerStatusInput.parse(args);
        
        if (input.toolName) {
            const stats = circuitBreakerService.getStats(input.toolName);
            return successResponse(stats, `Circuit status for ${input.toolName}`);
        } else {
            const allCircuits = circuitBreakerService.getAllCircuits();
            const summary = circuitBreakerService.getSummary();
            return successResponse({
                summary,
                circuits: allCircuits,
            }, `Circuit breaker status - ${summary.open} open, ${summary.closed} closed`);
        }
    }
);

export const handleResetCircuitBreaker = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = ResetCircuitBreakerInput.parse(args);
        
        circuitBreakerService.reset(input.toolName);
        
        return successResponse({}, input.toolName 
            ? `Circuit breaker for ${input.toolName} has been reset`
            : 'All circuit breakers have been reset'
        );
    }
);

export const handleConfigureCircuitBreaker = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = ConfigureCircuitBreakerInput.parse(args);
        
        circuitBreakerService.configure(input.toolName, {
            failureThreshold: input.failureThreshold,
            recoveryTimeout: input.recoveryTimeout,
            halfOpenMaxCalls: input.halfOpenMaxCalls,
            successThreshold: input.successThreshold,
        });
        
        return successResponse({}, `Circuit breaker for ${input.toolName} configured`);
    }
);

// Retry management handlers
export const handleGetDeadLetterQueue = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = GetDeadLetterQueueInput.parse(args);
        
        const queue = missionRetryService.getDeadLetterQueue({
            toolName: input.toolName,
            limit: input.limit,
            since: input.since ? new Date(input.since) : undefined,
        });
        
        return successResponse({
            entries: queue,
            count: queue.length,
        }, `Retrieved ${queue.length} dead letter entries`);
    }
);

export const handleReplayDeadLetter = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = ReplayDeadLetterInput.parse(args);
        
        // Note: Actual replay would require the original function context
        // This is a simplified version - in production you'd need to store
        // and restore the original execution context
        const result = await missionRetryService.replayDeadLetter(
            input.entryId,
            async () => {
                // Placeholder - actual implementation would restore and replay
                throw new Error('Replay not implemented for this entry type');
            }
        );
        
        if (!result) {
            return errorResponse(`Entry ${input.entryId} not found`);
        }
        
        return result.success
            ? successResponse(result, `Replayed entry ${input.entryId} successfully`)
            : errorResponse(result.error?.message || 'Replay failed');
    }
);

export const handleRemoveDeadLetter = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = RemoveDeadLetterInput.parse(args);
        
        const removed = missionRetryService.removeFromDeadLetter(input.entryId);
        
        return removed
            ? successResponse({}, `Removed entry ${input.entryId} from dead letter queue`)
            : errorResponse(`Entry ${input.entryId} not found`);
    }
);

export const handleGetRetryStats = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const stats = missionRetryService.getStats();
        
        return successResponse(stats, 'Retry service statistics');
    }
);

// Mission Dependencies handlers
export const handleAddMissionDependency = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = AddMissionDependencyInput.parse(args);
        
        const dependency = await missionDependenciesService.addDependency(
            input.sourceMissionId,
            input.targetMissionId,
            input.type,
            input.condition
        );
        
        return successResponse(dependency, `Created ${input.type} dependency: ${input.sourceMissionId} → ${input.targetMissionId}`);
    }
);

export const handleRemoveMissionDependency = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = RemoveMissionDependencyInput.parse(args);
        
        const removed = await missionDependenciesService.removeDependency(input.dependencyId);
        
        return removed
            ? successResponse({}, `Removed dependency ${input.dependencyId}`)
            : errorResponse(`Dependency ${input.dependencyId} not found`);
    }
);

export const handleGetMissionDependencies = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = GetMissionDependenciesInput.parse(args);
        
        const dependencies = missionDependenciesService.getDependencies(input.missionId);
        const dependents = missionDependenciesService.getDependents(input.missionId);
        
        return successResponse({
            missionId: input.missionId,
            dependsOn: dependencies,
            dependedBy: dependents,
            totalDependencies: dependencies.length,
            totalDependents: dependents.length,
        }, `Retrieved dependencies for mission ${input.missionId}`);
    }
);

export const handleGetDependencyGraph = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = GetDependencyGraphInput.parse(args);
        
        const graph = await missionDependenciesService.buildDependencyGraph(
            input.missionIds || undefined
        );
        
        const hasCycles = graph.cycles.length > 0;
        
        return successResponse({
            ...graph,
            hasCycles,
            cycleWarning: hasCycles ? `Detected ${graph.cycles.length} cycles in dependency graph` : undefined,
        }, hasCycles 
            ? `Dependency graph with ${graph.cycles.length} cycles detected`
            : `Dependency graph: ${graph.missions.length} missions, ${graph.edges.length} dependencies`
        );
    }
);

export const handleCheckDependenciesSatisfied = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = CheckDependenciesSatisfiedInput.parse(args);
        
        const result = await missionDependenciesService.checkDependenciesSatisfied(input.missionId);
        
        return successResponse({
            ...result,
            readyToRun: result.satisfied,
        }, result.satisfied
            ? `Mission ${input.missionId} is ready to run - all dependencies satisfied`
            : `Mission ${input.missionId} has ${result.blocking.length} unsatisfied dependencies`
        );
    }
);

export const handleGetExecutionOrder = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = GetExecutionOrderInput.parse(args);
        
        const result = missionDependenciesService.getExecutionOrder(input.missionIds);
        
        return successResponse({
            ...result,
            canExecute: result.possible,
        }, result.possible
            ? `Execution order: ${result.order.join(' → ')}`
            : `Cannot determine execution order - ${result.blocking.length} blocking issues`
        );
    }
);

export const handleCreateMissionWorkflow = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = CreateMissionWorkflowInput.parse(args);
        
        const result = await missionDependenciesService.createWorkflow(
            input.name,
            input.definition
        );
        
        return successResponse(result, `Created workflow "${input.name}" with ${result.dependencies.length} dependencies`);
    }
);

export const handleGetMissionWorkflows = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = GetMissionWorkflowsInput.parse(args);
        
        const workflows = missionDependenciesService.getWorkflows();
        
        return successResponse({
            workflows,
            total: workflows.length,
        }, `Retrieved ${workflows.length} mission workflows`);
    }
);

// Predictive Planning handlers
export const handleGenerateMissionPlan = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = GenerateMissionPlanInput.parse(args);
        
        const plan = await predictivePlanningService.generatePlan(
            input.objective,
            {
                orgId: input.orgId,
                considerHistory: input.considerHistory,
                maxSuggestions: input.maxSuggestions,
            }
        );
        
        return successResponse(plan, `Generated mission plan for: ${input.objective}`);
    }
);

export const handleGetMissionPatterns = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = GetMissionPatternsInput.parse(args);
        
        // Scoped to the caller's org so learned patterns come back alongside
        // the built-ins — and only that org's learned patterns.
        const patterns = await predictivePlanningService.getPatterns(context?.organizationId ?? undefined);

        return successResponse({
            patterns,
            total: patterns.length,
        }, `Retrieved ${patterns.length} mission patterns`);
    }
);

export const handleGetToolRecommendations = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = GetToolRecommendationsInput.parse(args);
        
        const recommendations = await predictivePlanningService.recommendTools(input.objective);
        
        return successResponse({
            recommendations,
            total: recommendations.length,
            topRecommendation: recommendations[0],
        }, `Generated ${recommendations.length} tool recommendations`);
    }
);

export const handleEstimateMissionCompletion = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = EstimateMissionCompletionInput.parse(args);
        
        const matchedPattern = predictivePlanningService.matchPattern(input.objective);
        const estimate = predictivePlanningService.estimateCompletion(
            input.objective,
            input.pipeline,
            matchedPattern || undefined
        );
        
        return successResponse(estimate, `Estimated completion: ${estimate.estimatedMinutes} minutes`);
    }
);

export const handleAssessMissionRisk = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = AssessMissionRiskInput.parse(args);
        
        const matchedPattern = predictivePlanningService.matchPattern(input.objective);
        const risk = predictivePlanningService.assessRisk(
            input.objective,
            input.pipeline || [],
            matchedPattern || undefined
        );
        
        return successResponse(risk, `Risk assessment: ${risk.overallRisk} (${risk.score}/100)`);
    }
);

export const handleFindSimilarMissions = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = FindSimilarMissionsInput.parse(args);
        
        // Placeholder for efficiency analysis
        const efficiency = {
            score: 85,
            factors: [
                { name: "Resource Usage", value: 90, status: "good" },
                { name: "Time to Complete", value: 80, status: "good" }
            ],
            recommendations: ["Optimize tool selection for step 2"]
        };
        
        const similar = await predictivePlanningService.findSimilarMissions(
            input.objective,
            input.orgId
        );
        
        return successResponse({
            missions: similar.slice(0, input.limit || 5),
            total: similar.length,
        }, `Found ${similar.length} similar missions`);
    }
);

// Self-Healing handlers
export const handleGetSelfHealingStats = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = GetSelfHealingStatsInput.parse(args);
        
        const stats = selfHealingService.getStats();
        
        return successResponse(stats, 'Self-healing service statistics');
    }
);

export const handleGetFailurePatterns = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = GetFailurePatternsInput.parse(args);
        
        const patterns = selfHealingService.getPatterns();
        
        return successResponse({
            patterns,
            total: patterns.length,
            autoRemediable: patterns.filter(p => p.autoRemediate).length,
        }, `Retrieved ${patterns.length} failure patterns`);
    }
);

export const handleGetActiveEscalations = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = GetActiveEscalationsInput.parse(args);
        
        const escalations = selfHealingService.getEscalations(input.status);
        
        return successResponse({
            escalations,
            total: escalations.length,
            pending: escalations.filter(e => e.status === 'pending').length,
        }, `Retrieved ${escalations.length} escalations`);
    }
);

export const handleAcknowledgeEscalation = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = AcknowledgeEscalationInput.parse(args);
        
        const escalation = selfHealingService.acknowledgeEscalation(
            input.escalationId,
            input.response
        );
        
        return escalation
            ? successResponse(escalation, `Acknowledged escalation ${input.escalationId}`)
            : errorResponse(`Escalation ${input.escalationId} not found`);
    }
);

export const handleResolveEscalation = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = ResolveEscalationInput.parse(args);
        
        const escalation = selfHealingService.resolveEscalation(
            input.escalationId,
            input.resolution,
            input.learnPattern
        );
        
        return escalation
            ? successResponse(escalation, `Resolved escalation ${input.escalationId}`)
            : errorResponse(`Escalation ${input.escalationId} not found`);
    }
);

// Multi-Agent Coordination handlers
export const handleCreateAgent = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = CreateAgentInput.parse(args);
        
        const agent = multiAgentCoordinationService.createAgent(
            input.missionId,
            input.name,
            input.role,
            input.specialties ? { specialties: input.specialties } : undefined
        );
        
        return successResponse(agent, `Created ${input.role} agent: ${input.name}`);
    }
);

export const handleGetAgents = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = GetAgentsInput.parse(args);
        
        const agents = multiAgentCoordinationService.getAgentsForMission(input.missionId);
        
        return successResponse({
            agents,
            total: agents.length,
            byRole: agents.reduce((acc, a) => {
                acc[a.role] = (acc[a.role] || 0) + 1;
                return acc;
            }, {} as Record<string, number>),
        }, `Retrieved ${agents.length} agents for mission ${input.missionId}`);
    }
);

export const handleSendAgentMessage = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = SendAgentMessageInput.parse(args);
        
        const message = multiAgentCoordinationService.sendMessage(input.fromAgentId, {
            toAgentId: input.toAgentId,
            type: input.type,
            content: input.content,
            priority: input.priority,
            requiresResponse: input.requiresResponse,
        });
        
        return successResponse(message, `Message sent: ${input.type}`);
    }
);

export const handleCreateConsensusProposal = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = CreateConsensusProposalInput.parse(args);
        
        const consensus = multiAgentCoordinationService.createConsensusProposal(
            input.missionId,
            input.proposedBy,
            input.topic,
            input.proposal,
            input.options,
            {
                deadline: input.deadline ? new Date(input.deadline) : undefined,
                conclusionThreshold: input.conclusionThreshold,
            }
        );
        
        // --- Latent Features Integrations ---
        try {
            import("../../domain/prediction-intelligence/integrations/consensus-integration.js").then(({ consensusIntegration }) => {
                consensusIntegration.mapConsensus(
                    (consensus as any).id || "unknown-prop",
                    input.topic,
                    [], 
                    String(input.missionId),
                    { organizationId: 1 } as any
                ).catch(() => {});
            }).catch(() => {});
        } catch (e) {}
        // ------------------------------------
        
        return successResponse(consensus, `Created consensus proposal: ${input.topic}`);
    }
);

export const handleCastConsensusVote = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = CastConsensusVoteInput.parse(args);
        
        const consensus = multiAgentCoordinationService.castVote(
            input.consensusId,
            input.agentId,
            input.option
        );
        
        // --- Latent Features Integrations ---
        try {
            import("../../domain/prediction-intelligence/integrations/consensus-integration.js").then(({ consensusIntegration }) => {
                consensusIntegration.mapConsensus(
                    input.consensusId,
                    "Updated Proposal", 
                    [{ agentId: input.agentId, vote: input.option }],
                    "unknown-mission", 
                    { organizationId: 1 } as any
                ).catch(() => {});
            }).catch(() => {});
        } catch (e) {}
        // ------------------------------------
        
        return consensus
            ? successResponse(consensus, `Vote cast for ${input.option}`)
            : errorResponse('Consensus not found or not open');
    }
);

export const handleAssignAgentTask = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = AssignAgentTaskInput.parse(args);
        
        const task = multiAgentCoordinationService.assignTask(
            input.missionId,
            input.assignedBy,
            input.assignedTo,
            input.description,
            {
                priority: input.priority,
                deadline: input.deadline ? new Date(input.deadline) : undefined,
                reviewBy: input.reviewBy,
            }
        );
        
        return successResponse(task, `Task assigned to ${input.assignedTo}`);
    }
);

export const handleUpdateAgentTaskStatus = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = UpdateAgentTaskStatusInput.parse(args);
        
        const task = multiAgentCoordinationService.updateTaskStatus(
            input.taskId,
            input.status,
            input.result
        );
        
        return task
            ? successResponse(task, `Task ${input.taskId} updated to ${input.status}`)
            : errorResponse('Task not found');
    }
);

export const handleDetectConflict = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = DetectConflictInput.parse(args);
        
        const conflict = multiAgentCoordinationService.detectConflict(
            input.missionId,
            input.agents,
            input.type,
            input.description,
            input.severity
        );
        
        return successResponse(conflict, `Conflict detected: ${input.type}`);
    }
);

export const handleGetMissionCoordinationStats = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = GetMissionCoordinationStatsInput.parse(args);
        
        const stats = multiAgentCoordinationService.getMissionStats(input.missionId);
        
        return successResponse(stats, `Coordination stats for mission ${input.missionId}`);
    }
);

export const handleCreateCoordinatorPool = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = CreateCoordinatorPoolInput.parse(args);

        const pool = multiAgentCoordinationService.createCoordinatorPool(input.missionId, {
            goal: input.goal,
            requiredRoles: input.requiredRoles,
            seedTasks: input.seedTasks,
            postGoalToBlackboard: input.postGoalToBlackboard,
        });

        return successResponse(pool, `Created coordinator pool with ${pool.agents.length} workers`);
    }
);

export const handlePostAgentBlackboardItem = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = PostAgentBlackboardItemInput.parse(args);

        const item = multiAgentCoordinationService.postBlackboardItem(
            input.missionId,
            input.postedBy,
            {
                topic: input.topic,
                content: input.content,
                type: input.type,
                priority: input.priority,
                visibility: input.visibility,
                targetRole: input.targetRole,
                targetAgentId: input.targetAgentId,
                tags: input.tags,
                context: input.context,
                expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
            }
        );

        return successResponse(item, `Posted blackboard item: ${input.topic}`);
    }
);

export const handleReadAgentBlackboard = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = ReadAgentBlackboardInput.parse(args);

        const items = multiAgentCoordinationService.readBlackboard(
            input.missionId,
            input.agentId,
            {
                topic: input.topic,
                type: input.type,
                tags: input.tags,
                since: input.since ? new Date(input.since) : undefined,
                includeExpired: input.includeExpired,
                limit: input.limit,
            }
        );

        return successResponse({
            items,
            total: items.length,
        }, `Read ${items.length} blackboard items`);
    }
);

export const handleClaimAgentTask = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = ClaimAgentTaskInput.parse(args);

        const task = multiAgentCoordinationService.claimNextTask(
            input.missionId,
            input.agentId,
            { requiredSpecialty: input.requiredSpecialty }
        );

        return task
            ? successResponse(task, `Task ${task.id} claimed by ${input.agentId}`)
            : errorResponse('No claimable task found');
    }
);

export const handleGetCoordinationTrajectories = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = GetCoordinationTrajectoriesInput.parse(args);

        const trajectories = multiAgentCoordinationService.getTrajectoriesForMission(input.missionId);

        return successResponse({
            trajectories,
            total: trajectories.length,
        }, `Retrieved ${trajectories.length} coordination trajectories`);
    }
);

export const handleRecordAffordanceObservation = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = RecordAffordanceObservationInput.parse(args);

        const observation = affordanceMapService.recordObservation({
            missionId: input.missionId,
            observedBy: input.observedBy,
            state: input.state,
            action: input.action,
            outcome: input.outcome,
            confidence: input.confidence,
            evidence: input.evidence,
            tags: input.tags,
        });

        const blackboardItem = input.publishToBlackboard
            ? multiAgentCoordinationService.postBlackboardItem(input.missionId, input.observedBy, {
                topic: `affordance.${input.state.kind}.${input.action.kind}`,
                content: `${input.action.description} => ${input.outcome.status}: ${input.outcome.description}`,
                type: 'affordance',
                priority: input.outcome.status === 'success' ? 'high' : 'medium',
                visibility: 'mission',
                tags: ['affordance', ...input.tags],
                context: { affordanceId: observation.id, observation },
            })
            : undefined;

        return successResponse({
            observation,
            blackboardItem,
        }, `Recorded affordance observation ${observation.id}`);
    }
);

export const handleQueryAffordances = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = QueryAffordancesInput.parse(args);

        const affordances = affordanceMapService.queryAffordances(input);

        return successResponse({
            affordances,
            total: affordances.length,
            stats: affordanceMapService.getMissionStats(input.missionId),
        }, `Found ${affordances.length} affordances`);
    }
);

export const handleSuggestAffordanceActions = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = SuggestAffordanceActionsInput.parse(args);

        const suggestions = affordanceMapService.suggestActions(input);

        return successResponse({
            suggestions,
            total: suggestions.length,
        }, `Suggested ${suggestions.length} affordance actions`);
    }
);
