/**
 * Default configuration constants for GraphRAG Engine
 */

import { GraphRAGConfig } from './types.js';

/**
 * Default GraphRAG configuration
 */
export const DEFAULT_GRAPH_RAG_CONFIG: Partial<GraphRAGConfig> = {
  embeddingConfig: {
    model: 'text-embedding-ada-002',
    dimensions: 1536
  },
  searchConfig: {
    defaultTopK: 10,
    maxGraphDepth: 3,
    vectorWeight: 0.6,
    graphWeight: 0.4
  }
};

/**
 * Default hybrid search configuration
 */
export const DEFAULT_HYBRID_SEARCH_CONFIG = {
  topK: 10,
  graphDepth: 2,
  vectorWeight: 0.6,
  graphWeight: 0.4,
  minScore: 0.5,
  maxLatency: 100 // milliseconds
};

/**
 * Supported entity types for extraction
 */
export const SUPPORTED_ENTITY_TYPES = [
  'person',
  'organization',
  'location',
  'product',
  'technology',
  'concept',
  'event',
  'date',
  'money',
  'percentage'
] as const;

/**
 * Supported relationship types
 */
export const SUPPORTED_RELATIONSHIP_TYPES = [
  'works_at',
  'founded_by',
  'located_in',
  'produces',
  'uses',
  'part_of',
  'related_to',
  'causes',
  'precedes',
  'owns',
  'invested_in'
] as const;

/**
 * Graph query timeout in milliseconds
 */
export const GRAPH_QUERY_TIMEOUT = 5000;

/**
 * Vector search timeout in milliseconds
 */
export const VECTOR_SEARCH_TIMEOUT = 3000;

/**
 * Maximum number of entities per document
 */
export const MAX_ENTITIES_PER_DOCUMENT = 100;

/**
 * Maximum relationships per entity
 */
export const MAX_RELATIONSHIPS_PER_ENTITY = 50;

/**
 * Default batch size for indexing
 */
export const DEFAULT_BATCH_SIZE = 100;

/**
 * Embedding model providers
 */
export const EMBEDDING_PROVIDERS = {
  openai: 'text-embedding-ada-002',
  azure: 'text-embedding-ada-002',
  huggingface: 'sentence-transformers/all-MiniLM-L6-v2',
  cohere: 'embed-english-v3'
} as const;
