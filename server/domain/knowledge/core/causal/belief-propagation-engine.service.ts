import { db } from "@server/database_service.js";
import { knowledgeNodes, knowledgeEdges } from "@shared/schema/index.js";
import type { KnowledgeEdge } from "@shared/schema/index.js";
import { eq, and, count } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("BeliefPropagationEngine");

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Metadata stored in knowledgeEdges.data JSONB column for causal edges.
 */
export interface CausalEdgeMetadata {
    causalStrength: number;            // 0.0–1.0
    propagationDirection: "forward" | "backward";
    lagDurationSeconds: number;        // 0–86400
}

/**
 * Parameters for creating a causal edge between two knowledge nodes.
 */
export interface CreateCausalEdgeParams {
    sourceNodeId: number;
    targetNodeId: number;
    organizationId: number;
    causalStrength: number;            // 0.0–1.0
    propagationDirection: "forward" | "backward";
    lagDurationSeconds: number;        // 0–86400
}

/**
 * A causal edge is a KnowledgeEdge with relation "CAUSES" and CausalEdgeMetadata in its data column.
 */
export type CausalEdge = KnowledgeEdge;

/**
 * Result type for causal edge creation errors.
 */
export interface CausalEdgeError {
    success: false;
    error: string;
}

/**
 * Result type for successful causal edge creation.
 */
export interface CausalEdgeSuccess {
    success: true;
    edge: CausalEdge;
}

export type CreateCausalEdgeResult = CausalEdgeSuccess | CausalEdgeError;

// ─── Propagation Types (stubs for future tasks 3.3 and 4.1) ─────────────────

export interface PropagationOptions {
    maxHops?: number;           // default 3, max 10
    minConfidence?: number;     // default 0.1
}

export interface PropagationResult {
    affectedNodes: Array<{
        nodeId: number;
        cumulativeConfidence: number;
        hopDistance: number;
    }>;
    cycleWarning?: { path: number[]; brokenEdgeId: number };
}

export interface CounterfactualQuery {
    targetNodeId: number;
    hypotheticalState: Record<string, any>;
    organizationId: number;
    maxHops?: number;
}

export interface CounterfactualResult {
    affectedNodes: Array<{
        nodeId: number;
        projectedState: Record<string, any>;
        cumulativeConfidence: number;
        hopDistance: number;
    }>;
    cycleWarning?: { path: number[]; brokenEdgeId: number };
    computationDurationMs: number;
    graphSizeExceeded: boolean;
}

/**
 * Error result returned when a counterfactual query references a target node
 * that does not exist or does not belong to the requesting organization.
 */
export interface CounterfactualError {
    error: string;
}

export type CounterfactualQueryResult = CounterfactualResult | CounterfactualError;

/**
 * Type guard to check if a CounterfactualQueryResult is an error.
 */
export function isCounterfactualError(result: CounterfactualQueryResult): result is CounterfactualError {
    return "error" in result;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export const beliefPropagationEngine = {
    /**
     * Creates a causal edge between two knowledge nodes.
     *
     * Validates:
     *   - source and target are not the same node
     *   - both nodes exist in the database
     *   - both nodes belong to the specified organization
     *
     * Stores the edge in knowledgeEdges with relation="CAUSES" and metadata in the data JSONB column.
     */
    async createCausalEdge(params: CreateCausalEdgeParams): Promise<CreateCausalEdgeResult> {
        const {
            sourceNodeId,
            targetNodeId,
            organizationId,
            causalStrength,
            propagationDirection,
            lagDurationSeconds,
        } = params;

        // Validate: source ≠ target
        if (sourceNodeId === targetNodeId) {
            return { success: false, error: "source and target nodes must be different" };
        }

        // Fetch both nodes
        const [sourceNode] = await db
            .select()
            .from(knowledgeNodes)
            .where(eq(knowledgeNodes.id, sourceNodeId))
            .limit(1);

        const [targetNode] = await db
            .select()
            .from(knowledgeNodes)
            .where(eq(knowledgeNodes.id, targetNodeId))
            .limit(1);

        // Validate: both nodes exist
        if (!sourceNode) {
            return { success: false, error: "source node does not exist" };
        }
        if (!targetNode) {
            return { success: false, error: "target node does not exist" };
        }

        // Validate: both nodes belong to the same organization
        if (sourceNode.organizationId !== organizationId) {
            return { success: false, error: "nodes must belong to the same organization" };
        }
        if (targetNode.organizationId !== organizationId) {
            return { success: false, error: "nodes must belong to the same organization" };
        }

        // Build causal edge metadata
        const metadata: CausalEdgeMetadata = {
            causalStrength,
            propagationDirection,
            lagDurationSeconds,
        };

        // Insert edge with relation="CAUSES"
        const [edge] = await db
            .insert(knowledgeEdges)
            .values({
                sourceId: sourceNodeId,
                targetId: targetNodeId,
                relation: "CAUSES",
                weight: 1,
                data: metadata,
                organizationId,
            })
            .returning();

        logger.info("Causal edge created", {
            edgeId: edge.id,
            source: sourceNodeId,
            target: targetNodeId,
            causalStrength,
            propagationDirection,
            lagDurationSeconds,
        });

        return { success: true, edge };
    },

    /**
     * Propagates belief state changes along causal edges from a given node.
     *
     * Uses BFS traversal along CAUSES edges, attenuating confidence by multiplying
     * the running confidence by each edge's causalStrength at every hop.
     * Stops when cumulative confidence < minConfidence or maxHops is reached.
     *
     * Cycle detection: when a neighbor is already in the visited set, the cycle path
     * is reconstructed. The edge with the lowest causalStrength (earliest createdAt
     * as tiebreaker) is identified as the break point and that edge is not traversed.
     * A warning is logged and the cycleWarning field is populated in the result.
     */
    async propagate(
        nodeId: number,
        orgId: number,
        options?: PropagationOptions,
    ): Promise<PropagationResult> {
        const maxHops = Math.min(options?.maxHops ?? 3, 10); // default 3, cap at 10
        const minConfidence = options?.minConfidence ?? 0.1;

        // Fetch the starting node's confidence score
        const [startNode] = await db
            .select()
            .from(knowledgeNodes)
            .where(eq(knowledgeNodes.id, nodeId))
            .limit(1);

        if (!startNode) {
            logger.warn("Propagation requested for non-existent node", { nodeId });
            return { affectedNodes: [] };
        }

        const initialConfidence = startNode.confidenceScore
            ? parseFloat(startNode.confidenceScore)
            : 1.0;

        // Fetch all CAUSES edges for the organization
        const causalEdges = await db
            .select()
            .from(knowledgeEdges)
            .where(
                and(
                    eq(knowledgeEdges.relation, "CAUSES"),
                    eq(knowledgeEdges.organizationId, orgId),
                ),
            );

        // Build adjacency list: sourceId -> list of edges with full metadata
        interface AdjacencyEntry {
            edgeId: number;
            targetId: number;
            causalStrength: number;
            createdAt: Date | null;
        }
        const adjacency = new Map<number, AdjacencyEntry[]>();
        for (const edge of causalEdges) {
            const metadata = edge.data as CausalEdgeMetadata | null;
            const causalStrength = metadata?.causalStrength ?? 0;
            if (!adjacency.has(edge.sourceId)) {
                adjacency.set(edge.sourceId, []);
            }
            adjacency.get(edge.sourceId)!.push({
                edgeId: edge.id,
                targetId: edge.targetId,
                causalStrength,
                createdAt: edge.createdAt,
            });
        }

        // BFS traversal with cycle detection
        const affectedNodes: Array<{
            nodeId: number;
            cumulativeConfidence: number;
            hopDistance: number;
        }> = [];

        const visited = new Set<number>();
        visited.add(nodeId);

        // Track the parent edge for each visited node to reconstruct cycle paths
        // parentMap: childNodeId -> { parentNodeId, edge used to reach child }
        const parentMap = new Map<number, { parentNodeId: number; edge: AdjacencyEntry }>();

        // Set of edge IDs that have been broken due to cycle detection
        const brokenEdges = new Set<number>();

        // Only report the first cycle warning found
        let cycleWarning: { path: number[]; brokenEdgeId: number } | undefined;

        // Queue entries: [nodeId, currentConfidence, hopDistance]
        let currentLevel: Array<[number, number, number]> = [[nodeId, initialConfidence, 0]];

        while (currentLevel.length > 0) {
            const nextLevel: Array<[number, number, number]> = [];

            for (const [currentNodeId, currentConfidence, hopDistance] of currentLevel) {
                // Don't exceed maxHops
                if (hopDistance >= maxHops) {
                    continue;
                }

                const neighbors = adjacency.get(currentNodeId) || [];
                for (const edgeEntry of neighbors) {
                    const { edgeId, targetId, causalStrength } = edgeEntry;

                    // Skip edges that have been broken due to cycle detection
                    if (brokenEdges.has(edgeId)) {
                        continue;
                    }

                    if (visited.has(targetId)) {
                        // Cycle detected! Reconstruct the cycle path.
                        // The cycle is: targetId -> ... -> currentNodeId -> targetId
                        const cyclePath: number[] = [targetId];
                        let traceNode = currentNodeId;
                        while (traceNode !== targetId) {
                            cyclePath.push(traceNode);
                            const parent = parentMap.get(traceNode);
                            if (!parent) {
                                // traceNode is the start node or path is incomplete
                                break;
                            }
                            traceNode = parent.parentNodeId;
                        }
                        cyclePath.push(targetId); // close the cycle
                        cyclePath.reverse();

                        // Collect all edges along the cycle path
                        interface CycleEdgeInfo {
                            edgeId: number;
                            causalStrength: number;
                            createdAt: Date | null;
                        }
                        const cycleEdges: CycleEdgeInfo[] = [];

                        // Add the edge that caused the cycle (currentNodeId -> targetId)
                        cycleEdges.push({
                            edgeId,
                            causalStrength,
                            createdAt: edgeEntry.createdAt,
                        });

                        // Add edges from the path using parentMap
                        let pathNode = currentNodeId;
                        while (pathNode !== targetId) {
                            const parent = parentMap.get(pathNode);
                            if (!parent) break;
                            cycleEdges.push({
                                edgeId: parent.edge.edgeId,
                                causalStrength: parent.edge.causalStrength,
                                createdAt: parent.edge.createdAt,
                            });
                            pathNode = parent.parentNodeId;
                        }

                        // Find the edge with the lowest causalStrength
                        // Tiebreaker: earliest createdAt
                        let weakestEdge = cycleEdges[0];
                        for (let i = 1; i < cycleEdges.length; i++) {
                            const candidate = cycleEdges[i];
                            if (
                                candidate.causalStrength < weakestEdge.causalStrength ||
                                (candidate.causalStrength === weakestEdge.causalStrength &&
                                    candidate.createdAt != null &&
                                    (weakestEdge.createdAt == null ||
                                        candidate.createdAt.getTime() < weakestEdge.createdAt.getTime()))
                            ) {
                                weakestEdge = candidate;
                            }
                        }

                        // Break the cycle at the weakest edge
                        brokenEdges.add(weakestEdge.edgeId);

                        // Log warning with cycle path and broken edge
                        logger.warn("Propagation cycle detected and broken", {
                            cyclePath: cyclePath,
                            brokenEdgeId: weakestEdge.edgeId,
                            brokenEdgeCausalStrength: weakestEdge.causalStrength,
                        });

                        // Set cycle warning (only record the first one)
                        if (!cycleWarning) {
                            cycleWarning = {
                                path: cyclePath,
                                brokenEdgeId: weakestEdge.edgeId,
                            };
                        }

                        continue;
                    }

                    const newConfidence = currentConfidence * causalStrength;

                    // Stop if confidence falls below threshold
                    if (newConfidence < minConfidence) {
                        continue;
                    }

                    visited.add(targetId);
                    parentMap.set(targetId, { parentNodeId: currentNodeId, edge: edgeEntry });
                    const newHopDistance = hopDistance + 1;

                    affectedNodes.push({
                        nodeId: targetId,
                        cumulativeConfidence: newConfidence,
                        hopDistance: newHopDistance,
                    });

                    nextLevel.push([targetId, newConfidence, newHopDistance]);
                }
            }

            currentLevel = nextLevel;
        }

        logger.info("Belief propagation completed", {
            startNodeId: nodeId,
            orgId,
            maxHops,
            minConfidence,
            affectedCount: affectedNodes.length,
            cycleDetected: !!cycleWarning,
        });

        const result: PropagationResult = { affectedNodes };
        if (cycleWarning) {
            result.cycleWarning = cycleWarning;
        }
        return result;
    },

    /**
     * Computes a counterfactual query without modifying actual graph state.
     *
     * Operates in-memory on a subgraph fetched once. Uses the same BFS traversal
     * and cycle detection algorithm as propagate, but never writes to the database.
     * Returns projected downstream impact including affected nodes, projected states,
     * cumulative confidence, computation duration, and graph size flag.
     *
     * Validates that the target node exists and belongs to the requesting organization.
     * Returns a CounterfactualError if validation fails.
     */
    async counterfactual(query: CounterfactualQuery): Promise<CounterfactualQueryResult> {
        const startTime = performance.now();

        const { targetNodeId, hypotheticalState, organizationId, maxHops: rawMaxHops } = query;
        const maxHops = Math.min(rawMaxHops ?? 3, 10);
        const minConfidence = 0.1;

        // Fetch the target node to validate existence and organization membership
        const [targetNode] = await db
            .select()
            .from(knowledgeNodes)
            .where(eq(knowledgeNodes.id, targetNodeId))
            .limit(1);

        if (!targetNode) {
            logger.warn("Counterfactual query for non-existent node", { targetNodeId, organizationId });
            return { error: "node not found" };
        }

        if (targetNode.organizationId !== organizationId) {
            logger.warn("Counterfactual query for node not belonging to requesting organization", {
                targetNodeId,
                requestingOrgId: organizationId,
                nodeOrgId: targetNode.organizationId,
            });
            return { error: "node not accessible" };
        }

        const initialConfidence = targetNode.confidenceScore
            ? parseFloat(targetNode.confidenceScore)
            : 1.0;

        // Fetch all CAUSES edges for the organization (in-memory subgraph)
        const causalEdges = await db
            .select()
            .from(knowledgeEdges)
            .where(
                and(
                    eq(knowledgeEdges.relation, "CAUSES"),
                    eq(knowledgeEdges.organizationId, organizationId),
                ),
            );

        // Build adjacency list: sourceId -> list of edges
        interface AdjacencyEntry {
            edgeId: number;
            targetId: number;
            causalStrength: number;
            createdAt: Date | null;
        }
        const adjacency = new Map<number, AdjacencyEntry[]>();
        for (const edge of causalEdges) {
            const metadata = edge.data as CausalEdgeMetadata | null;
            const causalStrength = metadata?.causalStrength ?? 0;
            if (!adjacency.has(edge.sourceId)) {
                adjacency.set(edge.sourceId, []);
            }
            adjacency.get(edge.sourceId)!.push({
                edgeId: edge.id,
                targetId: edge.targetId,
                causalStrength,
                createdAt: edge.createdAt,
            });
        }

        // BFS traversal with cycle detection (same algorithm as propagate)
        const affectedNodes: Array<{
            nodeId: number;
            projectedState: Record<string, any>;
            cumulativeConfidence: number;
            hopDistance: number;
        }> = [];

        const visited = new Set<number>();
        visited.add(targetNodeId);

        // Track the parent edge for each visited node to reconstruct cycle paths
        const parentMap = new Map<number, { parentNodeId: number; edge: AdjacencyEntry }>();

        // Set of edge IDs that have been broken due to cycle detection
        const brokenEdges = new Set<number>();

        // Only report the first cycle warning found
        let cycleWarning: { path: number[]; brokenEdgeId: number } | undefined;

        // Queue entries: [nodeId, currentConfidence, hopDistance]
        let currentLevel: Array<[number, number, number]> = [[targetNodeId, initialConfidence, 0]];

        while (currentLevel.length > 0) {
            const nextLevel: Array<[number, number, number]> = [];

            for (const [currentNodeId, currentConfidence, hopDistance] of currentLevel) {
                if (hopDistance >= maxHops) {
                    continue;
                }

                const neighbors = adjacency.get(currentNodeId) || [];
                for (const edgeEntry of neighbors) {
                    const { edgeId, targetId, causalStrength } = edgeEntry;

                    // Skip edges that have been broken due to cycle detection
                    if (brokenEdges.has(edgeId)) {
                        continue;
                    }

                    if (visited.has(targetId)) {
                        // Cycle detected — reconstruct cycle path
                        const cyclePath: number[] = [targetId];
                        let traceNode = currentNodeId;
                        while (traceNode !== targetId) {
                            cyclePath.push(traceNode);
                            const parent = parentMap.get(traceNode);
                            if (!parent) break;
                            traceNode = parent.parentNodeId;
                        }
                        cyclePath.push(targetId);
                        cyclePath.reverse();

                        // Collect all edges along the cycle path
                        interface CycleEdgeInfo {
                            edgeId: number;
                            causalStrength: number;
                            createdAt: Date | null;
                        }
                        const cycleEdges: CycleEdgeInfo[] = [];

                        // Edge that caused the cycle
                        cycleEdges.push({
                            edgeId,
                            causalStrength,
                            createdAt: edgeEntry.createdAt,
                        });

                        // Edges from the path using parentMap
                        let pathNode = currentNodeId;
                        while (pathNode !== targetId) {
                            const parent = parentMap.get(pathNode);
                            if (!parent) break;
                            cycleEdges.push({
                                edgeId: parent.edge.edgeId,
                                causalStrength: parent.edge.causalStrength,
                                createdAt: parent.edge.createdAt,
                            });
                            pathNode = parent.parentNodeId;
                        }

                        // Find edge with lowest causalStrength (earliest createdAt as tiebreaker)
                        let weakestEdge = cycleEdges[0];
                        for (let i = 1; i < cycleEdges.length; i++) {
                            const candidate = cycleEdges[i];
                            if (
                                candidate.causalStrength < weakestEdge.causalStrength ||
                                (candidate.causalStrength === weakestEdge.causalStrength &&
                                    candidate.createdAt != null &&
                                    (weakestEdge.createdAt == null ||
                                        candidate.createdAt.getTime() < weakestEdge.createdAt.getTime()))
                            ) {
                                weakestEdge = candidate;
                            }
                        }

                        // Break the cycle at the weakest edge
                        brokenEdges.add(weakestEdge.edgeId);

                        logger.warn("Counterfactual cycle detected and broken", {
                            cyclePath,
                            brokenEdgeId: weakestEdge.edgeId,
                            brokenEdgeCausalStrength: weakestEdge.causalStrength,
                        });

                        // Set cycle warning (only record the first one)
                        if (!cycleWarning) {
                            cycleWarning = {
                                path: cyclePath,
                                brokenEdgeId: weakestEdge.edgeId,
                            };
                        }

                        continue;
                    }

                    const newConfidence = currentConfidence * causalStrength;

                    // Stop if confidence falls below threshold
                    if (newConfidence < minConfidence) {
                        continue;
                    }

                    visited.add(targetId);
                    parentMap.set(targetId, { parentNodeId: currentNodeId, edge: edgeEntry });
                    const newHopDistance = hopDistance + 1;

                    // Projected state: hypothetical state merged with confidence info
                    const projectedState: Record<string, any> = {
                        ...hypotheticalState,
                        _confidence: newConfidence,
                        _hopDistance: newHopDistance,
                        _sourceNodeId: targetNodeId,
                    };

                    affectedNodes.push({
                        nodeId: targetId,
                        projectedState,
                        cumulativeConfidence: newConfidence,
                        hopDistance: newHopDistance,
                    });

                    nextLevel.push([targetId, newConfidence, newHopDistance]);
                }
            }

            currentLevel = nextLevel;
        }

        // Count total nodes for the organization to determine graphSizeExceeded
        const [nodeCountResult] = await db
            .select({ count: count() })
            .from(knowledgeNodes)
            .where(eq(knowledgeNodes.organizationId, organizationId));

        const totalNodes = nodeCountResult?.count ?? 0;
        const graphSizeExceeded = totalNodes > 10000;

        const computationDurationMs = performance.now() - startTime;

        logger.info("Counterfactual query completed", {
            targetNodeId,
            organizationId,
            maxHops,
            affectedCount: affectedNodes.length,
            computationDurationMs,
            graphSizeExceeded,
            cycleDetected: !!cycleWarning,
        });

        const result: CounterfactualResult = {
            affectedNodes,
            computationDurationMs,
            graphSizeExceeded,
        };
        if (cycleWarning) {
            result.cycleWarning = cycleWarning;
        }
        return result;
    },
};
