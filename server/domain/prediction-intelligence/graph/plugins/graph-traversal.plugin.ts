import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { GraphTraversalPluginInput, GraphNeighborhood, GraphNode, GraphEdge, GraphEdgeType, GraphNodeType } from "../types.js";
import { makeGraphManifest, successResult } from "./plugin-helpers.js";

const manifest = makeGraphManifest({
    name: "graph-traversal",
    subPod: "graph-traversal",
    capability: "graph.traversal",
    description: "Retrieves bounded graph neighborhoods from pre-loaded node/edge sets (spec §22).",
    inputTypes: ["GraphTraversalPluginInput"],
    outputTypes: ["GraphNeighborhood"],
    timeoutMs: 12,
    latencyClass: "interactive",
});

export const graphTraversalPlugin: PredictionPlugin<GraphTraversalPluginInput, GraphNeighborhood> = {
    manifest,

    async canHandle(input: GraphTraversalPluginInput): Promise<PluginDecision> {
        const ok = !!input?.startNodeId;
        return {
            shouldRun: ok,
            reason: ok ? "valid traversal input" : "missing startNodeId",
            priority: 75,
            estimatedCost: { latencyMs: 3, dbReads: 0, vectorQueries: 0, agentCalls: 0 },
        };
    },

    async execute(input: GraphTraversalPluginInput, ctx: PluginContext): Promise<PluginResult<GraphNeighborhood>> {
        const startedAt = new Date().toISOString();

        const nodeMap = new Map<string, GraphNode>(input.nodes.map(n => [n.id, n]));
        const edgesBySource = new Map<string, GraphEdge[]>();
        const edgesByTarget = new Map<string, GraphEdge[]>();

        for (const edge of input.edges) {
            if (!edgesBySource.has(edge.sourceNodeId)) edgesBySource.set(edge.sourceNodeId, []);
            edgesBySource.get(edge.sourceNodeId)!.push(edge);
            if (!edgesByTarget.has(edge.targetNodeId)) edgesByTarget.set(edge.targetNodeId, []);
            edgesByTarget.get(edge.targetNodeId)!.push(edge);
        }

        const visitedNodeIds = new Set<string>([input.startNodeId]);
        const resultEdges: GraphEdge[] = [];
        let frontier = [input.startNodeId];
        let truncated = false;

        for (let d = 0; d < input.depth && frontier.length > 0; d++) {
            const nextFrontier: string[] = [];

            for (const nodeId of frontier) {
                const outEdges = edgesBySource.get(nodeId) ?? [];
                const inEdges = edgesByTarget.get(nodeId) ?? [];
                const candidateEdges = [...outEdges, ...inEdges];

                for (const edge of candidateEdges) {
                    // Filter by edge type if specified
                    if (input.edgeTypes?.length && !input.edgeTypes.includes(edge.type as GraphEdgeType)) continue;

                    const neighborId = edge.sourceNodeId === nodeId ? edge.targetNodeId : edge.sourceNodeId;
                    const neighbor = nodeMap.get(neighborId);
                    if (!neighbor) continue;

                    // Filter by node type if specified
                    if (input.nodeTypes?.length && !input.nodeTypes.includes(neighbor.type as GraphNodeType)) continue;

                    if (!visitedNodeIds.has(neighborId)) {
                        if (visitedNodeIds.size >= input.maxNodes) {
                            truncated = true;
                            break;
                        }
                        visitedNodeIds.add(neighborId);
                        nextFrontier.push(neighborId);
                    }
                    if (!resultEdges.find(e => e.id === edge.id)) {
                        resultEdges.push(edge);
                    }
                }
                if (truncated) break;
            }
            if (truncated) break;
            frontier = nextFrontier;
        }

        const resultNodes = [...visitedNodeIds]
            .map(id => nodeMap.get(id))
            .filter((n): n is GraphNode => !!n);

        const neighborhood: GraphNeighborhood = {
            startNodeId: input.startNodeId,
            depth: input.depth,
            nodes: resultNodes,
            edges: resultEdges,
            truncated,
            explanation: `Traversal of ${resultNodes.length} nodes and ${resultEdges.length} edges at depth ${input.depth}${truncated ? " (truncated at max)" : ""}`,
        };

        return successResult(manifest, neighborhood, resultNodes.length > 1 ? 0.9 : 0.5, ctx, startedAt, "graph_traversal");
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
