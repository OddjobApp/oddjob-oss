import { missionQueryService } from "./mission-query.service.js";
import { missionLifecycleService } from "./mission-lifecycle.service.js";
import { missionExecutionService } from "./mission-execution.service.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("MissionService");

/**
 * MissionService Facade
 * Provides a unified entry point for mission operations by delegating to specialized domain services.
 * - MissionQueryService: Read-only operations and diagnostics.
 * - MissionLifecycleService: State transformations, blackboard management, and membership.
 * - MissionExecutionService: Runtime orchestration, planning, and external integrations.
 */
export const missionService = {
  // --- Query Operations (Delegated to MissionQueryService) ---
  async listMissions(orgId?: number) {
    return await missionQueryService.getMissions(orgId || 0);
  },

  async listMissionsWithStats(orgId?: number) {
    // For now, listMissions provides enough data for the UI
    return await missionQueryService.getMissions(orgId || 0);
  },

  async getById(id: number) {
    return await missionQueryService.getById(id);
  },

  async getMissionById(missionId: number, orgId?: number) {
    return await missionQueryService.getMissionById(missionId, orgId);
  },

  async getMissionDetail(id: number) {
    return await missionQueryService.getMissionDetail(id);
  },

  async calculateTotalSpend(missionId: number) {
    return await missionQueryService.calculateTotalSpend(missionId);
  },

  async listRuns(missionId?: number) {
    return await missionQueryService.listRuns(missionId);
  },

  async getActivity(missionId: number) {
    return await missionQueryService.getActivity(missionId);
  },

  async listGlobalActivity(orgId: number, timeRange: string = "24h") {
    return await missionQueryService.listGlobalActivity(orgId, timeRange);
  },

  async getHealth(missionId: number) {
    return await missionQueryService.getHealth(missionId);
  },

  async getMissionForEntity(options: { entityType: "job" | "pipeline"; entityId: number }) {
    return await missionQueryService.getMissionForEntity(options);
  },

  async listRagAssets(missionId: number) {
    return await missionQueryService.listRagAssets(missionId);
  },

  async getAvailableRagAssets(orgId: number | null) {
    return await missionQueryService.getAvailableRagAssets(orgId);
  },

  async listDocumentTemplates(missionId: number) {
    return await missionQueryService.listDocumentTemplates(missionId);
  },

  async listFileAttachments(missionId: number) {
    return await missionQueryService.listFileAttachments(missionId);
  },

  async getMissionRagContext(missionId: number) {
    return await missionQueryService.getMissionRagContext(missionId);
  },

  async getDeleteDiagnostic(missionId: number) {
    return await missionQueryService.getDeleteDiagnostic(missionId);
  },

  async listTemplates(orgId: number) {
    return await missionQueryService.listTemplates(orgId);
  },

  async getBlackboardHistory(missionId: number, limit: number = 20) {
    return await missionQueryService.getBlackboardHistory(missionId, limit);
  },


  // --- Lifecycle Operations (Delegated to MissionLifecycleService) ---
  async createMission(data: any, userId: string, members?: { entityType: string, entityId: number, role: string }[], isDraft: boolean = false, workflow?: any) {
    return await missionLifecycleService.createMission(data, userId, members, isDraft, workflow);
  },

  async ensureSupervisorMission(options: any) {
    return await missionLifecycleService.ensureSupervisorMission(options);
  },

  async updateMission(id: number, updates: any, userId: string = "system", orgId?: number | null) {
    return await missionLifecycleService.updateMission(id, updates, userId, orgId);
  },

  async addMember(options: any) {
    return await missionLifecycleService.addMember(options.missionId, options.entityType, options.entityId, options.role);
  },

  async removeMember(missionId: number, entityType: string, entityId: number) {
    return await missionLifecycleService.removeMember(missionId, entityType, entityId);
  },

  async updateMemberStatus(memberId: number, status: string) {
    return await missionLifecycleService.updateMemberStatus(memberId, status);
  },

  async syncFromPlan(missionId: number, plan: any) {
    return await missionLifecycleService.syncFromPlan(missionId, plan);
  },

  async updateBlackboard(missionId: number, patch: any, changedBy: string, reason?: string, tx?: any) {
    return await missionLifecycleService.updateBlackboard(missionId, patch, changedBy, reason, tx);
  },

  async addSharedMemory(missionId: number, observation: string, source: string, changedBy: string = "agent") {
    return await missionLifecycleService.addSharedMemory(missionId, observation, source, changedBy);
  },

  async queueBlackboardUpdate(missionId: number, patch: any, changedBy: string, reason?: string) {
    return await missionLifecycleService.queueBlackboardUpdate(missionId, patch, changedBy, reason);
  },

  async deleteMission(missionId: number, orgContext?: any) {
    return await missionLifecycleService.deleteMission(missionId, orgContext);
  },

  async pauseMission(missionId: number, orgId?: number | null) {
    await missionLifecycleService.pauseMission(missionId, orgId);
  },

  async resumeMission(missionId: number, orgId?: number | null) {
    await missionLifecycleService.resumeMission(missionId, orgId);
  },

  async terminateMission(missionId: number, orgId?: number | null) {
    await missionLifecycleService.terminateMission(missionId, orgId);
  },

  async attachRagAsset(missionId: number, assetId: number, purpose: string, userId: string) {
    return await missionLifecycleService.attachRagAsset(missionId, assetId, purpose, userId);
  },

  async detachRagAsset(missionId: number, attachmentId: number) {
    return await missionLifecycleService.detachRagAsset(missionId, attachmentId);
  },

  async attachDocumentTemplate(missionId: number, templateId: number, role: string, userId: string) {
    return await missionLifecycleService.attachDocumentTemplate(missionId, templateId, role, userId);
  },

  async detachDocumentTemplate(missionId: number, attachmentId: number) {
    return await missionLifecycleService.detachDocumentTemplate(missionId, attachmentId);
  },

  async attachFile(missionId: number, data: any, userId: string) {
    return await missionLifecycleService.attachFile(missionId, data, userId);
  },

  async detachFile(missionId: number, attachmentId: number) {
    return await missionLifecycleService.detachFile(missionId, attachmentId);
  },

  // Removed: promoteToMasterBlueprint (missing in Lifecycle/Query)

  async createTemplate(missionId: number, name: string, description: string, userId: string, orgId: number) {
    return await missionLifecycleService.createTemplate(missionId, name, description, userId, orgId);
  },

  async instantiateTemplate(templateId: number, name: string, userId: string, orgId: number, viaAppSlug?: string, scheduleConfig?: any) {
    return await missionLifecycleService.instantiateTemplate(templateId, name, userId, orgId, viaAppSlug, scheduleConfig);
  },

  async syncDeliverablesToBlackboard(missionId: number, objective: string, changedBy: string) {
    return await missionLifecycleService.syncDeliverablesToBlackboard(missionId, objective, changedBy);
  },


  // --- Execution Operations (Delegated to MissionExecutionService) ---
  async planMission(prompt: string, userId: string, orgId: number, history: any[] = []) {
    return await missionExecutionService.planMission(prompt, userId, orgId, history);
  },

  async launchMission(missionId: number, userId: string, orgId: number | null, existingRunId?: number, metadata?: any) {
    return await missionExecutionService.launchMission(missionId, userId, orgId, existingRunId, undefined, metadata);
  },

  async advanceSequence(missionRunId: number) {
    return await missionExecutionService.advanceSequence(missionRunId);
  },

  async triggerAppWebhook(missionRunId: number, appSlug: string, organizationId: number) {
    return await missionExecutionService.triggerAppWebhook(missionRunId, appSlug, organizationId);
  },

  async ensureSupervisorPipelineForOrg(orgId: number | null, userId: string, tx?: any) {
    return await missionExecutionService.ensureSupervisorPipelineForOrg(orgId, userId, tx);
  },

  async getTimeline(missionRunId: number, limit: number = 50, missionId: number) {
    return await missionQueryService.getTimeline(missionRunId, limit, missionId);
  },

  async getReasoningFeed(missionRunId: number, missionId: number, dynamicTrace: any[], limit: number = 100) {
    return await missionQueryService.getReasoningFeed(missionRunId, missionId, dynamicTrace, limit);
  },

  async checkBudget(missionId: number) {
    return await missionQueryService.checkBudget(missionId);
  }
};


