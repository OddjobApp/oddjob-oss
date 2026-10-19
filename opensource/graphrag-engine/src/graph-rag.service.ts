/**
 * GraphRAG Service
 * 
 * Main service for hybrid graph + vector retrieval augmented generation
 */

import { createLogger } from './utils/logger.js';
import {
  GraphRAGConfig,
  Document,
  HybridQuery,
  SearchResult,
  Entity,
  Relationship
} from './types.js';
import { DEFAULT_GRAPH_RAG_CONFIG } from './constants.js';
import { HybridSearchEngine } from './hybrid-search.engine.js';
import { EntityExtractor } from './entity-extractor.js';
import { GraphTraversalEngine } from './graph-traversal.engine.js';

const logger = createLogger('GraphRAGService');

/**
 * GraphRAG Service - Main entry point for hybrid graph + vector operations
 */
export class GraphRAGService {
  private config: GraphRAGConfig;
  private searchEngine: HybridSearchEngine;
  private entityExtractor: EntityExtractor;
  private graphEngine: GraphTraversalEngine;
  private initialized = false;

  /**
   * Create a new GraphRAG service instance
   * @param config - Service configuration
   */
  constructor(config: GraphRAGConfig) {
    this.config = {
      ...DEFAULT_GRAPH_RAG_CONFIG,
      ...config
    } as GraphRAGConfig;

    this.searchEngine = new HybridSearchEngine(this.config);
    this.entityExtractor = new EntityExtractor(this.config);
    this.graphEngine = new GraphTraversalEngine(this.config.graphConfig);

    logger.info('GraphRAG Service created', {
      collection: config.collectionName,
      qdrantUrl: config.qdrantUrl
    });
  }

  /**
   * Initialize the service and connect to databases
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await this.searchEngine.initialize();
      await this.graphEngine.initialize();
      
      this.initialized = true;
      logger.info('GraphRAG Service initialized');
    } catch (error) {
      logger.error('Failed to initialize GraphRAG Service', error);
      throw error;
    }
  }

  /**
   * Index a document into the knowledge base
   * Extracts entities and relationships, updates graph and vector store
   * 
   * @param document - Document to index
   */
  async indexDocument(document: Document): Promise<void> {
    this.checkInitialized();

    try {
      logger.debug('Indexing document', { docId: document.id });

      // Step 1: Extract entities from document
      const entities = await this.entityExtractor.extract(document);
      logger.debug('Entities extracted', { count: entities.length });

      // Step 2: Extract relationships between entities
      const relationships = await this.entityExtractor.extractRelationships(
        document,
        entities
      );
      logger.debug('Relationships extracted', { count: relationships.length });

      // Step 3: Add to vector store
      await this.searchEngine.indexDocument(document);

      // Step 4: Add entities and relationships to graph
      await this.graphEngine.addEntities(entities);
      await this.graphEngine.addRelationships(relationships);

      // Step 5: Link document to entities
      await this.graphEngine.linkDocumentToEntities(document.id, entities);

      logger.info('Document indexed successfully', {
        docId: document.id,
        entities: entities.length,
        relationships: relationships.length
      });
    } catch (error) {
      logger.error('Failed to index document', { docId: document.id, error });
      throw error;
    }
  }

  /**
   * Index multiple documents in batch
   * 
   * @param documents - Array of documents to index
   */
  async indexDocuments(documents: Document[]): Promise<void> {
    this.checkInitialized();

    logger.info('Batch indexing documents', { count: documents.length });

    // Process in batches
    const BATCH_SIZE = 10;
    for (let i = 0; i < documents.length; i += BATCH_SIZE) {
      const batch = documents.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map((doc) => this.indexDocument(doc)));
      
      logger.debug('Batch indexed', {
        processed: Math.min(i + BATCH_SIZE, documents.length),
        total: documents.length
      });
    }

    logger.info('Batch indexing complete', { count: documents.length });
  }

  /**
   * Perform hybrid search combining vector similarity and graph traversal
   * 
   * @param query - Hybrid search query
   * @returns Array of search results
   */
  async hybridSearchQuery(query: HybridQuery): Promise<SearchResult[]> {
    this.checkInitialized();

    const startTime = Date.now();

    try {
      logger.debug('Performing hybrid search', {
        query: query.query,
        strategy: query.strategy || 'hybrid'
      });

      // Perform hybrid search
      const results = await this.searchEngine.search(query);

      // Enrich with graph data if requested
      if (query.graphDepth && query.graphDepth > 0) {
        for (const result of results) {
          const relatedEntities = await this.graphEngine.getRelatedEntities(
            result.id,
            query.graphDepth
          );
          result.entities = relatedEntities;
        }
      }

      const latency = Date.now() - startTime;
      logger.info('Hybrid search complete', {
        query: query.query,
        results: results.length,
        latency
      });

      return results;
    } catch (error) {
      logger.error('Hybrid search failed', { query: query.query, error });
      throw error;
    }
  }

  /**
   * Vector-only search for quick retrieval
   * 
   * @param query - Search query text
   * @param topK - Number of results
   * @returns Vector search results
   */
  async vectorSearch(query: string, topK = 10): Promise<SearchResult[]> {
    return this.searchEngine.search({
      query,
      topK,
      strategy: 'vector'
    });
  }

  /**
   * Graph-only search for relationship-based retrieval
   * 
   * @param startNode - Starting node ID
   * @param depth - Traversal depth
   * @returns Graph search results
   */
  async graphSearch(startNode: string, depth = 2): Promise<SearchResult[]> {
    const traversal = await this.graphEngine.traverse(startNode, depth);
    
    // Convert traversal to search results
    return traversal.nodes.map((node: any) => ({
      id: node.id,
      content: JSON.stringify(node.properties),
      score: 1.0,
      metadata: node.properties
    }));
  }

  /**
   * Explain the relationship path between two entities
   * 
   * @param fromEntityId - Source entity ID
   * @param toEntityId - Target entity ID
   * @returns Path explanation
   */
  async explainPath(fromEntityId: string, toEntityId: string) {
    this.checkInitialized();
    return this.graphEngine.explainPath(fromEntityId, toEntityId);
  }

  /**
   * Get entities related to a document
   * 
   * @param documentId - Document ID
   * @returns Related entities
   */
  async getDocumentEntities(documentId: string): Promise<Entity[]> {
    this.checkInitialized();
    return this.graphEngine.getDocumentEntities(documentId);
  }

  /**
   * Delete a document and its associated data
   * 
   * @param documentId - Document ID to delete
   */
  async deleteDocument(documentId: string): Promise<void> {
    this.checkInitialized();

    try {
      // Remove from vector store
      await this.searchEngine.deleteDocument(documentId);

      // Remove document-entity links from graph
      await this.graphEngine.unlinkDocument(documentId);

      logger.info('Document deleted', { docId: documentId });
    } catch (error) {
      logger.error('Failed to delete document', { docId: documentId, error });
      throw error;
    }
  }

  /**
   * Get service statistics
   */
  async getStats(): Promise<{
    documentCount: number;
    entityCount: number;
    relationshipCount: number;
    avgQueryLatency: number;
  }> {
    this.checkInitialized();

    const [vectorStats, graphStats] = await Promise.all([
      this.searchEngine.getStats(),
      this.graphEngine.getStats()
    ]);

    return {
      documentCount: vectorStats.documentCount,
      entityCount: graphStats.entityCount,
      relationshipCount: graphStats.relationshipCount,
      avgQueryLatency: vectorStats.avgLatency
    };
  }

  /**
   * Close connections and cleanup
   */
  async close(): Promise<void> {
    if (!this.initialized) return;

    await Promise.all([
      this.searchEngine.close(),
      this.graphEngine.close()
    ]);

    this.initialized = false;
    logger.info('GraphRAG Service closed');
  }

  private checkInitialized(): void {
    if (!this.initialized) {
      throw new Error('GraphRAG Service not initialized. Call initialize() first.');
    }
  }
}

export default GraphRAGService;
