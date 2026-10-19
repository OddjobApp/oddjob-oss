/**
 * Reranking Telemetry Module
 *
 * Provides structured logging and in-memory metrics tracking for
 * the reranking service. Records per-request telemetry events and
 * maintains cumulative counters for backend usage reporting.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4
 */

import type { RerankBackendType } from "./types.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("RerankingTelemetry");

/** A single reranking telemetry event emitted after each operation. */
export interface RerankTelemetryEvent {
  /** Which backend performed the scoring. */
  backend: RerankBackendType;
  /** Number of documents submitted for reranking. */
  documentCount: number;
  /** Total request latency in milliseconds. */
  latencyMs: number;
  /** Whether the operation completed successfully. */
  success: boolean;
  /** Whether a fallback was triggered during the operation. */
  fallbackTriggered: boolean;
  /** Number of results returned (after topK applied). */
  resultsReturned: number;
}

/** Event emitted when a fallback is triggered. */
export interface FallbackTelemetryEvent {
  /** The backend that failed. */
  failedBackend: RerankBackendType;
  /** Reason the backend failed. */
  failureReason: string;
  /** The backend selected as fallback (null if all exhausted). */
  fallbackTarget: RerankBackendType | null;
}

/** Snapshot of current telemetry metrics. */
export interface RerankMetrics {
  /** Total number of reranking requests processed. */
  totalRequests: number;
  /** Total number of successful requests. */
  successfulRequests: number;
  /** Total number of failed requests (all backends exhausted). */
  failedRequests: number;
  /** Total number of fallback events triggered. */
  totalFallbacks: number;
  /** Cumulative documents reranked per backend. */
  documentsPerBackend: Record<RerankBackendType, number>;
  /** Cumulative request count per backend. */
  requestsPerBackend: Record<RerankBackendType, number>;
  /** Latency percentiles (approximate, based on recent requests). */
  latency: {
    /** Most recent request latency in ms. */
    lastMs: number;
    /** Average latency across all requests. */
    avgMs: number;
    /** Maximum observed latency. */
    maxMs: number;
  };
}

/**
 * In-memory metrics state for the reranking service.
 * Accessible via getMetrics() for platform telemetry integration.
 */
const state = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  totalFallbacks: 0,
  documentsPerBackend: {
    cohere: 0,
    local: 0,
    llm: 0,
  } as Record<RerankBackendType, number>,
  requestsPerBackend: {
    cohere: 0,
    local: 0,
    llm: 0,
  } as Record<RerankBackendType, number>,
  totalLatencyMs: 0,
  lastLatencyMs: 0,
  maxLatencyMs: 0,
};

/**
 * Emit a telemetry event for a completed reranking operation.
 * Updates in-memory counters and emits structured log.
 *
 * Requirement 9.1: Structured logs for each reranking operation
 * Requirement 9.3: Per-request latency metrics
 * Requirement 9.4: Total documents reranked per backend
 */
export function emitRerankTelemetry(event: RerankTelemetryEvent): void {
  // Update counters
  state.totalRequests++;
  state.documentsPerBackend[event.backend] =
    (state.documentsPerBackend[event.backend] || 0) + event.documentCount;
  state.requestsPerBackend[event.backend] =
    (state.requestsPerBackend[event.backend] || 0) + 1;
  state.totalLatencyMs += event.latencyMs;
  state.lastLatencyMs = event.latencyMs;
  state.maxLatencyMs = Math.max(state.maxLatencyMs, event.latencyMs);

  if (event.success) {
    state.successfulRequests++;
  } else {
    state.failedRequests++;
  }

  // Emit structured log (Requirement 9.1)
  logger.info("Reranking operation completed", {
    backend: event.backend,
    documentCount: event.documentCount,
    latencyMs: event.latencyMs,
    success: event.success,
    fallbackTriggered: event.fallbackTriggered,
    resultsReturned: event.resultsReturned,
  });
}

/**
 * Emit a warning log when a fallback is triggered.
 *
 * Requirement 9.2: Log warnings on fallback triggers with failure reason
 */
export function emitFallbackWarning(event: FallbackTelemetryEvent): void {
  state.totalFallbacks++;

  logger.warn("Reranking backend fallback triggered", {
    failedBackend: event.failedBackend,
    failureReason: event.failureReason,
    fallbackTarget: event.fallbackTarget ?? "none (all exhausted)",
  });
}

/**
 * Get the current telemetry metrics snapshot.
 * Used by the platform telemetry system for monitoring and reporting.
 *
 * Requirement 9.3: Per-request latency metrics accessible through platform telemetry
 * Requirement 9.4: Total documents reranked per backend
 */
export function getMetrics(): RerankMetrics {
  return {
    totalRequests: state.totalRequests,
    successfulRequests: state.successfulRequests,
    failedRequests: state.failedRequests,
    totalFallbacks: state.totalFallbacks,
    documentsPerBackend: { ...state.documentsPerBackend },
    requestsPerBackend: { ...state.requestsPerBackend },
    latency: {
      lastMs: state.lastLatencyMs,
      avgMs:
        state.totalRequests > 0
          ? Math.round(state.totalLatencyMs / state.totalRequests)
          : 0,
      maxMs: state.maxLatencyMs,
    },
  };
}

/**
 * Reset all telemetry metrics. Primarily used for testing.
 */
export function resetMetrics(): void {
  state.totalRequests = 0;
  state.successfulRequests = 0;
  state.failedRequests = 0;
  state.totalFallbacks = 0;
  state.documentsPerBackend = { cohere: 0, local: 0, llm: 0 };
  state.requestsPerBackend = { cohere: 0, local: 0, llm: 0 };
  state.totalLatencyMs = 0;
  state.lastLatencyMs = 0;
  state.maxLatencyMs = 0;
}
