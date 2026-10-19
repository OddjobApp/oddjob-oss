/**
 * Graph RAG Module
 * 
 * Hybrid vector + graph retrieval for knowledge-based RAG.
 * 
 * @example
 * ```typescript
 * import { GraphRAGService } from './graph-rag';
 * 
 * const service = new GraphRAGService(qdrantClient, embeddingService);
 * 
 * const result = await service.query({
 *   query: "What features are related to ticket PROJ-123?",
 *   organizationId: 1,
 *   maxHops: 2,
 *   topK: 5,
 *   includePaths: true
 * });
 * 
 * console.log(result.answer);
 * console.log(result.traversedPaths);
 * ```
 */

// Types
export {
  GraphRAGQuery,
  GraphRAGResult,
  GraphRAGMetrics,
  GraphRAGCacheEntry,
  GraphRAGServiceConfig,
  GraphRAGError,
  GraphRAGErrorType,
  ContextNode,
  GraphPath,
  SeedEntity,
  TraversalResult,
  TraversalConfig,
  DEFAULT_GRAPH_RAG_QUERY,
  DEFAULT_TRAVERSAL_CONFIG,
  DEFAULT_SERVICE_CONFIG
} from './types.js';

// Services
export { GraphRAGService } from './graph-rag.service.js';
export { HybridSearchEngine } from './hybrid-search.engine.js';
export { PathExplainerService } from './path-explainer.service.js';
export { CommunityMaintainerService } from './community-maintainer.service.js';
export type { AdaptiveRetrievalResult } from './community-maintainer.service.js';
