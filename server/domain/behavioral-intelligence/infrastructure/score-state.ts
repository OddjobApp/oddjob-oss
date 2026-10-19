/**
 * Behavioral Intelligence Engine — Score State (Redis)
 *
 * Manages the hot score state in Redis. Each entity's scores are stored
 * as a Redis Hash with vector values and timestamps.
 *
 * Key pattern: bi:{orgId}:scores:{entityType}:{entityId}
 *
 * Hash fields:
 *   {vectorName}        → raw score (float)
 *   {vectorName}:ts     → last update timestamp (unix seconds)
 *   {vectorName}:src    → signal source ("behavioral"|"qualification"|"blended")
 *
 * All operations are org-namespaced for tenant isolation.
 */
import { getRedisClient } from "@domain/core/infrastructure/redis/redis-client.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("BIScoreState");

// ─── Key Patterns ────────────────────────────────────────────────────────────

const SCORE_PREFIX = "bi:scores:";
const WINDOW_PREFIX = "bi:window:";
const TEMPORAL_PREFIX = "bi:temporal:";
const COOLDOWN_PREFIX = "bi:cooldown:";

function scoreKey(orgId: number, entityType: string, entityId: string): string {
  return `${SCORE_PREFIX}${orgId}:${entityType}:${entityId}`;
}

function windowKey(orgId: number, entityType: string, entityId: string): string {
  return `${WINDOW_PREFIX}${orgId}:${entityType}:${entityId}`;
}

function temporalKey(orgId: number, entityType: string, entityId: string): string {
  return `${TEMPORAL_PREFIX}${orgId}:${entityType}:${entityId}`;
}

function cooldownKey(orgId: number, thresholdId: string, entityType: string, entityId: string): string {
  return `${COOLDOWN_PREFIX}${orgId}:${thresholdId}:${entityType}:${entityId}`;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface VectorScore {
  vector: string;
  rawScore: number;
  lastUpdate: number; // unix seconds
  source: "behavioral" | "qualification" | "blended";
}

export interface ScoreUpdate {
  vector: string;
  weight: number;
  operation: "increment" | "set" | "multiply";
  source: "behavioral" | "qualification";
}

export interface EntityScoreState {
  orgId: number;
  entityType: string;
  entityId: string;
  vectors: VectorScore[];
}

// ─── Score Operations ────────────────────────────────────────────────────────

/**
 * Apply score updates atomically using a Lua script.
 * Handles increment, set, and multiply operations.
 * Returns the new score values after update.
 */
async function applyScoreUpdates(
  orgId: number,
  entityType: string,
  entityId: string,
  updates: ScoreUpdate[]
): Promise<Record<string, number>> {
  const client = getRedisClient();
  const key = scoreKey(orgId, entityType, entityId);
  const now = Math.floor(Date.now() / 1000);
  const results: Record<string, number> = {};

  // Use pipeline for atomic multi-vector update
  const pipeline = client.pipeline();

  for (const update of updates) {
    if (update.operation === "increment") {
      pipeline.hincrbyfloat(key, update.vector, update.weight);
    } else if (update.operation === "set") {
      pipeline.hset(key, update.vector, String(update.weight));
    } else if (update.operation === "multiply") {
      // Multiply requires read-then-write — use Lua for atomicity
      pipeline.eval(
        `local v = tonumber(redis.call('HGET', KEYS[1], ARGV[1]) or '0'); v = v * tonumber(ARGV[2]); redis.call('HSET', KEYS[1], ARGV[1], tostring(v)); return tostring(v)`,
        1, key, update.vector, String(update.weight)
      );
    }
    // Update timestamp and source
    pipeline.hset(key, `${update.vector}:ts`, String(now));
    pipeline.hset(key, `${update.vector}:src`, update.source);
  }

  // Set TTL (90 days default — matches retention)
  pipeline.expire(key, 90 * 86400);

  const pipelineResults = await pipeline.exec();

  // Extract new values from pipeline results
  let resultIdx = 0;
  for (const update of updates) {
    const [err, value] = pipelineResults![resultIdx] || [null, 0];
    results[update.vector] = err ? 0 : parseFloat(String(value) || "0");
    resultIdx += 3; // skip ts and src set results
  }

  return results;
}

/**
 * Get all vector scores for an entity.
 */
async function getScores(orgId: number, entityType: string, entityId: string): Promise<VectorScore[]> {
  const client = getRedisClient();
  const key = scoreKey(orgId, entityType, entityId);
  const hash = await client.hgetall(key);

  if (!hash || Object.keys(hash).length === 0) return [];

  const vectors: VectorScore[] = [];
  const seen = new Set<string>();

  for (const field of Object.keys(hash)) {
    if (field.includes(":")) continue; // skip :ts and :src fields
    if (seen.has(field)) continue;
    seen.add(field);

    vectors.push({
      vector: field,
      rawScore: parseFloat(hash[field] || "0"),
      lastUpdate: parseInt(hash[`${field}:ts`] || "0"),
      source: (hash[`${field}:src`] as any) || "behavioral",
    });
  }

  return vectors;
}

/**
 * Get a single vector's raw score.
 */
async function getVectorScore(orgId: number, entityType: string, entityId: string, vector: string): Promise<number> {
  const client = getRedisClient();
  const key = scoreKey(orgId, entityType, entityId);
  const value = await client.hget(key, vector);
  return parseFloat(value || "0");
}

/**
 * Delete all scores for an entity (GDPR erasure).
 */
async function deleteEntityScores(orgId: number, entityType: string, entityId: string): Promise<void> {
  const client = getRedisClient();
  const pipeline = client.pipeline();
  pipeline.del(scoreKey(orgId, entityType, entityId));
  pipeline.del(windowKey(orgId, entityType, entityId));
  pipeline.del(temporalKey(orgId, entityType, entityId));
  await pipeline.exec();
}

// ─── Event Window ────────────────────────────────────────────────────────────

const MAX_WINDOW_SIZE = 20;

/**
 * Push an event to the entity's event window (for path matching).
 * Maintains a capped list of the last N events.
 */
async function pushToWindow(orgId: number, entityType: string, entityId: string, event: { event_type: string; timestamp: string; metadata?: any }): Promise<void> {
  const client = getRedisClient();
  const key = windowKey(orgId, entityType, entityId);
  const pipeline = client.pipeline();
  pipeline.lpush(key, JSON.stringify(event));
  pipeline.ltrim(key, 0, MAX_WINDOW_SIZE - 1);
  pipeline.expire(key, 90 * 86400);
  await pipeline.exec();
}

/**
 * Get the entity's event window (most recent first).
 */
async function getWindow(orgId: number, entityType: string, entityId: string): Promise<Array<{ event_type: string; timestamp: string; metadata?: any }>> {
  const client = getRedisClient();
  const key = windowKey(orgId, entityType, entityId);
  const items = await client.lrange(key, 0, MAX_WINDOW_SIZE - 1);
  return items.map(item => { try { return JSON.parse(item); } catch { return null; } }).filter(Boolean);
}

// ─── Cooldown Management ─────────────────────────────────────────────────────

/**
 * Check if a threshold is in cooldown for an entity.
 */
async function isInCooldown(orgId: number, thresholdId: string, entityType: string, entityId: string): Promise<boolean> {
  const client = getRedisClient();
  const key = cooldownKey(orgId, thresholdId, entityType, entityId);
  return (await client.exists(key)) === 1;
}

/**
 * Set cooldown for a threshold × entity combination.
 */
async function setCooldown(orgId: number, thresholdId: string, entityType: string, entityId: string, cooldownMs: number): Promise<void> {
  const client = getRedisClient();
  const key = cooldownKey(orgId, thresholdId, entityType, entityId);
  await client.set(key, String(Date.now()), "PX", cooldownMs);
}

// ─── Temporal Metrics Cache ──────────────────────────────────────────────────

/**
 * Store pre-computed temporal metrics (updated during snapshot flush).
 */
async function setTemporalMetrics(orgId: number, entityType: string, entityId: string, metrics: Record<string, any>): Promise<void> {
  const client = getRedisClient();
  const key = temporalKey(orgId, entityType, entityId);
  const pipeline = client.pipeline();
  for (const [field, value] of Object.entries(metrics)) {
    pipeline.hset(key, field, typeof value === "object" ? JSON.stringify(value) : String(value));
  }
  pipeline.expire(key, 86400); // 24h TTL
  await pipeline.exec();
}

/**
 * Get pre-computed temporal metrics.
 */
async function getTemporalMetrics(orgId: number, entityType: string, entityId: string): Promise<Record<string, any>> {
  const client = getRedisClient();
  const key = temporalKey(orgId, entityType, entityId);
  return await client.hgetall(key);
}

// ─── Batch Operations ────────────────────────────────────────────────────────

/**
 * Get scores for multiple entities (batch query).
 */
async function batchGetScores(orgId: number, entityType: string, entityIds: string[]): Promise<Map<string, VectorScore[]>> {
  const client = getRedisClient();
  const pipeline = client.pipeline();

  for (const entityId of entityIds) {
    pipeline.hgetall(scoreKey(orgId, entityType, entityId));
  }

  const results = await pipeline.exec();
  const scoreMap = new Map<string, VectorScore[]>();

  for (let i = 0; i < entityIds.length; i++) {
    const [err, hash] = results![i] || [null, {}];
    if (err || !hash || Object.keys(hash as any).length === 0) {
      scoreMap.set(entityIds[i], []);
      continue;
    }

    const vectors: VectorScore[] = [];
    const h = hash as Record<string, string>;
    for (const field of Object.keys(h)) {
      if (field.includes(":")) continue;
      vectors.push({
        vector: field,
        rawScore: parseFloat(h[field] || "0"),
        lastUpdate: parseInt(h[`${field}:ts`] || "0"),
        source: (h[`${field}:src`] as any) || "behavioral",
      });
    }
    scoreMap.set(entityIds[i], vectors);
  }

  return scoreMap;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export const biScoreState = {
  // Score operations
  applyScoreUpdates,
  getScores,
  getVectorScore,
  deleteEntityScores,
  batchGetScores,

  // Event window
  pushToWindow,
  getWindow,

  // Cooldowns
  isInCooldown,
  setCooldown,

  // Temporal metrics
  setTemporalMetrics,
  getTemporalMetrics,

  // Key helpers (for testing/debugging)
  scoreKey,
  windowKey,
  temporalKey,
  cooldownKey,
};
