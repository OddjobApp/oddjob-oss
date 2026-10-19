/**
 * Behavioral Intelligence Engine — Snapshot Flusher
 *
 * Periodically flushes score state from Redis to PostgreSQL for:
 * - Historical analysis and reporting
 * - Prediction engine training data
 * - Score history queries (trend, velocity)
 * - GDPR-compliant retention management
 *
 * Runs every 5 minutes. Pre-computes temporal metrics during flush.
 * Uses flattenForDataset() for consistent schema mapping.
 */
import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { appRecords } from "@shared/schema/apps.js";
import { biScoreState } from "./score-state.js";
import { computeDecay, computeRecency } from "../core/decay-engine.js";
import { getRedisClient } from "@domain/core/infrastructure/redis/redis-client.js";
import { getActiveIndexOrgIds } from "./rule-index.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";

const logger = createLogger("BISnapshotFlusher");

// ─── Constants ───────────────────────────────────────────────────────────────

const FLUSH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const SCORE_KEY_PATTERN = "bi:scores:*";
const SNAPSHOT_COLLECTION = "bi_score_snapshots";
const BATCH_SIZE = 100; // Flush 100 entities per batch to avoid overwhelming PG
const DEFAULT_RETENTION_DAYS = 90;

// ─── Types ───────────────────────────────────────────────────────────────────

interface ScoreSnapshot {
  org_id: number;
  entity_type: string;
  entity_id: string;
  vectors: Record<string, { raw: number; decayed: number; source: string; last_update: number }>;
  temporal: Record<string, any>;
  rfg: { recency: number; frequency?: number };
  snapshot_at: string;
}

// ─── Flusher Logic ───────────────────────────────────────────────────────────

let flushInterval: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

/**
 * Perform a single flush cycle for all active orgs.
 */
async function flush(): Promise<{ orgsProcessed: number; entitiesFlushed: number; errors: number }> {
  if (isRunning) {
    logger.warn("[SnapshotFlusher] Previous flush still running — skipping");
    return { orgsProcessed: 0, entitiesFlushed: 0, errors: 0 };
  }

  isRunning = true;
  const startTime = Date.now();
  let orgsProcessed = 0;
  let entitiesFlushed = 0;
  let errors = 0;

  try {
    const client = getRedisClient();
    const now = Math.floor(Date.now() / 1000);

    // Scan for all score keys across all orgs
    // Pattern: bi:scores:{orgId}:{entityType}:{entityId}
    let cursor = "0";
    const allKeys: string[] = [];

    do {
      const [nextCursor, keys] = await client.scan(cursor, "MATCH", SCORE_KEY_PATTERN, "COUNT", 500);
      cursor = nextCursor;
      allKeys.push(...keys);
    } while (cursor !== "0" && allKeys.length < 10000); // Cap at 10K entities per flush

    if (allKeys.length === 0) {
      isRunning = false;
      return { orgsProcessed: 0, entitiesFlushed: 0, errors: 0 };
    }

    // Group keys by org
    const orgKeys = new Map<number, Array<{ key: string; entityType: string; entityId: string }>>();

    for (const key of allKeys) {
      // Parse: bi:scores:{orgId}:{entityType}:{entityId}
      const parts = key.replace("bi:scores:", "").split(":");
      if (parts.length < 3) continue;
      const orgId = parseInt(parts[0]);
      const entityType = parts[1];
      const entityId = parts.slice(2).join(":"); // entityId might contain colons
      if (isNaN(orgId)) continue;

      const existing = orgKeys.get(orgId) || [];
      existing.push({ key, entityType, entityId });
      orgKeys.set(orgId, existing);
    }

    // Process each org
    for (const [orgId, entities] of orgKeys) {
      orgsProcessed++;

      // Process in batches
      for (let i = 0; i < entities.length; i += BATCH_SIZE) {
        const batch = entities.slice(i, i + BATCH_SIZE);
        const snapshots: ScoreSnapshot[] = [];

        for (const { key, entityType, entityId } of batch) {
          try {
            const hash = await client.hgetall(key);
            if (!hash || Object.keys(hash).length === 0) continue;

            // Build vector snapshot
            const vectors: ScoreSnapshot["vectors"] = {};
            const seen = new Set<string>();

            for (const field of Object.keys(hash)) {
              if (field.includes(":")) continue;
              if (seen.has(field)) continue;
              seen.add(field);

              const raw = parseFloat(hash[field] || "0");
              const lastUpdate = parseInt(hash[`${field}:ts`] || "0");
              const source = hash[`${field}:src`] || "behavioral";
              const decayed = computeDecay(raw, lastUpdate, now, { type: "exponential", halfLifeDays: 7 });

              vectors[field] = { raw, decayed, source, last_update: lastUpdate };
            }

            if (Object.keys(vectors).length === 0) continue;

            // Compute temporal metrics
            const lastActivity = Math.max(...Object.values(vectors).map(v => v.last_update));
            const recency = computeRecency(lastActivity, now, 7);

            // Compute velocity (score change rate) — compare with previous snapshot if available
            const temporal: Record<string, any> = {};
            for (const [vectorName, vectorData] of Object.entries(vectors)) {
              const ageHours = (now - vectorData.last_update) / 3600;
              temporal[`velocity:${vectorName}`] = ageHours > 0 ? vectorData.raw / ageHours : 0;
            }

            snapshots.push({
              org_id: orgId,
              entity_type: entityType,
              entity_id: entityId,
              vectors,
              temporal,
              rfg: { recency },
              snapshot_at: new Date().toISOString(),
            });

            // Update temporal metrics cache in Redis
            await biScoreState.setTemporalMetrics(orgId, entityType, entityId, temporal);

          } catch (err: any) {
            errors++;
            logger.warn(`[SnapshotFlusher] Failed to snapshot ${key}: ${err.message}`);
          }
        }

        // Batch insert to PostgreSQL
        if (snapshots.length > 0) {
          try {
            // Find the BI app for this org (needed for appRecords)
            // Use org_id 0 as a system-level collection
            const values = snapshots.map(s => ({
              appId: 0, // System-level snapshots
              orgId: s.org_id,
              collection: SNAPSHOT_COLLECTION,
              recordId: `${s.entity_type}:${s.entity_id}:${Date.now()}`,
              data: s as any,
              createdAt: new Date(),
              updatedAt: new Date(),
            }));

            await db.insert(appRecords).values(values).onConflictDoNothing();
            entitiesFlushed += snapshots.length;
          } catch (err: any) {
            errors++;
            logger.error(`[SnapshotFlusher] Batch insert failed for org ${orgId}: ${err.message}`);
          }
        }
      }
    }

    const durationMs = Date.now() - startTime;
    if (entitiesFlushed > 0) {
      logger.info(`[SnapshotFlusher] Flushed ${entitiesFlushed} entities across ${orgsProcessed} orgs in ${durationMs}ms (${errors} errors)`);
    }

    // Emit flush event for monitoring
    eventStream.publish("bi.snapshot_flushed", {
      orgsProcessed, entitiesFlushed, errors, durationMs,
    }, {}, "behavioral-intelligence").catch(() => {});

  } catch (err: any) {
    logger.error(`[SnapshotFlusher] Flush cycle failed: ${err.message}`);
    errors++;
  } finally {
    isRunning = false;
  }

  return { orgsProcessed, entitiesFlushed, errors };
}

/**
 * Start the periodic flush cycle.
 */
function start(): void {
  if (flushInterval) return;
  logger.info("[SnapshotFlusher] Starting (interval: 5 minutes)");
  flushInterval = setInterval(flush, FLUSH_INTERVAL_MS);
  // Run first flush after 30 seconds (let the system stabilize)
  setTimeout(flush, 30_000);
}

/**
 * Stop the periodic flush cycle.
 */
function stop(): void {
  if (flushInterval) {
    clearInterval(flushInterval);
    flushInterval = null;
    logger.info("[SnapshotFlusher] Stopped");
  }
}

/**
 * Trigger an immediate flush (for testing or on-demand).
 */
async function flushNow(): Promise<{ orgsProcessed: number; entitiesFlushed: number; errors: number }> {
  return flush();
}

/**
 * Prune snapshots older than retention period.
 */
async function pruneExpired(retentionDays = DEFAULT_RETENTION_DAYS): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);

  try {
    const { sql } = await import("drizzle-orm");
    const result = await db.delete(appRecords)
      .where(sql`${appRecords.collection} = ${SNAPSHOT_COLLECTION} AND ${appRecords.createdAt} < ${cutoff}`)
      .returning({ id: appRecords.id });

    const pruned = result.length;
    if (pruned > 0) {
      logger.info(`[SnapshotFlusher] Pruned ${pruned} expired snapshots (older than ${retentionDays} days)`);
    }
    return pruned;
  } catch (err: any) {
    logger.error(`[SnapshotFlusher] Prune failed: ${err.message}`);
    return 0;
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export const biSnapshotFlusher = {
  start,
  stop,
  flushNow,
  pruneExpired,
  isRunning: () => isRunning,
};
