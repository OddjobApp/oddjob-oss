import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { GraphFeaturePluginInput, GraphFeatureSet } from "../types.js";
import { clamp, makeGraphManifest, successResult } from "./plugin-helpers.js";

const manifest = makeGraphManifest({
    name: "graph-feature-extractor",
    subPod: "graph-feature-extractor",
    capability: "graph.feature_extraction",
    description: "Extracts graph-derived features for prediction from a node neighborhood (spec §24).",
    inputTypes: ["GraphFeaturePluginInput"],
    outputTypes: ["GraphFeatureSet"],
    timeoutMs: 10,
    latencyClass: "interactive",
});

export const graphFeatureExtractorPlugin: PredictionPlugin<GraphFeaturePluginInput, GraphFeatureSet> = {
    manifest,

    async canHandle(input: GraphFeaturePluginInput): Promise<PluginDecision> {
        const ok = !!input?.nodeId && !!input?.neighbors;
        return {
            shouldRun: ok,
            reason: ok ? "valid feature extraction input" : "missing nodeId or neighbors",
            priority: 70,
            estimatedCost: { latencyMs: 2, dbReads: 0, vectorQueries: 0, agentCalls: 0 },
        };
    },

    async execute(input: GraphFeaturePluginInput, ctx: PluginContext): Promise<PluginResult<GraphFeatureSet>> {
        const startedAt = new Date().toISOString();
        const { nodes, edges } = input.neighbors;

        // Degree metrics
        const outEdges = edges.filter(e => e.sourceNodeId === input.nodeId);
        const inEdges = edges.filter(e => e.targetNodeId === input.nodeId);
        const nodeDegree = outEdges.length + inEdges.length;

        // Weighted degree
        const weightedDegree = edges
            .filter(e => e.sourceNodeId === input.nodeId || e.targetNodeId === input.nodeId)
            .reduce((s, e) => s + e.weight, 0);

        // Support vs contradiction ratio
        const supportEdges = edges.filter(e => (e.sourceNodeId === input.nodeId || e.targetNodeId === input.nodeId)
            && (e.type === "supports" || e.type === "resonates_with" || e.type === "predictively_supports"));
        const contradictionEdges = edges.filter(e => (e.sourceNodeId === input.nodeId || e.targetNodeId === input.nodeId)
            && (e.type === "contradicts" || e.type === "interferes_with" || e.type === "opposes"));

        const supportPathCount = supportEdges.length;
        const contradictionPathCount = contradictionEdges.length;

        // Branch support
        const branchNodes = nodes.filter(n => n.type === "branch");
        const branchSupportEdges = edges.filter(e =>
            e.type === "supports" && branchNodes.some(b => b.id === e.targetNodeId)
        );

        // Nearest attractor
        const nearAttractorEdges = edges.filter(e =>
            (e.sourceNodeId === input.nodeId || e.targetNodeId === input.nodeId) && e.type === "near_attractor"
        );
        const nearestAttractorDistance = nearAttractorEdges.length > 0
            ? clamp(1 - nearAttractorEdges[0].weight)
            : 1.0;

        // Causal path strength
        const causalEdges = edges.filter(e =>
            (e.sourceNodeId === input.nodeId || e.targetNodeId === input.nodeId)
            && (e.type === "causally_supported" || e.type === "causally_suspected" || e.type === "causes")
        );
        const causalPathStrength = causalEdges.length > 0
            ? clamp(causalEdges.reduce((s, e) => s + e.weight, 0) / causalEdges.length)
            : 0;

        // Semantic neighborhood density
        const semanticNodes = nodes.filter(n => n.type === "concept" || n.type === "topic" || n.type === "theme");
        const semanticNeighborhoodDensity = clamp(semanticNodes.length / Math.max(nodes.length, 1));

        // Neighbor count
        const neighborCount = nodes.filter(n => n.id !== input.nodeId).length;

        const features: Record<string, number> = {
            node_degree: nodeDegree,
            weighted_degree: clamp(weightedDegree),
            neighbor_count: neighborCount,
            support_path_count: supportPathCount,
            contradiction_path_count: contradictionPathCount,
            branch_support_count: branchSupportEdges.length,
            nearest_attractor_distance: nearestAttractorDistance,
            causal_path_strength: causalPathStrength,
            semantic_neighborhood_density: semanticNeighborhoodDensity,
        };

        const featureSet: GraphFeatureSet = {
            nodeId: input.nodeId,
            contextId: input.contextId,
            features,
            evidenceNodeIds: nodes.map(n => n.id),
            evidenceEdgeIds: edges.map(e => e.id),
            createdAt: ctx.now,
        };

        return successResult(manifest, featureSet, 0.85, ctx, startedAt, "graph_feature_extraction");
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
