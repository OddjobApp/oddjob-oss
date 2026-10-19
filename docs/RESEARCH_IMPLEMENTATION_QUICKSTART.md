# Priority 1 Research Implementation - Quick Start Guide

**For**: Development Team  
**Start Date**: Week of May 5, 2026  
**Goal**: Begin Graph RAG implementation (Sprint 1)

---

## This Week's Objectives

### Day 1-2: Environment Setup & Project Structure

#### 1. Create Feature Branch
```bash
git checkout -b feature/graph-rag-implementation
git push -u origin feature/graph-rag-implementation
```

#### 2. Create Directory Structure
```bash
# Create Graph RAG directories
mkdir -p server/domain/knowledge/core/graph-rag/tests
mkdir -p server/domain/agents/core/constitutional-ai/tests
mkdir -p server/domain/agents/core/multimodal/tests
mkdir -p server/domain/agents/core/speculative/tests

# Create shared types directory
mkdir -p shared/types/research
```

#### 3. Install Dependencies
```bash
# Qdrant client (if not already installed)
npm install @qdrant/js-client-rest

# Additional utilities
npm install uuid hash-wasm
npm install -D @types/uuid
```

### Day 3: Core Types Definition

#### File: `server/domain/knowledge/core/graph-rag/types.ts`

Create this file with the core interfaces:

```typescript
// Graph RAG Query Types
export interface GraphRAGQuery {
  query: string;
  organizationId: number;
  maxHops: number;              // 1-3 hops (default: 2)
  topK: number;                 // Vector search seeds (default: 5)
  traversalStrategy: 'bfs' | 'dfs' | 'bidirectional';
  entityTypes?: string[];       // Filter: ['Ticket', 'Feature', 'Person']
  minRelationshipWeight: number; // Edge weight threshold
  includePaths: boolean;        // Return explanation paths
}

export interface GraphRAGResult {
  answer: string;               // Generated answer
  contextNodes: ContextNode[];  // Retrieved knowledge nodes
  traversedPaths: GraphPath[];  // Explanation trails
  metrics: GraphRAGMetrics;
}

export interface ContextNode {
  node: KnowledgeNode;
  relevanceScore: number;       // Combined vector + graph score
  hopDistance: number;          // Distance from seed entities
  incomingPaths: GraphPath[];   // How we reached this node
}

export interface GraphPath {
  edges: KnowledgeEdge[];
  pathScore: number;
  explanation: string;          // Human-readable path description
}

export interface GraphRAGMetrics {
  vectorSearchTimeMs: number;
  graphTraversalTimeMs: number;
  totalNodesVisited: number;
  totalPathsExplored: number;
  cacheHitRate: number;
}
```

### Day 4-5: Hybrid Search Engine Foundation

#### File: `server/domain/knowledge/core/graph-rag/hybrid-search.engine.ts`

**Starter Implementation**:

```typescript
import { GraphRAGQuery, ContextNode, GraphPath } from './types';
import { GraphService } from '../graph/graph-service';
import { QdrantClient } from '@qdrant/js-client-rest';

export class HybridSearchEngine {
  constructor(
    private qdrantClient: QdrantClient,
    private graphService: GraphService
  ) {}

  async hybridSearch(query: GraphRAGQuery): Promise<HybridSearchResult> {
    const startTime = Date.now();
    
    // 1. Vector search for seed entities
    const vectorResults = await this.vectorSearch(query);
    
    // 2. Graph traversal from seeds
    const graphResults = await this.traverseFromSeeds(
      vectorResults,
      query.maxHops,
      query.traversalStrategy
    );
    
    // 3. Combine and rank results
    const combined = this.combineScores(vectorResults, graphResults);
    const ranked = this.rankByRelevance(combined);
    
    return {
      nodes: ranked,
      metrics: {
        totalTimeMs: Date.now() - startTime,
        vectorResults: vectorResults.length,
        graphNodesExplored: graphResults.length
      }
    };
  }

  private async vectorSearch(
    query: GraphRAGQuery
  ): Promise<VectorSearchResult[]> {
    // Use existing Qdrant integration
    const results = await this.qdrantClient.search('knowledge_nodes', {
      vector: await this.getQueryEmbedding(query.query),
      limit: query.topK,
      filter: {
        must: [
          { key: 'organization_id', match: { value: query.organizationId } }
        ]
      }
    });
    
    return results.map(r => ({
      nodeId: r.payload!.id as string,
      score: r.score,
      payload: r.payload!
    }));
  }

  private async traverseFromSeeds(
    seeds: VectorSearchResult[],
    maxHops: number,
    strategy: string
  ): Promise<TraversalResult[]> {
    // TODO: Implement BFS/DFS traversal
    // For now, return direct neighbors
    const results: TraversalResult[] = [];
    
    for (const seed of seeds) {
      const neighbors = await this.graphService.getNodeNeighbors(
        seed.nodeId,
        1  // 1 hop for now
      );
      
      results.push(...neighbors.map(n => ({
        nodeId: n.targetId,
        sourceId: seed.nodeId,
        edge: n,
        hopDistance: 1
      })));
    }
    
    return results;
  }

  private combineScores(
    vectorResults: VectorSearchResult[],
    graphResults: TraversalResult[]
  ): CombinedResult[] {
    // TODO: Implement hybrid scoring
    // For now, simple concatenation with deduplication
    const combined = new Map<string, CombinedResult>();
    
    // Add vector results
    for (const v of vectorResults) {
      combined.set(v.nodeId, {
        nodeId: v.nodeId,
        vectorScore: v.score,
        graphScore: 0,
        hopDistance: 0,
        combinedScore: v.score
      });
    }
    
    // Add graph results
    for (const g of graphResults) {
      const existing = combined.get(g.nodeId);
      if (existing) {
        existing.graphScore = 0.5;  // Base score for graph match
        existing.hopDistance = g.hopDistance;
        existing.combinedScore = this.calculateHybridScore(
          existing.vectorScore,
          existing.graphScore,
          g.hopDistance
        );
      } else {
        combined.set(g.nodeId, {
          nodeId: g.nodeId,
          vectorScore: 0,
          graphScore: 0.5,
          hopDistance: g.hopDistance,
          combinedScore: this.calculateHybridScore(0, 0.5, g.hopDistance)
        });
      }
    }
    
    return Array.from(combined.values());
  }

  private calculateHybridScore(
    vectorScore: number,
    graphScore: number,
    hopDistance: number
  ): number {
    // Weight: 60% vector, 40% graph
    // Penalty for distance: -10% per hop
    const distancePenalty = hopDistance * 0.1;
    return (vectorScore * 0.6) + (graphScore * 0.4) - distancePenalty;
  }

  private rankByRelevance(
    combined: CombinedResult[]
  ): ContextNode[] {
    return combined
      .sort((a, b) => b.combinedScore - a.combinedScore)
      .map(c => ({
        node: { id: c.nodeId } as KnowledgeNode,
        relevanceScore: c.combinedScore,
        hopDistance: c.hopDistance,
        incomingPaths: []
      }));
  }

  private async getQueryEmbedding(query: string): Promise<number[]> {
    // TODO: Integrate with existing embedding service
    // For now, return mock embedding
    return new Array(1536).fill(0).map(() => Math.random());
  }
}

// Types for internal use
interface VectorSearchResult {
  nodeId: string;
  score: number;
  payload: Record<string, any>;
}

interface TraversalResult {
  nodeId: string;
  sourceId: string;
  edge: KnowledgeEdge;
  hopDistance: number;
}

interface CombinedResult {
  nodeId: string;
  vectorScore: number;
  graphScore: number;
  hopDistance: number;
  combinedScore: number;
}

interface HybridSearchResult {
  nodes: ContextNode[];
  metrics: {
    totalTimeMs: number;
    vectorResults: number;
    graphNodesExplored: number;
  };
}
```

---

## Week 2 Goals

### Continue with Path Traversal Service

#### File: `server/domain/knowledge/core/graph-rag/path-traversal.service.ts`

**Next Steps**:
1. Implement BFS algorithm with early stopping
2. Add cycle detection
3. Implement path scoring
4. Add parallel traversal for performance

### Add Path Explanation

#### File: `server/domain/knowledge/core/graph-rag/path-explainer.service.ts`

```typescript
export class PathExplainerService {
  generateExplanation(path: GraphPath): string {
    // Convert graph path to natural language
    // Example: "Ticket PROJ-123 → reported by → Alice → manages → Team Alpha"
    
    const segments: string[] = [];
    for (let i = 0; i < path.edges.length; i++) {
      const edge = path.edges[i];
      if (i === 0) {
        segments.push(edge.sourceLabel || edge.sourceId);
      }
      segments.push(`→ ${edge.relation} →`);
      segments.push(edge.targetLabel || edge.targetId);
    }
    
    return segments.join(' ');
  }
  
  generateCitation(path: GraphPath): string {
    // Generate citation for attribution
    const sources = path.edges.map(e => e.sourceId);
    const targets = path.edges.map(e => e.targetId);
    const allNodes = [...new Set([...sources, ...targets])];
    
    return `Based on knowledge graph paths: ${allNodes.join(', ')}`;
  }
}
```

---

## Testing Strategy

### Unit Tests: `server/domain/knowledge/core/graph-rag/tests/hybrid-search.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { HybridSearchEngine } from '../hybrid-search.engine';

describe('HybridSearchEngine', () => {
  let engine: HybridSearchEngine;
  
  beforeEach(() => {
    engine = new HybridSearchEngine(
      mockQdrantClient,
      mockGraphService
    );
  });
  
  it('should combine vector and graph scores', async () => {
    const query: GraphRAGQuery = {
      query: 'What features are related to ticket PROJ-123?',
      organizationId: 1,
      maxHops: 2,
      topK: 5,
      traversalStrategy: 'bfs',
      minRelationshipWeight: 0.5,
      includePaths: true
    };
    
    const result = await engine.hybridSearch(query);
    
    expect(result.nodes).toHaveLength greaterThan(0);
    expect(result.metrics.totalTimeMs).toBeLessThan(1000);
  });
  
  it('should penalize distant nodes', () => {
    const score1 = engine.calculateHybridScore(0.9, 0.5, 1);
    const score2 = engine.calculateHybridScore(0.9, 0.5, 2);
    
    expect(score1).toBeGreaterThan(score2);
  });
});
```

---

## Integration Checklist

### Week 1 Deliverables
- [ ] Project structure created
- [ ] Core types defined
- [ ] Hybrid search engine skeleton
- [ ] Unit tests passing
- [ ] Code review completed

### Week 2 Deliverables
- [ ] BFS/DFS traversal implemented
- [ ] Path explanation service
- [ ] API routes added
- [ ] Integration tests
- [ ] Performance benchmarks

### Week 3 Deliverables
- [ ] Full Graph RAG service
- [ ] Caching layer
- [ ] Error handling
- [ ] Documentation
- [ ] Staging deployment

---

## Daily Standup Questions

1. What did you complete yesterday?
2. What will you work on today?
3. Any blockers or help needed?

## Common Issues & Solutions

### Issue: Qdrant Connection Errors
**Solution**: Check Qdrant URL in environment variables:
```bash
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=your_key_here
```

### Issue: Graph Service Not Returning Neighbors
**Solution**: Verify graph schema and edge table:
```sql
-- Check if edges exist
SELECT COUNT(*) FROM knowledge_edges 
WHERE source_id = 'your-test-node-id';
```

### Issue: Embeddings Not Generated
**Solution**: Ensure OpenAI API key is set:
```bash
OPENAI_API_KEY=sk-...
```

---

## Resources

### Documentation
- [GraphRAG Paper](https://arxiv.org/abs/2404.16130)
- [Qdrant Documentation](https://qdrant.tech/documentation/)
- [BFS/DFS Algorithms](https://en.wikipedia.org/wiki/Graph_traversal)

### Code References
- Existing Graph Service: `server/domain/knowledge/core/graph/graph-service.ts`
- Existing Qdrant Integration: `server/domain/knowledge/core/indexing/qdrant-publisher.ts`
- Knowledge Routes: `server/domain/knowledge/knowledge.route.ts`

### Team Contacts
- Tech Lead: [Your Name]
- ML Engineer: [Name]
- Product Manager: [Name]

---

## Sprint Schedule

| Week | Focus | Key Deliverable | Demo Date |
|------|-------|----------------|-----------|
| 1 | Graph RAG Foundation | Hybrid search working | May 9 |
| 2 | Path Traversal | Multi-hop queries | May 16 |
| 3 | Integration & Optimization | Full Graph RAG service | May 23 |
| 4 | Constitutional AI | Safety layer prototype | May 30 |
| 5 | Constitution Framework | 3+ principles working | June 6 |
| 6 | CI Integration | Agent safety deployed | June 13 |
| 7 | Multi-Modal Vision | Image analysis working | June 20 |
| 8 | Document Processing | PDF/Word extraction | June 27 |
| 9 | Visual Selenium | Smart selectors | July 4 |
| 10 | Speculative Planning | MCTS prototype | July 11 |
| 11 | Rollback & Recovery | Self-healing agents | July 18 |
| 12 | Final Integration | All features working | July 25 |

---

## Success Criteria

### Week 1 Success
- Hybrid search engine compiles without errors
- Unit tests pass (coverage >70%)
- Can perform basic vector + graph combination

### Sprint 1 Success (Week 3)
- Graph RAG API responds in <500ms (p95)
- 2-3 hop traversal working
- Path explanations generated
- Integration with existing knowledge system

---

**Questions?** Post in #research-implementation Slack channel or tag @tech-lead

**Ready to code?** Start with `types.ts` and work through Week 1 tasks above.

Good luck! 🚀
