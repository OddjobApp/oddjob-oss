/**
 * Type definitions for GraphRAG Engine
 */

/**
 * Configuration for GraphRAG Service
 */
export interface GraphRAGConfig {
  /** Qdrant vector database URL */
  qdrantUrl: string;
  
  /** Name of the vector collection */
  collectionName: string;
  
  /** Optional API key for Qdrant */
  apiKey?: string;
  
  /** Graph database configuration */
  graphConfig?: {
    type: 'neo4j' | 'janusgraph' | 'custom';
    url: string;
    username?: string;
    password?: string;
  };
  
  /** Embedding model configuration */
  embeddingConfig?: {
    model: string;
    dimensions: number;
  };
  
  /** Search configuration */
  searchConfig?: {
    defaultTopK: number;
    maxGraphDepth: number;
    vectorWeight: number;
    graphWeight: number;
  };
}

/**
 * Document to be indexed
 */
export interface Document {
  /** Unique document ID */
  id: string;
  
  /** Document content */
  content: string;
  
  /** Optional document metadata */
  metadata?: Record<string, any>;
  
  /** Pre-computed embedding (optional) */
  embedding?: number[];
}

/**
 * Hybrid search query
 */
export interface HybridQuery {
  /** Search query text */
  query: string;
  
  /** Number of results to return */
  topK?: number;
  
  /** Graph traversal depth */
  graphDepth?: number;
  
  /** Filter by metadata */
  filters?: Record<string, any>;
  
  /** Search strategy */
  strategy?: SearchStrategy;
  
  /** Whether to include explanations */
  explain?: boolean;
}

/**
 * Search strategy options
 */
export type SearchStrategy = 
  | 'vector'           // Vector-only search
  | 'graph'            // Graph-only search
  | 'hybrid'           // Combined vector + graph
  | 'hybrid-rerank'    // Hybrid with reranking
  | 'path';            // Path-based graph search

/**
 * Search result
 */
export interface SearchResult {
  /** Document ID */
  id: string;
  
  /** Document content snippet */
  content: string;
  
  /** Combined relevance score */
  score: number;
  
  /** Vector similarity score */
  vectorScore?: number;
  
  /** Graph relevance score */
  graphScore?: number;
  
  /** Document metadata */
  metadata?: Record<string, any>;
  
  /** Related entities from graph */
  entities?: Entity[];
  
  /** Explanation of why this result matched */
  explanation?: string;
  
  /** Path from query to this result (if graph search) */
  path?: GraphEdge[];
}

/**
 * Graph node (entity)
 */
export interface GraphNode {
  /** Unique node ID */
  id: string;
  
  /** Node label/type */
  label: string;
  
  /** Node properties */
  properties: Record<string, any>;
  
  /** Vector embedding */
  embedding?: number[];
}

/**
 * Graph edge (relationship)
 */
export interface GraphEdge {
  /** Source node ID */
  source: string;
  
  /** Target node ID */
  target: string;
  
  /** Relationship type */
  type: string;
  
  /** Edge properties */
  properties?: Record<string, any>;
  
  /** Edge weight/strength */
  weight?: number;
}

/**
 * Entity extracted from document
 */
export interface Entity {
  /** Entity ID */
  id: string;
  
  /** Entity name/text */
  name: string;
  
  /** Entity type */
  type: string;
  
  /** Confidence score */
  confidence: number;
  
  /** Position in document */
  position?: {
    start: number;
    end: number;
  };
}

/**
 * Relationship between entities
 */
export interface Relationship {
  /** Source entity ID */
  source: string;
  
  /** Target entity ID */
  target: string;
  
  /** Relationship type */
  type: string;
  
  /** Confidence score */
  confidence: number;
  
  /** Evidence text */
  evidence?: string;
}

/**
 * Path explanation between two entities
 */
export interface PathExplanation {
  /** Starting entity */
  from: Entity;
  
  /** Target entity */
  to: Entity;
  
  /** Paths connecting the entities */
  paths: Array<{
    edges: GraphEdge[];
    score: number;
    explanation: string;
  }>;
  
  /** Overall relationship strength */
  relationshipStrength: number;
}

/**
 * Graph traversal result
 */
export interface GraphTraversal {
  /** Starting node ID */
  startNode: string;
  
  /** Traversal depth */
  depth: number;
  
  /** Nodes discovered */
  nodes: GraphNode[];
  
  /** Edges traversed */
  edges: GraphEdge[];
  
  /** Subgraphs by depth level */
  levels: Array<{
    depth: number;
    nodes: GraphNode[];
  }>;
}
