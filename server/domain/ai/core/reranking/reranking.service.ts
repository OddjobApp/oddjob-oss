/**
 * RerankingService — Orchestrator for Multi-Backend Reranking
 *
 * Coordinates backend selection, scoring, normalization, and fallback
 * for reranking candidate documents against a query.
 *
 * Flow: validate input → select backend → score → normalize → sort → apply topK → emit telemetry
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.2, 2.3, 2.4, 6.4, 6.5
 */

import type {
  CandidateDocument,
  RerankBackendConfig,
  RerankBackendType,
  RerankRequest,
  RerankResponse,
  RerankResult,
} from "./types.js";
import type { RerankBackend } from "./backends/rerank-backend.interface.js";
import { FallbackManager } from "./fallback-manager.js";
import { normalizeScores } from "./score-normalizer.js";
import { RerankBackendError } from "./backends/cohere.backend.js";
import { ParseError } from "./backends/llm.backend.js";
import { createLogger } from "@server/utils/logger.js";
import { emitRerankTelemetry, emitFallbackWarning } from "./telemetry.js";
import { saveRerankingConfig } from "./config.js";

const logger = createLogger("RerankingService");

export class RerankingService {
  private config: RerankBackendConfig;
  private backends: Map<RerankBackendType, RerankBackend>;

  constructor(
    config: RerankBackendConfig,
    backends: Map<RerankBackendType, RerankBackend>
  ) {
    this.config = config;
    this.backends = backends;
  }

  /**
   * Rerank candidate documents against a query.
   *
   * 1. Empty documents → return empty response immediately
   * 2. Select backend (preferred or default)
   * 3. Attempt scoring with fallback chain
   * 4. Normalize scores → sort descending → apply topK
   * 5. Return response with metadata
   */
  async rerank(request: RerankRequest): Promise<RerankResponse> {
    const startTime = Date.now();

    // 1. Empty document list → return immediately without invoking backend
    if (request.documents.length === 0) {
      return {
        results: [],
        metadata: {
          backendUsed: this.config.defaultBackend,
          fallbackTriggered: false,
          latencyMs: 0,
          documentCount: 0,
        },
      };
    }

    // 2. Create FallbackManager and select initial backend
    const fallbackManager = new FallbackManager(this.config.priorityOrder);
    let currentBackendType: RerankBackendType | null = fallbackManager.selectBackend(request.backend);
    let fallbackTriggered = false;

    // 3. Loop: try to score with selected backend, fallback on error
    let rawScores: { documentId: string; score: number }[] | null = null;

    while (currentBackendType !== null) {
      const backend = this.backends.get(currentBackendType);

      if (!backend) {
        logger.warn("Backend not registered, moving to next", {
          backend: currentBackendType,
        });
        const next = fallbackManager.nextBackend(currentBackendType);
        if (next) fallbackTriggered = true;
        emitFallbackWarning({
          failedBackend: currentBackendType,
          failureReason: "Backend not registered",
          fallbackTarget: next,
        });
        currentBackendType = next;
        continue;
      }

      try {
        rawScores = await backend.score(
          request.query,
          request.documents,
          request.options
        );
        break; // Success — exit loop
      } catch (error: unknown) {
        // ParseError from LLM backend → return original order with warning
        if (error instanceof ParseError) {
          logger.warn("LLM parse error, returning documents in original order", {
            message: error.message,
          });
          return this.buildOriginalOrderResponse(
            request.documents,
            currentBackendType,
            true,
            startTime
          );
        }

        // RerankBackendError → trigger fallback
        if (error instanceof RerankBackendError) {
          logger.warn("Backend failed, attempting fallback", {
            backend: currentBackendType,
            reason: error.reason,
            message: error.message,
          });

          const next = fallbackManager.nextBackend(currentBackendType);
          if (next) fallbackTriggered = true;
          emitFallbackWarning({
            failedBackend: currentBackendType,
            failureReason: error.reason ?? error.message,
            fallbackTarget: next,
          });
          currentBackendType = next;
          continue;
        }

        // Unexpected error → also trigger fallback
        logger.error("Unexpected backend error, attempting fallback", {
          backend: currentBackendType,
          error: error instanceof Error ? error.message : String(error),
        });

        const next = fallbackManager.nextBackend(currentBackendType);
        if (next) fallbackTriggered = true;
        emitFallbackWarning({
          failedBackend: currentBackendType,
          failureReason: error instanceof Error ? error.message : String(error),
          fallbackTarget: next,
        });
        currentBackendType = next;
      }
    }

    // 4. All backends exhausted → return original order with warning
    if (rawScores === null) {
      logger.error("All backends exhausted, returning documents in original order");
      return this.buildOriginalOrderResponse(
        request.documents,
        this.config.defaultBackend,
        true,
        startTime
      );
    }

    // 5. Normalize raw scores
    const normalizedScores = normalizeScores(rawScores);

    // 6. Build RerankResult[] preserving document data
    const scoreMap = new Map(
      normalizedScores.map((ns) => [ns.documentId, ns.score])
    );

    const results: RerankResult[] = request.documents.map((doc) => ({
      id: doc.id,
      content: doc.content,
      relevanceScore: scoreMap.get(doc.id) ?? 0,
      originalScore: doc.originalScore,
      metadata: doc.metadata,
    }));

    // 7. Sort by relevanceScore descending
    results.sort((a, b) => b.relevanceScore - a.relevanceScore);

    // 8. Apply topK
    const topK = request.topK;
    const finalResults = topK !== undefined ? results.slice(0, topK) : results;

    const latencyMs = Date.now() - startTime;

    // 9. Emit telemetry
    logger.info("Reranking completed", {
      backendUsed: currentBackendType,
      documentCount: request.documents.length,
      latencyMs,
      fallbackTriggered,
      topK: topK ?? "all",
      resultsReturned: finalResults.length,
    });

    emitRerankTelemetry({
      backend: currentBackendType!,
      documentCount: request.documents.length,
      latencyMs,
      success: true,
      fallbackTriggered,
      resultsReturned: finalResults.length,
    });

    return {
      results: finalResults,
      metadata: {
        backendUsed: currentBackendType!,
        fallbackTriggered,
        latencyMs,
        documentCount: request.documents.length,
      },
    };
  }

  /**
   * Get the current reranking configuration.
   */
  getConfig(): RerankBackendConfig {
    return this.config;
  }

  /**
   * Update the reranking configuration (partial merge).
   * Persists the merged config to system settings asynchronously.
   */
  updateConfig(config: Partial<RerankBackendConfig>): void {
    this.config = { ...this.config, ...config };

    // Persist asynchronously — fire-and-forget with error logging
    saveRerankingConfig(this.config).catch((err) => {
      logger.error("Failed to persist config update", err);
    });
  }

  /**
   * Build a response that preserves original document order with position-based scores.
   * Used when all backends are exhausted or when ParseError is thrown.
   */
  private buildOriginalOrderResponse(
    documents: CandidateDocument[],
    backendUsed: RerankBackendType,
    fallbackTriggered: boolean,
    startTime: number
  ): RerankResponse {
    const latencyMs = Date.now() - startTime;

    // Assign position-based scores: first doc gets highest score, linearly decreasing
    const results: RerankResult[] = documents.map((doc, index) => ({
      id: doc.id,
      content: doc.content,
      relevanceScore:
        documents.length === 1
          ? 1.0
          : 1.0 - index / (documents.length - 1),
      originalScore: doc.originalScore,
      metadata: doc.metadata,
    }));

    emitRerankTelemetry({
      backend: backendUsed,
      documentCount: documents.length,
      latencyMs,
      success: false,
      fallbackTriggered,
      resultsReturned: results.length,
    });

    return {
      results,
      metadata: {
        backendUsed,
        fallbackTriggered,
        latencyMs,
        documentCount: documents.length,
      },
    };
  }
}

/**
 * Factory function for creating a RerankingService instance.
 * Use this instead of direct instantiation since config and backends
 * are not available at import time.
 */
export function createRerankingService(
  config: RerankBackendConfig,
  backends: Map<RerankBackendType, RerankBackend>
): RerankingService {
  return new RerankingService(config, backends);
}

/**
 * Singleton holder — lazily initialized via `initRerankingService()`.
 * Access via `getRerankingService()` after initialization.
 */
let _instance: RerankingService | null = null;

/**
 * Initialize the singleton reranking service instance.
 * Must be called once during application startup with the resolved config and backends.
 */
export function initRerankingService(
  config: RerankBackendConfig,
  backends: Map<RerankBackendType, RerankBackend>
): RerankingService {
  _instance = new RerankingService(config, backends);
  return _instance;
}

/**
 * Get the singleton reranking service instance.
 * Throws if not yet initialized via `initRerankingService()`.
 */
export function getRerankingService(): RerankingService {
  if (!_instance) {
    throw new Error(
      "RerankingService not initialized. Call initRerankingService() first."
    );
  }
  return _instance;
}
