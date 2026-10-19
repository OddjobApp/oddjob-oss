import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { missionRuns, missionShadowRuns, forensicEventLog } from "@shared/schema/index.js";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import { missionRunService } from "./mission-run.service.js";

const logger = createLogger("AutoresearchService");

export class AutoresearchService {
  /**
   * Main entry point for autonomous evolution.
   */
  async initiateEvolution(skillId: string, missionRunId: number, options: { orgId?: number } = {}) {
    logger.info(`[Autoresearch] Initiating evolution for skill ${skillId} (Mission Run ${missionRunId})`);

    // 1. Verify failure signatures
    const failures = await this.getRecentFailures(skillId, options);
    if (failures.length === 0) {
      logger.info(`[Autoresearch] No recent failures found for skill ${skillId}. Evolutionary pressure is low.`);
      return;
    }

    // 1.5 Avoid redundant shadow experiments for the same skill if already active
    const activeShadowConditions = [
      eq(missionShadowRuns.status, 'active'),
      sql`${missionShadowRuns.missionContext}->'autoresearchMetadata'->>'originalSkillId' = ${skillId}`
    ];
    if (options.orgId) {
      activeShadowConditions.push(eq(missionRuns.organizationId, options.orgId));
    }

    const activeShadowsQuery = db.select({ id: missionShadowRuns.id }).from(missionShadowRuns);
    const activeShadows = options.orgId
      ? await activeShadowsQuery
        .innerJoin(missionRuns, eq(missionShadowRuns.parentRunId, missionRuns.id))
        .where(and(...activeShadowConditions))
        .limit(1)
      : await activeShadowsQuery
        .where(and(...activeShadowConditions))
        .limit(1);

    if (activeShadows.length > 0) {
      logger.info(`[Autoresearch] Skill ${skillId} already has an active shadow experiment (#${activeShadows[0].id}). Skipping.`);
      return;
    }

    // 2. Retrieve TrustGraph Context
    const { TrustGraphExportService } = await import("../../integrations/trustgraph/export.service.js");
    const graphContext = await TrustGraphExportService.snapMission(missionRunId);

    // 3. Generate New Strategy (Skill or Prompt)
    const { skillGeneratorService } = await import("./skill-generator.service.js");
    const graphContextUrl = graphContext.success ? (graphContext as any).coreUrl : "";
    const proposal = await skillGeneratorService.generateProposal(skillId, failures, graphContextUrl);

    // 4. Launch Shadow Experiment (Phase 2)
    logger.info(`[Autoresearch] Launching Shadow Experiment for skill ${skillId}...`);
    const shadow = await missionRunService.createShadowRun({
      parentRunId: missionRunId,
      modelId: proposal.recommendedModelId,
      promptVersion: proposal.newVersion,
      missionContext: {
        ...proposal.modifiedContext,
        autoresearchMetadata: {
          originalSkillId: skillId,
          failureCount: failures.length,
          strategy: proposal.strategyDescription,
          proposedCode: proposal.proposedCode ?? null,
          proposedMetadataPatch: proposal.modifiedContext ?? null
        }
      }
    });

    logger.info(`[Autoresearch] Shadow Run ${shadow.id} launched. Monitoring for performance gains.`);
  }

  private async getRecentFailures(skillId: string, options: { orgId?: number } = {}) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const conditions = [
      eq(forensicEventLog.jobType, "uci_skill_execution"),
      eq(forensicEventLog.status, "failure"),
      sql`${forensicEventLog.attributes}->>'skillId' = ${skillId}`,
      gte(forensicEventLog.createdAt, thirtyDaysAgo)
    ];

    if (options.orgId) {
      conditions.push(sql`(
        ${forensicEventLog.organizationId} = ${options.orgId}
        OR ${forensicEventLog.missionRunId} IN (
          SELECT id FROM mission_runs WHERE organization_id = ${options.orgId}
        )
      )`);
    }

    return await db
      .select()
      .from(forensicEventLog)
      .where(and(...conditions))
      .orderBy(desc(forensicEventLog.createdAt))
      .limit(5);
  }
}

export const autoresearchService = new AutoresearchService();


