/**
 * Behavioral Intelligence Engine — Diff Bridge
 *
 * Subscribes to pipeline diff events and dataset mutations,
 * converting them into scoring events for the BI engine.
 *
 * This enables scoring based on actual data changes — not just UI interactions.
 *
 * Integrations:
 * - Pipeline step runner diff events (emitDiffEvent)
 * - AppRecords dataset mutations (INSERT/UPDATE/DELETE)
 * - Score-based dataset enrichment (auto-join scores on queries)
 */
import { createLogger } from "@server/utils/logger.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";
import { biIngestionService } from "../core/ingestion.service.js";

const logger = createLogger("BIDiffBridge");

let isSubscribed = false;

/**
 * Subscribe to platform diff events and convert them to scoring events.
 */
function subscribe(): void {
  if (isSubscribed) return;
  isSubscribed = true;

  // 1. Subscribe to pipeline diff events
  eventStream.onEvent((event) => {
    handleDiffEvent(event.payload).catch(err =>
      logger.warn(`[DiffBridge] Failed to process diff event: ${err.message}`)
    );
  }, { type: "diff.*" });

  // 2. Subscribe to dataset mutation events
  eventStream.onEvent((event) => {
    handleDatasetMutation(event.payload).catch(err =>
      logger.warn(`[DiffBridge] Failed to process dataset mutation: ${err.message}`)
    );
  }, { type: "dataset.*" });

  // 3. Subscribe to mission completion events (for agent scoring)
  eventStream.onEvent((event) => {
    handleMissionCompletion(event.payload).catch(err =>
      logger.warn(`[DiffBridge] Failed to process mission completion: ${err.message}`)
    );
  }, { type: "mission.*completed*" });

  logger.info("[DiffBridge] Subscribed to platform events (diff, dataset, mission)");
}

/**
 * Handle a pipeline diff event — convert to scoring event.
 */
async function handleDiffEvent(payload: any): Promise<void> {
  if (!payload?.orgId || !payload?.entityType) return;

  const { orgId, entityType, entityId, jobId, changeCount, summary } = payload;

  // Emit as a scoring event with diff metadata
  await biIngestionService.ingestEvent(orgId, {
    event_type: "diff_detected",
    entity_type: entityType || "project",
    entity_id: String(entityId || jobId || "unknown"),
    source: "diff",
    signal_category: "behavioral",
    payload: {
      change_count: changeCount || 0,
      added: summary?.added || 0,
      removed: summary?.removed || 0,
      modified: summary?.modified || 0,
      job_id: jobId,
      diff_source: "pipeline_step",
    },
  });
}

/**
 * Handle a dataset mutation — convert to scoring event.
 */
async function handleDatasetMutation(payload: any): Promise<void> {
  if (!payload?.orgId || !payload?.collection) return;

  const { orgId, collection, recordId, mutationType, entityType, entityId, changedFields } = payload;

  // Only emit for collections that have scoring relevance
  // (configured per org via scoring rules with rule_type: "diff_event")
  await biIngestionService.ingestEvent(orgId, {
    event_type: `dataset_${mutationType || "changed"}`,
    entity_type: entityType || "contact",
    entity_id: String(entityId || recordId || "unknown"),
    source: "diff",
    signal_category: "behavioral",
    payload: {
      collection,
      record_id: recordId,
      mutation_type: mutationType, // "insert", "update", "delete"
      changed_fields: changedFields,
    },
  });
}

/**
 * Handle mission completion — score the assigned agent.
 */
async function handleMissionCompletion(payload: any): Promise<void> {
  if (!payload?.organizationId || !payload?.missionRunId) return;

  const { organizationId, missionRunId, missionId, status, agentId, agentName } = payload;

  if (!agentId && !agentName) return;

  // Score the agent on Reliability
  const isSuccess = status === "completed";
  await biIngestionService.ingestEvent(organizationId, {
    event_type: isSuccess ? "mission_completed" : "mission_failed",
    entity_type: "agent",
    entity_id: String(agentId || agentName),
    source: "system",
    signal_category: "behavioral",
    payload: {
      mission_run_id: missionRunId,
      mission_id: missionId,
      outcome: status,
    },
  });
}

/**
 * Unsubscribe from all events.
 */
function unsubscribe(): void {
  isSubscribed = false;
  logger.info("[DiffBridge] Unsubscribed from platform events");
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export const biDiffBridge = {
  subscribe,
  unsubscribe,
  handleDiffEvent,
  handleDatasetMutation,
  handleMissionCompletion,
};
