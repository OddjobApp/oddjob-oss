/**
 * Reranking Backend — Adapter Interface
 *
 * Each backend (Cohere, Local, LLM) implements this interface.
 * Backends produce raw scores; normalization is handled by the service layer.
 */

import type { CandidateDocument, RerankBackendType, RerankOptions } from "../types.js";

/** Raw score from a backend before normalization. Range depends on the backend. */
export interface RawScore {
  documentId: string;
  score: number;
}

/** Pluggable reranking backend adapter. */
export interface RerankBackend {
  readonly type: RerankBackendType;

  /**
   * Score query-document pairs. Returns raw scores (may be outside 0–1).
   * Normalization is handled by the service layer.
   */
  score(
    query: string,
    documents: CandidateDocument[],
    options?: RerankOptions
  ): Promise<RawScore[]>;

  /**
   * Check if this backend is currently available.
   */
  isAvailable(): Promise<boolean>;
}
