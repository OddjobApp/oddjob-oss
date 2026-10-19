/**
 * Oddjob MCP Server - Tool Handler Hub
 * 
 * Central export point for all modular handlers and the main tool dispatcher.
 */

import { handleSearchKnowledgeGraph, handleGetEntityImpact, handleCreateEntity, handleCreateRelationship, handleSuggestSchema, handleGetGraphStatistics, handleExploreRelationships } from "./handlers/knowledge-graph.js";
import { handleListPipelines, handleGetPipelineDetails, handleRunPipeline, handleGetExecutionStatus, handleListRecentExecutions, handleCreatePipeline, handleUpdatePipeline, handleDeletePipeline, handleAddPipelineStep, handleUpdatePipelineStep, handleDeletePipelineStep, handleDelegateTask } from "./handlers/pipelines.js";
import { handleSearchDocuments, handleListDocuments, handleGetDocumentContent, handleSearchUnified } from "./handlers/documents.js";
import { handleListSystemSpecs, handleGetSystemSpec, handleSearchSystemDocs, handleListPlatformPatterns, handleSearchPlatformPatterns, handleGetPlatformPattern } from "./handlers/documentation.js";
import { handleListKnowledgePacks, handleGetApplicableGovernance, handleEvaluateGovernedAction } from "./handlers/knowledge-packs.js";
import { handleListJobs, handleGetJobDetails, handleCreateJob, handleUpdateJob, handleDeleteJob } from "./handlers/jobs.js";
import { handleListSchedules, handleGetScheduleDetails, handleCreateSchedule, handleUpdateSchedule, handleDeleteSchedule, handleListScheduledJobs, handleGetScheduledJobDetails, handleCreateScheduledJob, handleUpdateScheduledJob, handleDeleteScheduledJob, handleGetUpcomingScheduledRuns } from "./handlers/schedules.js";
import { handleListDatasets, handleGetDatasetDetails, handleCreateDataset, handleQueryDataset, handleAddDatasetItems } from "./handlers/datasets.js";
import { handleGetUserIntent } from "./handlers/ephemeral.js";
import { handleListTemplates, handleGetTemplateDetails, handleInstantiateTemplate } from "./handlers/templates.js";
import { handleListSaasConnectors, handleSyncSaasConnector, handleGetSaasConnectorSchema, handleUpdateSaasSyncConfig, handleAddJiraComment, handleTransitionJiraIssue, handleUpdateJiraIssue, handleCreateJiraIssue } from "./handlers/saas.js";
import { handleGetAssistantInfo, handleUpdateAssistantSettings, handleResyncSystemGraph } from "./handlers/system.js";
import { handleGetGovernorHealth, handleUpdateGovernorSettings } from "./handlers/governor.js";
import { handleSendEmail } from "./handlers/email.js";
import { handleExecuteVisualQuery } from "./handlers/query-builder.js";
import { handleQueryPlatformStructure, handleSearchPlatformNodes } from "./handlers/platform-structure.js";
import { handleListMissions, handleGetMissionDetails, handleUpdateMission } from "./handlers/missions.js";
import {
    handleCreateMission,
    handleDeleteMission,
    handlePlanMission,
    handleListMissionTemplates,
    handleInstantiateMissionTemplate,
    handleChatWithMission,
    handleGetMissionMemories,
    handleGetMissionTimeline,
    handleGetMissionActivity,
    handlePromoteShadowRun,
    handleGetMissionSuggestions,
    handleUpdateMissionMembers,
    handleGetMissionStatus,
    handleGetMissionReplayHistory,
    handleReplayMissionFromCheckpoint,
    handleCompareMissionRuns,
    handleGetMissionExecutionHeatmap,
    handleStartMissionDebugSession,
    handlePauseMission,
    handleResumeMission,
    handleStepMission,
    handleInspectMissionState,
    handleModifyMissionVariable,
    handleAddMissionBreakpoint,
    handleRemoveMissionBreakpoint,
    handleGetCircuitBreakerStatus,
    handleResetCircuitBreaker,
    handleConfigureCircuitBreaker,
    handleGetDeadLetterQueue,
    handleReplayDeadLetter,
    handleRemoveDeadLetter,
    handleGetRetryStats,
    handleAddMissionDependency,
    handleRemoveMissionDependency,
    handleGetMissionDependencies,
    handleGetDependencyGraph,
    handleCheckDependenciesSatisfied,
    handleGetExecutionOrder,
    handleCreateMissionWorkflow,
    handleGetMissionWorkflows,
    handleGenerateMissionPlan,
    handleGetMissionPatterns,
    handleGetToolRecommendations,
    handleEstimateMissionCompletion,
    handleAssessMissionRisk,
    handleFindSimilarMissions,
    handleGetSelfHealingStats,
    handleGetFailurePatterns,
    handleGetActiveEscalations,
    handleAcknowledgeEscalation,
    handleResolveEscalation,
    handleCreateAgent,
    handleGetAgents,
    handleSendAgentMessage,
    handleCreateConsensusProposal,
    handleCastConsensusVote,
    handleAssignAgentTask,
    handleUpdateAgentTaskStatus,
    handleDetectConflict,
    handleGetMissionCoordinationStats,
    handleCreateCoordinatorPool,
    handlePostAgentBlackboardItem,
    handleReadAgentBlackboard,
    handleClaimAgentTask,
    handleGetCoordinationTrajectories,
    handleRecordAffordanceObservation,
    handleQueryAffordances,
    handleSuggestAffordanceActions,
} from "./handlers/missions-enhanced.js";
import { handleListHilForms, handleGetHilForm, handleRequestHumanInput } from "./handlers/hil.js";
import { handleSendNotification } from "./handlers/messaging.js";
import { handleQueryCodeGraph, handleGetCodeMetrics, handleIndexWorkspace } from "./handlers/xray.js";
import { 
    handleForgeApp, 
    handleListBlueprints, 
    handleGetForgeStatus,
    handleForgeSanitizeDeps,
    handleForgeInjectBuildConfig,
    handleForgeValidateWorkspace,
    handleForgeCheckReadiness,
    handleForgeEditFile,
    handleForgeNpmCommand,
    handleStudioListFiles,
    handleStudioReadFile,
    handleStudioEnhanceApp,
    handleStudioPlanEnhancement,
    handleSearchHilContext,
    handleGetBlueprintSpec
} from "./handlers/forge.js";
import { handleAgentMailSend, handleAgentMailListThreads, handleAgentMailGetThread } from "./handlers/agentmail.js";
import { handleListAntigravityIncidents, handleGetIncidentContext, handleResolveAntigravityIncident } from "./handlers/antigravity.js";
import { 
    handleGMSScoreBlueprint, 
    handleGMSSynthesizeMissions, 
    handleGMSShadowValidate, 
    handleGMSFindSkills, 
    handleGMSEvolveSkill, 
    handleGMSComposeMission,
    handleGMSGetStatus
} from "./handlers/gms.js";
import { 
    handleListCycles, 
    handleLaunchCycle, 
    handleApproveCycle, 
    handlePauseCycle, 
    handleResumeCycle 
} from "./handlers/cycles.js";
import { handleGetHiddenStateEstimate, handlePredictOutcomes, handleExplainPrediction } from "./handlers/prediction.js";
import {
    handleCreateTrycuaTask,
    handleListTrycuaTasks,
    handleGetTrycuaTaskDetails,
    handleConfirmTrycuaTask,
    handleCancelTrycuaTask,
    handleRunTrycuaAutonomousLoop
} from "./handlers/trycua.js";
import { successResponse, errorResponse, type ToolContext } from "./handlers/utils.js";

import { normalizeToolName } from "../domain/tools/v1/tool-registry.service.js";
import { db } from "../db/index.js";
import { skills, approvalRequests } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { ToolDefinition } from "../domain/tools/v1/capabilities/types.js";
import { knowledgePackService } from "../domain/knowledge-packs/knowledge-pack.service.js";
import { withSpan } from "../utils/tracing.js";


/**
 * Execute a tool definition with strict Zod parameter validation
 */
async function executeTool(tool: ToolDefinition<any>, args: unknown, context?: ToolContext) {
    return await withSpan(`tool:${tool.name}`, async () => {
        try {
            const fullContext: ToolContext = {
                named: {},
                positional: {},
                ...(context || {})
            } as ToolContext;
            
            const validatedArgs = tool.parameters.parse(args);

            // ── Organization Knowledge-Pack Governance Gate ──
            // Only packs with controls for this exact tool/action participate;
            // organizations without an applicable active pack retain existing behavior.
            if (fullContext.organizationId) {
                const applicable = await knowledgePackService.getApplicableGovernance(fullContext.organizationId, tool.name);
                if (applicable.length > 0) {
                    const governed = await knowledgePackService.evaluateAction(fullContext.organizationId, tool.name, validatedArgs as Record<string, unknown>, fullContext.userId);
                    if (governed.decision !== "ALLOW") {
                        return successResponse({
                            suspended: true,
                            governanceDecision: governed.decision,
                            applicableControls: governed.applicableControls,
                            missingContext: governed.missingContext,
                            rationale: governed.reasons,
                            safeNextActions: governed.safeNextActions,
                            contextHash: governed.contextHash,
                        }, `Execution prevented by organization governance: ${governed.decision}`);
                    }
                }
            }

            // ── Proposal-Based Action Pattern Interceptor ──
            if (tool.approvalPolicy?.requiresApproval || tool.riskLevel === 'high') {
                const crypto = await import("crypto");
                const token = crypto.randomBytes(32).toString("hex");

                const [proposal] = await db.insert(approvalRequests).values({
                    executionId: fullContext.missionRunId?.toString() || "system",
                    approverType: "internal",
                    approverEmail: "admin@oddjob.local", // Fallback for system tools
                    status: "pending",
                    token,
                    organizationId: fullContext.organizationId,
                    toolName: tool.name,
                    toolArgs: validatedArgs,
                }).returning();

                return successResponse({
                    suspended: true,
                    message: "Execution suspended. Human approval required.",
                    proposalId: proposal.id,
                    rationale: tool.approvalPolicy?.rationale || "High risk tool execution requires human approval.",
                    approvalToken: token
                });
            }

            return await tool.execute(validatedArgs, fullContext);
        } catch (err: any) {
            return errorResponse(`Tool validation/execution failed [${tool.name}]: ${err.message}`);
        }
    }, {
        "tool.name": tool.name,
        "mission.run_id": context?.missionRunId || "",
        "user.id": context?.userId || ""
    } as any);
}

// Re-export utilities and handlers for potential direct use
export * from "./handlers/utils.js";
export * from "./handlers/knowledge-graph.js";
export * from "./handlers/pipelines.js";
export * from "./handlers/documents.js";
export * from "./handlers/jobs.js";
export * from "./handlers/schedules.js";
export * from "./handlers/datasets.js";
export * from "./handlers/ephemeral.js";
export * from "./handlers/templates.js";
export * from "./handlers/saas.js";
export * from "./handlers/system.js";
export * from "./handlers/governor.js";
export * from "./handlers/query-builder.js";
export * from "./handlers/platform-structure.js";
export * from "./handlers/missions.js";
export * from "./handlers/hil.js";

/**
 * Main dispatcher for MCP tool calls
 */
export async function handleToolCall(name: string, args: unknown, context?: ToolContext) {
    const normalizedName = normalizeToolName(name);

    switch (normalizedName) {
        // Knowledge Graph tools
        case "search_knowledge_graph":
            return handleSearchKnowledgeGraph(args, context);
        case "get_entity_impact":
            return handleGetEntityImpact(args, context);
        case "create_entity":
            return handleCreateEntity(args, context);
        case "create_relationship":
            return handleCreateRelationship(args, context);
        case "suggest_schema":
            return handleSuggestSchema(args, context);
        case "get_graph_statistics":
            return handleGetGraphStatistics(args, context);
        case "explore_relationships":
            return handleExploreRelationships(args, context);
        // get_documents_for_entity, get_entity_details → registry fallthrough

        // Pipeline tools (read)
        case "list_pipelines":
            return handleListPipelines(args, context);
        case "get_pipeline_details":
            return handleGetPipelineDetails(args, context);
        case "run_pipeline":
            return handleRunPipeline(args, context);
        case "get_pipeline_execution_status":
            return handleGetExecutionStatus(args, context);
        case "list_recent_executions":
            return handleListRecentExecutions(args, context);

        // Pipeline tools (write)
        case "create_pipeline":
            return handleCreatePipeline(args, context);
        case "update_pipeline":
            return handleUpdatePipeline(args, context);
        case "delete_pipeline":
            return handleDeletePipeline(args, context);
        case "add_pipeline_step":
            return handleAddPipelineStep(args, context);
        case "update_pipeline_step":
            return handleUpdatePipelineStep(args, context);
        case "delete_pipeline_step":
            return handleDeletePipelineStep(args, context);
        case "delegate_task":
            return handleDelegateTask(args, context);

        // Document tools
        case "search_documents":
            return handleSearchDocuments(args, context);
        case "list_documents":
            return handleListDocuments(args, context);
        case "get_document_content":
            return handleGetDocumentContent(args, context);
        case "search_unified_knowledge":
        case "search_knowledge_base":
        case "knowledge_base":
            return handleSearchUnified(args, context);

        // System documentation tools
        case "list_system_specs":
            return handleListSystemSpecs(args, context);
        case "get_system_spec":
            return handleGetSystemSpec(args, context);
        case "search_system_docs":
            return handleSearchSystemDocs(args, context);
        case "list_platform_patterns":
            return handleListPlatformPatterns(args);
        case "search_platform_patterns":
            return handleSearchPlatformPatterns(args);
        case "get_platform_pattern":
            return handleGetPlatformPattern(args);
        case "list_knowledge_packs":
            return handleListKnowledgePacks(args, context);
        case "get_applicable_governance":
            return handleGetApplicableGovernance(args, context);
        case "evaluate_governed_action":
            return handleEvaluateGovernedAction(args, context);

        // Job tools
        case "list_jobs":
            return handleListJobs(args, context);
        case "get_job_details":
            return handleGetJobDetails(args, context);
        case "create_job":
            return handleCreateJob(args, context);
        case "update_job":
            return handleUpdateJob(args, context);
        case "delete_job":
            return handleDeleteJob(args, context);

        // Schedule tools
        case "list_schedules":
            return handleListSchedules(args, context);
        case "get_schedule_details":
            return handleGetScheduleDetails(args, context);
        case "create_schedule":
            return handleCreateSchedule(args, context);
        case "update_schedule":
            return handleUpdateSchedule(args, context);
        case "delete_schedule":
            return handleDeleteSchedule(args, context);

        // Scheduled job tools
        case "list_scheduled_jobs":
            return handleListScheduledJobs(args, context);
        case "get_scheduled_job_details":
            return handleGetScheduledJobDetails(args, context);
        case "create_scheduled_job":
            return handleCreateScheduledJob(args, context);
        case "update_scheduled_job":
            return handleUpdateScheduledJob(args, context);
        case "delete_scheduled_job":
            return handleDeleteScheduledJob(args, context);
        case "get_upcoming_scheduled_runs":
            return handleGetUpcomingScheduledRuns(args, context);

        // Dataset tools
        case "list_datasets":
            return handleListDatasets(args, context);
        case "get_dataset_details":
            return handleGetDatasetDetails(args, context);
        case "create_dataset":
            return handleCreateDataset(args, context);
        case "query_dataset":
            return handleQueryDataset(args, context);
        case "add_dataset_items":
            return handleAddDatasetItems(args, context);

        // Template tools
        case "list_templates":
            return handleListTemplates(args, context);
        case "get_template_details":
            return handleGetTemplateDetails(args, context);
        case "instantiate_template":
            return handleInstantiateTemplate(args, context);

        // Ephemeral tools
        case "get_user_intent":
            return handleGetUserIntent(args);

        // SaaS tools
        case "list_saas_connectors":
            return handleListSaasConnectors(args, context);
        case "sync_saas_connector":
            return handleSyncSaasConnector(args, context);
        case "get_saas_connector_schema":
            return handleGetSaasConnectorSchema(args, context);
        case "update_saas_sync_config":
            return handleUpdateSaasSyncConfig(args, context);
        case "add_jira_comment":
            return handleAddJiraComment(args, context);
        case "transition_jira_issue":
            return handleTransitionJiraIssue(args, context);
        case "update_jira_issue":
            return handleUpdateJiraIssue(args, context);
        case "create_jira_issue":
            return handleCreateJiraIssue(args, context);

        // System/Assistant tools
        case "get_assistant_info":
            return handleGetAssistantInfo(args);
        case "update_assistant_settings":
            return handleUpdateAssistantSettings(args);
        case "resync_system_graph":
            return handleResyncSystemGraph(args, context);
        // get_system_health, list_failed_jobs, get_cost_analysis, list_alerts,
        // get_health_dashboard, shell, python → registry fallthrough

        // Governor tools
        case "get_governor_health":
            return handleGetGovernorHealth(args);
        case "update_governor_settings":
            return handleUpdateGovernorSettings(args);

        // Email tools
        case "send_email":
            return handleSendEmail(args, context);

        // Query Builder tools
        case "execute_visual_query":
            return handleExecuteVisualQuery(args, context);
        case "query_platform_structure":
            return handleQueryPlatformStructure(args, context);
        case "search_platform_nodes":
            return handleSearchPlatformNodes(args, context);

        // Mission tools
        case "list_missions":
            return handleListMissions(args, context);
        case "get_mission_details":
            return handleGetMissionDetails(args, context);
        case "update_mission":
            return handleUpdateMission(args, context);

        // HIL/Form tools
        case "list_hil_forms":
            return handleListHilForms(args, context);
        case "get_hil_form":
            return handleGetHilForm(args, context);
        case "request_human_input":
            return handleRequestHumanInput(args, context);

        // Messaging tools
        case "send_notification":
            return handleSendNotification(args);

        // Web (browse_web, google_search), Generation (generate_excel,
        // ai_translate, generate_pdf, generate_image, generate_word,
        // generate_mermaid_diagram), File/Storage (file_list, file_read,
        // file_write, read_system_file, list_system_files, analyze_image,
        // google_doc_read), Git workspace (workspace_*, git_*) and Discovery
        // (list_available_mcp_capabilities, request_mcp_tool) tools all dispatch
        // via the generic registry fallthrough — they were pure
        // `executeTool(TOOLS.name, args, context)` passthroughs identical to it.

        // XRay code graph tools
        case "query_code_graph":
            return handleQueryCodeGraph(args, context);
        case "get_code_metrics":
            return handleGetCodeMetrics(args, context);
        case "index_workspace":
            return handleIndexWorkspace(args, context);
        case "xray_find_symbol":
            const { handleXRayFind } = await import("./handlers/xray.js");
            return handleXRayFind(args, context);
        case "xray_explore_workspace":
            const { handleXRayExplore } = await import("./handlers/xray.js");
            return handleXRayExplore(args, context);
        case "xray_trace_impact":
            const { handleXRayImpact } = await import("./handlers/xray.js");
            return handleXRayImpact(args, context);

        // AgentMail tools
        case "agentmail_send":
            return handleAgentMailSend(args, context);
        case "agentmail_list_threads":
            return handleAgentMailListThreads(args, context);
        case "agentmail_get_thread":
            return handleAgentMailGetThread(args, context);

        // Forge tools
        case "forge_app":
            return handleForgeApp(args, context);
        case "list_blueprints":
            return handleListBlueprints(args, context);
        case "get_forge_status":
            return handleGetForgeStatus(args, context);
        case "forge_sanitize_deps":
            return handleForgeSanitizeDeps(args, context);
        case "forge_inject_build_config":
            return handleForgeInjectBuildConfig(args, context);
        case "forge_validate_workspace":
            return handleForgeValidateWorkspace(args, context);
        case "forge_check_readiness":
            return handleForgeCheckReadiness(args, context);
        case "forge_edit_file":
            return handleForgeEditFile(args, context);
        case "forge_npm_command":
            return handleForgeNpmCommand(args, context);
        case "studio_list_files":
            return handleStudioListFiles(args, context);
        case "studio_read_file":
            return handleStudioReadFile(args, context);
        case "studio_enhance_app":
            return handleStudioEnhanceApp(args, context);
        case "studio_plan_enhancement":
            return handleStudioPlanEnhancement(args, context);
        case "search_hil_context":
            return handleSearchHilContext(args, context);
        case "get_blueprint_spec":
            return handleGetBlueprintSpec(args, context);

        // Antigravity tools
        case "list_antigravity_incidents":
            return handleListAntigravityIncidents(args, context);
        case "get_incident_context":
            return handleGetIncidentContext(args, context);
        case "resolve_antigravity_incident":
            return handleResolveAntigravityIncident(args, context);

        // GMS (Generative Mission Synthesis) tools
        case "gms_score_blueprint":
            return handleGMSScoreBlueprint(args, context);
        case "gms_synthesize_missions":
            return handleGMSSynthesizeMissions(args, context);
        case "gms_shadow_validate":
            return handleGMSShadowValidate(args, context);
        case "gms_find_skills":
            return handleGMSFindSkills(args, context);
        case "gms_evolve_skill":
            return handleGMSEvolveSkill(args, context);
        case "gms_compose_mission":
            return handleGMSComposeMission(args, context);
        case "gms_get_status":
            return handleGMSGetStatus(args, context);

        case "update_blackboard":
        case "get_blackboard":
        case "add_shared_memory":
        case "launch_mission":
        case "apply_recovery_decision":
            const { MISSION_TOOLS: MT } = await import("../domain/tools/v1/capabilities/missions.js");
            const tool = MT[normalizedName];
            if (!tool) return errorResponse(`Mission Tool definition missing: ${normalizedName}`);
            const res = await executeTool(tool, args, context);
            if (typeof res === 'string') {
                try {
                    const parsed = JSON.parse(res);
                    return successResponse(parsed);
                } catch {
                    return successResponse({ message: res });
                }
            }
            return res;

        // Enhanced mission tools
        case "create_mission":
            return handleCreateMission(args, context);
        case "delete_mission":
            return handleDeleteMission(args, context);
        case "plan_mission":
            return handlePlanMission(args, context);
        case "list_mission_templates":
            return handleListMissionTemplates(args, context);
        case "instantiate_mission_template":
            return handleInstantiateMissionTemplate(args, context);
        case "chat_with_mission":
            return handleChatWithMission(args, context);
        case "get_mission_memories":
            return handleGetMissionMemories(args, context);
        case "get_mission_timeline":
            return handleGetMissionTimeline(args, context);
        case "get_mission_activity":
            return handleGetMissionActivity(args, context);
        case "promote_shadow_run":
            return handlePromoteShadowRun(args, context);
        case "get_mission_suggestions":
            return handleGetMissionSuggestions(args, context);
        case "update_mission_members":
            return handleUpdateMissionMembers(args, context);
        case "get_mission_status":
            return handleGetMissionStatus(args, context);
        case "get_mission_replay_history":
            return handleGetMissionReplayHistory(args, context);
        case "replay_mission_from_checkpoint":
            return handleReplayMissionFromCheckpoint(args, context);
        case "compare_mission_runs":
            return handleCompareMissionRuns(args, context);
        case "get_mission_execution_heatmap":
            return handleGetMissionExecutionHeatmap(args, context);
        case "start_mission_debug_session":
            return handleStartMissionDebugSession(args, context);
        case "pause_mission":
            return handlePauseMission(args, context);
        case "resume_mission":
            return handleResumeMission(args, context);
        case "step_mission":
            return handleStepMission(args, context);
        case "inspect_mission_state":
            return handleInspectMissionState(args, context);
        case "modify_mission_variable":
            return handleModifyMissionVariable(args, context);
        case "add_mission_breakpoint":
            return handleAddMissionBreakpoint(args, context);
        case "remove_mission_breakpoint":
            return handleRemoveMissionBreakpoint(args, context);
        case "get_circuit_breaker_status":
            return handleGetCircuitBreakerStatus(args, context);
        case "reset_circuit_breaker":
            return handleResetCircuitBreaker(args, context);
        case "configure_circuit_breaker":
            return handleConfigureCircuitBreaker(args, context);
        case "get_dead_letter_queue":
            return handleGetDeadLetterQueue(args, context);
        case "replay_dead_letter":
            return handleReplayDeadLetter(args, context);
        case "remove_dead_letter":
            return handleRemoveDeadLetter(args, context);
        case "get_retry_stats":
            return handleGetRetryStats(args, context);
        case "add_mission_dependency":
            return handleAddMissionDependency(args, context);
        case "remove_mission_dependency":
            return handleRemoveMissionDependency(args, context);
        case "get_mission_dependencies":
            return handleGetMissionDependencies(args, context);
        case "get_dependency_graph":
            return handleGetDependencyGraph(args, context);
        case "check_dependencies_satisfied":
            return handleCheckDependenciesSatisfied(args, context);
        case "get_execution_order":
            return handleGetExecutionOrder(args, context);
        case "create_mission_workflow":
            return handleCreateMissionWorkflow(args, context);
        case "get_mission_workflows":
            return handleGetMissionWorkflows(args, context);
        case "generate_mission_plan":
            return handleGenerateMissionPlan(args, context);
        case "get_mission_patterns":
            return handleGetMissionPatterns(args, context);
        case "get_tool_recommendations":
            return handleGetToolRecommendations(args, context);
        case "estimate_mission_completion":
            return handleEstimateMissionCompletion(args, context);
        case "assess_mission_risk":
            return handleAssessMissionRisk(args, context);
        case "find_similar_missions":
            return handleFindSimilarMissions(args, context);
        case "get_self_healing_stats":
            return handleGetSelfHealingStats(args, context);
        case "get_failure_patterns":
            return handleGetFailurePatterns(args, context);
        case "get_active_escalations":
            return handleGetActiveEscalations(args, context);
        case "acknowledge_escalation":
            return handleAcknowledgeEscalation(args, context);
        case "resolve_escalation":
            return handleResolveEscalation(args, context);
        case "create_agent":
            return handleCreateAgent(args, context);
        case "get_agents":
            return handleGetAgents(args, context);
        case "send_agent_message":
            return handleSendAgentMessage(args, context);
        case "create_consensus_proposal":
            return handleCreateConsensusProposal(args, context);
        case "cast_consensus_vote":
            return handleCastConsensusVote(args, context);
        case "assign_agent_task":
            return handleAssignAgentTask(args, context);
        case "update_agent_task_status":
            return handleUpdateAgentTaskStatus(args, context);
        case "detect_conflict":
            return handleDetectConflict(args, context);
        case "get_mission_coordination_stats":
            return handleGetMissionCoordinationStats(args, context);
        case "create_coordinator_pool":
            return handleCreateCoordinatorPool(args, context);
        case "post_agent_blackboard_item":
            return handlePostAgentBlackboardItem(args, context);
        case "read_agent_blackboard":
            return handleReadAgentBlackboard(args, context);
        case "claim_agent_task":
            return handleClaimAgentTask(args, context);
        case "get_coordination_trajectories":
            return handleGetCoordinationTrajectories(args, context);
        case "record_affordance_observation":
            return handleRecordAffordanceObservation(args, context);
        case "query_affordances":
            return handleQueryAffordances(args, context);
        case "suggest_affordance_actions":
            return handleSuggestAffordanceActions(args, context);

        // Cycle Management tools
        case "list_cycles":
            return handleListCycles(args, context);
        case "launch_cycle":
            return handleLaunchCycle(args, context);
        case "approve_cycle":
            return handleApproveCycle(args, context);
        case "pause_cycle":
            return handlePauseCycle(args, context);
        case "resume_cycle":
            return handleResumeCycle(args, context);

        // Prediction tools
        case "get_hidden_state_estimate":
            return handleGetHiddenStateEstimate(args, context);
        case "predict_outcomes":
            return handlePredictOutcomes(args, context);
        case "explain_prediction":
            return handleExplainPrediction(args, context);

        // Trycua tools
        case "create_trycua_task":
            return handleCreateTrycuaTask(args, context);
        case "list_trycua_tasks":
            return handleListTrycuaTasks(args, context);
        case "get_trycua_task_details":
            return handleGetTrycuaTaskDetails(args, context);
        case "confirm_trycua_task":
            return handleConfirmTrycuaTask(args, context);
        case "cancel_trycua_task":
            return handleCancelTrycuaTask(args, context);
        case "run_trycua_autonomous_loop":
            return handleRunTrycuaAutonomousLoop(args, context);

        default:
            // Check if it's a dynamic skill from the DB
            try {
                const [skill] = await db.select().from(skills).where(eq(skills.name, normalizedName)).limit(1);
                if (skill) {
                    const { skillService } = await import("../domain/agents/core/skill-service.js");
                    return await skillService.executeSkill(skill.id, (args as any)?.args || args || {});
                }
            } catch (err: any) {
                console.error(`[handleToolCall] Error checking dynamic skills: ${err.message}`);
            }

            // Generic registry fallthrough: any tool advertised to the planner
            // (static capabilities + connected MCP tools) is dispatchable here via
            // its own `execute`, so the executor's coverage can't silently drift
            // behind the advertised set. Placed AFTER the skills check to preserve
            // existing skill precedence; explicit cases above still win. This is the
            // same generic path the supervisor tool-worker already uses, and routing
            // through executeTool also applies the risk/approval interceptor.
            try {
                const { getAgentTools } = await import("../domain/tools/v1/capabilities/index.js");
                const registryTool = getAgentTools()[normalizedName];
                if (registryTool) {
                    return executeTool(registryTool, args, context);
                }
            } catch (err: any) {
                console.error(`[handleToolCall] Registry fallthrough failed for ${normalizedName}: ${err.message}`);
            }

            return errorResponse(`Unknown tool: ${name}`);
    }
}

