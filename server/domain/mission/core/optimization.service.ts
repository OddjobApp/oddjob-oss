import { db } from "@server/database_service.js";
import { missionShadowRuns, missionRuns, missions } from "@shared/schema/missions/index.js";
import { eq } from "drizzle-orm";
import { approvalService } from "../../integrations/core/approval.service.js";
import { createLogger } from "@server/utils/logger.js";
import { type EvaluationResult } from "./evaluation.service.js";

const logger = createLogger("OptimizationService");

export const optimizationService = {
  /**
   * Create an HIL approval request for an optimization proposal.
   * This bridges the Phase 2 experiment into a Phase 3 actionable decision.
   */
  async proposeOptimization(shadowRunId: number, evaluation: EvaluationResult) {
    logger.info(`[OptimizationService] Proposing optimization for shadow run ${shadowRunId}`);
    
    // 1. Fetch shadow run details
    const [shadow] = await db
      .select()
      .from(missionShadowRuns)
      .where(eq(missionShadowRuns.id, shadowRunId))
      .limit(1);
      
    if (!shadow) {
      logger.error(`[OptimizationService] Shadow run ${shadowRunId} not found`);
      return;
    }
    
    // 2. Fetch primary run (parent)
    const [primary] = await db
      .select()
      .from(missionRuns)
      .where(eq(missionRuns.id, shadow.parentRunId))
      .limit(1);
      
    if (!primary) {
      logger.error(`[OptimizationService] Primary parent run ${shadow.parentRunId} not found for shadow ${shadowRunId}`);
      return;
    }

    // NEW: Fetch mission to get humanSteeringNudge
    const [mission] = await db
      .select()
      .from(missions)
      .where(eq(missions.id, primary.missionId as any))
      .limit(1);

    // 3. Construct optimization context for HIL decision
    const context = {
      type: "OPTIMIZATION_PROPOSAL",
      shadowRunId: shadow.id,
      parentRunId: primary.id,
      missionId: primary.missionId,
      modelId: shadow.modelId,
      promptVersion: shadow.promptVersion,
      score: evaluation.score,
      reasoning: evaluation.reasoning,
      delta: evaluation.delta,
      improvementDetected: evaluation.isImproved,
      missionName: primary.name,
      primaryModelId: (primary.missionContext as any)?.primaryModelId || "Unknown Baseline",
      humanSteeringNudge: mission?.humanSteeringNudge || null,
    };

    // 4. Create the HIL Approval Request
    // This will appear in the "Decision Inbox" (Activity Center)
    try {
      await approvalService.createApprovalRequest({
        executionId: `optimization:${shadow.id}`, // Custom prefix for mission-level optimizations
        jobId: 0, // System-level
        approverType: "internal",
        approverEmail: primary.createdBy || "admin@oddjob.ai",
        status: "pending",
        organizationId: primary.organizationId || undefined,
        context
      });

      logger.info(`[OptimizationService] HIL Proposal submitted successfully for shadow run ${shadowRunId}`);
    } catch (error: any) {
      logger.error(`[OptimizationService] Failed to create approval request: ${error.message}`);
    }
  }
};


