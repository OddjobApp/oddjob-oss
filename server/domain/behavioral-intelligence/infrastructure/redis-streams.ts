/**
 * Behavioral Intelligence Engine — Redis Streams Infrastructure
 *
 * Manages Redis Streams for event ingestion and action dispatch.
 * Each org gets its own stream namespace for tenant isolation.
 *
 * Streams:
 * - bi:{orgId}:events — incoming behavioral/qualification events
 * - bi:{orgId}:actions — threshold-triggered actions to dispatch
 *
 * Consumer groups ensure exactly-once processing with acknowledgment.
 */
import { redis, getRedisClient } from "@domain/core/infrastructure/redis/redis-client.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("BIRedisStreams");

// ─── Constants ───────────────────────────────────────────────────────────────

const EVENT_STREAM_PREFIX = "bi:events:";
const ACTION_STREAM_PREFIX = "bi:actions:";
const CONSUMER_GROUP = "bi-scoring-engine";
const ACTION_CONSUMER_GROUP = "bi-action-dispatcher";
const MAX_STREAM_LENGTH = 100_000; // Trim streams to prevent unbounded growth

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BIScoringEvent {
  event_id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  source: "sdk" | "webhook" | "crm" | "workbench" | "diff" | "agent" | "system";
  signal_category: "behavioral" | "qualification";
  timestamp: string; // ISO8601
  org_id: number;
  payload: Record<string, any>;
  api_key_id?: string;
  environmental?: {
    latitude?: number;
    longitude?: number;
    altitude_m?: number;
    timezone?: string;
    temperature_c?: number;
    weather_condition?: string;
    signal_dbm?: number;
    connection_type?: string;
  };
}

export interface BIActionEvent {
  action_id: string;
  threshold_id: string;
  entity_type: string;
  entity_id: string;
  org_id: number;
  action_type: string; // webhook, slack, mission_launch, email, crm_update, hil_form
  action_config: Record<string, any>;
  crossed_at: string;
  vector: string;
  score_value: number;
  context?: Record<string, any>;
}

// ─── Stream Management ───────────────────────────────────────────────────────

function eventStreamKey(orgId: number): string {
  return `${EVENT_STREAM_PREFIX}${orgId}`;
}

function actionStreamKey(orgId: number): string {
  return `${ACTION_STREAM_PREFIX}${orgId}`;
}

/**
 * Ensure consumer groups exist for an org's streams.
 * Idempotent — safe to call multiple times.
 */
async function ensureConsumerGroups(orgId: number): Promise<void> {
  const client = getRedisClient();
  const eventKey = eventStreamKey(orgId);
  const actionKey = actionStreamKey(orgId);

  try {
    await client.xgroup("CREATE", eventKey, CONSUMER_GROUP, "0", "MKSTREAM").catch(() => {});
    await client.xgroup("CREATE", actionKey, ACTION_CONSUMER_GROUP, "0", "MKSTREAM").catch(() => {});
  } catch (err: any) {
    // BUSYGROUP = group already exists, which is fine
    if (!err.message?.includes("BUSYGROUP")) {
      logger.error(`[BIStreams] Failed to create consumer groups for org ${orgId}: ${err.message}`);
    }
  }
}

// ─── Event Ingestion (Write) ─────────────────────────────────────────────────

/**
 * Write a scoring event to the org's event stream.
 * Target: < 5ms latency (just XADD, no processing).
 */
async function writeEvent(event: BIScoringEvent): Promise<string> {
  const client = getRedisClient();
  const streamKey = eventStreamKey(event.org_id);

  const entryId = await client.xadd(
    streamKey,
    "MAXLEN", "~", String(MAX_STREAM_LENGTH), // Approximate trimming for performance
    "*", // Auto-generate ID
    "data", JSON.stringify(event)
  );

  return entryId!;
}

/**
 * Write a batch of events to the stream (for SDK batch flush).
 * Uses pipeline for efficiency.
 */
async function writeEventBatch(events: BIScoringEvent[]): Promise<string[]> {
  if (events.length === 0) return [];
  const client = getRedisClient();
  const pipeline = client.pipeline();

  for (const event of events) {
    const streamKey = eventStreamKey(event.org_id);
    pipeline.xadd(streamKey, "MAXLEN", "~", String(MAX_STREAM_LENGTH), "*", "data", JSON.stringify(event));
  }

  const results = await pipeline.exec();
  return (results || []).map(([err, id]) => (err ? "" : String(id))).filter(Boolean);
}

// ─── Event Consumption (Read) ────────────────────────────────────────────────

/**
 * Read pending events from the stream for processing.
 * Uses consumer group for exactly-once semantics.
 */
async function readEvents(orgId: number, consumerId: string, count = 100, blockMs = 1000): Promise<Array<{ id: string; event: BIScoringEvent }>> {
  const client = getRedisClient();
  const streamKey = eventStreamKey(orgId);

  try {
    const results = await client.xreadgroup(
      "GROUP", CONSUMER_GROUP, consumerId,
      "COUNT", String(count),
      "BLOCK", String(blockMs),
      "STREAMS", streamKey, ">"
    ) as any;

    if (!results || results.length === 0) return [];

    const entries: Array<{ id: string; event: BIScoringEvent }> = [];
    for (const [, messages] of results) {
      for (const [id, fields] of messages) {
        try {
          const data = fields[1]; // fields = ["data", "{json}"]
          entries.push({ id, event: JSON.parse(data) });
        } catch (parseErr) {
          logger.warn(`[BIStreams] Failed to parse event ${id}: ${parseErr}`);
        }
      }
    }
    return entries;
  } catch (err: any) {
    if (err.message?.includes("NOGROUP")) {
      await ensureConsumerGroups(orgId);
      return [];
    }
    throw err;
  }
}

/**
 * Acknowledge processed events (removes from pending list).
 */
async function acknowledgeEvents(orgId: number, eventIds: string[]): Promise<void> {
  if (eventIds.length === 0) return;
  const client = getRedisClient();
  const streamKey = eventStreamKey(orgId);
  await client.xack(streamKey, CONSUMER_GROUP, ...eventIds);
}

// ─── Action Queue (Write) ────────────────────────────────────────────────────

/**
 * Enqueue a threshold action for async dispatch.
 */
async function enqueueAction(action: BIActionEvent): Promise<string> {
  const client = getRedisClient();
  const streamKey = actionStreamKey(action.org_id);

  const entryId = await client.xadd(
    streamKey,
    "MAXLEN", "~", "10000",
    "*",
    "data", JSON.stringify(action)
  );

  return entryId!;
}

/**
 * Read pending actions for dispatch.
 */
async function readActions(orgId: number, consumerId: string, count = 50, blockMs = 1000): Promise<Array<{ id: string; action: BIActionEvent }>> {
  const client = getRedisClient();
  const streamKey = actionStreamKey(orgId);

  try {
    const results = await client.xreadgroup(
      "GROUP", ACTION_CONSUMER_GROUP, consumerId,
      "COUNT", String(count),
      "BLOCK", String(blockMs),
      "STREAMS", streamKey, ">"
    ) as any;

    if (!results || results.length === 0) return [];

    const entries: Array<{ id: string; action: BIActionEvent }> = [];
    for (const [, messages] of results) {
      for (const [id, fields] of messages) {
        try {
          entries.push({ id, action: JSON.parse(fields[1]) });
        } catch { logger.warn(`[BIStreams] Failed to parse action ${id}`); }
      }
    }
    return entries;
  } catch (err: any) {
    if (err.message?.includes("NOGROUP")) {
      await ensureConsumerGroups(orgId);
      return [];
    }
    throw err;
  }
}

/**
 * Acknowledge processed actions.
 */
async function acknowledgeActions(orgId: number, actionIds: string[]): Promise<void> {
  if (actionIds.length === 0) return;
  const client = getRedisClient();
  await client.xack(actionStreamKey(orgId), ACTION_CONSUMER_GROUP, ...actionIds);
}

// ─── Stream Health ───────────────────────────────────────────────────────────

/**
 * Get the consumer group lag (pending messages not yet processed).
 */
async function getConsumerLag(orgId: number): Promise<number> {
  const client = getRedisClient();
  const streamKey = eventStreamKey(orgId);

  try {
    const info = await client.xinfo("GROUPS", streamKey) as any[];
    const group = info?.find((g: any) => g[1] === CONSUMER_GROUP || g?.name === CONSUMER_GROUP);
    return group ? (group[7] ?? group?.pending ?? 0) : 0;
  } catch { return 0; }
}

/**
 * Get stream length (total unprocessed + processed events in retention window).
 */
async function getStreamLength(orgId: number): Promise<number> {
  const client = getRedisClient();
  return await client.xlen(eventStreamKey(orgId));
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export const biRedisStreams = {
  // Setup
  ensureConsumerGroups,

  // Event ingestion
  writeEvent,
  writeEventBatch,

  // Event consumption
  readEvents,
  acknowledgeEvents,

  // Action queue
  enqueueAction,
  readActions,
  acknowledgeActions,

  // Health
  getConsumerLag,
  getStreamLength,

  // Key helpers (for testing)
  eventStreamKey,
  actionStreamKey,
};
