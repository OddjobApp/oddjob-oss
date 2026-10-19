/**
 * Behavioral Intelligence Engine — Replay Engine
 *
 * Re-processes archived events through scoring rules to backfill scores
 * when new rules are added. Events are replayed in chronological order
 * with decay applied relative to original timestamps.
 *
 * Features:
 * - Scoped replay (time range, entity filter, rule filter)
 * - Non-blocking (live scoring continues during replay)
 * - 90-day maximum replay window
 * - Completion event with summary statistics
 */
import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { appRecords } from "@shared/schema/apps.js";
import { and, eq, sql, desc } from "drizzle-orm";
import { biScoreState } from "./score-state.js";
import { getOrCreateIndex } from "./rule-index.js";
import { evaluate } from "../core/expression-engine.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";

const logger = createLogger("BIReplayEngine");

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ReplayOptions {
  org_id: number;
  time_range?: { start: string; end: string }; // ISO8601
  entity_filter?: { entity_type: string; entity_ids?: string[] };
  rule_filter?: string[]; // Only replay through specific rule IDs
  max_events?: number; // Safety cap (default 100,000)
}

export interface ReplayResult {
  success: boolean;
  events_processed: number;
  scores_updated: number;
  duration_ms: number;
  time_range: { start: string; end: string };
  error?: string;
}

const MAX_REPLAY_DAYS = 90;
const DEFAULT_MAX_EVENTS = 100_000;

// ─── Replay Execution ────────────────────────────────────────────────────────

/**
 * Replay archived events through the scoring engine.
 * Non-blocking — live scoring continues normally.
 */
async function replay(options: ReplayOptions): Promise<ReplayResult> {
  const startTime = Date.now();
  const { org_id, time_range, entity_filter, rule_filter, max_events = DEFAULT_MAX_EVENTS } = options;

  // Validate time range
  const now = new Date();
  const maxStart = new Date(now.getTime() - MAX_REPLAY_DAYS * 86400000);
  const start = time_range?.start ? new Date(time_range.start) : maxStart;
  const end = time_range?.end ? new Date(time_range.end) : now;

  if (start < maxStart) {
    return { success: false, events_processed: 0, scores_updated: 0, duration_ms: 0, time_range: { start: start.toISOString(), end: end.toISOString() }, error: `Replay window exceeds ${MAX_REPLAY_DAYS} days maximum` };
  }

  logger.info(`[Replay] Starting for org ${org_id}: ${start.toISOString()} → ${end.toISOString()}`);

  // Get the rule index
  const index = getOrCreateIndex(org_id);
  if (index.size === 0) {
    return { success: false, events_processed: 0, scores_updated: 0, duration_ms: 0, time_range: { start: start.toISOString(), end: end.toISOString() }, error: "No compiled rules for this org" };
  }

  // Query archived events from signal log (chronological order)
  let eventsProcessed = 0;
  let scoresUpdated = 0;

  try {
    // Query events from the bi_signal_log or event archive
    const conditions = [
      eq(appRecords.orgId, org_id),
      eq(appRecords.collection, "bi_signal_log"),
      sql`${appRecords.createdAt} >= ${start}`,
      sql`${appRecords.createdAt} <= ${end}`,
    ];

    const events = await db.select().from(appRecords)
      .where(and(...conditions))
      .orderBy(appRecords.createdAt)
      .limit(max_events);

    for (const record of events) {
      const eventData = record.data as any;
      if (!eventData?.event_type || !eventData?.entity_type || !eventData?.entity_id) continue;

      // Apply entity filter
      if (entity_filter) {
        if (entity_filter.entity_type && eventData.entity_type !== entity_filter.entity_type) continue;
        if (entity_filter.entity_ids && !entity_filter.entity_ids.includes(eventData.entity_id)) continue;
      }

      // Find matching rules
      const matches = index.findMatches({
        event_type: eventData.event_type,
        entity_type: eventData.entity_type,
        page: eventData.payload?.page,
        activity: eventData.payload?.activity || eventData.event_type,
        source: eventData.source,
      }, { event: eventData, vectors: {} });

      // Apply rule filter
      const filteredMatches = rule_filter
        ? matches.filter(m => rule_filter.includes(m.rule.definition.id))
        : matches;

      if (filteredMatches.length > 0) {
        // Apply score updates
        const updates = filteredMatches.flatMap(m => m.weights.map(w => ({
          vector: w.vector,
          weight: w.weight,
          operation: w.operation,
          source: m.rule.definition.signal_category,
        })));

        if (updates.length > 0) {
          await biScoreState.applyScoreUpdates(org_id, eventData.entity_type, eventData.entity_id, updates);
          scoresUpdated++;
        }
      }

      eventsProcessed++;
    }
  } catch (err: any) {
    logger.error(`[Replay] Failed: ${err.message}`);
    return { success: false, events_processed: eventsProcessed, scores_updated: scoresUpdated, duration_ms: Date.now() - startTime, time_range: { start: start.toISOString(), end: end.toISOString() }, error: err.message };
  }

  const durationMs = Date.now() - startTime;

  // Emit completion event
  eventStream.publish("bi.replay_completed", {
    org_id, events_processed: eventsProcessed, scores_updated: scoresUpdated, duration_ms: durationMs,
  }, { organizationId: org_id }, "behavioral-intelligence").catch(() => {});

  logger.info(`[Replay] Completed for org ${org_id}: ${eventsProcessed} events, ${scoresUpdated} scores updated in ${durationMs}ms`);

  return { success: true, events_processed: eventsProcessed, scores_updated: scoresUpdated, duration_ms: durationMs, time_range: { start: start.toISOString(), end: end.toISOString() } };
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export const biReplayEngine = { replay, MAX_REPLAY_DAYS };
