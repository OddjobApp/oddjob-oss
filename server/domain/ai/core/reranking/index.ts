/**
 * Reranking Service — Public API Barrel
 *
 * Re-exports the public surface of the reranking service module.
 * Consumers should import from this barrel rather than reaching into
 * internal files directly.
 */

// Service singleton access and initialization
export { getRerankingService, initRerankingService, RerankingService } from "./reranking.service.js";

// Boot function for platform startup
export { bootRerankingService } from "./boot.js";

// Configuration management (load from DB, save/update)
export { loadRerankingConfig, saveRerankingConfig, DEFAULT_RERANKING_CONFIG } from "./config.js";

// Core types used by consumers (hybrid search, constrained RAG, API route)
export type {
  RerankRequest,
  RerankResponse,
  RerankResult,
  CandidateDocument,
  RerankBackendType,
  RerankBackendConfig,
  RerankOptions,
} from "./types.js";

// Telemetry access for platform observability
export { getMetrics } from "./telemetry.js";
