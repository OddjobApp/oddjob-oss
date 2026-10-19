/**
 * Graph RAG - Types and Interfaces
 * 
 * Hybrid vector + graph traversal retrieval system
 * for knowledge graph-based RAG enhancement.
 */

import { KnowledgeNode, KnowledgeEdge } from '@shared/schema/index.js';

/**
 * Graph RAG Query Configuration
 */
export interface GraphRAGQuery {
  /** Natural language query */
  query: string;
  
  /** Organization scope */
  organizationId: number;
  
  /** Maximum traversal hops from seed entities (1-3) */
  maxHops: number;
  
  /** Number of seed entities from vector search */
  topK: number;
  
  /** Graph traversal strategy */
  traversalStrategy: 'bfs' | 'dfs' | 'bidirectional';
  
  /** Filter by specific entity types (optional) */
  entityTypes?: string[];
  
  /** Minimum edge weight threshold for traversal */
  minRelationshipWeight: number;
  
  /** Include explanation paths in results */
  includePaths: boolean;
  
  /** Include answer generation from context (vs retrieval only) */
  generateAnswer?: boolean;

  /** GraphRAG mode: 'local' (focused entities/traversal) or 'global' (community summaries) */
  mode?: 'local' | 'global';
}

/**
 * Default query configuration
 */
export const DEFAULT_GRAPH_RAG_QUERY: Partial<GraphRAGQuery> = {
  maxHops: 2,
  topK: 5,
  traversalStrategy: 'bfs',
  minRelationshipWeight: 0.5,
  includePaths: true,
  generateAnswer: true
};

/**
 * Graph RAG Query Result
 */
export interface GraphRAGResult {
  /** Generated answer (if generateAnswer=true) */
  answer?: string;
  
  /** Retrieved knowledge nodes with context */
  contextNodes: ContextNode[];
  
  /** Traversal paths for explainability */
  traversedPaths: GraphPath[];
  
  /** Performance and quality metrics */
  metrics: GraphRAGMetrics;
  
  /** Query ID for tracking */
  queryId: string;
}

/**
 * Context Node - Knowledge node with traversal metadata
 */
export interface ContextNode {
  /** The knowledge node */
  node: KnowledgeNode;
  
  /** Combined vector + graph relevance score (0-1) */
  relevanceScore: number;
  
  /** Distance from seed entities in hops */
  hopDistance: number;
  
  /** Paths that led to this node */
  incomingPaths: GraphPath[];
  
  /** Source of discovery: 'vector' | 'traversal' | 'both' */
  discoverySource: string;
}

/**
 * Graph Path Edge - Knowledge edge with human-readable labels
 */
export interface GraphPathEdge extends KnowledgeEdge {
  /** Source node display name */
  sourceName?: string;
  
  /** Source node label */
  sourceLabel?: string;
  
  /** Target node display name */
  targetName?: string;
  
  /** Target node label */
  targetLabel?: string;
}

/**
 * Graph Path - Traversal trail for explainability
 */
export interface GraphPath {
  /** Unique path identifier */
  pathId: string;
  
  /** Sequence of edges forming the path */
  edges: GraphPathEdge[];
  
  /** Cumulative path relevance score */
  pathScore: number;
  
  /** Human-readable path explanation */
  explanation: string;
  
  /** Starting seed entity */
  seedNodeId: string;
  
  /** Target node reached */
  targetNodeId: string;
  
  /** Number of hops in path */
  hopCount: number;
}

/**
 * Graph RAG Performance Metrics
 */
export interface GraphRAGMetrics {
  /** Vector search execution time (ms) */
  vectorSearchTimeMs: number;
  
  /** Graph traversal execution time (ms) */
  graphTraversalTimeMs: number;
  
  /** Total query execution time (ms) */
  totalTimeMs: number;
  
  /** Number of nodes visited during traversal */
  totalNodesVisited: number;
  
  /** Number of paths explored */
  totalPathsExplored: number;
  
  /** Number of edges traversed */
  totalEdgesTraversed: number;
  
  /** Cache hit rate (0-1) */
  cacheHitRate: number;
  
  /** Number of seed entities found */
  seedCount: number;
  
  /** Number of context nodes returned */
  resultCount: number;
}

/**
 * Hybrid Search Result (internal)
 */
export interface HybridSearchResult {
  /** Ranked context nodes */
  nodes: ContextNode[];
  
  /** All traversed paths */
  paths: GraphPath[];
  
  /** Seed entities from vector search */
  seeds: SeedEntity[];
  
  /** Performance metrics */
  metrics: Omit<GraphRAGMetrics, 'totalTimeMs' | 'cacheHitRate'>;
}

/**
 * Seed Entity from Vector Search
 */
export interface SeedEntity {
  /** Node ID */
  nodeId: string;
  
  /** Vector similarity score */
  vectorScore: number;
  
  /** Node payload from Qdrant */
  payload: Record<string, any>;
  
  /** Source vector from embedding */
  vector?: number[];
}

/**
 * Traversal Result (internal)
 */
export interface TraversalResult {
  /** Discovered node ID */
  nodeId: string;
  
  /** Source node that led to this discovery */
  sourceId: string;
  
  /** Edge traversed */
  edge: KnowledgeEdge;
  
  /** Hop distance from seed */
  hopDistance: number;
  
  /** Path taken to reach this node */
  path: KnowledgeEdge[];
  
  /** Cumulative path score */
  pathScore: number;
}

/**
 * Traversal Configuration
 */
export interface TraversalConfig {
  /** Maximum hops to traverse */
  maxHops: number;
  
  /** Maximum nodes to visit per hop */
  maxNodesPerHop: number;
  
  /** Maximum total nodes to visit */
  maxTotalNodes: number;
  
  /** Minimum edge weight threshold */
  minEdgeWeight: number;
  
  /** Entity type filters */
  entityTypeFilter?: string[];
  
  /** Enable cycle detection */
  detectCycles: boolean;
  
  /** Enable parallel traversal */
  parallel: boolean;
  
  /** Early stopping score threshold */
  earlyStopThreshold?: number;
}

/**
 * Default traversal configuration
 */
export const DEFAULT_TRAVERSAL_CONFIG: TraversalConfig = {
  maxHops: 2,
  maxNodesPerHop: 50,
  maxTotalNodes: 200,
  minEdgeWeight: 0.5,
  detectCycles: true,
  parallel: true,
  earlyStopThreshold: 0.1
};

/**
 * Combined Score Result (internal)
 */
export interface CombinedScoreResult {
  /** Node ID */
  nodeId: string;
  
  /** Vector similarity score (0-1) */
  vectorScore: number;
  
  /** Graph traversal score (0-1) */
  graphScore: number;
  
  /** Combined hybrid score */
  combinedScore: number;
  
  /** Hop distance from nearest seed */
  hopDistance: number;
  
  /** Discovery sources */
  sources: ('vector' | 'traversal')[];
}

/**
 * Cache Entry for Graph RAG
 */
export interface GraphRAGCacheEntry {
  /** Cache key (hash of query + orgId) */
  key: string;
  
  /** Cached result */
  result: GraphRAGResult;
  
  /** Timestamp when cached */
  cachedAt: Date;
  
  /** Time-to-live in seconds */
  ttl: number;
  
  /** Query that generated this result */
  originalQuery: string;
  
  /** Cache hit count */
  hitCount: number;
}

/**
 * Subgraph Cache Entry
 */
export interface SubgraphCacheEntry {
  /** Starting node ID */
  nodeId: string;
  
  /** Traversal depth */
  depth: number;
  
  /** Cached subgraph nodes */
  nodes: KnowledgeNode[];
  
  /** Cached subgraph edges */
  edges: KnowledgeEdge[];
  
  /** Timestamp when cached */
  cachedAt: Date;
}

/**
 * Graph RAG Service Configuration
 */
export interface GraphRAGServiceConfig {
  /** Enable query result caching */
  enableCache: boolean;
  
  /** Default query TTL in seconds */
  defaultCacheTtl: number;
  
  /** Enable subgraph caching */
  enableSubgraphCache: boolean;
  
  /** Subgraph cache TTL in seconds */
  subgraphCacheTtl: number;
  
  /** Maximum cache size (entries) */
  maxCacheSize: number;
  
  /** Enable metrics collection */
  enableMetrics: boolean;
  
  /** Enable detailed logging */
  enableLogging: boolean;
  
  /** Default query configuration */
  defaultQueryConfig: Partial<GraphRAGQuery>;
}

/**
 * Default service configuration
 */
export const DEFAULT_SERVICE_CONFIG: GraphRAGServiceConfig = {
  enableCache: true,
  defaultCacheTtl: 3600,  // 1 hour
  enableSubgraphCache: true,
  subgraphCacheTtl: 7200, // 2 hours
  maxCacheSize: 10000,
  enableMetrics: true,
  enableLogging: true,
  defaultQueryConfig: DEFAULT_GRAPH_RAG_QUERY
};

/**
 * Path Explanation Request
 */
export interface PathExplanationRequest {
  /** Path to explain */
  path: GraphPath;
  
  /** Query context */
  query: string;
  
  /** Explanation style */
  style: 'simple' | 'detailed' | 'technical';
  
  /** Include relationship types in explanation */
  includeRelationships: boolean;
}

/**
 * Query Statistics
 */
export interface GraphRAGQueryStats {
  /** Total queries executed */
  totalQueries: number;
  
  /** Average latency (ms) */
  averageLatencyMs: number;
  
  /** P95 latency (ms) */
  p95LatencyMs: number;
  
  /** P99 latency (ms) */
  p99LatencyMs: number;
  
  /** Cache hit rate */
  cacheHitRate: number;
  
  /** Top queries by frequency */
  topQueries: Array<{ query: string; count: number }>;
  
  /** Error rate */
  errorRate: number;
  
  /** Time range for stats */
  timeRange: { start: Date; end: Date };
}

/**
 * Graph RAG Events
 */
export type GraphRAGEvent =
  | { type: 'graphrag.query_started'; payload: { queryId: string; query: string } }
  | { type: 'graphrag.query_completed'; payload: { queryId: string; metrics: GraphRAGMetrics } }
  | { type: 'graphrag.cache_hit'; payload: { queryId: string; cacheKey: string } }
  | { type: 'graphrag.cache_miss'; payload: { queryId: string; cacheKey: string } }
  | { type: 'graphrag.traversal_completed'; payload: { queryId: string; nodesFound: number } }
  | { type: 'graphrag.error'; payload: { queryId: string; error: string } };

/**
 * Validation error types
 */
export enum GraphRAGErrorType {
  INVALID_QUERY = 'invalid_query',
  VECTOR_SEARCH_FAILED = 'vector_search_failed',
  TRAVERSAL_FAILED = 'traversal_failed',
  CACHE_ERROR = 'cache_error',
  LLM_GENERATION_FAILED = 'llm_generation_failed',
  INVALID_NODE = 'invalid_node',
  CYCLE_DETECTED = 'cycle_detected',
  TIMEOUT = 'timeout',
  UNKNOWN = 'unknown'
}

/**
 * Graph RAG Error
 */
export class GraphRAGError extends Error {
  constructor(
    public type: GraphRAGErrorType,
    message: string,
    public queryId?: string,
    public cause?: Error
  ) {
    super(message);
    this.name = 'GraphRAGError';
  }
}
