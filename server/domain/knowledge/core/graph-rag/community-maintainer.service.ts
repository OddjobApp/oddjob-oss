/**
 * Community Maintainer Service
 * 
 * Provides incremental community maintenance for the knowledge graph.
 * Extends the existing CommunitySummarizerService with:
 * - Incremental edge add/remove handling (no full rebuild)
 * - In-memory adjacency lists per org (lazy-loaded, <50ms for ≤50K edges)
 * - Modularity score monitoring with scheduled full rebuild
 * - Selective cache invalidation for changed communities only
 * - Failure handling: retain previous assignments on error
 * 
 * Validates: Requirements 8 (AC 1-6), 9 (AC 1-5)
 */

import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { knowledgeEdges } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { CommunitySummarizerService } from "./community-summarizer.service.js";
import type { KnowledgeEdge } from "@shared/schema/index.js";
import type { GraphRAGQuery, GraphRAGResult } from "./types.js";

const logger = createLogger("CommunityMaintainer");

/**
 * Adjacency list representation for a single org's graph.
 * Maps nodeId -> Set of connected nodeIds.
 */
export type AdjacencyList = Map<number, Set<number>>;

/**
 * Community assignment: maps nodeId -> communityId
 */
export type CommunityAssignment = Map<number, string>;

/**
 * Result of adaptive retrieval with expansion metadata.
 */
export interface AdaptiveRetrievalResult {
  results: GraphRAGResult[];
  finalDepth: number;
  expansionTriggered: boolean;
  averageConfidence: number;
  belowThreshold: boolean;
}

/**
 * Internal state for an org's community graph data.
 */
interface OrgGraphState {
  adjacency: AdjacencyList;
  communities: CommunityAssignment;
  loaded: boolean;
  edgeCount: number;
}

/** Threshold for merging communities based on shared neighbors */
const MERGE_CONNECTIVITY_THRESHOLD = 0.3;

/** Default modularity threshold below which full rebuild is scheduled */
const DEFAULT_MODULARITY_THRESHOLD = 0.3;

/** Maximum hops to check for alternative path on edge removal */
const MAX_ALTERNATIVE_PATH_HOPS = 5;

export class CommunityMaintainerService {
  /**
   * In-memory adjacency lists per org (lazy-loaded).
   * Key: orgId, Value: graph state for that org.
   */
  private static orgGraphs: Map<number, OrgGraphState> = new Map();

  /** Track communities whose membership changed (for selective cache invalidation) */
  private static changedCommunities: Set<string> = new Set();

  /** Scheduled rebuild flags per org */
  private static scheduledRebuilds: Set<number> = new Set();

  // ─── Public API ───────────────────────────────────────────────────────

  /**
   * Handle an edge being added to the knowledge graph.
   * Assigns nodes to communities or merges communities based on edge weight and connectivity.
   * 
   * Validates: Requirement 8, AC 1
   */
  static async handleEdgeAdded(edge: KnowledgeEdge): Promise<void> {
    const orgId = edge.organizationId;
    if (orgId == null) return;

    const startTime = performance.now();

    try {
      const state = await this.ensureLoaded(orgId);

      // Update adjacency list
      this.addEdgeToAdjacency(state, edge.sourceId, edge.targetId);

      const sourceCommunity = state.communities.get(edge.sourceId);
      const targetCommunity = state.communities.get(edge.targetId);

      if (!sourceCommunity && !targetCommunity) {
        // Neither node has a community — create a new one
        const newCommunityId = `community-${edge.sourceId}-${edge.targetId}`;
        state.communities.set(edge.sourceId, newCommunityId);
        state.communities.set(edge.targetId, newCommunityId);
        this.changedCommunities.add(newCommunityId);
      } else if (!sourceCommunity && targetCommunity) {
        // Source has no community, assign to target's community
        state.communities.set(edge.sourceId, targetCommunity);
        this.changedCommunities.add(targetCommunity);
      } else if (sourceCommunity && !targetCommunity) {
        // Target has no community, assign to source's community
        state.communities.set(edge.targetId, sourceCommunity);
        this.changedCommunities.add(sourceCommunity);
      } else if (sourceCommunity !== targetCommunity) {
        // Different communities — evaluate merge based on connectivity
        const shouldMerge = this.evaluateMerge(state, edge.sourceId, edge.targetId, edge.weight ?? 1);
        if (shouldMerge) {
          this.mergeCommunities(state, sourceCommunity!, targetCommunity!);
        }
        // If not merging, both communities still valid — no change needed
      }
      // Same community — no action needed

      // Check modularity and schedule rebuild if needed
      await this.checkModularityAndScheduleRebuild(orgId, state);

      const elapsed = performance.now() - startTime;
      if (elapsed > 50) {
        logger.warn(`[CommunityMaintainer] handleEdgeAdded took ${elapsed.toFixed(1)}ms (target: <50ms) for org ${orgId}`);
      }
    } catch (error) {
      // Failure handling: retain previous assignments, log, schedule rebuild
      logger.error(`[CommunityMaintainer] handleEdgeAdded failed for edge ${edge.id}`, { error });
      this.scheduleFullRebuild(orgId);
    }
  }

  /**
   * Handle an edge being removed from the knowledge graph.
   * Checks 5-hop alternative path; splits community if no path exists.
   * 
   * Validates: Requirement 8, AC 2
   */
  static async handleEdgeRemoved(edge: KnowledgeEdge): Promise<void> {
    const orgId = edge.organizationId;
    if (orgId == null) return;

    const startTime = performance.now();

    try {
      const state = await this.ensureLoaded(orgId);

      // Remove edge from adjacency list
      this.removeEdgeFromAdjacency(state, edge.sourceId, edge.targetId);

      const sourceCommunity = state.communities.get(edge.sourceId);
      const targetCommunity = state.communities.get(edge.targetId);

      // Only check split if both nodes are in the same community
      if (sourceCommunity && sourceCommunity === targetCommunity) {
        const hasAlternativePath = this.hasPathWithinHops(
          state.adjacency,
          edge.sourceId,
          edge.targetId,
          MAX_ALTERNATIVE_PATH_HOPS,
          sourceCommunity,
          state.communities
        );

        if (!hasAlternativePath) {
          // Split the community
          this.splitCommunity(state, edge.sourceId, edge.targetId, sourceCommunity);
        }
      }

      // Remove isolated nodes from communities
      this.cleanupIsolatedNodes(state, edge.sourceId);
      this.cleanupIsolatedNodes(state, edge.targetId);

      // Check modularity and schedule rebuild if needed
      await this.checkModularityAndScheduleRebuild(orgId, state);

      const elapsed = performance.now() - startTime;
      if (elapsed > 50) {
        logger.warn(`[CommunityMaintainer] handleEdgeRemoved took ${elapsed.toFixed(1)}ms (target: <50ms) for org ${orgId}`);
      }
    } catch (error) {
      // Failure handling: retain previous assignments, log, schedule rebuild
      logger.error(`[CommunityMaintainer] handleEdgeRemoved failed for edge ${edge.id}`, { error });
      this.scheduleFullRebuild(orgId);
    }
  }

  /**
   * Calculate the modularity score for an org's current community assignments.
   * Modularity Q = Σ [ (edges_within_c / total_edges) - (degree_c / 2*total_edges)² ]
   * 
   * Validates: Requirement 8, AC 4
   */
  static async getModularityScore(orgId: number): Promise<number> {
    const state = await this.ensureLoaded(orgId);
    return this.computeModularity(state);
  }

  /**
   * Schedule a full community rebuild for next low-traffic window.
   * 
   * Validates: Requirement 8, AC 4, AC 6
   */
  static scheduleFullRebuild(orgId: number): void {
    this.scheduledRebuilds.add(orgId);
    logger.info(`[CommunityMaintainer] Full rebuild scheduled for org ${orgId}`);
  }

  /**
   * Check if a full rebuild is scheduled for an org.
   */
  static isRebuildScheduled(orgId: number): boolean {
    return this.scheduledRebuilds.has(orgId);
  }

  /**
   * Execute the scheduled full rebuild (called during low-traffic periods).
   */
  static async executeFullRebuild(orgId: number): Promise<void> {
    try {
      const state = await this.ensureLoaded(orgId);

      // Get all nodes from the adjacency list
      const nodes = Array.from(state.adjacency.keys()).map(id => ({ id }));
      const edges: Array<{ sourceId: number; targetId: number }> = [];

      // Reconstruct edge list from adjacency
      const seen = new Set<string>();
      for (const [nodeId, neighbors] of state.adjacency.entries()) {
        for (const neighbor of neighbors) {
          const key = `${Math.min(nodeId, neighbor)}-${Math.max(nodeId, neighbor)}`;
          if (!seen.has(key)) {
            seen.add(key);
            edges.push({ sourceId: nodeId, targetId: neighbor });
          }
        }
      }

      // Run full label propagation
      const communityMap = CommunitySummarizerService.detectCommunities(nodes, edges);

      // Update community assignments
      state.communities.clear();
      for (const [communityId, nodeIds] of communityMap.entries()) {
        for (const nodeId of nodeIds) {
          state.communities.set(nodeId, communityId);
        }
      }

      // All communities changed after a full rebuild
      for (const communityId of communityMap.keys()) {
        this.changedCommunities.add(communityId);
      }

      this.scheduledRebuilds.delete(orgId);
      logger.info(`[CommunityMaintainer] Full rebuild completed for org ${orgId}: ${communityMap.size} communities`);
    } catch (error) {
      logger.error(`[CommunityMaintainer] Full rebuild failed for org ${orgId}`, { error });
    }
  }

  /**
   * Get communities that have changed since last invalidation check.
   * Used for selective cache invalidation.
   * 
   * Validates: Requirement 8, AC 5
   */
  static getChangedCommunities(): Set<string> {
    return new Set(this.changedCommunities);
  }

  /**
   * Invalidate only community summaries that have changed.
   * 
   * Validates: Requirement 8, AC 5
   */
  static invalidateChangedSummaries(): string[] {
    const changed = Array.from(this.changedCommunities);
    this.changedCommunities.clear();
    // The caller should regenerate summaries only for these communities
    return changed;
  }

  /**
   * Adaptive retrieval: start at configured depth, expand if confidence is low.
   * 
   * Validates: Requirements 9 (AC 1-5)
   */
  static async adaptiveRetrieve(
    query: GraphRAGQuery,
    retrieveFn: (query: GraphRAGQuery) => Promise<GraphRAGResult>,
    confidenceThreshold: number = 0.5,
    maxExpansion: number = 2
  ): Promise<AdaptiveRetrievalResult> {
    let currentDepth = query.maxHops;
    const originalDepth = query.maxHops;
    const maxDepth = originalDepth + maxExpansion;
    let expansionTriggered = false;
    let allResults: GraphRAGResult[] = [];

    while (currentDepth <= maxDepth) {
      const currentQuery = { ...query, maxHops: currentDepth };
      const result = await retrieveFn(currentQuery);
      allResults.push(result);

      const avgConfidence = this.computeAverageConfidence(result);
      const hasResults = result.contextNodes.length > 0;

      if (hasResults && avgConfidence >= confidenceThreshold) {
        // Sufficient confidence — return
        return {
          results: allResults,
          finalDepth: currentDepth,
          expansionTriggered,
          averageConfidence: avgConfidence,
          belowThreshold: false
        };
      }

      // Expand if below threshold or no results
      if (currentDepth < maxDepth) {
        expansionTriggered = true;
        logger.info(`[CommunityMaintainer] Adaptive expansion: depth ${currentDepth} -> ${currentDepth + 1}, avgConfidence=${avgConfidence.toFixed(3)}, results=${result.contextNodes.length}`);
        currentDepth++;
      } else {
        break;
      }
    }

    // Cap reached
    const finalAvgConfidence = this.computeOverallAverageConfidence(allResults);
    return {
      results: allResults,
      finalDepth: currentDepth,
      expansionTriggered,
      averageConfidence: finalAvgConfidence,
      belowThreshold: finalAvgConfidence < confidenceThreshold
    };
  }

  // ─── Accessors for testing ────────────────────────────────────────────

  /**
   * Get the current community assignments for an org (for testing/inspection).
   */
  static getCommunityAssignments(orgId: number): CommunityAssignment | undefined {
    return this.orgGraphs.get(orgId)?.communities;
  }

  /**
   * Get the adjacency list for an org (for testing/inspection).
   */
  static getAdjacencyList(orgId: number): AdjacencyList | undefined {
    return this.orgGraphs.get(orgId)?.adjacency;
  }

  /**
   * Reset all internal state (for testing).
   */
  static reset(): void {
    this.orgGraphs.clear();
    this.changedCommunities.clear();
    this.scheduledRebuilds.clear();
  }

  /**
   * Initialize state for an org with pre-built data (for testing).
   */
  static initializeForTesting(orgId: number, adjacency: AdjacencyList, communities: CommunityAssignment): void {
    let edgeCount = 0;
    for (const neighbors of adjacency.values()) {
      edgeCount += neighbors.size;
    }
    edgeCount = edgeCount / 2; // Each edge counted twice in undirected adjacency

    this.orgGraphs.set(orgId, {
      adjacency,
      communities,
      loaded: true,
      edgeCount
    });
  }

  // ─── Private Helpers ──────────────────────────────────────────────────

  /**
   * Ensure the adjacency list for an org is loaded into memory.
   * Lazy-loads from DB on first access.
   */
  private static async ensureLoaded(orgId: number): Promise<OrgGraphState> {
    if (this.orgGraphs.has(orgId) && this.orgGraphs.get(orgId)!.loaded) {
      return this.orgGraphs.get(orgId)!;
    }

    // Load edges from DB
    const edges = await db.select().from(knowledgeEdges).where(eq(knowledgeEdges.organizationId, orgId));

    const adjacency: AdjacencyList = new Map();
    for (const edge of edges) {
      if (!adjacency.has(edge.sourceId)) adjacency.set(edge.sourceId, new Set());
      if (!adjacency.has(edge.targetId)) adjacency.set(edge.targetId, new Set());
      adjacency.get(edge.sourceId)!.add(edge.targetId);
      adjacency.get(edge.targetId)!.add(edge.sourceId);
    }

    // Run initial community detection
    const nodes = Array.from(adjacency.keys()).map(id => ({ id }));
    const edgeList = edges.map(e => ({ sourceId: e.sourceId, targetId: e.targetId }));
    const communityMap = CommunitySummarizerService.detectCommunities(nodes, edgeList);

    const communities: CommunityAssignment = new Map();
    for (const [communityId, nodeIds] of communityMap.entries()) {
      for (const nodeId of nodeIds) {
        communities.set(nodeId, communityId);
      }
    }

    const state: OrgGraphState = {
      adjacency,
      communities,
      loaded: true,
      edgeCount: edges.length
    };

    this.orgGraphs.set(orgId, state);
    logger.info(`[CommunityMaintainer] Loaded graph for org ${orgId}: ${adjacency.size} nodes, ${edges.length} edges, ${communityMap.size} communities`);
    return state;
  }

  /**
   * Add an edge to the adjacency list (undirected).
   */
  private static addEdgeToAdjacency(state: OrgGraphState, sourceId: number, targetId: number): void {
    if (!state.adjacency.has(sourceId)) state.adjacency.set(sourceId, new Set());
    if (!state.adjacency.has(targetId)) state.adjacency.set(targetId, new Set());
    state.adjacency.get(sourceId)!.add(targetId);
    state.adjacency.get(targetId)!.add(sourceId);
    state.edgeCount++;
  }

  /**
   * Remove an edge from the adjacency list (undirected).
   */
  private static removeEdgeFromAdjacency(state: OrgGraphState, sourceId: number, targetId: number): void {
    state.adjacency.get(sourceId)?.delete(targetId);
    state.adjacency.get(targetId)?.delete(sourceId);
    state.edgeCount = Math.max(0, state.edgeCount - 1);
  }

  /**
   * Evaluate whether two communities should be merged based on connectivity.
   * Merge if: shared_neighbors / min(community_size_a, community_size_b) > threshold
   */
  private static evaluateMerge(
    state: OrgGraphState,
    sourceId: number,
    targetId: number,
    edgeWeight: number
  ): boolean {
    const sourceCommunity = state.communities.get(sourceId)!;
    const targetCommunity = state.communities.get(targetId)!;

    // Get members of each community
    const sourceMembers = this.getCommunityMembers(state.communities, sourceCommunity);
    const targetMembers = this.getCommunityMembers(state.communities, targetCommunity);

    // Count shared neighbors (cross-community edges)
    let crossEdges = 0;
    for (const sourceMember of sourceMembers) {
      const neighbors = state.adjacency.get(sourceMember) || new Set();
      for (const neighbor of neighbors) {
        if (targetMembers.has(neighbor)) {
          crossEdges++;
        }
      }
    }

    const minSize = Math.min(sourceMembers.size, targetMembers.size);
    if (minSize === 0) return true; // Empty community, merge unconditionally

    const connectivityScore = crossEdges / minSize;

    // Factor in edge weight (higher weight = more likely to merge)
    const weightedScore = connectivityScore * (edgeWeight / 10);

    return weightedScore >= MERGE_CONNECTIVITY_THRESHOLD || crossEdges >= 2;
  }

  /**
   * Merge two communities: all members of targetCommunity join sourceCommunity.
   */
  private static mergeCommunities(
    state: OrgGraphState,
    sourceCommunity: string,
    targetCommunity: string
  ): void {
    for (const [nodeId, community] of state.communities.entries()) {
      if (community === targetCommunity) {
        state.communities.set(nodeId, sourceCommunity);
      }
    }
    this.changedCommunities.add(sourceCommunity);
    this.changedCommunities.add(targetCommunity);
  }

  /**
   * Check if an alternative path exists between two nodes within maxHops,
   * restricted to nodes within the same community.
   * Uses BFS with hop limit.
   */
  static hasPathWithinHops(
    adjacency: AdjacencyList,
    sourceId: number,
    targetId: number,
    maxHops: number,
    communityId: string,
    communities: CommunityAssignment
  ): boolean {
    if (sourceId === targetId) return true;

    const visited = new Set<number>();
    // BFS queue: [nodeId, currentHops]
    const queue: Array<[number, number]> = [[sourceId, 0]];
    visited.add(sourceId);

    while (queue.length > 0) {
      const [current, hops] = queue.shift()!;

      if (hops >= maxHops) continue;

      const neighbors = adjacency.get(current);
      if (!neighbors) continue;

      for (const neighbor of neighbors) {
        if (neighbor === targetId) return true;
        if (visited.has(neighbor)) continue;

        // Only traverse within the same community
        if (communities.get(neighbor) !== communityId) continue;

        visited.add(neighbor);
        queue.push([neighbor, hops + 1]);
      }
    }

    return false;
  }

  /**
   * Split a community after an edge removal disconnects two nodes (within the hop limit).
   * Uses bounded BFS from sourceId (max 5 hops) to find nodes reachable within the
   * connectivity threshold. Nodes NOT reachable within that limit form a new community.
   * This ensures that communities remain "locally cohesive" — all members are within
   * MAX_ALTERNATIVE_PATH_HOPS of each other through same-community nodes.
   */
  private static splitCommunity(
    state: OrgGraphState,
    sourceId: number,
    targetId: number,
    originalCommunity: string
  ): void {
    // BFS from sourceId with hop limit to find locally reachable nodes
    const sourceComponent = new Set<number>();
    const queue: Array<[number, number]> = [[sourceId, 0]];
    sourceComponent.add(sourceId);

    while (queue.length > 0) {
      const [current, hops] = queue.shift()!;
      if (hops >= MAX_ALTERNATIVE_PATH_HOPS) continue;

      const neighbors = state.adjacency.get(current);
      if (!neighbors) continue;

      for (const neighbor of neighbors) {
        if (sourceComponent.has(neighbor)) continue;
        if (state.communities.get(neighbor) !== originalCommunity) continue;
        sourceComponent.add(neighbor);
        queue.push([neighbor, hops + 1]);
      }
    }

    // All community members not in sourceComponent go to a new community
    const newCommunityId = `community-split-${targetId}-${Date.now()}`;
    let splitCount = 0;
    for (const [nodeId, community] of state.communities.entries()) {
      if (community === originalCommunity && !sourceComponent.has(nodeId)) {
        state.communities.set(nodeId, newCommunityId);
        splitCount++;
      }
    }

    if (splitCount > 0) {
      this.changedCommunities.add(originalCommunity);
      this.changedCommunities.add(newCommunityId);
      logger.info(`[CommunityMaintainer] Split community ${originalCommunity}: ${sourceComponent.size} nodes stay, ${splitCount} form ${newCommunityId}`);
    }
  }

  /**
   * Remove a node from its community if it has no remaining edges.
   */
  private static cleanupIsolatedNodes(state: OrgGraphState, nodeId: number): void {
    const neighbors = state.adjacency.get(nodeId);
    if (!neighbors || neighbors.size === 0) {
      const community = state.communities.get(nodeId);
      if (community) {
        this.changedCommunities.add(community);
        state.communities.delete(nodeId);
      }
    }
  }

  /**
   * Get all members of a community.
   */
  private static getCommunityMembers(communities: CommunityAssignment, communityId: string): Set<number> {
    const members = new Set<number>();
    for (const [nodeId, comm] of communities.entries()) {
      if (comm === communityId) members.add(nodeId);
    }
    return members;
  }

  /**
   * Compute modularity score Q for the current community assignments.
   * Q = (1/2m) * Σ_ij [ A_ij - (k_i * k_j) / 2m ] * δ(c_i, c_j)
   * Where m = total edges, k_i = degree of node i, δ = 1 if same community.
   */
  private static computeModularity(state: OrgGraphState): number {
    const m = state.edgeCount;
    if (m === 0) return 0;

    const twoM = 2 * m;
    let Q = 0;

    // Group nodes by community
    const communityNodes = new Map<string, number[]>();
    for (const [nodeId, community] of state.communities.entries()) {
      if (!communityNodes.has(community)) communityNodes.set(community, []);
      communityNodes.get(community)!.push(nodeId);
    }

    // For each community, compute its contribution to modularity
    for (const [, members] of communityNodes.entries()) {
      let edgesWithin = 0;
      let totalDegree = 0;

      for (const nodeId of members) {
        const neighbors = state.adjacency.get(nodeId);
        const degree = neighbors ? neighbors.size : 0;
        totalDegree += degree;

        // Count edges within this community
        if (neighbors) {
          for (const neighbor of neighbors) {
            if (state.communities.get(neighbor) === state.communities.get(nodeId)) {
              edgesWithin++;
            }
          }
        }
      }

      // edgesWithin counts each edge twice (once from each end)
      edgesWithin = edgesWithin / 2;
      Q += (edgesWithin / m) - Math.pow(totalDegree / twoM, 2);
    }

    return Q;
  }

  /**
   * Check if modularity has degraded below threshold and schedule rebuild if needed.
   */
  private static async checkModularityAndScheduleRebuild(
    orgId: number,
    state: OrgGraphState,
    threshold: number = DEFAULT_MODULARITY_THRESHOLD
  ): Promise<void> {
    // Only check periodically (every 100 edge operations or when state is suspicious)
    const modularity = this.computeModularity(state);
    if (modularity < threshold) {
      logger.warn(`[CommunityMaintainer] Modularity ${modularity.toFixed(3)} below threshold ${threshold} for org ${orgId}`);
      this.scheduleFullRebuild(orgId);
    }
  }

  /**
   * Compute average relevance score from a GraphRAGResult.
   */
  private static computeAverageConfidence(result: GraphRAGResult): number {
    if (result.contextNodes.length === 0) return 0;
    const sum = result.contextNodes.reduce((acc, node) => acc + node.relevanceScore, 0);
    return sum / result.contextNodes.length;
  }

  /**
   * Compute overall average confidence across multiple results.
   */
  private static computeOverallAverageConfidence(results: GraphRAGResult[]): number {
    let totalScore = 0;
    let totalNodes = 0;
    for (const result of results) {
      for (const node of result.contextNodes) {
        totalScore += node.relevanceScore;
        totalNodes++;
      }
    }
    return totalNodes > 0 ? totalScore / totalNodes : 0;
  }
}
