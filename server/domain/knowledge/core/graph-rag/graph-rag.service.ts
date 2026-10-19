/**
 * Graph RAG Service
 * 
 * Main service for hybrid vector + graph retrieval.
 * Provides context-rich results for RAG with explainability.
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import { HybridSearchEngine } from './hybrid-search.engine.js';
import { PathExplainerService } from './path-explainer.service.js';
import { 
  GraphRAGQuery, 
  GraphRAGResult, 
  GraphRAGServiceConfig,
  DEFAULT_SERVICE_CONFIG,
  GraphRAGCacheEntry,
  GraphRAGMetrics,
  GraphRAGError,
  GraphRAGErrorType
} from './types.js';
import { randomUUID } from 'crypto';
import { createLogger } from '../../../../utils/logger.js';

const logger = createLogger('GraphRAGService');

/**
 * Graph RAG Service
 */
export class GraphRAGService {
  private hybridSearchEngine: HybridSearchEngine;
  private pathExplainer: PathExplainerService;
  private config: GraphRAGServiceConfig;
  private queryCache: Map<string, GraphRAGCacheEntry> = new Map();
  private metrics: GraphRAGMetrics[] = [];

  constructor(
    private qdrantClient: QdrantClient,
    private embeddingService: EmbeddingService,
    config?: Partial<GraphRAGServiceConfig>
  ) {
    this.config = { ...DEFAULT_SERVICE_CONFIG, ...config };
    this.hybridSearchEngine = new HybridSearchEngine(
      qdrantClient,
      embeddingService
    );
    this.pathExplainer = new PathExplainerService();
    
    logger.info('GraphRAG Service initialized', {
      enableCache: this.config.enableCache,
      defaultCacheTtl: this.config.defaultCacheTtl
    });
  }

  /**
   * Execute Graph RAG query
   */
  async query(query: GraphRAGQuery): Promise<GraphRAGResult> {
    const queryId = randomUUID();
    const startTime = Date.now();
    
    logger.info(`[${queryId}] Graph RAG query: "${query.query}"`);

    try {
      // Validate query
      this.validateQuery(query);

      // Check cache
      if (this.config.enableCache) {
        const cached = this.getCachedResult(query);
        if (cached) {
          logger.info(`[${queryId}] Cache hit, returning cached result`);
          return {
            ...cached,
            metrics: {
              ...cached.metrics,
              totalTimeMs: Date.now() - startTime,
              cacheHitRate: 1.0
            }
          };
        }
      }

      // Execute global search if requested
      if (query.mode === 'global') {
        const { CommunitySummarizerService } = await import('./community-summarizer.service.js');
        const summaries = await CommunitySummarizerService.generateCommunitySummaries(query.organizationId);
        const answer = await CommunitySummarizerService.queryCommunitySummaries(query.query, summaries);
        
        return {
          answer,
          contextNodes: [],
          traversedPaths: [],
          metrics: {
            vectorSearchTimeMs: 0,
            graphTraversalTimeMs: 0,
            totalTimeMs: Date.now() - startTime,
            totalNodesVisited: 0,
            totalPathsExplored: 0,
            totalEdgesTraversed: 0,
            cacheHitRate: 0,
            seedCount: 0,
            resultCount: 0
          },
          queryId
        };
      }

      // Execute hybrid search
      const searchResult = await this.hybridSearchEngine.hybridSearch(query, queryId);

      // Generate answer if requested
      let answer: string | undefined;
      if (query.generateAnswer !== false && searchResult.nodes.length > 0) {
        answer = await this.generateAnswer(query.query, searchResult.nodes);
      }

      // Build final paths if includePaths is enabled
      const paths = query.includePaths 
        ? this.enrichPaths(searchResult.paths, query.query)
        : [];

      const result: GraphRAGResult = {
        answer,
        contextNodes: searchResult.nodes,
        traversedPaths: paths,
        metrics: {
          ...searchResult.metrics,
          totalTimeMs: Date.now() - startTime,
          cacheHitRate: 0
        },
        queryId
      };

      // Cache result
      if (this.config.enableCache) {
        this.cacheResult(query, result);
      }

      // Record metrics
      if (this.config.enableMetrics) {
        this.recordMetrics(result.metrics);
      }

      logger.info(`[${queryId}] Query completed in ${result.metrics.totalTimeMs}ms, ` +
        `${searchResult.nodes.length} nodes, ${paths.length} paths`);

      return result;

    } catch (error) {
      logger.error(`[${queryId}] Query failed:`, error);
      
      if (error instanceof GraphRAGError) {
        throw error;
      }
      
      throw new GraphRAGError(
        GraphRAGErrorType.UNKNOWN,
        `Graph RAG query failed: ${(error as Error).message}`,
        queryId,
        error as Error
      );
    }
  }

  /**
   * Execute query without answer generation (retrieval only)
   */
  async retrieve(query: GraphRAGQuery): Promise<GraphRAGResult> {
    return this.query({ ...query, generateAnswer: false });
  }

  /**
   * Get explanation for how results were retrieved
   */
  async explainQuery(query: GraphRAGQuery): Promise<{
    seeds: string[];
    paths: string[];
    traversalDepth: number;
    explanation: string;
  }> {
    const result = await this.query({ ...query, generateAnswer: false });
    
    const seedIds = [...new Set(result.traversedPaths.map(p => p.seedNodeId))];
    
    return {
      seeds: seedIds,
      paths: result.traversedPaths.map(p => p.explanation),
      traversalDepth: Math.max(...result.traversedPaths.map(p => p.hopCount), 0),
      explanation: this.generateQueryExplanation(query.query, result)
    };
  }

  /**
   * Get service statistics
   */
  getStats(): {
    totalQueries: number;
    averageLatency: number;
    cacheSize: number;
    cacheHitRate: number;
  } {
    const totalQueries = this.metrics.length;
    const averageLatency = totalQueries > 0
      ? this.metrics.reduce((sum, m) => sum + m.totalTimeMs, 0) / totalQueries
      : 0;
    
    const cacheHits = this.metrics.filter(m => m.cacheHitRate > 0).length;
    const cacheHitRate = totalQueries > 0 ? cacheHits / totalQueries : 0;

    return {
      totalQueries,
      averageLatency,
      cacheSize: this.queryCache.size,
      cacheHitRate
    };
  }

  /**
   * Clear query cache
   */
  clearCache(): void {
    this.queryCache.clear();
    logger.info('Query cache cleared');
  }

  /**
   * Update service configuration
   */
  updateConfig(config: Partial<GraphRAGServiceConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Configuration updated', config);
  }

  /**
   * Validate query parameters
   */
  private validateQuery(query: GraphRAGQuery): void {
    if (!query.query || query.query.trim().length === 0) {
      throw new GraphRAGError(
        GraphRAGErrorType.INVALID_QUERY,
        'Query text is required'
      );
    }

    if (!query.organizationId || query.organizationId <= 0) {
      throw new GraphRAGError(
        GraphRAGErrorType.INVALID_QUERY,
        'Valid organizationId is required'
      );
    }

    if (query.maxHops < 1 || query.maxHops > 5) {
      throw new GraphRAGError(
        GraphRAGErrorType.INVALID_QUERY,
        'maxHops must be between 1 and 5'
      );
    }

    if (query.topK < 1 || query.topK > 20) {
      throw new GraphRAGError(
        GraphRAGErrorType.INVALID_QUERY,
        'topK must be between 1 and 20'
      );
    }
  }

  /**
   * Generate cache key from query
   */
  private getCacheKey(query: GraphRAGQuery): string {
    const normalizedQuery = query.query.toLowerCase().trim();
    return `${query.organizationId}:${normalizedQuery}:${query.maxHops}:${query.topK}`;
  }

  /**
   * Get cached result if valid
   */
  private getCachedResult(query: GraphRAGQuery): GraphRAGResult | null {
    const key = this.getCacheKey(query);
    const entry = this.queryCache.get(key);

    if (!entry) return null;

    // Check if cache entry is expired
    const now = Date.now();
    const expired = (now - entry.cachedAt.getTime()) > (entry.ttl * 1000);

    if (expired) {
      this.queryCache.delete(key);
      return null;
    }

    // Update hit count
    entry.hitCount++;
    return entry.result;
  }

  /**
   * Cache query result
   */
  private cacheResult(query: GraphRAGQuery, result: GraphRAGResult): void {
    // Check cache size limit
    if (this.queryCache.size >= this.config.maxCacheSize) {
      // Remove oldest entry (LRU)
      const oldestKey = this.queryCache.keys().next().value;
      if (oldestKey) {
        this.queryCache.delete(oldestKey);
      }
    }

    const key = this.getCacheKey(query);
    const entry: GraphRAGCacheEntry = {
      key,
      result,
      cachedAt: new Date(),
      ttl: this.config.defaultCacheTtl,
      originalQuery: query.query,
      hitCount: 0
    };

    this.queryCache.set(key, entry);
  }

  /**
   * Generate answer from context nodes
   */
  private async generateAnswer(
    query: string,
    nodes: any[]
  ): Promise<string> {
    // Build context from nodes
    const context = nodes
      .slice(0, 10)  // Use top 10 nodes
      .map((n, i) => `[${i + 1}] ${n.node.name}: ${JSON.stringify(n.node.data)}`)
      .join('\n');

    // This is a placeholder - integrate with your LLM service
    // For now, return a summary of what was found
    return `Found ${nodes.length} relevant entities. ` +
      `Top result: ${nodes[0]?.node.name || 'N/A'}`;
  }

  /**
   * Enrich paths with better explanations
   */
  private enrichPaths(paths: any[], query: string): any[] {
    return paths.map(path => ({
      ...path,
      explanation: this.pathExplainer.generateExplanation(path, query)
    }));
  }

  /**
   * Generate human-readable query explanation
   */
  private generateQueryExplanation(
    query: string,
    result: GraphRAGResult
  ): string {
    const parts: string[] = [];
    
    parts.push(`Query: "${query}"`);
    parts.push(`\nFound ${result.contextNodes.length} relevant entities ` +
      `through ${result.traversedPaths.length} connection paths.`);
    
    if (result.traversedPaths.length > 0) {
      parts.push('\nTop connection paths:');
      result.traversedPaths
        .slice(0, 3)
        .forEach((path, i) => {
          parts.push(`  ${i + 1}. ${path.explanation}`);
        });
    }

    return parts.join('\n');
  }

  /**
   * Record metrics for analysis
   */
  private recordMetrics(metrics: GraphRAGMetrics): void {
    this.metrics.push(metrics);
    
    // Keep only last 1000 metrics
    if (this.metrics.length > 1000) {
      this.metrics = this.metrics.slice(-1000);
    }
  }
}

/**
 * Embedding Service Interface (placeholder)
 */
interface EmbeddingService {
  generateEmbedding(text: string): Promise<number[]>;
}
