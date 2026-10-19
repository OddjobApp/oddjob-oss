import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { BranchGraphPluginInput, GraphNode, GraphEdge } from "../types.js";
import { makeGraphManifest, successResult, buildNode, buildEdge } from "./plugin-helpers.js";

export interface BranchGraphOutput { node: GraphNode; edges: GraphEdge[] }

const manifest = makeGraphManifest({
    name: "branch-graph",
    subPod: "branch-graph",
    capability: "graph.branch_graph",
    description: "Creates graph nodes and edges for prediction branches, expansions, merges, prunes, and outcomes (spec §19).",
    inputTypes: ["BranchGraphPluginInput"],
    outputTypes: ["BranchGraphOutput"],
    timeoutMs: 10,
});

export const branchGraphPlugin: PredictionPlugin<BranchGraphPluginInput, BranchGraphOutput> = {
    manifest,

    async canHandle(input: BranchGraphPluginInput): Promise<PluginDecision> {
        const ok = !!input?.contextId && !!input?.branchId;
        return {
            shouldRun: ok,
            reason: ok ? "valid branch graph input" : "missing contextId or branchId",
            priority: 85,
            estimatedCost: { latencyMs: 2, dbReads: 0, vectorQueries: 0, agentCalls: 0 },
        };
    },

    async execute(input: BranchGraphPluginInput, ctx: PluginContext): Promise<PluginResult<BranchGraphOutput>> {
        const startedAt = new Date().toISOString();

        const node = buildNode({
            id: input.branchId,
            type: "branch",
            label: input.branchPredicate,
            contextId: input.contextId,
            refId: input.branchRefId,
            properties: { predicate: input.branchPredicate },
            now: ctx.now,
        });

        const provPl = { source: "plugin" as const, method: "branch_graph", pluginName: manifest.name, pluginVersion: manifest.version, evidenceIds: [input.branchId], createdAt: ctx.now };
        const edges: GraphEdge[] = [];

        // Parent → child expansion edge
        if (input.parentBranchId) {
            edges.push(buildEdge({
                sourceNodeId: input.parentBranchId,
                targetNodeId: input.branchId,
                type: "expanded_to",
                strength: 0.9,
                confidence: 0.85,
                contextId: input.contextId,
                evidenceIds: [input.branchId],
                provenance: provPl,
                now: ctx.now,
            }));
        }

        // Merge edge
        if (input.mergedIntoBranchId) {
            edges.push(buildEdge({
                sourceNodeId: input.branchId,
                targetNodeId: input.mergedIntoBranchId,
                type: "merged_into",
                strength: 0.85,
                confidence: 0.8,
                contextId: input.contextId,
                evidenceIds: [input.branchId],
                provenance: provPl,
                now: ctx.now,
            }));
        }

        // Prune edge (pruned_by links to a pruning context placeholder)
        if (input.prunedReason) {
            edges.push(buildEdge({
                sourceNodeId: input.branchId,
                targetNodeId: input.branchId, // self-loop annotation — pruned branch points at itself as record
                type: "pruned_by",
                strength: 0.95,
                confidence: 0.9,
                contextId: input.contextId,
                evidenceIds: [input.branchId],
                provenance: provPl,
                properties: { reason: input.prunedReason },
                now: ctx.now,
            }));
        }

        // Outcome match edge
        if (input.outcomeId) {
            edges.push(buildEdge({
                sourceNodeId: input.branchId,
                targetNodeId: input.outcomeId,
                type: "matched_outcome",
                strength: input.outcomeMatched ? 0.95 : 0.3,
                confidence: 0.9,
                contextId: input.contextId,
                evidenceIds: [input.branchId, input.outcomeId],
                provenance: provPl,
                properties: { matched: input.outcomeMatched },
                now: ctx.now,
            }));
        }

        return successResult(manifest, { node, edges }, 0.9, ctx, startedAt, "branch_graph", [input.branchId]);
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
