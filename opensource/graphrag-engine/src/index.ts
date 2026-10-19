/**
 * GraphRAG Engine
 * 
 * Hybrid Graph + Vector Retrieval Augmented Generation
 * 
 * @module @oddjob/graphrag-engine
 * @license Apache-2.0
 */

export { GraphRAGService } from './graph-rag.service.js';
export { HybridSearchEngine } from './hybrid-search.engine.js';
export { PathExplainerService } from './path-explainer.service.js';
export { GraphTraversalEngine } from './graph-traversal.engine.js';
export { EntityExtractor } from './entity-extractor.js';

export type {
  GraphRAGConfig,
  Document,
  HybridQuery,
  SearchResult,
  GraphNode,
  GraphEdge,
  PathExplanation,
  Entity,
  Relationship,
  GraphTraversal,
  SearchStrategy
} from './types.js';

export {
  DEFAULT_GRAPH_RAG_CONFIG,
  DEFAULT_HYBRID_SEARCH_CONFIG
} from './constants.js';
