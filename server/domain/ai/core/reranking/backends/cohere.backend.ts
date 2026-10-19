/**
 * Cohere Rerank Backend
 *
 * Calls the Cohere Rerank v2 API to score query-document pairs.
 * Produces raw relevance scores; normalization is handled by the service layer.
 *
 * Triggers fallback (throws RerankBackendError) on:
 * - HTTP 429 (rate limit)
 * - HTTP 401/403 (auth errors)
 * - Network failures
 */

import type { CandidateDocument, RerankBackendConfig, RerankOptions } from "../types.js";
import type { RawScore, RerankBackend } from "./rerank-backend.interface.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("CohereBackend");

const COHERE_RERANK_URL = "https://api.cohere.ai/v2/rerank";
const DEFAULT_MODEL = "rerank-v3.5";

/**
 * Error thrown when the Cohere backend fails in a way that should trigger fallback.
 * The service layer catches this to move to the next backend in priority order.
 */
export class RerankBackendError extends Error {
  constructor(
    public readonly backend: string,
    public readonly reason: "rate_limit" | "auth" | "network" | "timeout" | "server_error",
    message: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = "RerankBackendError";
  }
}

/** Shape of the Cohere Rerank API response */
interface CohereRerankResponse {
  id: string;
  results: Array<{
    index: number;
    relevance_score: number;
  }>;
  meta?: {
    api_version?: { version: string };
    billed_units?: { search_units: number };
  };
}

export class CohereBackend implements RerankBackend {
  readonly type = "cohere" as const;

  private readonly model: string;
  private readonly apiKeyEnvVar: string;

  constructor(config?: RerankBackendConfig["cohere"]) {
    this.model = config?.model ?? DEFAULT_MODEL;
    this.apiKeyEnvVar = config?.apiKeyEnvVar ?? "COHERE_API_KEY";
  }

  /**
   * Check if the Cohere backend is available by verifying the API key is configured.
   */
  async isAvailable(): Promise<boolean> {
    const apiKey = this.resolveApiKey();
    return !!apiKey;
  }

  /**
   * Score query-document pairs using the Cohere Rerank API.
   * Returns raw relevance_score values from Cohere (already in 0–1 range).
   */
  async score(
    query: string,
    documents: CandidateDocument[],
    options?: RerankOptions
  ): Promise<RawScore[]> {
    const apiKey = this.resolveApiKey();
    if (!apiKey) {
      throw new RerankBackendError(
        "cohere",
        "auth",
        `Cohere API key not found in environment variable '${this.apiKeyEnvVar}'`
      );
    }

    const documentTexts = documents.map((doc) => doc.content);

    const requestBody = {
      model: this.model,
      query,
      documents: documentTexts,
      top_n: documents.length,
    };

    const timeout = options?.timeout ?? 30000;

    let response: Response;
    try {
      response = await fetch(COHERE_RERANK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(timeout),
      });
    } catch (error: any) {
      logger.error("Cohere API network error", {
        error: error.message,
        model: this.model,
        documentCount: documents.length,
      });
      throw new RerankBackendError(
        "cohere",
        "network",
        `Cohere API request failed: ${error.message}`
      );
    }

    // Handle error status codes that trigger fallback
    if (response.status === 429) {
      logger.warn("Cohere API rate limited", { status: response.status });
      throw new RerankBackendError(
        "cohere",
        "rate_limit",
        "Cohere API rate limit exceeded (HTTP 429)",
        429
      );
    }

    if (response.status === 401 || response.status === 403) {
      logger.error("Cohere API auth error", {
        status: response.status,
        envVar: this.apiKeyEnvVar,
      });
      throw new RerankBackendError(
        "cohere",
        "auth",
        `Cohere API authentication failed (HTTP ${response.status})`,
        response.status
      );
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      logger.error("Cohere API error", {
        status: response.status,
        body: errorText,
      });
      throw new RerankBackendError(
        "cohere",
        "server_error",
        `Cohere API returned HTTP ${response.status}: ${errorText}`,
        response.status
      );
    }

    const data: CohereRerankResponse = await response.json();

    // Map Cohere results back to document IDs using the index field
    const scores: RawScore[] = data.results.map((result) => ({
      documentId: documents[result.index].id,
      score: result.relevance_score,
    }));

    logger.info("Cohere rerank completed", {
      model: this.model,
      documentCount: documents.length,
      resultsCount: scores.length,
    });

    return scores;
  }

  /**
   * Resolve the API key from the environment variable.
   */
  private resolveApiKey(): string | undefined {
    return process.env[this.apiKeyEnvVar];
  }
}
