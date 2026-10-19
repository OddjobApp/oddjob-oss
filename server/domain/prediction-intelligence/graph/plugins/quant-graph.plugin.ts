import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { QuantGraphPluginInput, GraphNode, GraphEdge, GraphNodeType } from "../types.js";
import { makeGraphManifest, successResult, buildNode, buildEdge, clamp, provenance } from "./plugin-helpers.js";

export interface QuantGraphOutput { node: GraphNode; edges: GraphEdge[] }

const manifest = makeGraphManifest({
    name: "quant-graph",
    subPod: "quant-graph",
    capability: "graph.quant_graph",
    description: "Creates graph nodes and relationship edges for quants (spec §13).",
    inputTypes: ["QuantGraphPluginInput"],
    outputTypes: ["QuantGraphOutput"],
    timeoutMs: 10,
});

// Map quant relationship types to graph edge types
const REL_TO_EDGE: Record<QuantGraphPluginInput["relationshipType"], string> = {
    resonates_with: "resonates_with",
    interferes_with: "interferes_with",
    supports: "supports",
    opposes: "opposes",
    contradicts: "contradicts",
    collapses_into: "collapsed_into",
    derived_from: "derived_from",
};

export const quantGraphPlugin: PredictionPlugin<QuantGraphPluginInput, QuantGraphOutput> = {
    manifest,

    async canHandle(input: QuantGraphPluginInput): Promise<PluginDecision> {
        const ok = !!input?.contextId && !!input?.quantId;
        return {
            shouldRun: ok,
            reason: ok ? "valid quant graph input" : "missing contextId or quantId",
            priority: 88,
            estimatedCost: { latencyMs: 2, dbReads: 0, vectorQueries: 0, agentCalls: 0 },
        };
    },

    async execute(input: QuantGraphPluginInput, ctx: PluginContext): Promise<PluginResult<QuantGraphOutput>> {
        const startedAt = new Date().toISOString();

        const node = buildNode({
            id: input.quantId,
            type: "quant",
            label: input.quantLabel,
            contextId: input.contextId,
            refId: input.quantRefId,
            now: ctx.now,
        });

        const edges: GraphEdge[] = [];

        // Quant-to-quant relationship
        if (input.targetQuantId) {
            edges.push(buildEdge({
                sourceNodeId: input.quantId,
                targetNodeId: input.targetQuantId,
                type: REL_TO_EDGE[input.relationshipType] as GraphEdge["type"],
                strength: clamp(input.strength),
                confidence: clamp(input.confidence),
                contextId: input.contextId,
                evidenceIds: input.evidenceIds ?? [],
                provenance: provenance(manifest, ctx, "quant_graph", input.evidenceIds ?? []),
                now: ctx.now,
            }));
        }

        // Quant-to-branch relationship (collapse or support)
        if (input.targetBranchId) {
            edges.push(buildEdge({
                sourceNodeId: input.quantId,
                targetNodeId: input.targetBranchId,
                type: input.relationshipType === "collapses_into" ? "collapsed_into" : "supports",
                strength: clamp(input.strength),
                confidence: clamp(input.confidence),
                contextId: input.contextId,
                evidenceIds: input.evidenceIds ?? [],
                provenance: provenance(manifest, ctx, "quant_graph", input.evidenceIds ?? []),
                now: ctx.now,
            }));
        }

        return successResult(manifest, { node, edges }, clamp(input.confidence), ctx, startedAt, "quant_graph", [input.quantId]);
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
