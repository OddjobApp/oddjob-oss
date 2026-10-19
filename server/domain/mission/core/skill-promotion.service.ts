import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { skills, skillVersionHistory, missionShadowRuns } from "@shared/schema/index.js";
import { eq, desc, sql } from "drizzle-orm";

const logger = createLogger("SkillPromotionService");

export class SkillPromotionService {
  /**
   * Durably apply an approved shadow-run improvement to the real `skills` row.
   * No-op (returns null) if the shadow has no originating skill or no proposed change.
   */
  async promoteToSkill(shadowRunId: number, promotedBy: string): Promise<{ skillId: number; versionId: number } | null> {
    const [shadow] = await db.select().from(missionShadowRuns).where(eq(missionShadowRuns.id, shadowRunId)).limit(1);
    if (!shadow) return null;

    const meta = (shadow.missionContext as any)?.autoresearchMetadata;
    const originalSkillId = meta?.originalSkillId;
    if (!originalSkillId || isNaN(Number(originalSkillId))) return null;

    const proposedCode: string | undefined = meta?.proposedCode ?? undefined;
    const proposedMetadataPatch: Record<string, any> | undefined = meta?.proposedMetadataPatch ?? undefined;
    if (!proposedCode && !proposedMetadataPatch) return null; // nothing durable to write

    const skillId = Number(originalSkillId);
    const [skill] = await db.select().from(skills).where(eq(skills.id, skillId)).limit(1);
    if (!skill) {
      logger.warn(`[SkillPromotion] Skill ${skillId} not found; skipping durable write for shadow ${shadowRunId}`);
      return null;
    }

    // 1. Snapshot the current (pre-change) state before overwriting, so rollback
    //    always has somewhere to go back to even on the very first promotion.
    await db.insert(skillVersionHistory).values({
      skillId,
      code: skill.code,
      metadata: (skill.metadata as any) || {},
      source: "pre_promotion_snapshot",
      shadowRunId,
      promotedBy,
    });

    // 2. Apply the change to the live skill row.
    const mergedMetadata = { ...((skill.metadata as any) || {}), ...(proposedMetadataPatch || {}) };
    await db.update(skills).set({
      code: proposedCode ?? skill.code,
      metadata: mergedMetadata,
      updatedAt: new Date(),
    }).where(eq(skills.id, skillId));

    // 3. Snapshot the new (post-change) state — this is the row future rollbacks restore from.
    const [newVersion] = await db.insert(skillVersionHistory).values({
      skillId,
      code: proposedCode ?? skill.code,
      metadata: mergedMetadata,
      source: "autoresearch_promotion",
      shadowRunId,
      strategyDescription: meta?.strategy ?? null,
      promotedBy,
    }).returning();

    logger.info(`[SkillPromotion] Skill ${skillId} durably promoted from shadow ${shadowRunId} (version history id ${newVersion.id})`);
    return { skillId, versionId: newVersion.id };
  }

  /**
   * Durably apply an externally-generated code change to a skill — e.g. an approved
   * Evolution Flight Deck patch. Snapshots both the pre- and post-change state to
   * skill_version_history, so it is fully rollback-safe (and picked up by the
   * regression watchdog) exactly like an autoresearch promotion.
   */
  async applyDirectCodeChange(
    skillId: number,
    newCode: string,
    opts: { promotedBy: string; strategy?: string; metadataPatch?: Record<string, any> }
  ): Promise<{ skillId: number; versionId: number } | null> {
    if (!newCode || !newCode.trim()) {
      throw new Error("Refusing to apply an empty skill patch.");
    }

    const [skill] = await db.select().from(skills).where(eq(skills.id, skillId)).limit(1);
    if (!skill) {
      logger.warn(`[SkillPromotion] Skill ${skillId} not found; cannot apply direct code change`);
      return null;
    }

    // 1. Snapshot current state (rollback target).
    await db.insert(skillVersionHistory).values({
      skillId,
      code: skill.code,
      metadata: (skill.metadata as any) || {},
      source: "pre_promotion_snapshot",
      promotedBy: opts.promotedBy,
    });

    // 2. Apply the new code to the live skill row.
    const mergedMetadata = { ...((skill.metadata as any) || {}), ...(opts.metadataPatch || {}) };
    await db.update(skills).set({
      code: newCode,
      metadata: mergedMetadata,
      updatedAt: new Date(),
    }).where(eq(skills.id, skillId));

    // 3. Snapshot the new state.
    const [newVersion] = await db.insert(skillVersionHistory).values({
      skillId,
      code: newCode,
      metadata: mergedMetadata,
      source: "evolution_promotion",
      strategyDescription: opts.strategy ?? null,
      promotedBy: opts.promotedBy,
    }).returning();

    logger.info(`[SkillPromotion] Skill ${skillId} code updated via evolution promotion (version history id ${newVersion.id})`);
    return { skillId, versionId: newVersion.id };
  }

  /**
   * Roll back a skill to the most recent version_history row prior to the bad one.
   * If `beforeVersionId` is given, restores the latest row strictly before that id;
   * otherwise restores the row before the single most recent one (undo the last change).
   */
  async rollbackSkill(skillId: number, options: { beforeVersionId?: number; reason: string; actor: string }): Promise<void> {
    const history = await db.select().from(skillVersionHistory)
      .where(eq(skillVersionHistory.skillId, skillId))
      .orderBy(desc(skillVersionHistory.id))
      .limit(10);

    if (history.length === 0) {
      logger.warn(`[SkillPromotion] No version history found for skill ${skillId}; cannot roll back`);
      return;
    }

    const target = options.beforeVersionId
      ? history.find(h => h.id < options.beforeVersionId!)
      : history[1]; // skip the most recent (the bad one), restore the one before it

    if (!target) {
      logger.warn(`[SkillPromotion] No prior version found to roll back skill ${skillId}`);
      return;
    }

    await db.update(skills).set({
      code: target.code,
      metadata: (target.metadata as any) || {},
      updatedAt: new Date(),
    }).where(eq(skills.id, skillId));

    await db.insert(skillVersionHistory).values({
      skillId,
      code: target.code,
      metadata: (target.metadata as any) || {},
      source: "rollback",
      promotedBy: options.actor,
      strategyDescription: `Rollback: ${options.reason} (restored version ${target.id})`,
    });

    logger.warn(`[SkillPromotion] Skill ${skillId} rolled back to version ${target.id}. Reason: ${options.reason}`);
  }

  async getVersionHistory(skillId: number, limit = 20) {
    return db.select().from(skillVersionHistory)
      .where(eq(skillVersionHistory.skillId, skillId))
      .orderBy(desc(skillVersionHistory.createdAt))
      .limit(limit);
  }

  /**
   * Find skills promoted within the lookback window and compare reliability before vs.
   * after promotion. Auto-rolls-back and raises a Decision Inbox notice on regression.
   */
  async checkForRegressions(options: { lookbackHours?: number; regressionThresholdPct?: number } = {}): Promise<void> {
    const lookbackHours = options.lookbackHours ?? 72;
    const regressionThresholdPct = options.regressionThresholdPct ?? 15;
    const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

    const recentPromotions = await db.execute(sql`
      SELECT DISTINCT ON (skill_id) skill_id, id, created_at
      FROM skill_version_history
      WHERE source IN ('autoresearch_promotion', 'evolution_promotion') AND created_at >= ${since}
      ORDER BY skill_id, created_at DESC
    `);
    const rows = Array.isArray(recentPromotions) ? recentPromotions : ((recentPromotions as any).rows ?? []);
    if (rows.length === 0) return;

    const { SentinelService } = await import("../../agents/core/sentinel.service.js");

    for (const row of rows as any[]) {
      const skillId = String(row.skill_id);
      // raw db.execute() rows return "timestamp without time zone" columns as bare
      // strings with no offset (e.g. "2026-06-23 20:33:49.477") — Date would parse
      // that as local time instead of UTC, so normalize explicitly before parsing.
      const promotedAt = row.created_at instanceof Date
        ? row.created_at
        : new Date(`${String(row.created_at).replace(" ", "T")}Z`);
      const windowMs = Date.now() - promotedAt.getTime();
      if (windowMs <= 0) continue;

      const before = await SentinelService.getSkillHealthInWindow(skillId, new Date(promotedAt.getTime() - windowMs), promotedAt);
      const after = await SentinelService.getSkillHealthInWindow(skillId, promotedAt, new Date());

      if (after.totalRuns < 5) continue; // not enough post-promotion signal yet

      const drop = before.reliabilityIndex - after.reliabilityIndex;
      if (drop < regressionThresholdPct) continue;

      logger.warn(`[Watchdog] Skill ${skillId} regressed ${drop}pts after promotion ${row.id} (before=${before.reliabilityIndex}%, after=${after.reliabilityIndex}%). Auto-rolling back.`);

      await this.rollbackSkill(Number(skillId), {
        beforeVersionId: row.id,
        reason: `Auto-rollback: reliability dropped ${drop}pts after promotion (before=${before.reliabilityIndex}%, after=${after.reliabilityIndex}%, n=${after.totalRuns})`,
        actor: "system:watchdog",
      });

      const { approvalService } = await import("../../integrations/core/approval.service.js");
      await approvalService.createApprovalRequest({
        executionId: `skill_regression:${skillId}:${row.id}`,
        jobId: 0,
        approverType: "internal",
        approverEmail: "admin@oddjob.ai",
        status: "pending",
        context: {
          type: "SKILL_REGRESSION_ROLLBACK",
          skillId,
          versionId: row.id,
          reliabilityBefore: before.reliabilityIndex,
          reliabilityAfter: after.reliabilityIndex,
          dropPct: drop,
          message: `Skill ${skillId} was auto-rolled-back after an approved promotion regressed reliability by ${drop} points. Review and confirm.`,
        },
      });
    }
  }
}

export const skillPromotionService = new SkillPromotionService();
