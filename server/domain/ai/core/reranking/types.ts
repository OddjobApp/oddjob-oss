/**
 * Reranking Service — Core Type Definitions
 *
 * Unified types for the multi-backend cross-encoder reranking primitive.
 * All backends produce raw scores; normalization to [0.0, 1.0] happens
 * at the service layer boundary.
 */

/** A document or chunk retrieved by initial search, submitted for reranking. */
export interface CandidateDocument {
  id: string;
  content: string;
  metadata?: Record<string, any>;
  originalScore?: number;
}

/** Structured input for a reranking operation. */
export interface RerankRequest {
  query: string;
  documents: CandidateDocument[];
  topK?: number;
  backend?: RerankBackendType;
  options?: RerankOptions;
}

/** Per-request options that influence backend behavior. */
export interface RerankOptions {
  timeout?: number;                // Per-backend timeout in ms
  batchSize?: number;              // For local backend batching
  maxDocumentsPerPrompt?: number;  // For LLM backend context limits
  organizationId?: number;
  credentialId?: number;
}

/** A single reranked document with its normalized relevance score. */
export interface RerankResult {
  id: string;
  content: string;
  relevanceScore: number;          // Normalized 0.0–1.0
  originalScore?: number;          // Pre-rerank score preserved
  metadata?: Record<string, any>;
}

/** Full response from a reranking operation. */
export interface RerankResponse {
  results: RerankResult[];
  metadata: {
    backendUsed: RerankBackendType;
    fallbackTriggered: boolean;
    latencyMs: number;
    documentCount: number;
  };
}

/** Supported reranking backend identifiers. */
export type RerankBackendType = "cohere" | "local" | "llm";

/** System-level configuration for the reranking service. */
export interface RerankBackendConfig {
  defaultBackend: RerankBackendType;
  priorityOrder: RerankBackendType[];
  cohere?: {
    model?: string;            // Default: "rerank-v3.5"
    apiKeyEnvVar?: string;
  };
  local?: {
    endpoint: string;          // Ollama or sidecar URL
    model?: string;            // Default: "cross-encoder/ms-marco-MiniLM-L-6-v2"
    batchSize?: number;        // Default: 32
    timeoutMs?: number;        // Default: 10000
  };
  llm?: {
    maxDocsPerPrompt?: number; // Default: 20
    model?: string;
    temperature?: number;      // Default: 0
  };
}
