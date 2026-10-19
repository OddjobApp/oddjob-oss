/**
 * Local Cross-Encoder Rerank Backend
 *
 * Sends query-document pairs to a locally-hosted cross-encoder model via
 * Ollama or a Python sidecar endpoint. Batches pairs for throughput optimization
 * and enforces per-batch timeouts.
 *
 * Triggers fallback (throws RerankBackendError) on:
 * - ECONNREFUSED (endpoint unreachable)
 * - Batch timeout exceeded
 * - Network failures
 */

import type { CandidateDocument, RerankBackendConfig, RerankOptions } from "../types.js";
import type { RawScore, RerankBackend } from "./rerank-backend.interface.js";
import { RerankBackendError } from "./cohere.backend.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("LocalBackend");

const DEFAULT_ENDPOINT = "http://localhost:11434";
const DEFAULT_MODEL = "cross-encoder/ms-marco-MiniLM-L-6-v2";
const DEFAULT_BATCH_SIZE = 32;
const DEFAULT_TIMEOUT_MS = 10000;

/** Shape of the local rerank API response (Ollama-style) */
interface LocalRerankResponse {
  results: Array<{
    index: number;
    relevance_score: number;
  }>;
}

export class LocalBackend implements RerankBackend {
  readonly type = "local" as const;

  private readonly endpoint: string;
  private readonly model: string;
  private readonly batchSize: number;
  private readonly timeoutMs: number;

  constructor(config?: RerankBackendConfig["local"]) {
    this.endpoint = config?.endpoint ?? DEFAULT_ENDPOINT;
    this.model = config?.model ?? DEFAULT_MODEL;
    this.batchSize = config?.batchSize ?? DEFAULT_BATCH_SIZE;
    this.timeoutMs = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Check if the local endpoint is reachable via a health/ping request.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.endpoint}/api/tags`, {
        method: "GET",
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Score query-document pairs using the local cross-encoder endpoint.
   * Documents are batched into groups of `batchSize` for throughput optimization.
   * Each batch enforces a timeout; partial results from completed batches are preserved.
   */
  async score(
    query: string,
    documents: CandidateDocument[],
    options?: RerankOptions
  ): Promise<RawScore[]> {
    const batchSize = options?.batchSize ?? this.batchSize;
    const timeoutMs = options?.timeout ?? this.timeoutMs;

    // Split documents into batches
    const batches = this.createBatches(documents, batchSize);

    logger.info("Local rerank starting", {
      model: this.model,
      documentCount: documents.length,
      batchCount: batches.length,
      batchSize,
      timeoutMs,
    });

    const allScores: RawScore[] = [];
    let failedBatchIndex: number | null = null;
    let failureError: Error | null = null;

    for (let i = 0; i < batches.length; i++) {
      try {
        const batchScores = await this.scoreBatch(query, batches[i], timeoutMs);
        allScores.push(...batchScores);
      } catch (error: any) {
        failedBatchIndex = i;
        failureError = error;
        break;
      }
    }

    // If a batch failed, we have partial results from completed batches
    if (failureError !== null) {
      const completedBatches = failedBatchIndex!;
      const totalBatches = batches.length;

      logger.warn("Local rerank partial failure", {
        completedBatches,
        totalBatches,
        partialResults: allScores.length,
        error: failureError.message,
      });

      // If it's already a RerankBackendError, re-throw it
      if (failureError instanceof RerankBackendError) {
        throw failureError;
      }

      // Determine error reason from the failure
      const reason = this.classifyError(failureError);
      throw new RerankBackendError(
        "local",
        reason,
        `Local backend failed on batch ${failedBatchIndex! + 1}/${totalBatches}: ${failureError.message}`
      );
    }

    logger.info("Local rerank completed", {
      model: this.model,
      documentCount: documents.length,
      resultsCount: allScores.length,
    });

    return allScores;
  }

  /**
   * Score a single batch of documents against the query.
   * Enforces the per-batch timeout.
   */
  private async scoreBatch(
    query: string,
    batch: CandidateDocument[],
    timeoutMs: number
  ): Promise<RawScore[]> {
    const requestBody = {
      model: this.model,
      query,
      documents: batch.map((doc) => ({ text: doc.content })),
    };

    let response: Response;
    try {
      response = await fetch(`${this.endpoint}/api/rerank`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error: any) {
      const reason = this.classifyError(error);
      throw new RerankBackendError(
        "local",
        reason,
        `Local endpoint request failed: ${error.message}`
      );
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      logger.error("Local endpoint error", {
        status: response.status,
        body: errorText,
      });
      throw new RerankBackendError(
        "local",
        "server_error",
        `Local endpoint returned HTTP ${response.status}: ${errorText}`,
        response.status
      );
    }

    const data: LocalRerankResponse = await response.json();

    // Map results back to document IDs using the index field
    return data.results.map((result) => ({
      documentId: batch[result.index].id,
      score: result.relevance_score,
    }));
  }

  /**
   * Split documents into batches of the given size.
   */
  private createBatches(
    documents: CandidateDocument[],
    batchSize: number
  ): CandidateDocument[][] {
    const batches: CandidateDocument[][] = [];
    for (let i = 0; i < documents.length; i += batchSize) {
      batches.push(documents.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Classify a network error into a fallback reason.
   */
  private classifyError(
    error: any
  ): "network" | "timeout" | "server_error" {
    const message = error?.message?.toLowerCase() ?? "";
    const code = error?.cause?.code?.toLowerCase() ?? error?.code?.toLowerCase() ?? "";

    if (code === "econnrefused" || message.includes("econnrefused")) {
      return "network";
    }
    if (
      message.includes("timeout") ||
      message.includes("abort") ||
      error?.name === "TimeoutError" ||
      error?.name === "AbortError"
    ) {
      return "timeout";
    }
    return "network";
  }
}
