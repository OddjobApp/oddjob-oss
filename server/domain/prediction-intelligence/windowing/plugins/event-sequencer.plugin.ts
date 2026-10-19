import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { EventSequencerPluginInput, EventSequenceResult } from "../types.js";
import { makeWindowManifest, successResult, clamp } from "./plugin-helpers.js";

const manifest = makeWindowManifest({
    name: "event-sequencer",
    subPod: "event-sequencer",
    capability: "temporal.sequence_event",
    description: "Assigns sequence index, identifies prior and pre-prior events by occurredAt ordering (spec §12-§14).",
    inputTypes: ["EventSequencerPluginInput"],
    outputTypes: ["EventSequenceResult"],
    timeoutMs: 5,
});

export const eventSequencerPlugin: PredictionPlugin<EventSequencerPluginInput, EventSequenceResult> = {
    manifest,

    async canHandle(input: EventSequencerPluginInput): Promise<PluginDecision> {
        const ok = !!input?.event?.id;
        return { shouldRun: ok, reason: ok ? "valid sequencer input" : "missing event", priority: 95, estimatedCost: { latencyMs: 0, dbReads: 0, vectorQueries: 0, agentCalls: 0 } };
    },

    async execute(input: EventSequencerPluginInput, ctx: PluginContext): Promise<PluginResult<EventSequenceResult>> {
        const startedAt = new Date().toISOString();

        // Sort recent events by occurredAt ascending
        const sorted = [...input.recentEvents]
            .filter(e => e.id !== input.event.id)
            .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));

        const eventTime = Date.parse(input.event.occurredAt);

        // Events strictly before the current event
        const priorEvents = sorted.filter(e => Date.parse(e.occurredAt) <= eventTime);

        // Sequence index = how many prior events exist (0-based)
        const sequenceIndex = priorEvents.length;
        const prior = priorEvents[priorEvents.length - 1];
        const prePriorIds = priorEvents.slice(-4, -1).map(e => e.id); // up to 3 pre-priors

        // Confidence: high if prior has explicit sequence index, lower if timestamp-only
        const orderingConfidence = prior?.sequenceIndex != null ? 0.95 : 0.75;

        return successResult(manifest, {
            sequenceIndex,
            priorEventId: prior?.id,
            prePriorEventIds: prePriorIds,
            orderingConfidence,
        }, orderingConfidence, ctx, startedAt, "event_sequencing");
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
