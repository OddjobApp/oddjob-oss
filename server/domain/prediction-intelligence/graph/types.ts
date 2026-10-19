// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN - GRAPH POD
// Core TypeScript type definitions (spec §6-§33)
// ============================================================================

import type { DomainContext } from "../quant/types.js";
import type { Provenance } from "../plugin-runtime/types.js";

export type PredictionMode = "realtime" | "interactive" | "analysis" | "batch";

// ---------------------------------------------------------------------------
// Node Types (spec §6)
// ---------------------------------------------------------------------------

export type GraphNodeType =
    | "event"
    | "quant"
    | "episode"
    | "concept"
    | "topic"
    | "theme"
    | "set"
    | "actor"
    | "object"
    | "context"
    | "window"
    | "hidden_state"
    | "branch"
    | "prediction"
    | "outcome"
    | "pattern"
    | "memory"
    | "attractor"
    | "location"
    | "region"
    | "zone"
    | "geofence"
    | "route"
    | "entity"
    | "spatial_relation";

// ---------------------------------------------------------------------------
// Edge Types (spec §7)
// ---------------------------------------------------------------------------

export type GraphEdgeType =
    | "precedes"
    | "follows"
    | "generated"
    | "derived_from"
    | "supports"
    | "opposes"
    | "contradicts"
    | "resonates_with"
    | "interferes_with"
    | "causes"
    | "caused_by"
    | "correlated_with"
    | "predictively_supports"
    | "causally_suspected"
    | "causally_supported"
    | "counterfactually_supported"
    | "part_of"
    | "contains"
    | "relates_to"
    | "similar_to"
    | "opposite_of"
    | "instance_of"
    | "subclass_of"
    | "located_in"
    | "near"
    | "far_from"
    | "inside"
    | "outside"
    | "adjacent_to"
    | "co_located_with"
    | "moving_toward"
    | "moving_away_from"
    | "path_intersects"
    | "path_diverges"
    | "path_converges"
    | "entered"
    | "left"
    | "crossed_boundary"
    | "predicts"
    | "expanded_to"
    | "merged_into"
    | "pruned_by"
    | "collapsed_into"
    | "matched_outcome"
    | "near_attractor";

// ---------------------------------------------------------------------------
// Graph Node (spec §8)
// ---------------------------------------------------------------------------

export interface GraphNode {
    id: string;
    type: GraphNodeType;
    label?: string;
    contextId?: string;
    refId: string;
    properties: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
}

// ---------------------------------------------------------------------------
// Graph Edge (spec §9)
// ---------------------------------------------------------------------------

export interface GraphEdge {
    id: string;
    contextId?: string;
    sourceNodeId: string;
    targetNodeId: string;
    type: GraphEdgeType;
    strength: number;
    confidence: number;
    weight: number;
    direction: "directed" | "undirected";
    evidenceIds: string[];
    provenance: Provenance;
    validFrom?: string;
    validTo?: string;
    properties: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
}

// ---------------------------------------------------------------------------
// Graph Neighborhood (spec §30)
// ---------------------------------------------------------------------------

export interface GraphNeighborhood {
    startNodeId: string;
    depth: number;
    nodes: GraphNode[];
    edges: GraphEdge[];
    truncated: boolean;
    explanation?: string;
}

// ---------------------------------------------------------------------------
// Relationship Path (spec §31)
// ---------------------------------------------------------------------------

export interface RelationshipPath {
    id: string;
    sourceNodeId: string;
    targetNodeId: string;
    nodes: GraphNode[];
    edges: GraphEdge[];
    pathStrength: number;
    confidence: number;
    explanation: string;
}

// ---------------------------------------------------------------------------
// Graph Feature Set (spec §32)
// ---------------------------------------------------------------------------

export interface GraphFeatureSet {
    nodeId: string;
    contextId?: string;
    features: Record<string, number>;
    evidenceNodeIds: string[];
    evidenceEdgeIds: string[];
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Graph Diff (spec §33)
// ---------------------------------------------------------------------------

export type GraphDiffChangeType =
    | "node_added"
    | "node_removed"
    | "edge_added"
    | "edge_removed"
    | "edge_weight_changed"
    | "edge_confidence_changed"
    | "relationship_type_changed"
    | "subgraph_shape_changed"
    | "path_created"
    | "path_broken";

export interface GraphDiffChange {
    type: GraphDiffChangeType;
    nodeId?: string;
    edgeId?: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    confidence: number;
    explanation: string;
}

export interface GraphDiff {
    id: string;
    contextId?: string;
    previousSnapshotId?: string;
    currentSnapshotId?: string;
    changes: GraphDiffChange[];
    summary: {
        nodesAdded: number;
        nodesRemoved: number;
        edgesAdded: number;
        edgesRemoved: number;
        edgeWeightsChanged: number;
        shapeChanged: boolean;
    };
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Graph Snapshot
// ---------------------------------------------------------------------------

export interface GraphSnapshot {
    id: string;
    contextId?: string;
    snapshotType: string;
    nodeCount: number;
    edgeCount: number;
    summary: Record<string, unknown>;
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Graph Projection
// ---------------------------------------------------------------------------

export interface GraphProjection {
    id: string;
    contextId?: string;
    nodeTypes: GraphNodeType[];
    edgeTypes: GraphEdgeType[];
    nodes: GraphNode[];
    edges: GraphEdge[];
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Port input types
// ---------------------------------------------------------------------------

export interface UpsertGraphNodeInput {
    id?: string;
    contextId?: string;
    type: GraphNodeType;
    label?: string;
    refId: string;
    properties?: Record<string, unknown>;
}

export interface UpsertGraphEdgeInput {
    id?: string;
    contextId?: string;
    sourceNodeId: string;
    targetNodeId: string;
    type: GraphEdgeType;
    strength: number;
    confidence: number;
    direction?: "directed" | "undirected";
    evidenceIds?: string[];
    provenance: Provenance;
    validFrom?: string;
    validTo?: string;
    properties?: Record<string, unknown>;
}

export interface GraphNeighborInput {
    nodeId: string;
    contextId?: string;
    edgeTypes?: GraphEdgeType[];
    nodeTypes?: GraphNodeType[];
    depth?: number;
    maxNodes?: number;
    mode?: PredictionMode;
}

export interface GraphPathInput {
    sourceNodeId: string;
    targetNodeId: string;
    contextId?: string;
    edgeTypes?: GraphEdgeType[];
    maxDepth?: number;
    maxPaths?: number;
}

export interface GraphFeatureInput {
    nodeId: string;
    contextId?: string;
    mode?: PredictionMode;
}

export interface GraphDiffInput {
    contextId?: string;
    previousSnapshotId?: string;
    currentNodes: GraphNode[];
    currentEdges: GraphEdge[];
}

export interface GraphProjectionInput {
    contextId?: string;
    nodeTypes: GraphNodeType[];
    edgeTypes: GraphEdgeType[];
    limit?: number;
}

export interface GraphSnapshotInput {
    contextId?: string;
    snapshotType: string;
}

// ---------------------------------------------------------------------------
// Plugin-specific input types
// ---------------------------------------------------------------------------

export interface EventGraphPluginInput {
    contextId: string;
    eventId: string;
    eventLabel: string;
    eventRefId: string;
    priorEventId?: string;
    causalEventIds?: string[];
    generatedQuantIds?: string[];
    sequencePosition?: number;
    mode: PredictionMode;
}

export interface QuantGraphPluginInput {
    contextId: string;
    quantId: string;
    quantLabel?: string;
    quantRefId: string;
    relationshipType: "resonates_with" | "interferes_with" | "supports" | "opposes" | "contradicts" | "collapses_into" | "derived_from";
    targetQuantId?: string;
    targetBranchId?: string;
    strength: number;
    confidence: number;
    evidenceIds?: string[];
    provenance: Provenance;
    mode: PredictionMode;
}

export interface BranchGraphPluginInput {
    contextId: string;
    branchId: string;
    branchPredicate: string;
    branchRefId: string;
    parentBranchId?: string;
    mergedIntoBranchId?: string;
    prunedReason?: string;
    outcomeId?: string;
    outcomeMatched?: boolean;
    mode: PredictionMode;
}

export interface GraphTraversalPluginInput {
    startNodeId: string;
    edges: GraphEdge[];
    nodes: GraphNode[];
    depth: number;
    edgeTypes?: GraphEdgeType[];
    nodeTypes?: GraphNodeType[];
    maxNodes: number;
}

export interface GraphFeaturePluginInput {
    nodeId: string;
    neighbors: GraphNeighborhood;
    contextId?: string;
}

// ---------------------------------------------------------------------------
// Graph Port (spec §29)
// ---------------------------------------------------------------------------

export interface GraphPort {
    upsertNode(input: UpsertGraphNodeInput, ctx: DomainContext): Promise<GraphNode>;
    upsertEdge(input: UpsertGraphEdgeInput, ctx: DomainContext): Promise<GraphEdge>;
    getNeighbors(input: GraphNeighborInput, ctx: DomainContext): Promise<GraphNeighborhood>;
    findPaths(input: GraphPathInput, ctx: DomainContext): Promise<RelationshipPath[]>;
    extractFeatures(input: GraphFeatureInput, ctx: DomainContext): Promise<GraphFeatureSet>;
    diff(input: GraphDiffInput, ctx: DomainContext): Promise<GraphDiff>;
    project(input: GraphProjectionInput, ctx: DomainContext): Promise<GraphProjection>;
    snapshot(input: GraphSnapshotInput, ctx: DomainContext): Promise<GraphSnapshot>;
}

// ---------------------------------------------------------------------------
// Depth limits by mode (spec §36)
// ---------------------------------------------------------------------------

export const GRAPH_DEPTH_LIMITS: Record<PredictionMode, { maxDepth: number; maxNodes: number }> = {
    realtime:    { maxDepth: 1, maxNodes: 20 },
    interactive: { maxDepth: 3, maxNodes: 100 },
    analysis:    { maxDepth: 6, maxNodes: 500 },
    batch:       { maxDepth: 10, maxNodes: 2000 },
};

export const GRAPH_EPSILON = 1e-6;
