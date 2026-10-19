/**
 * Ingestion Context Snapshot Schema
 *
 * Defines the structure stored in the pipelineExecution `contextSnapshot` JSONB
 * field for autonomous research ingestion runs. This captures the full
 * orchestration state including strategy, collector results, metrics, and
 * app provisioning outcomes.
 *
 * @see Requirements 1.5, 7.5
 */

import type { ClassifiedInput, GatheringStrategy, IngestionStage } from "./types.js";
import type { CollectorResult } from "./collectors/collector.interface.js";

// ─── Context Snapshot ──────────────────────────────────────────────────────────

/** Full orchestration metadata stored in pipelineExecution.contextSnapshot */
export interface IngestionContextSnapshot {
  /** Discriminator identifying this as an autonomous research orchestration */
  orchestrationType: "autonomous_research";
  /** The classified and normalized research subject */
  researchSubject: ClassifiedInput;
  /** The gathering strategy that was executed */
  strategy: GatheringStrategy;
  /** Results from each collector invocation */
  collectorResults: CollectorResult[];
  /** Aggregated metrics for the orchestration run */
  metrics: {
    /** Number of sources successfully collected */
    sourcesCollected: number;
    /** Number of sources that failed or timed out */
    sourcesFailed: number;
    /** Number of Knowledge Graph entities created */
    entitiesCreated: number;
    /** Number of Knowledge Graph relationships created */
    relationshipsCreated: number;
    /** Number of Dataset items stored */
    datasetItemsStored: number;
    /** ID of the created Dataset (null if not yet created) */
    datasetId: number | null;
    /** ID of the generated Document Template (null if not yet created) */
    documentTemplateId: number | null;
    /** Total token budget consumed during the run */
    tokenBudgetUsed: number;
  };
  /** Log of app provisioning attempts made during the pipeline */
  appProvisioningLog: Array<{
    /** The app instance ID that was provisioned */
    appId: number;
    /** The pipeline stage when provisioning was triggered */
    stage: IngestionStage;
    /** Whether the app started successfully */
    success: boolean;
    /** Error message if provisioning failed */
    error?: string;
    /** ISO 8601 timestamp of the provisioning attempt */
    timestamp: string;
  }>;
}
