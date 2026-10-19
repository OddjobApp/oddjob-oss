/**
 * Progress Emitter Service
 *
 * Bridges between the ingestion orchestration pipeline and SSE streaming
 * to provide real-time progress events to connected Research Workbench
 * clients. Uses an EventEmitter to broadcast IngestionProgressEvent objects
 * that SSE route handlers subscribe to.
 *
 * @module ingestion/progress-emitter
 */

import { EventEmitter } from "events";
import { createLogger } from "@server/utils/logger.js";
import type {
  IngestionProgressEvent,
  PlanningPayload,
  CollectingPayload,
  ExtractingPayload,
  SynthesizingPayload,
  CompletedPayload,
  FailedPayload,
} from "./progress.types.js";
import type { GatheringStrategy } from "./types.js";

const logger = createLogger("ProgressEmitter");

// ─── Event Bus ─────────────────────────────────────────────────────────────────

/**
 * Internal event bus for broadcasting ingestion progress events.
 * SSE route handlers subscribe to `progress:{pipelineExecutionId}` channels.
 */
const progressBus = new EventEmitter();
progressBus.setMaxListeners(200);

// ─── Public Interface ──────────────────────────────────────────────────────────

/** Interface for the progress emitter service */
export interface ProgressEmitter {
  /** Emit a planning stage event with the generated strategy */
  emitPlanning(pipelineExecutionId: number, strategy: GatheringStrategy): void;
  /** Emit a collecting stage event with per-collector progress */
  emitCollecting(pipelineExecutionId: number, payload: CollectingPayload): void;
  /** Emit an extracting stage event with entity/relationship counts */
  emitExtracting(pipelineExecutionId: number, payload: ExtractingPayload): void;
  /** Emit a synthesizing stage event with progress percentage */
  emitSynthesizing(pipelineExecutionId: number, progress: number): void;
  /** Emit a completed stage event with final summary metrics */
  emitCompleted(pipelineExecutionId: number, summary: CompletedPayload["summary"]): void;
  /** Emit a failed stage event with error and optional partial results */
  emitFailed(pipelineExecutionId: number, error: string, partialResults?: Partial<CompletedPayload["summary"]>): void;
  /** Emit a warning event for non-blocking issues (e.g., app provisioning failures) */
  emitWarning(pipelineExecutionId: number, stage: string, message: string): void;
  /** Subscribe to progress events for a specific pipeline execution */
  subscribe(pipelineExecutionId: number, listener: (event: IngestionProgressEvent) => void): void;
  /** Unsubscribe from progress events for a specific pipeline execution */
  unsubscribe(pipelineExecutionId: number, listener: (event: IngestionProgressEvent) => void): void;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Build the channel key for a pipeline execution */
function channelKey(pipelineExecutionId: number): string {
  return `progress:${pipelineExecutionId}`;
}

/** Create and broadcast an IngestionProgressEvent */
function emitEvent(event: IngestionProgressEvent): void {
  const channel = channelKey(event.pipelineExecutionId);
  logger.info("Emitting progress event", {
    type: event.type,
    pipelineExecutionId: event.pipelineExecutionId,
  });
  progressBus.emit(channel, event);
}

// ─── Service Implementation ────────────────────────────────────────────────────

export const progressEmitterService: ProgressEmitter = {
  emitPlanning(pipelineExecutionId: number, strategy: GatheringStrategy): void {
    const payload: PlanningPayload = {
      stage: "planning",
      strategy,
    };

    const event: IngestionProgressEvent = {
      type: "ingestion.planning",
      pipelineExecutionId,
      timestamp: new Date().toISOString(),
      payload,
    };

    emitEvent(event);
  },

  emitCollecting(pipelineExecutionId: number, payload: CollectingPayload): void {
    const event: IngestionProgressEvent = {
      type: "ingestion.collecting",
      pipelineExecutionId,
      timestamp: new Date().toISOString(),
      payload,
    };

    emitEvent(event);
  },

  emitExtracting(pipelineExecutionId: number, payload: ExtractingPayload): void {
    const event: IngestionProgressEvent = {
      type: "ingestion.extracting",
      pipelineExecutionId,
      timestamp: new Date().toISOString(),
      payload,
    };

    emitEvent(event);
  },

  emitSynthesizing(pipelineExecutionId: number, progress: number): void {
    const payload: SynthesizingPayload = {
      stage: "synthesizing",
      progress: Math.max(0, Math.min(100, progress)),
    };

    const event: IngestionProgressEvent = {
      type: "ingestion.synthesizing",
      pipelineExecutionId,
      timestamp: new Date().toISOString(),
      payload,
    };

    emitEvent(event);
  },

  emitCompleted(pipelineExecutionId: number, summary: CompletedPayload["summary"]): void {
    const payload: CompletedPayload = {
      stage: "completed",
      summary,
    };

    const event: IngestionProgressEvent = {
      type: "ingestion.completed",
      pipelineExecutionId,
      timestamp: new Date().toISOString(),
      payload,
    };

    emitEvent(event);
  },

  emitFailed(
    pipelineExecutionId: number,
    error: string,
    partialResults?: Partial<CompletedPayload["summary"]>
  ): void {
    const payload: FailedPayload = {
      stage: "failed",
      error,
      partialResults,
    };

    const event: IngestionProgressEvent = {
      type: "ingestion.failed",
      pipelineExecutionId,
      timestamp: new Date().toISOString(),
      payload,
    };

    emitEvent(event);
  },

  emitWarning(pipelineExecutionId: number, stage: string, message: string): void {
    logger.warn("Emitting progress warning", {
      pipelineExecutionId,
      stage,
      message,
    });

    // Emit as a generic event on the progress bus so SSE subscribers receive it
    const channel = channelKey(pipelineExecutionId);
    const warningEvent = {
      type: `ingestion.warning` as const,
      pipelineExecutionId,
      timestamp: new Date().toISOString(),
      payload: { stage, warning: message },
    };
    progressBus.emit(channel, warningEvent);
  },

  subscribe(
    pipelineExecutionId: number,
    listener: (event: IngestionProgressEvent) => void
  ): void {
    const channel = channelKey(pipelineExecutionId);
    progressBus.on(channel, listener);
    logger.info("Client subscribed to progress events", { pipelineExecutionId });
  },

  unsubscribe(
    pipelineExecutionId: number,
    listener: (event: IngestionProgressEvent) => void
  ): void {
    const channel = channelKey(pipelineExecutionId);
    progressBus.off(channel, listener);
    logger.info("Client unsubscribed from progress events", { pipelineExecutionId });
  },
};
