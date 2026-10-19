/**
 * Ingestion Orchestrator - Progress Event Types
 *
 * Defines the SSE event payload types emitted during autonomous
 * research ingestion for real-time progress monitoring in the
 * Research Workbench UI.
 */

import type { IngestionStage, SourceCollectorType, GatheringStrategy } from './types.js';

// ─── Progress Event ────────────────────────────────────────────────────────────

/** SSE event emitted at each stage transition during orchestration */
export interface IngestionProgressEvent {
  /** Event type following PlatformEvent convention: "ingestion.{stage}" */
  type: `ingestion.${IngestionStage}`;
  /** Pipeline execution record this event belongs to */
  pipelineExecutionId: number;
  /** ISO 8601 timestamp of the event */
  timestamp: string;
  /** Stage-specific payload data */
  payload:
    | PlanningPayload
    | CollectingPayload
    | ExtractingPayload
    | SynthesizingPayload
    | CompletedPayload
    | FailedPayload;
}

// ─── Stage Payloads ────────────────────────────────────────────────────────────

/** Emitted when strategy planning begins or completes */
export interface PlanningPayload {
  stage: "planning";
  /** The generated gathering strategy */
  strategy: GatheringStrategy;
}

/** Emitted for each collector start/completion/failure during collection */
export interface CollectingPayload {
  stage: "collecting";
  /** Which collector type is reporting */
  collectorType: SourceCollectorType;
  /** Target URL being fetched (if applicable) */
  sourceUrl?: string;
  /** Search query being executed (if applicable) */
  query?: string;
  /** Lifecycle status of this collector invocation */
  status: "started" | "completed" | "failed";
  /** Size of collected content in bytes (on completion) */
  contentSize?: number;
  /** Running count of sources collected so far */
  sourcesCollected: number;
  /** Total sources targeted by the strategy */
  totalSources: number;
}

/** Emitted during entity/relationship extraction phase */
export interface ExtractingPayload {
  stage: "extracting";
  /** Cumulative entities created so far */
  entitiesCreated: number;
  /** Cumulative relationships created so far */
  relationshipsCreated: number;
  /** Cumulative dataset items stored so far */
  datasetItemsStored: number;
}

/** Emitted during synthesis report generation */
export interface SynthesizingPayload {
  stage: "synthesizing";
  /** Completion percentage (0-100) */
  progress: number;
}

/** Emitted when the orchestration run completes successfully */
export interface CompletedPayload {
  stage: "completed";
  /** Final run summary metrics */
  summary: {
    sourcesCollected: number;
    sourcesFailed: number;
    entitiesCreated: number;
    relationshipsCreated: number;
    datasetItemsStored: number;
    datasetId: number;
    documentTemplateId: number;
    durationMs: number;
  };
}

/** Emitted when the orchestration run encounters a fatal error */
export interface FailedPayload {
  stage: "failed";
  /** Human-readable error description */
  error: string;
  /** Partial results accumulated before the failure */
  partialResults?: Partial<CompletedPayload["summary"]>;
}
