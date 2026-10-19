import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { EventGraphPluginInput, GraphNode, GraphEdge } from "../types.js";
import { makeGraphManifest, successResult, buildNode, buildEdge } from "./plugin-helpers.js";

export interface EventGraphOutput { node: GraphNode; edges: GraphEdge[] }

const manifest = makeGraphManifest({
    name: "event-graph",
    subPod: "event-graph",
    capability: "graph.event_graph",
    description: "Creates graph nodes and edges for canonical events (spec §12).",
    inputTypes: ["EventGraphPluginInput"],
    outputTypes: ["EventGraphOutput"],
    timeoutMs: 10,
});

export const eventGraphPlugin: PredictionPlugin<EventGraphPluginInput, EventGraphOutput> = {
    manifest,

    async canHandle(input: EventGraphPluginInput): Promise<PluginDecision> {
        const ok = !!input?.contextId && !!input?.eventId;
        return {
            shouldRun: ok,
            reason: ok ? "valid event graph input" : "missing contextId or eventId",
            priority: 90,
            estimatedCost: { latencyMs: 2, dbReads: 0, vectorQueries: 0, agentCalls: 0 },
        };
    },

    async execute(input: EventGraphPluginInput, ctx: PluginContext): Promise<PluginResult<EventGraphOutput>> {
        const startedAt = new Date().toISOString();

        const node = buildNode({
            id: input.eventId,
            type: "event",
            label: input.eventLabel,
            contextId: input.contextId,
            refId: input.eventRefId,
            properties: { sequencePosition: input.sequencePosition },
            now: ctx.now,
        });

        const provPl = { source: "plugin" as const, method: "event_graph", pluginName: manifest.name, pluginVersion: manifest.version, evidenceIds: [input.eventId], createdAt: ctx.now };
        const edges: GraphEdge[] = [];

        // Sequence edge to prior event
        if (input.priorEventId) {
            edges.push(buildEdge({
                sourceNodeId: input.priorEventId,
                targetNodeId: input.eventId,
                type: "precedes",
                strength: 0.9,
                confidence: 0.95,
                contextId: input.contextId,
                evidenceIds: [input.eventId],
                provenance: provPl,
                now: ctx.now,
            }));
        }

        // Causal edges to cause events
        for (const causeId of input.causalEventIds ?? []) {
            edges.push(buildEdge({
                sourceNodeId: causeId,
                targetNodeId: input.eventId,
                type: "caused_by",
                strength: 0.7,
                confidence: 0.65,
                contextId: input.contextId,
                evidenceIds: [input.eventId, causeId],
                provenance: provPl,
                now: ctx.now,
            }));
        }

        // Generated quant edges
        for (const quantId of input.generatedQuantIds ?? []) {
            edges.push(buildEdge({
                sourceNodeId: input.eventId,
                targetNodeId: quantId,
                type: "generated",
                strength: 0.95,
                confidence: 0.9,
                contextId: input.contextId,
                evidenceIds: [input.eventId],
                provenance: provPl,
                now: ctx.now,
            }));
        }

        return successResult(manifest, { node, edges }, 0.9, ctx, startedAt, "event_graph", [input.eventId]);
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
