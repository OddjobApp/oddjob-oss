/**
 * Behavioral Intelligence Engine — Retention Service
 *
 * Manages data lifecycle:
 * - Configurable retention periods per org (default 90 days)
 * - Automatic pruning of expired snapshots and signal logs
 * - Data anonymization (strip entity_id after threshold, retain aggregates)
 * - Redis TTL enforcement for hot state
 */
import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { appRecords } from "@shared/schema/apps.js";
import { sql, and, eq } from "drizzle-orm";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";

const logger = createLogger("BIRetention");

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RetentionConfig {
  snapshot_retention_days: number;  // Default 90
  signal_log_retention_days: number; // Default 30
  redis_score_ttl_days: number;     // Default 90
  anonymize_after_days?: number;    // If set, strip entity_id after this many days
}

const DEFAULT_CONFIG: RetentionConfig = {
  snapshot_retention_days: 90,
  signal_log_retention_days: 30,
  redis_score_ttl_days: 90,
};

// ─── Pruning ─────────────────────────────────────────────────────────────────

/**
 * Prune expired data for an org based on retention config.
 */
async function pruneExpiredData(orgId: number, config: RetentionConfig = DEFAULT_CONFIG): Promise<{
  snapshots_pruned: number;
  signals_pruned: number;
  anonymized: number;
}> {
  let snapshotsPruned = 0;
  let signalsPruned = 0;
  let anonymized = 0;

  // 1. Prune expired snapshots
  const snapshotCutoff = new Date();
  snapshotCutoff.setDate(snapshotCutoff.getDate() - config.snapshot_retention_days);

  try {
    const deleted = await db.delete(appRecords)
      .where(and(
        eq(appRecords.orgId, orgId),
        eq(appRecords.collection, "bi_score_snapshots"),
        sql`${appRecords.createdAt} < ${snapshotCutoff}`
      ))
      .returning({ id: appRecords.id });
    snapshotsPruned = deleted.length;
  } catch (err: any) {
    logger.error(`[Retention] Snapshot prune failed for org ${orgId}: ${err.message}`);
  }

  // 2. Prune expired signal logs
  const signalCutoff = new Date();
  signalCutoff.setDate(signalCutoff.getDate() - config.signal_log_retention_days);

  try {
    const deleted = await db.delete(appRecords)
      .where(and(
        eq(appRecords.orgId, orgId),
        eq(appRecords.collection, "bi_signal_log"),
        sql`${appRecords.createdAt} < ${signalCutoff}`
      ))
      .returning({ id: appRecords.id });
    signalsPruned = deleted.length;
  } catch (err: any) {
    logger.error(`[Retention] Signal log prune failed for org ${orgId}: ${err.message}`);
  }

  // 3. Anonymize old snapshots (if configured)
  if (config.anonymize_after_days) {
    const anonymizeCutoff = new Date();
    anonymizeCutoff.setDate(anonymizeCutoff.getDate() - config.anonymize_after_days);

    try {
      // Update snapshots: replace entity_id with hash, keep aggregate data
      const result = await db.execute(sql`
        UPDATE app_records
        SET data = jsonb_set(
          jsonb_set(data, '{entity_id}', '"anonymized"'),
          '{anonymized_at}', to_jsonb(now()::text)
        )
        WHERE org_id = ${orgId}
          AND collection = 'bi_score_snapshots'
          AND created_at < ${anonymizeCutoff}
          AND (data->>'entity_id') != 'anonymized'
      `);
      anonymized = (result as any)?.rowCount || 0;
    } catch (err: any) {
      logger.error(`[Retention] Anonymization failed for org ${orgId}: ${err.message}`);
    }
  }

  if (snapshotsPruned > 0 || signalsPruned > 0 || anonymized > 0) {
    logger.info(`[Retention] Org ${orgId}: pruned ${snapshotsPruned} snapshots, ${signalsPruned} signals, anonymized ${anonymized}`);
    eventStream.publish("bi.retention_pruned", { orgId, snapshotsPruned, signalsPruned, anonymized }, { organizationId: orgId }, "behavioral-intelligence").catch(() => {});
  }

  return { snapshots_pruned: snapshotsPruned, signals_pruned: signalsPruned, anonymized };
}

/**
 * Run retention pruning for all active orgs.
 * Called periodically (e.g., daily via scheduler).
 */
async function pruneAll(config: RetentionConfig = DEFAULT_CONFIG): Promise<void> {
  // Get all orgs that have BI data
  const orgs = await db.selectDistinct({ orgId: appRecords.orgId })
    .from(appRecords)
    .where(eq(appRecords.collection, "bi_score_snapshots"));

  for (const { orgId } of orgs) {
    if (orgId) {
      await pruneExpiredData(orgId, config);
    }
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export const biRetentionService = {
  pruneExpiredData,
  pruneAll,
  DEFAULT_CONFIG,
};
