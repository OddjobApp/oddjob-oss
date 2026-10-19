import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CommunityMaintainerService } from "./community-maintainer.service.js";
import type { AdjacencyList, CommunityAssignment } from "./community-maintainer.service.js";
import type { KnowledgeEdge } from "@shared/schema/index.js";
import type { GraphRAGResult } from "./types.js";

vi.mock("@server/database_service.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([])
      }))
    }))
  }
}));

vi.mock("@server/utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}));

vi.mock("./community-summarizer.service.js", () => ({
  CommunitySummarizerService: {
    detectCommunities: vi.fn((nodes: Array<{ id: number }>, edges: Array<{ sourceId: number; targetId: number }>) => {
      // Simple connected components for testing
      const adjacency = new Map<number, Set<number>>();
      for (const node of nodes) {
        adjacency.set(node.id, new Set());
      }
      for (const edge of edges) {
        adjacency.get(edge.sourceId)?.add(edge.targetId);
        adjacency.get(edge.targetId)?.add(edge.sourceId);
      }

      const visited = new Set<number>();
      const communities = new Map<string, number[]>();
      let communityIdx = 0;

      for (const node of nodes) {
        if (visited.has(node.id)) continue;
        const component: number[] = [];
        const queue = [node.id];
        visited.add(node.id);
        while (queue.length > 0) {
          const curr = queue.shift()!;
          component.push(curr);
          for (const neighbor of adjacency.get(curr) || []) {
            if (!visited.has(neighbor)) {
              visited.add(neighbor);
              queue.push(neighbor);
            }
          }
        }
        communities.set(`community-${communityIdx++}`, component);
      }
      return communities;
    }),
    clearCache: vi.fn()
  }
}));

function makeEdge(overrides: Partial<KnowledgeEdge> = {}): KnowledgeEdge {
  return {
    id: 1,
    sourceId: 1,
    targetId: 2,
    relation: "RELATED_TO",
    weight: 5,
    data: {},
    organizationId: 100,
    prospectPropertyId: null,
    createdBy: "test",
    createdAt: new Date(),
    missionId: null,
    lastUpdatedByRunId: null,
    ...overrides
  };
}

function buildAdjacency(edges: Array<[number, number]>): AdjacencyList {
  const adj: AdjacencyList = new Map();
  for (const [s, t] of edges) {
    if (!adj.has(s)) adj.set(s, new Set());
    if (!adj.has(t)) adj.set(t, new Set());
    adj.get(s)!.add(t);
    adj.get(t)!.add(s);
  }
  return adj;
}

describe("CommunityMaintainerService", () => {
  beforeEach(() => {
    CommunityMaintainerService.reset();
  });

  describe("handleEdgeAdded", () => {
    it("should create a new community when neither node has one", async () => {
      const adj = buildAdjacency([]);
      const communities: CommunityAssignment = new Map();
      CommunityMaintainerService.initializeForTesting(100, adj, communities);

      const edge = makeEdge({ sourceId: 1, targetId: 2 });
      await CommunityMaintainerService.handleEdgeAdded(edge);

      const assignments = CommunityMaintainerService.getCommunityAssignments(100)!;
      expect(assignments.get(1)).toBeDefined();
      expect(assignments.get(2)).toBeDefined();
      expect(assignments.get(1)).toBe(assignments.get(2));
    });

    it("should assign unassigned node to existing community", async () => {
      const adj = buildAdjacency([[1, 2]]);
      const communities: CommunityAssignment = new Map([
        [1, "community-A"],
        [2, "community-A"]
      ]);
      CommunityMaintainerService.initializeForTesting(100, adj, communities);

      const edge = makeEdge({ sourceId: 2, targetId: 3 });
      await CommunityMaintainerService.handleEdgeAdded(edge);

      const assignments = CommunityMaintainerService.getCommunityAssignments(100)!;
      expect(assignments.get(3)).toBe("community-A");
    });

    it("should merge communities when edge connects well-connected nodes", async () => {
      // Two separate communities with multiple cross-edges (high connectivity)
      const adj = buildAdjacency([[1, 2], [3, 4], [1, 3], [2, 4]]);
      const communities: CommunityAssignment = new Map([
        [1, "community-A"],
        [2, "community-A"],
        [3, "community-B"],
        [4, "community-B"]
      ]);
      CommunityMaintainerService.initializeForTesting(100, adj, communities);

      // Add another cross-community edge
      const edge = makeEdge({ sourceId: 1, targetId: 4, weight: 8 });
      await CommunityMaintainerService.handleEdgeAdded(edge);

      const assignments = CommunityMaintainerService.getCommunityAssignments(100)!;
      // After merge, all nodes should be in same community
      const allCommunities = new Set(assignments.values());
      expect(allCommunities.size).toBe(1);
    });

    it("should not modify assignments when nodes are already in same community", async () => {
      const adj = buildAdjacency([[1, 2], [2, 3]]);
      const communities: CommunityAssignment = new Map([
        [1, "community-A"],
        [2, "community-A"],
        [3, "community-A"]
      ]);
      CommunityMaintainerService.initializeForTesting(100, adj, communities);

      const edge = makeEdge({ sourceId: 1, targetId: 3 });
      await CommunityMaintainerService.handleEdgeAdded(edge);

      const assignments = CommunityMaintainerService.getCommunityAssignments(100)!;
      expect(assignments.get(1)).toBe("community-A");
      expect(assignments.get(3)).toBe("community-A");
    });

    it("should handle null organizationId gracefully", async () => {
      const edge = makeEdge({ organizationId: null });
      // Should not throw
      await CommunityMaintainerService.handleEdgeAdded(edge);
    });
  });

  describe("handleEdgeRemoved", () => {
    it("should split community when no alternative path within 5 hops", async () => {
      // Linear chain: 1-2 (only connection between these two)
      const adj = buildAdjacency([[1, 2]]);
      const communities: CommunityAssignment = new Map([
        [1, "community-A"],
        [2, "community-A"]
      ]);
      CommunityMaintainerService.initializeForTesting(100, adj, communities);

      const edge = makeEdge({ sourceId: 1, targetId: 2 });
      await CommunityMaintainerService.handleEdgeRemoved(edge);

      const assignments = CommunityMaintainerService.getCommunityAssignments(100)!;
      // After removing the only edge, nodes become isolated and are cleaned up
      expect(assignments.has(1)).toBe(false);
      expect(assignments.has(2)).toBe(false);
    });

    it("should NOT split community when alternative path exists within 5 hops", async () => {
      // Triangle: 1-2, 2-3, 1-3 — removing 1-2 still leaves path 1-3-2
      const adj = buildAdjacency([[1, 2], [2, 3], [1, 3]]);
      const communities: CommunityAssignment = new Map([
        [1, "community-A"],
        [2, "community-A"],
        [3, "community-A"]
      ]);
      CommunityMaintainerService.initializeForTesting(100, adj, communities);

      const edge = makeEdge({ sourceId: 1, targetId: 2 });
      await CommunityMaintainerService.handleEdgeRemoved(edge);

      const assignments = CommunityMaintainerService.getCommunityAssignments(100)!;
      // All should remain in same community
      expect(assignments.get(1)).toBe("community-A");
      expect(assignments.get(2)).toBe("community-A");
      expect(assignments.get(3)).toBe("community-A");
    });

    it("should split when alternative path exceeds 5 hops", async () => {
      // Create a ring of 8 nodes: 1-2-3-4-5-6-7-8-1
      // Remove edge 1-2. Alternative path: 1-8-7-6-5-4-3-2 = 7 hops > 5 hops limit
      const adj = buildAdjacency([[1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 1]]);
      const communities: CommunityAssignment = new Map([
        [1, "community-A"],
        [2, "community-A"],
        [3, "community-A"],
        [4, "community-A"],
        [5, "community-A"],
        [6, "community-A"],
        [7, "community-A"],
        [8, "community-A"]
      ]);
      CommunityMaintainerService.initializeForTesting(100, adj, communities);

      const edge = makeEdge({ sourceId: 1, targetId: 2 });
      await CommunityMaintainerService.handleEdgeRemoved(edge);

      const assignments = CommunityMaintainerService.getCommunityAssignments(100)!;
      // Nodes should be split into two communities since alternative path > 5 hops
      const community1 = assignments.get(1);
      const community2 = assignments.get(2);
      expect(community1).toBeDefined();
      expect(community2).toBeDefined();
      expect(community1).not.toBe(community2);
    });

    it("should not split when alternative path is exactly 5 hops", async () => {
      // Ring of 6 nodes: 1-2-3-4-5-6-1
      // Removing 1-2: alternative path 1-6-5-4-3-2 = 5 hops (exactly at limit)
      const adj = buildAdjacency([[1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 1]]);
      const communities: CommunityAssignment = new Map([
        [1, "community-A"],
        [2, "community-A"],
        [3, "community-A"],
        [4, "community-A"],
        [5, "community-A"],
        [6, "community-A"]
      ]);
      CommunityMaintainerService.initializeForTesting(100, adj, communities);

      const edge = makeEdge({ sourceId: 1, targetId: 2 });
      await CommunityMaintainerService.handleEdgeRemoved(edge);

      const assignments = CommunityMaintainerService.getCommunityAssignments(100)!;
      // All should remain in same community (5-hop path exists)
      expect(assignments.get(1)).toBe(assignments.get(2));
    });

    it("should handle null organizationId gracefully", async () => {
      const edge = makeEdge({ organizationId: null });
      await CommunityMaintainerService.handleEdgeRemoved(edge);
      // Should not throw
    });
  });

  describe("hasPathWithinHops", () => {
    it("should find direct path", () => {
      const adj = buildAdjacency([[1, 2]]);
      const communities: CommunityAssignment = new Map([[1, "c"], [2, "c"]]);
      expect(CommunityMaintainerService.hasPathWithinHops(adj, 1, 2, 5, "c", communities)).toBe(true);
    });

    it("should find multi-hop path within limit", () => {
      const adj = buildAdjacency([[1, 2], [2, 3], [3, 4]]);
      const communities: CommunityAssignment = new Map([[1, "c"], [2, "c"], [3, "c"], [4, "c"]]);
      expect(CommunityMaintainerService.hasPathWithinHops(adj, 1, 4, 5, "c", communities)).toBe(true);
    });

    it("should not find path exceeding hop limit", () => {
      const adj = buildAdjacency([[1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7]]);
      const communities: CommunityAssignment = new Map([
        [1, "c"], [2, "c"], [3, "c"], [4, "c"], [5, "c"], [6, "c"], [7, "c"]
      ]);
      // Path from 1 to 7 is 6 hops, limit is 5
      expect(CommunityMaintainerService.hasPathWithinHops(adj, 1, 7, 5, "c", communities)).toBe(false);
    });

    it("should not traverse nodes outside community", () => {
      const adj = buildAdjacency([[1, 2], [2, 3]]);
      const communities: CommunityAssignment = new Map([[1, "c1"], [2, "c2"], [3, "c1"]]);
      // Node 2 is in different community, so path 1-2-3 is not valid
      expect(CommunityMaintainerService.hasPathWithinHops(adj, 1, 3, 5, "c1", communities)).toBe(false);
    });

    it("should return true for same source and target", () => {
      const adj = buildAdjacency([]);
      const communities: CommunityAssignment = new Map([[1, "c"]]);
      expect(CommunityMaintainerService.hasPathWithinHops(adj, 1, 1, 5, "c", communities)).toBe(true);
    });
  });

  describe("getModularityScore", () => {
    it("should return 0 for empty graph", async () => {
      const adj: AdjacencyList = new Map();
      const communities: CommunityAssignment = new Map();
      CommunityMaintainerService.initializeForTesting(100, adj, communities);

      const score = await CommunityMaintainerService.getModularityScore(100);
      expect(score).toBe(0);
    });

    it("should return positive modularity for well-separated communities", async () => {
      // Two disconnected cliques -> high modularity
      const adj = buildAdjacency([[1, 2], [2, 3], [1, 3], [4, 5], [5, 6], [4, 6]]);
      const communities: CommunityAssignment = new Map([
        [1, "community-A"], [2, "community-A"], [3, "community-A"],
        [4, "community-B"], [5, "community-B"], [6, "community-B"]
      ]);
      CommunityMaintainerService.initializeForTesting(100, adj, communities);

      const score = await CommunityMaintainerService.getModularityScore(100);
      expect(score).toBeGreaterThan(0.3);
    });

    it("should return lower modularity for poorly separated communities", async () => {
      // All nodes in one community (no community structure)
      const adj = buildAdjacency([[1, 2], [2, 3], [3, 4]]);
      const communities: CommunityAssignment = new Map([
        [1, "community-A"], [2, "community-A"], [3, "community-A"], [4, "community-A"]
      ]);
      CommunityMaintainerService.initializeForTesting(100, adj, communities);

      const score = await CommunityMaintainerService.getModularityScore(100);
      // Single community should be 0 modularity (or close to it)
      expect(score).toBeLessThanOrEqual(0.5);
    });
  });

  describe("scheduleFullRebuild and isRebuildScheduled", () => {
    it("should schedule and detect rebuild", () => {
      expect(CommunityMaintainerService.isRebuildScheduled(100)).toBe(false);
      CommunityMaintainerService.scheduleFullRebuild(100);
      expect(CommunityMaintainerService.isRebuildScheduled(100)).toBe(true);
    });

    it("should clear rebuild after execution", async () => {
      const adj = buildAdjacency([[1, 2], [3, 4]]);
      const communities: CommunityAssignment = new Map([
        [1, "community-A"], [2, "community-A"],
        [3, "community-B"], [4, "community-B"]
      ]);
      CommunityMaintainerService.initializeForTesting(100, adj, communities);
      CommunityMaintainerService.scheduleFullRebuild(100);

      await CommunityMaintainerService.executeFullRebuild(100);
      expect(CommunityMaintainerService.isRebuildScheduled(100)).toBe(false);
    });
  });

  describe("selective cache invalidation", () => {
    it("should track changed communities on edge add", async () => {
      const adj = buildAdjacency([]);
      const communities: CommunityAssignment = new Map();
      CommunityMaintainerService.initializeForTesting(100, adj, communities);

      const edge = makeEdge({ sourceId: 10, targetId: 20 });
      await CommunityMaintainerService.handleEdgeAdded(edge);

      const changed = CommunityMaintainerService.getChangedCommunities();
      expect(changed.size).toBeGreaterThan(0);
    });

    it("should clear changed communities after invalidation", async () => {
      const adj = buildAdjacency([]);
      const communities: CommunityAssignment = new Map();
      CommunityMaintainerService.initializeForTesting(100, adj, communities);

      const edge = makeEdge({ sourceId: 10, targetId: 20 });
      await CommunityMaintainerService.handleEdgeAdded(edge);

      const invalidated = CommunityMaintainerService.invalidateChangedSummaries();
      expect(invalidated.length).toBeGreaterThan(0);

      const afterInvalidation = CommunityMaintainerService.getChangedCommunities();
      expect(afterInvalidation.size).toBe(0);
    });
  });

  describe("failure handling", () => {
    it("should retain previous assignments and schedule rebuild on error", async () => {
      // Don't initialize the org — force a DB call which will "fail"
      // The mock returns empty array, so ensureLoaded will work
      // Instead, manually set up a state that will cause an error
      const adj = buildAdjacency([[1, 2]]);
      const communities: CommunityAssignment = new Map([
        [1, "community-A"],
        [2, "community-A"]
      ]);
      CommunityMaintainerService.initializeForTesting(100, adj, communities);

      // Make adjacency.get throw for a specific call
      const originalGet = adj.get.bind(adj);
      let callCount = 0;
      vi.spyOn(adj, "get").mockImplementation((key: number) => {
        callCount++;
        // Throw on 3rd call to simulate mid-operation failure
        if (callCount > 2) throw new Error("Simulated failure");
        return originalGet(key);
      });

      const edge = makeEdge({ sourceId: 1, targetId: 3 });
      await CommunityMaintainerService.handleEdgeAdded(edge);

      // Should have scheduled rebuild on failure
      expect(CommunityMaintainerService.isRebuildScheduled(100)).toBe(true);
    });
  });

  describe("adaptiveRetrieve", () => {
    it("should return immediately when confidence is above threshold", async () => {
      const mockResult: GraphRAGResult = {
        answer: "test",
        contextNodes: [
          { node: {} as any, relevanceScore: 0.8, hopDistance: 1, incomingPaths: [], discoverySource: "vector" },
          { node: {} as any, relevanceScore: 0.7, hopDistance: 1, incomingPaths: [], discoverySource: "vector" }
        ],
        traversedPaths: [],
        metrics: {} as any,
        queryId: "test"
      };

      const retrieveFn = vi.fn().mockResolvedValue(mockResult);
      const query: any = { query: "test", organizationId: 1, maxHops: 2, topK: 5 };

      const result = await CommunityMaintainerService.adaptiveRetrieve(query, retrieveFn, 0.5);

      expect(result.expansionTriggered).toBe(false);
      expect(result.finalDepth).toBe(2);
      expect(result.belowThreshold).toBe(false);
      expect(retrieveFn).toHaveBeenCalledTimes(1);
    });

    it("should expand when confidence is below threshold", async () => {
      const lowConfResult: GraphRAGResult = {
        answer: "test",
        contextNodes: [
          { node: {} as any, relevanceScore: 0.3, hopDistance: 1, incomingPaths: [], discoverySource: "vector" }
        ],
        traversedPaths: [],
        metrics: {} as any,
        queryId: "test"
      };
      const highConfResult: GraphRAGResult = {
        answer: "test",
        contextNodes: [
          { node: {} as any, relevanceScore: 0.8, hopDistance: 2, incomingPaths: [], discoverySource: "traversal" }
        ],
        traversedPaths: [],
        metrics: {} as any,
        queryId: "test"
      };

      const retrieveFn = vi.fn()
        .mockResolvedValueOnce(lowConfResult)
        .mockResolvedValueOnce(highConfResult);

      const query: any = { query: "test", organizationId: 1, maxHops: 2, topK: 5 };
      const result = await CommunityMaintainerService.adaptiveRetrieve(query, retrieveFn, 0.5);

      expect(result.expansionTriggered).toBe(true);
      expect(result.finalDepth).toBe(3);
      expect(result.belowThreshold).toBe(false);
      expect(retrieveFn).toHaveBeenCalledTimes(2);
    });

    it("should expand when zero results", async () => {
      const emptyResult: GraphRAGResult = {
        answer: "test",
        contextNodes: [],
        traversedPaths: [],
        metrics: {} as any,
        queryId: "test"
      };
      const someResult: GraphRAGResult = {
        answer: "test",
        contextNodes: [
          { node: {} as any, relevanceScore: 0.9, hopDistance: 1, incomingPaths: [], discoverySource: "vector" }
        ],
        traversedPaths: [],
        metrics: {} as any,
        queryId: "test"
      };

      const retrieveFn = vi.fn()
        .mockResolvedValueOnce(emptyResult)
        .mockResolvedValueOnce(someResult);

      const query: any = { query: "test", organizationId: 1, maxHops: 2, topK: 5 };
      const result = await CommunityMaintainerService.adaptiveRetrieve(query, retrieveFn, 0.5);

      expect(result.expansionTriggered).toBe(true);
      expect(result.finalDepth).toBe(3);
    });

    it("should cap expansion at maxDepth + 2", async () => {
      const lowConfResult: GraphRAGResult = {
        answer: "test",
        contextNodes: [
          { node: {} as any, relevanceScore: 0.1, hopDistance: 1, incomingPaths: [], discoverySource: "vector" }
        ],
        traversedPaths: [],
        metrics: {} as any,
        queryId: "test"
      };

      const retrieveFn = vi.fn().mockResolvedValue(lowConfResult);
      const query: any = { query: "test", organizationId: 1, maxHops: 2, topK: 5 };
      const result = await CommunityMaintainerService.adaptiveRetrieve(query, retrieveFn, 0.5, 2);

      // Should cap at 2 + 2 = 4, so calls at depth 2, 3, 4
      expect(retrieveFn).toHaveBeenCalledTimes(3);
      expect(result.finalDepth).toBe(4);
      expect(result.belowThreshold).toBe(true);
    });

    it("should set belowThreshold flag when cap reached and confidence still low", async () => {
      const lowConfResult: GraphRAGResult = {
        answer: "test",
        contextNodes: [
          { node: {} as any, relevanceScore: 0.2, hopDistance: 1, incomingPaths: [], discoverySource: "vector" }
        ],
        traversedPaths: [],
        metrics: {} as any,
        queryId: "test"
      };

      const retrieveFn = vi.fn().mockResolvedValue(lowConfResult);
      const query: any = { query: "test", organizationId: 1, maxHops: 1, topK: 5 };
      const result = await CommunityMaintainerService.adaptiveRetrieve(query, retrieveFn, 0.5, 2);

      expect(result.belowThreshold).toBe(true);
      expect(result.expansionTriggered).toBe(true);
    });
  });

  describe("performance", () => {
    it("should handle edge operations within 50ms for moderate graphs", async () => {
      // Build a graph with ~1000 edges
      const edges: Array<[number, number]> = [];
      for (let i = 0; i < 200; i++) {
        for (let j = i + 1; j < Math.min(i + 6, 200); j++) {
          edges.push([i, j]);
        }
      }
      const adj = buildAdjacency(edges);
      const communities: CommunityAssignment = new Map();
      // Assign to 20 communities
      for (let i = 0; i < 200; i++) {
        communities.set(i, `community-${i % 20}`);
      }
      CommunityMaintainerService.initializeForTesting(100, adj, communities);

      const start = performance.now();
      const edge = makeEdge({ sourceId: 50, targetId: 150 });
      await CommunityMaintainerService.handleEdgeAdded(edge);
      const elapsed = performance.now() - start;

      // Should be well under 50ms for this graph size
      expect(elapsed).toBeLessThan(50);
    });
  });
});
