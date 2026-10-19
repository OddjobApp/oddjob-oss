import { db } from "@server/database_service.js";
import { eq, desc, and } from "drizzle-orm";
import { missionSuggestions } from "@shared/schema/agent/index.js";
import { missions, missionMembers, missionRuns, pipelineStepExecutions, pipelineExecutions } from "@shared/schema/index.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("SuggestionApplyService");

/**
 * Dispatches a mission suggestion's suggestedAction and marks it applied.
 *
 * Supported action types:
 *  - update_objective   → update missions.objective
 *  - add_member         → insert into missionMembers
 *  - update_blackboard  → merge key/value into the active missionRun's missionContext
 *  - approve_tool       → no-op placeholder (governor approval handled separately)
 *  - add_step           → append a new step to the current pipeline
 *  - update_step        → modify an existing step (with fallback to last failed step)
 *  - checkpoint         → log a decision/insight to the mission timeline
 */
export const suggestionApplyService = {
    async apply(suggestionId: number, userId?: string): Promise<{ success: boolean; message?: string }> {
        const [suggestion] = await db
            .select()
            .from(missionSuggestions)
            .where(eq(missionSuggestions.id, suggestionId))
            .limit(1);

        if (!suggestion) {
            return { success: false, message: "Suggestion not found" };
        }

        if (suggestion.status === "applied") {
            return { success: false, message: "Suggestion already applied" };
        }

        const action = suggestion.suggestedAction as any;
        if (!action?.type) {
            return { success: false, message: "Suggestion has no actionable payload" };
        }

        try {
            await this.dispatch(action, suggestion.missionId, suggestion.missionRunId);

            await db.update(missionSuggestions)
                .set({ status: "applied", appliedAt: new Date() })
                .where(eq(missionSuggestions.id, suggestionId));

            logger.info(`[SuggestionApply] Applied suggestion ${suggestionId} (type: ${action.type}) on mission ${suggestion.missionId}`);
            return { success: true };
        } catch (err: any) {
            logger.error(`[SuggestionApply] Failed to apply suggestion ${suggestionId}: ${err.message}`);
            return { success: false, message: err.message };
        }
    },

    async dismiss(suggestionId: number): Promise<void> {
        await db.update(missionSuggestions)
            .set({ status: "dismissed" })
            .where(eq(missionSuggestions.id, suggestionId));
    },

    async dispatch(action: any, missionId: number, missionRunId: number): Promise<void> {
        let type = action.type;

        // --- Robust Action Mapping (Mission Healing) ---
        // Map hallucinated or specialized types to core dispatchers
        const MAPPED_TYPES: Record<string, string> = {
            "add_monitoring": "update_blackboard",
            "add_latency_monitoring": "update_blackboard",
            "log_performance": "update_blackboard",
            "add_cost_tracking": "update_blackboard",
            "implement_cost_tracking": "update_blackboard",
            "add_performance_logging": "update_blackboard",
            "add_performance_monitoring": "update_blackboard",
            "add_performance_tracking": "update_blackboard",
            "add_time_tracking": "update_blackboard",
            "add_latency_logging": "update_blackboard",
            "add_latency_tracking": "update_blackboard",
            "implement_tracking": "update_blackboard",
            "log_cost": "update_blackboard",
            "add_logging": "update_blackboard",
            "add_error_handling": "update_blackboard",
            "add_retry_mechanism": "update_blackboard",
            "add_retry_logic": "update_blackboard",
            "add_timeout": "update_blackboard",
            "add_validation": "update_blackboard",
            "add_metrics": "update_blackboard",
            "log_metrics": "update_blackboard",
            "report_metrics": "update_blackboard",
            "configure_runtime": "update_blackboard",
            "set_timeout_policy": "update_blackboard",
            "update_settings": "update_blackboard",
            "enable_verbose_logging": "update_blackboard",
            "enable_logging": "update_blackboard",
            "disable_logging": "update_blackboard",
            "enable_feature": "update_blackboard",
            "enable_debugging": "update_blackboard",
            "add_validation_step": "add_step",
            "add_resource_tracking": "add_step",
            "add_pre_flight_check": "add_step",
            "add_requirement_check": "add_step",
            "add_preflight_check": "add_step",
            "update_supervisor_agent": "checkpoint",
            "gather_data": "checkpoint",
            "investigate_initialization": "checkpoint",
            "update_agent_code": "checkpoint",
            "update_agent_configuration": "checkpoint",
            "request_additional_data": "checkpoint",
            "update_job_configuration": "checkpoint",
            "update_step_definition": "checkpoint",
            "update_initialization": "checkpoint",
            "update_mission_config": "checkpoint",
            "update_step_command": "checkpoint",
            "update_config": "checkpoint",
            "revalidate_initialization_params": "checkpoint",
            "update_instructions": "checkpoint",
            "update_parameter": "checkpoint",
            "optimize_execution": "checkpoint",
            "update_policy": "checkpoint",
            "retry_mission": "checkpoint",
            "optimization_strategy": "checkpoint",
            "profile_mission_execution": "checkpoint",
            "modify_config": "checkpoint",
            "optimize_mission_flow": "checkpoint",
            "optimize_steps": "checkpoint",
            "update_steps": "checkpoint",
            "optimize_workflow": "checkpoint",
            "modify_steps": "checkpoint",
            "modify_step": "checkpoint",
            "add_error_mitigation": "checkpoint",
            "add_error_handling_logic": "checkpoint",
            "add_code": "checkpoint",
            "update_code": "checkpoint",
            "modify_code": "checkpoint",
            "fix_code": "checkpoint",
            "refactor_code": "checkpoint"
        };

        if (MAPPED_TYPES[type]) {
            logger.debug(`[SuggestionApply] Remapping action type '${type}' to '${MAPPED_TYPES[type]}'`);
            type = MAPPED_TYPES[type];
        }

        switch (type) {
            case "update_objective": {
                if (!action.value) throw new Error("update_objective requires 'value'");
                await db.update(missions)
                    .set({ objective: action.value, updatedAt: new Date() })
                    .where(eq(missions.id, missionId));
                break;
            }

            case "add_member": {
                if (!action.entityType || action.entityId == null) {
                    throw new Error("add_member requires 'entityType' and 'entityId'");
                }
                const existing = await db.query.missionMembers.findFirst({
                    where: (mm, { and: a, eq: e }) => a(
                        e(mm.missionId, missionId),
                        e(mm.entityType, action.entityType),
                        e(mm.entityId, action.entityId)
                    ),
                });
                if (!existing) {
                    await db.insert(missionMembers).values({
                        missionId,
                        entityType: action.entityType,
                        entityId: action.entityId,
                        role: action.role || "contributor",
                    } as any);
                }
                break;
            }

            case "update_blackboard": {
                // blackboard actions can have 'key'/'value' or just a payload
                const key = action.key || action.type || "remediation_applied";
                const value = action.value !== undefined ? action.value : (action.config || action.params || true);
                
                const { missionRunService } = await import("./mission-run.service.js");
                await missionRunService.checkpoint({
                    missionRunId,
                    missionId,
                    missionContext: { [key]: value },
                    reason: `Suggestion applied: ${action.type}`,
                    changedBy: "suggestion-apply-service",
                });
                break;
            }

            case "approve_tool": {
                if (!action.toolName) throw new Error("approve_tool requires 'toolName'");
                const { governorService } = await import("@domain/governor/core/governor-service.js");
                await governorService.createScopedAllowRule({
                    toolName: action.toolName,
                    missionRunId,
                    expiresAfterMs: action.expiresAfterMs ?? 3600000,
                });
                break;
            }

            case "add_step": {
                if (!action.jobId && !action.toolName && !action.forgeConfig) {
                    logger.warn(`[SuggestionApply] add_step missing target for '${action.name || action.outputName || 'unnamed'}'. Falling back to checkpoint.`);
                    const { missionRunService: ms } = await import("./mission-run.service.js");
                    try {
                        await ms.checkpoint({
                            missionRunId,
                            missionId,
                            missionContext: { [`pending_remediation_${action.name || 'unnamed'}`]: action },
                            reason: `Abstract remediation: ${action.name || action.type}`,
                            changedBy: "suggestion-apply-service",
                        });
                    } catch (e: any) {
                        logger.warn(`[SuggestionApply] Fallback checkpoint failed for add_step in run ${missionRunId}: ${e.message}`);
                    }
                    break;
                }
                const { pipelineService } = await import("@domain/pipeline/core/pipeline.service.js");
                const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, missionRunId)).limit(1);
                if (!run?.currentPipelineId) throw new Error("Mission run has no current pipeline");

                const steps = await pipelineService.listSteps(run.currentPipelineId);
                const maxOrder = steps.reduce((max, s) => Math.max(max, s.order), 0);

                await pipelineService.insertSteps(run.currentPipelineId, [{
                    jobId: action.jobId || null,
                    toolName: action.toolName || null,
                    toolArguments: action.toolArguments || null,
                    forgeConfig: action.forgeConfig || null,
                    order: maxOrder + 1,
                    outputName: action.name || action.outputName || `step_${maxOrder + 1}`,
                    runOnCondition: action.runOnCondition || "on_success",
                }]);
                break;
            }

            case "update_step": {
                let stepId = action.stepId;
                if (!stepId) {
                    // FALLBACK: Find the last failed step execution for this mission run
                    const [lastFailed] = await db.select({
                            pipelineStepId: pipelineStepExecutions.pipelineStepId
                        })
                        .from(pipelineStepExecutions)
                        .innerJoin(pipelineExecutions, eq(pipelineStepExecutions.pipelineExecutionId, pipelineExecutions.id))
                        .where(and(
                            eq(pipelineExecutions.missionRunId, missionRunId),
                            eq(pipelineStepExecutions.status, 'failed')
                        ))
                        .orderBy(desc(pipelineStepExecutions.executedAt))
                        .limit(1);
                    
                    if (lastFailed) {
                        stepId = lastFailed.pipelineStepId;
                        logger.info(`[SuggestionApply] Inferred stepId ${stepId} for update_step from last failed execution`);
                    }
                }

                if (!stepId) {
                    logger.warn(`[SuggestionApply] update_step inference failed for run ${missionRunId}. Falling back to checkpoint.`);
                    const { missionRunService: ms } = await import("./mission-run.service.js");
                    try {
                        await ms.checkpoint({
                            missionRunId,
                            missionId,
                            missionContext: { [`pending_remediation_update_${action.name || 'unnamed'}`]: action },
                            reason: `Abstract remediation (update): ${action.name || action.type}`,
                            changedBy: "suggestion-apply-service",
                        });
                    } catch (e: any) {
                        logger.warn(`[SuggestionApply] Fallback checkpoint failed for update_step in run ${missionRunId}: ${e.message}`);
                    }
                    break;
                }
                
                const { pipelineSteps } = await import("@shared/schema/index.js");
                const updateData: any = {};
                if (action.jobId !== undefined) updateData.jobId = action.jobId;
                if (action.order !== undefined) updateData.order = action.order;
                if (action.outputName !== undefined) updateData.outputName = action.outputName;
                if (action.runOnCondition !== undefined) updateData.runOnCondition = action.runOnCondition;
                if (action.toolName !== undefined) updateData.toolName = action.toolName;
                if (action.toolArguments !== undefined) updateData.toolArguments = action.toolArguments;
                if (action.forgeConfig !== undefined) updateData.forgeConfig = action.forgeConfig;

                await db.update(pipelineSteps)
                    .set({ ...updateData, updatedAt: new Date() })
                    .where(eq(pipelineSteps.id, stepId));
                break;
            }

            case "checkpoint":
            case "add_logging": {
                const { missionRunService } = await import("./mission-run.service.js");
                try {
                    await missionRunService.checkpoint({
                        missionRunId,
                        missionId,
                        missionContext: { 
                            [`last_decision_${action.type}`]: action.value || action.config || action.params || true,
                            ...(action.type === 'add_logging' ? { enhanced_logging: true } : {})
                        },
                        reason: `Autonomous decision applied: ${action.type}`,
                        changedBy: "governance-agent",
                    });
                } catch (e: any) {
                    logger.warn(`[SuggestionApply] Explicit checkpoint failed for run ${missionRunId}: ${e.message}`);
                }
                break;
            }

            default:
                logger.warn(`[SuggestionApply] Unknown suggestedAction type '${action.type}' - treating as checkpoint insight`);
                const { missionRunService: mrs } = await import("./mission-run.service.js");
                try {
                    await mrs.checkpoint({
                        missionRunId,
                        missionId,
                        missionContext: { [`unmapped_action_${action.type}`]: action },
                        reason: `Log unknown action: ${action.type}`,
                        changedBy: "suggestion-apply-service",
                    });
                } catch (e: any) {
                    logger.warn(`[SuggestionApply] Checkpoint failed for run ${missionRunId}: ${e.message}`);
                }
                break;
        }
    }
};
