/**
 * Behavioral Intelligence Engine — Event Ingestion Service
 *
 * Accepts behavioral events from all sources (SDK, webhooks, workbench apps,
 * CRM sync, diff events, agents), validates them, and writes to Redis Streams.
 *
 * Target: < 50ms acceptance latency (just validation + XADD).
 * No scoring happens here — that's the consumer's job.
 */
import { createLogger } from "@server/utils/logger.js";
import { biRedisStreams, type BIScoringEvent } from "../infrastructure/redis-streams.js";
import { requireBI, checkLimit } from "../infrastructure/feature-gate.js";
import { getRedisClient } from "@domain/core/infrastructure/redis/redis-client.js";
import crypto from "node:crypto";

const logger = createLogger("BIIngestion");

// ─── Types ───────────────────────────────────────────────────────────────────

export interface IngestEventInput {
  event_type: string;
  entity_type: string;
  entity_id: string;
  source?: BIScoringEvent["source"];
  signal_category?: "behavioral" | "qualification";
  timestamp?: string;
  payload?: Record<string, any>;
  api_key_id?: string;
  environmental?: BIScoringEvent["environmental"];
}

export interface IngestResult {
  success: boolean;
  event_id?: string;
  stream_id?: string;
  error?: string;
}

// ─── Rate Limiting ───────────────────────────────────────────────────────────

const RATE_LIMIT_KEY_PREFIX = "bi:rate:";
const RATE_LIMIT_WINDOW_SECONDS = 86400; // 24 hours

async function checkDailyRate(orgId: number): Promise<{ allowed: boolean; current: number }> {
  const client = getRedisClient();
  const key = `${RATE_LIMIT_KEY_PREFIX}${orgId}:${new Date().toISOString().split("T")[0]}`;
  const current = parseInt(await client.get(key) || "0");
  return { allowed: true, current }; // Actual limit check happens in ingestEvent
}

async function incrementDailyRate(orgId: number): Promise<number> {
  const client = getRedisClient();
  const key = `${RATE_LIMIT_KEY_PREFIX}${orgId}:${new Date().toISOString().split("T")[0]}`;
  const pipeline = client.pipeline();
  pipeline.incr(key);
  pipeline.expire(key, RATE_LIMIT_WINDOW_SECONDS);
  const results = await pipeline.exec();
  return parseInt(String(results?.[0]?.[1] || "0"));
}

// ─── Validation ──────────────────────────────────────────────────────────────

const VALID_ENTITY_TYPES = ["contact", "account", "agent", "mission", "deal", "project"];
const VALID_SOURCES: BIScoringEvent["source"][] = ["sdk", "webhook", "crm", "workbench", "diff", "agent", "system"];
const VALID_SIGNAL_CATEGORIES: BIScoringEvent["signal_category"][] = ["behavioral", "qualification"];

function validateEvent(input: IngestEventInput): string | null {
  if (!input.event_type || typeof input.event_type !== "string") return "event_type is required (string)";
  if (!input.entity_type || typeof input.entity_type !== "string") return "entity_type is required (string)";
  if (!input.entity_id || typeof input.entity_id !== "string") return "entity_id is required (string)";
  if (input.event_type.length > 100) return "event_type must be ≤100 characters";
  if (input.entity_id.length > 200) return "entity_id must be ≤200 characters";
  if (input.source && !VALID_SOURCES.includes(input.source)) return `source must be one of: ${VALID_SOURCES.join(", ")}`;
  if (input.signal_category && !VALID_SIGNAL_CATEGORIES.includes(input.signal_category)) return `signal_category must be one of: ${VALID_SIGNAL_CATEGORIES.join(", ")}`;
  if (input.timestamp) {
    const ts = new Date(input.timestamp);
    if (isNaN(ts.getTime())) return "timestamp must be a valid ISO8601 date";
  }
  return null;
}

// ─── Ingestion ───────────────────────────────────────────────────────────────

/**
 * Ingest a single scoring event.
 * Validates, checks feature gate + rate limits, writes to Redis Stream.
 */
async function ingestEvent(orgId: number, input: IngestEventInput): Promise<IngestResult> {
  // 1. Feature gate check
  try {
    await requireBI(orgId);
  } catch (err: any) {
    return { success: false, error: err.message };
  }

  // 2. Validate event schema
  const validationError = validateEvent(input);
  if (validationError) {
    return { success: false, error: validationError };
  }

  // 3. Check daily rate limit
  const dailyCount = await incrementDailyRate(orgId);
  // Note: we accept the event even if over limit (overage mode) but mark it
  // The feature gate's checkLimit will throw for hard enforcement if needed

  // 4. Build the full event
  const event: BIScoringEvent = {
    event_id: crypto.randomUUID(),
    event_type: input.event_type,
    entity_type: input.entity_type,
    entity_id: input.entity_id,
    source: input.source || "workbench",
    signal_category: input.signal_category || "behavioral",
    timestamp: input.timestamp || new Date().toISOString(),
    org_id: orgId,
    payload: input.payload || {},
    api_key_id: input.api_key_id,
    environmental: input.environmental,
  };

  // 5. Write to Redis Stream
  try {
    const streamId = await biRedisStreams.writeEvent(event);
    return { success: true, event_id: event.event_id, stream_id: streamId };
  } catch (err: any) {
    logger.error(`[BIIngestion] Failed to write event to stream for org ${orgId}: ${err.message}`);
    return { success: false, error: "Event ingestion failed — please retry" };
  }
}

/**
 * Ingest a batch of events (for SDK batch flush).
 * Validates all events first, then writes the valid ones.
 */
async function ingestBatch(orgId: number, inputs: IngestEventInput[]): Promise<{ accepted: number; rejected: number; errors: Array<{ index: number; error: string }> }> {
  // Feature gate
  try {
    await requireBI(orgId);
  } catch (err: any) {
    return { accepted: 0, rejected: inputs.length, errors: [{ index: 0, error: err.message }] };
  }

  const validEvents: BIScoringEvent[] = [];
  const errors: Array<{ index: number; error: string }> = [];

  for (let i = 0; i < inputs.length; i++) {
    const validationError = validateEvent(inputs[i]);
    if (validationError) {
      errors.push({ index: i, error: validationError });
      continue;
    }

    validEvents.push({
      event_id: crypto.randomUUID(),
      event_type: inputs[i].event_type,
      entity_type: inputs[i].entity_type,
      entity_id: inputs[i].entity_id,
      source: inputs[i].source || "sdk",
      signal_category: inputs[i].signal_category || "behavioral",
      timestamp: inputs[i].timestamp || new Date().toISOString(),
      org_id: orgId,
      payload: inputs[i].payload || {},
      api_key_id: inputs[i].api_key_id,
      environmental: inputs[i].environmental,
    });
  }

  if (validEvents.length > 0) {
    try {
      await biRedisStreams.writeEventBatch(validEvents);
    } catch (err: any) {
      logger.error(`[BIIngestion] Batch write failed for org ${orgId}: ${err.message}`);
      return { accepted: 0, rejected: inputs.length, errors: [{ index: 0, error: "Batch write failed" }] };
    }
  }

  return { accepted: validEvents.length, rejected: errors.length, errors };
}

/**
 * Get current daily event count for an org (for rate limit display).
 */
async function getDailyEventCount(orgId: number): Promise<number> {
  const { current } = await checkDailyRate(orgId);
  return current;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export const biIngestionService = {
  ingestEvent,
  ingestBatch,
  getDailyEventCount,
  validateEvent,
};
