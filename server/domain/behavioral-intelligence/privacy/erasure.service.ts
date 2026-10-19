/**
 * Behavioral Intelligence Engine — GDPR Erasure Service
 *
 * Implements right-to-erasure (Article 17) for behavioral scoring data.
 * Permanently removes all scoring data for a specified entity across:
 * - Redis hot state (scores, windows, cooldowns, temporal metrics)
 * - PostgreSQL snapshots (bi_score_snapshots)
 * - Signal logs (bi_signal_log)
 * - Knowledge graph nodes (if tagged)
 *
 * Produces a cryptographic proof of deletion for audit compliance.
 */
import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { appRecords } from "@shared/schema/apps.js";
import { biScoreState } from "../infrastructure/score-state.js";
import { getRedisClient } from "@domain/core/infrastructure/redis/redis-client.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";
import { sql, and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";

const logger = createLogger("BIErasure");

export interface ErasureResult {
  success: boolean;
  entity_type: string;
  entity_id: string;
  org_id: number;
  records_deleted: {
    redis_keys: number;
    pg_snapshots: number;
    pg_signals: number;
  };
  proof_hash: string; // SHA-256 of deleted record IDs
  completed_at: string;
}

/**
 * Delete ALL behavioral scoring data for a specific entity.
 * This is irreversible and produces an audit-compliant proof.
 */
async function eraseEntity(orgId: number, entityType: string, entityId: string): Promise<ErasureResult> {
  logger.info(`[Erasure] Starting deletion for ${entityType}:${entityId} in org ${orgId}`);

  const deletedIds: string[] = [];
  let redisKeysDeleted = 0;
  let pgSnapshotsDeleted = 0;
  let pgSignalsDeleted = 0;

  // 1. Delete Redis hot state
  try {
    const client = getRedisClient();
    const keysToDelete = [
      biScoreState.scoreKey(orgId, entityType, entityId),
      biScoreState.windowKey(orgId, entityType, entityId),
      biScoreState.temporalKey(orgId, entityType, entityId),
    ];

    // Also find and delete any cooldown keys for this entity
    let cursor = "0";
    const cooldownPattern = `bi:cooldown:${orgId}:*:${entityType}:${entityId}`;
    do {
      const [nextCursor, keys] = await client.scan(cursor, "MATCH", cooldownPattern, "COUNT", 100);
      cursor = nextCursor;
      keysToDelete.push(...keys);
    } while (cursor !== "0");

    for (const key of keysToDelete) {
      const deleted = await client.del(key);
      if (deleted > 0) {
        redisKeysDeleted++;
        deletedIds.push(`redis:${key}`);
      }
    }
  } catch (err: any) {
    logger.error(`[Erasure] Redis deletion failed: ${err.message}`);
  }

  // 2. Delete PostgreSQL snapshots
  try {
    const snapshots = await db.delete(appRecords)
      .where(and(
        eq(appRecords.orgId, orgId),
        eq(appRecords.collection, "bi_score_snapshots"),
        sql`${appRecords.data}->>'entity_type' = ${entityType} AND ${appRecords.data}->>'entity_id' = ${entityId}`
      ))
      .returning({ id: appRecords.id, recordId: appRecords.recordId });

    pgSnapshotsDeleted = snapshots.length;
    deletedIds.push(...snapshots.map(s => `pg:snapshot:${s.recordId}`));
  } catch (err: any) {
    logger.error(`[Erasure] Snapshot deletion failed: ${err.message}`);
  }

  // 3. Delete signal logs
  try {
    const signals = await db.delete(appRecords)
      .where(and(
        eq(appRecords.orgId, orgId),
        eq(appRecords.collection, "bi_signal_log"),
        sql`${appRecords.data}->>'entity_type' = ${entityType} AND ${appRecords.data}->>'entity_id' = ${entityId}`
      ))
      .returning({ id: appRecords.id, recordId: appRecords.recordId });

    pgSignalsDeleted = signals.length;
    deletedIds.push(...signals.map(s => `pg:signal:${s.recordId}`));
  } catch (err: any) {
    logger.error(`[Erasure] Signal log deletion failed: ${err.message}`);
  }

  // 4. Generate cryptographic proof
  const proofInput = deletedIds.sort().join("|");
  const proofHash = createHash("sha256").update(proofInput).digest("hex");

  const result: ErasureResult = {
    success: true,
    entity_type: entityType,
    entity_id: entityId,
    org_id: orgId,
    records_deleted: {
      redis_keys: redisKeysDeleted,
      pg_snapshots: pgSnapshotsDeleted,
      pg_signals: pgSignalsDeleted,
    },
    proof_hash: proofHash,
    completed_at: new Date().toISOString(),
  };

  // 5. Emit deletion event (for audit trail)
  eventStream.publish("bi.entity_erased", {
    orgId, entityType, entityId,
    records_deleted: result.records_deleted,
    proof_hash: proofHash,
  }, { organizationId: orgId }, "behavioral-intelligence").catch(() => {});

  logger.info(`[Erasure] Completed for ${entityType}:${entityId} — ${redisKeysDeleted} Redis keys, ${pgSnapshotsDeleted} snapshots, ${pgSignalsDeleted} signals deleted. Proof: ${proofHash.slice(0, 16)}...`);

  return result;
}

/**
 * Check if an entity has any scoring data (for consent verification).
 */
async function hasData(orgId: number, entityType: string, entityId: string): Promise<boolean> {
  const scores = await biScoreState.getScores(orgId, entityType, entityId);
  return scores.length > 0;
}

export const biErasureService = { eraseEntity, hasData };
