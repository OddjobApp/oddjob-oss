/**
 * Hybrid Search Engine
 * 
 * Combines vector similarity search with graph traversal
 * to provide context-rich retrieval for RAG.
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import { graphService } from '../graph/graph-service.js';
import { 
  GraphRAGQuery, 
  HybridSearchResult, 
  SeedEntity, 
  ContextNode, 
  GraphPath,
  TraversalResult,
  CombinedScoreResult,
  TraversalConfig,
  DEFAULT_TRAVERSAL_CONFIG,
  GraphRAGMetrics,
  GraphRAGError,
  GraphRAGErrorType
} from './types.js';
import { randomUUID } from 'crypto';
import { createLogger } from '../../../../utils/logger.js';

// Initialize logger
const logger = createLogger('GraphRAG');

/**
 * Hybrid Search Engine - Vector + Graph
 */
export class HybridSearchEngine {
  private metrics: Partial<GraphRAGMetrics> = {};
  
  constructor(
    private qdrantClient: QdrantClient,
    private embeddingService: EmbeddingService
  ) {}

  /**
   * Execute hybrid search: vector + graph
   */
  async hybridSearch(
    query: GraphRAGQuery,
    queryId: string
  ): Promise<HybridSearchResult> {
    const startTime = Date.now();
    logger.info(`[${queryId}] Starting hybrid search for: "${query.query}"`);

    try {
      // 1. Vector search for seed entities
      const vectorStart = Date.now();
      const seeds = await this.vectorSearch(query);
      this.metrics.vectorSearchTimeMs = Date.now() - vectorStart;
      
      logger.info(`[${queryId}] Vector search found ${seeds.length} seeds in ${this.metrics.vectorSearchTimeMs}ms`);

      if (seeds.length === 0) {
        logger.warn(`[${queryId}] No seed entities found from vector search`);
        return {
          nodes: [],
          paths: [],
          seeds: [],
          metrics: {
            vectorSearchTimeMs: this.metrics.vectorSearchTimeMs,
            graphTraversalTimeMs: 0,
            totalNodesVisited: 0,
            totalPathsExplored: 0,
            totalEdgesTraversed: 0,
            seedCount: 0,
            resultCount: 0
          }
        };
      }

      // 2. Graph traversal from seeds
      const traversalStart = Date.now();
      let traversal: TraversalResult[] = [];
      let pythonAccelerated = false;

      try {
        const { pythonBridge } = await import("@domain/integrations/core/gateway/python.gateway.js");
        const seedIds = seeds.map(s => parseInt(s.nodeId));
        const result = await pythonBridge.traverseGraph(seedIds, { 
          maxHops: query.maxHops || 2, 
          limit: 100 
        });

        if (result && result.nodes) {
          // Map Python results back to TraversalResult format
          traversal = result.nodes.map((node: any) => ({
            nodeId: String(node.id),
            sourceId: String(node.id), // In full traversal, source might be complex, but for ranking it's the node itself
            edge: {}, // Edges are handled by buildPaths if needed
            hopDistance: node.hop || 0,
            path: [], 
            pathScore: node.structuralScore || 0,
            structuralScore: node.structuralScore
          }));
          pythonAccelerated = true;
          logger.info(`[${queryId}] Python-accelerated traversal complete in ${Date.now() - traversalStart}ms`);
        }
      } catch (err) {
        logger.warn(`[${queryId}] Python traversal failed, falling back to Node.js BFS`, { err });
      }

      if (!pythonAccelerated) {
        traversal = await this.traverseFromSeeds(query, seeds);
      }
      
      this.metrics.graphTraversalTimeMs = Date.now() - traversalStart;
      logger.info(`[${queryId}] Graph traversal found ${traversal.length} nodes in ${this.metrics.graphTraversalTimeMs}ms`);

      // 3. Combine and rank results
      const combined = this.combineScores(seeds, traversal);
      const ranked = this.rankByRelevance(combined);

      // 4. Refine ranking via Python structural analysis (PageRank)
      let refinedRanked = ranked;
      if (ranked.length > 5) {
        try {
          const { pythonBridge } = await import("@domain/integrations/core/gateway/python.gateway.js");
          const edgesForRanking = traversal.map(t => t.edge);
          const nodesForRanking = ranked.map(r => ({ id: parseInt(r.nodeId) }));
          
          const structuralScores = await pythonBridge.rankNodes(nodesForRanking, edgesForRanking);
          
          if (structuralScores) {
            // Find max structural score for normalization
            const maxStructural = Math.max(...(Object.values(structuralScores) as number[]), 0.001);

            refinedRanked = ranked.map(r => {
              const rawStructural = structuralScores[r.nodeId] || 0;
              // Normalize structural score to 0-1 range relative to this subgraph
              const normalizedStructural = rawStructural / maxStructural;
              
              return {
                ...r,
                // Harmonic mean or weighted average: 
                // 80% semantic relevance, 20% structural importance (normalized)
                combinedScore: (r.combinedScore * 0.8) + (normalizedStructural * 0.2) 
              };
            }).sort((a, b) => b.combinedScore - a.combinedScore);
            
            logger.info(`[${queryId}] Ranking refined via Python PageRank (Context size: ${ranked.length})`);
          }
        } catch (err) {
          logger.warn(`[${queryId}] Python ranking refinement failed, using default scores`, { err });
        }
      }

      // 5. Build paths for top results
      const paths = this.buildPaths(refinedRanked, traversal);

      // 6. Load full node details
      const nodes = await this.loadNodeDetails(refinedRanked, query.organizationId);

      const result: HybridSearchResult = {
        nodes,
        paths,
        seeds,
        metrics: {
          vectorSearchTimeMs: this.metrics.vectorSearchTimeMs,
          graphTraversalTimeMs: this.metrics.graphTraversalTimeMs,
          totalNodesVisited: traversal.length,
          totalPathsExplored: paths.length,
          totalEdgesTraversed: traversal.reduce((sum, t) => sum + t.path.length, 0),
          seedCount: seeds.length,
          resultCount: nodes.length
        }
      };

      logger.info(`[${queryId}] Hybrid search completed in ${Date.now() - startTime}ms, returning ${nodes.length} nodes`);
      
      return result;

    } catch (error) {
      logger.error(`[${queryId}] Hybrid search failed:`, error);
      throw new GraphRAGError(
        GraphRAGErrorType.UNKNOWN,
        `Hybrid search failed: ${(error as Error).message}`,
        queryId,
        error as Error
      );
    }
  }

  /**
   * Vector search for seed entities
   */
  private async vectorSearch(query: GraphRAGQuery): Promise<SeedEntity[]> {
    try {
      // Generate query embedding
      const embedding = await this.embeddingService.generateEmbedding(query.query);
      
      // Search Qdrant
      const results = await this.qdrantClient.search('knowledge_nodes', {
        vector: embedding,
        limit: query.topK,
        score_threshold: 0.7,  // Minimum similarity threshold
        with_payload: true,
        filter: {
          must: [
            { key: 'organization_id', match: { value: query.organizationId } },
            ...(query.entityTypes ? [{
              key: 'label',
              match: { any: query.entityTypes }
            }] : [])
          ]
        }
      });

      return results.map(r => ({
        nodeId: r.payload!.id as string,
        vectorScore: r.score,
        payload: r.payload as Record<string, any>,
        vector: r.vector as number[] | undefined
      }));

    } catch (error) {
      logger.error('Vector search failed:', error);
      throw new GraphRAGError(
        GraphRAGErrorType.VECTOR_SEARCH_FAILED,
        `Vector search failed: ${(error as Error).message}`
      );
    }
  }

  /**
   * Traverse graph from seed entities
   */
  private async traverseFromSeeds(
    query: GraphRAGQuery,
    seeds: SeedEntity[]
  ): Promise<TraversalResult[]> {
    const config: TraversalConfig = {
      ...DEFAULT_TRAVERSAL_CONFIG,
      maxHops: query.maxHops,
      minEdgeWeight: query.minRelationshipWeight,
      entityTypeFilter: query.entityTypes
    };

    const results: TraversalResult[] = [];
    const visited = new Set<string>();
    const seedIds = new Set(seeds.map(s => s.nodeId));

    // Mark seeds as visited to avoid cycles back to them
    seeds.forEach(s => visited.add(s.nodeId));

    // BFS from each seed
    let currentFrontier: Array<{ nodeId: string; path: any[]; pathScore: number; hopDistance: number }> = 
      seeds.map(s => ({ 
        nodeId: s.nodeId, 
        path: [], 
        pathScore: s.vectorScore,
        hopDistance: 0 
      }));

    for (let hop = 0; hop < config.maxHops && currentFrontier.length > 0; hop++) {
      const nextFrontier: typeof currentFrontier = [];
      const frontierIds = currentFrontier.map(f => parseInt(f.nodeId));
      
      try {
        // 1. Get ALL neighbors for the current frontier in ONE batch call
        const allNeighbors = await graphService.getNodeEdgesBatch(
          frontierIds,
          { organizationId: query.organizationId } as any,
          'both'
        );

        // 2. Group neighbors by source node ID for processing
        const neighborsBySource = new Map<string, any[]>();
        allNeighbors.forEach((neighbor: any) => {
          // Add to outgoing from source
          const srcId = String(neighbor.sourceId);
          if (!neighborsBySource.has(srcId)) neighborsBySource.set(srcId, []);
          neighborsBySource.get(srcId)!.push(neighbor);

          // Add to incoming to target (if not already handled, though getNodeEdgesBatch with 'both' returns both)
          const tgtId = String(neighbor.targetId);
          if (!neighborsBySource.has(tgtId)) neighborsBySource.set(tgtId, []);
          neighborsBySource.get(tgtId)!.push({
            ...neighbor,
            targetId: neighbor.sourceId,
            sourceId: neighbor.targetId,
            targetLabel: neighbor.sourceLabel,
            sourceLabel: neighbor.targetLabel
          });
        });

        // 3. Process each node in the frontier
        for (const frontier of currentFrontier) {
          const neighbors = neighborsBySource.get(frontier.nodeId) || [];

          // Filter by edge weight and entity type
          const validNeighbors = neighbors.filter((n: any) => {
            const meetsWeightThreshold = (n.weight || 1) >= config.minEdgeWeight;
            const meetsTypeFilter = !config.entityTypeFilter || 
              config.entityTypeFilter.includes(n.targetLabel || '');
            return meetsWeightThreshold && meetsTypeFilter;
          });

          for (const neighbor of validNeighbors) {
            // Skip if already visited (cycle detection)
            if (visited.has(String(neighbor.targetId))) {
              continue;
            }

            // Check if we've reached max nodes
            if (results.length >= config.maxTotalNodes) {
              logger.debug(`Max nodes limit reached: ${config.maxTotalNodes}`);
              return results;
            }

            visited.add(String(neighbor.targetId));

            // Calculate path score with decay
            const edgeWeight = neighbor.weight || 1;
            const distanceDecay = Math.pow(0.8, frontier.hopDistance + 1);
            const newPathScore = frontier.pathScore * edgeWeight * distanceDecay;

            // Early stopping: skip low-scoring paths
            if (config.earlyStopThreshold && newPathScore < config.earlyStopThreshold) {
              continue;
            }

            const newPath = [...frontier.path, neighbor];

            const traversalResult: TraversalResult = {
              nodeId: String(neighbor.targetId),
              sourceId: frontier.nodeId,
              edge: neighbor,
              hopDistance: frontier.hopDistance + 1,
              path: newPath,
              pathScore: newPathScore
            };

            results.push(traversalResult);

            // Add to next frontier for continued traversal
            nextFrontier.push({
              nodeId: String(neighbor.targetId),
              path: newPath,
              pathScore: newPathScore,
              hopDistance: frontier.hopDistance + 1
            });
          }
        }
      } catch (error) {
        logger.error(`Failed to process frontier at hop ${hop}:`, error);
        // We stop this hop but could potentially continue if we had partial results
      }

      currentFrontier = nextFrontier;
      
      // Check max nodes per hop
      if (currentFrontier.length > config.maxNodesPerHop) {
        logger.debug(`Limiting frontier from ${currentFrontier.length} to ${config.maxNodesPerHop}`);
        currentFrontier = currentFrontier.slice(0, config.maxNodesPerHop);
      }
    }

    return results;
  }

  /**
   * Combine vector and graph scores
   */
  private combineScores(
    vectorResults: SeedEntity[],
    graphResults: TraversalResult[]
  ): CombinedScoreResult[] {
    const combined = new Map<string, CombinedScoreResult>();

    // Add vector results (seeds)
    for (const v of vectorResults) {
      combined.set(v.nodeId, {
        nodeId: v.nodeId,
        vectorScore: v.vectorScore,
        graphScore: 0,
        combinedScore: v.vectorScore * 0.6,  // Vector weight: 60%
        hopDistance: 0,
        sources: ['vector']
      });
    }

    // Add graph results
    for (const g of graphResults) {
      const existing = combined.get(g.nodeId);
      
      if (existing) {
        // Node found via both vector and graph
        existing.graphScore = Math.max(existing.graphScore, g.pathScore);
        existing.sources = ['vector', 'traversal'];
        existing.hopDistance = Math.min(existing.hopDistance, g.hopDistance);
      } else {
        // Node found only via graph traversal
        combined.set(g.nodeId, {
          nodeId: g.nodeId,
          vectorScore: 0,
          graphScore: g.pathScore,
          combinedScore: g.pathScore * 0.4,  // Graph weight: 40%
          hopDistance: g.hopDistance,
          sources: ['traversal']
        });
      }
    }

    // Recalculate combined scores for nodes found via both
    for (const c of combined.values()) {
      if (c.sources.includes('vector') && c.sources.includes('traversal')) {
        c.combinedScore = this.calculateHybridScore(
          c.vectorScore,
          c.graphScore,
          c.hopDistance
        );
      }
    }

    return Array.from(combined.values());
  }

  /**
   * Calculate hybrid score
   */
  private calculateHybridScore(
    vectorScore: number,
    graphScore: number,
    hopDistance: number
  ): number {
    // Weight: 60% vector, 40% graph
    // Distance penalty: -10% per hop
    const distancePenalty = hopDistance * 0.1;
    const baseScore = (vectorScore * 0.6) + (graphScore * 0.4);
    return Math.max(0, baseScore - distancePenalty);
  }

  /**
   * Rank results by relevance
   */
  private rankByRelevance(
    combined: CombinedScoreResult[]
  ): CombinedScoreResult[] {
    return combined
      .filter(c => c.combinedScore > 0.2)  // Minimum relevance threshold
      .sort((a, b) => b.combinedScore - a.combinedScore)
      .slice(0, 50);  // Return top 50 results
  }

  /**
   * Build paths for top results
   */
  private buildPaths(
    ranked: CombinedScoreResult[],
    traversal: TraversalResult[]
  ): GraphPath[] {
    const paths: GraphPath[] = [];
    const processedPaths = new Set<string>();

    for (const result of ranked.slice(0, 20)) {  // Build paths for top 20
      // Find all traversal results for this node
      const nodeTraversals = traversal.filter(t => t.nodeId === result.nodeId);
      
      for (const t of nodeTraversals.slice(0, 3)) {  // Max 3 paths per node
        const pathKey = t.path.map(e => e.id).join('->');
        
        if (processedPaths.has(pathKey)) {
          continue;
        }
        processedPaths.add(pathKey);

        // Find seed for this path
        const seedId = t.path.length > 0 ? t.path[0].sourceId : t.sourceId;

        const path: GraphPath = {
          pathId: randomUUID(),
          edges: t.path,
          pathScore: t.pathScore,
          explanation: this.generatePathExplanation(t.path),
          seedNodeId: String(seedId),
          targetNodeId: t.nodeId,
          hopCount: t.hopDistance
        };

        paths.push(path);
      }
    }

    return paths.sort((a, b) => b.pathScore - a.pathScore);
  }

  /**
   * Load full node details
   */
  private async loadNodeDetails(
    ranked: CombinedScoreResult[],
    organizationId: number
  ): Promise<ContextNode[]> {
    const nodes: ContextNode[] = [];

    for (const r of ranked) {
      try {
        const node = await graphService.getNodeById(parseInt(r.nodeId), { organizationId } as any);
        
        if (!node) {
          logger.warn(`Node ${r.nodeId} not found in graph service`);
          continue;
        }

        // Find paths that led to this node
        const nodePaths = [] as GraphPath[];  // Will be populated from traversal

        nodes.push({
          node,
          relevanceScore: r.combinedScore,
          hopDistance: r.hopDistance,
          incomingPaths: nodePaths,
          discoverySource: r.sources.includes('vector') && r.sources.includes('traversal')
            ? 'both'
            : r.sources[0]
        });
      } catch (error) {
        logger.error(`Failed to load node ${r.nodeId}:`, error);
      }
    }

    return nodes;
  }

  /**
   * Generate human-readable path explanation
   */
  private generatePathExplanation(edges: any[]): string {
    if (edges.length === 0) {
      return 'Direct match from vector search';
    }

    const segments: string[] = [];
    
    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i];
      
      if (i === 0) {
        segments.push(`${edge.sourceLabel || edge.sourceId}`);
      }
      
      segments.push(`→ ${edge.relation} →`);
      segments.push(`${edge.targetLabel || edge.targetId}`);
    }

    return segments.join(' ');
  }

  /**
   * Reset metrics for new query
   */
  resetMetrics(): void {
    this.metrics = {};
  }
}

/**
 * Embedding Service Interface (placeholder)
 * Replace with actual embedding service from your codebase
 */
interface EmbeddingService {
  generateEmbedding(text: string): Promise<number[]>;
}
