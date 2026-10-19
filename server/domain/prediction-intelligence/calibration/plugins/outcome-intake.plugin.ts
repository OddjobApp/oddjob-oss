import { randomUUID } from "crypto";
import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { OutcomeIntakeInput, ObservedOutcome } from "../types.js";
import { clamp, makeCalibrationManifest, successResult } from "./plugin-helpers.js";

const manifest = makeCalibrationManifest({
    name: "outcome-intake",
    subPod: "outcome-intake",
    capability: "calibration.outcome_intake",
    description: "Validates and normalizes observed outcomes before calibration processing (spec §12).",
    inputTypes: ["OutcomeIntakeInput"],
    outputTypes: ["ObservedOutcome"],
    timeoutMs: 8,
});

export const outcomeIntakePlugin: PredictionPlugin<OutcomeIntakeInput, ObservedOutcome> = {
    manifest,

    async canHandle(input: OutcomeIntakeInput): Promise<PluginDecision> {
        const ok = !!input?.contextId && !!input?.label && !!input?.source;
        return { shouldRun: ok, reason: ok ? "valid outcome input" : "missing contextId, label, or source", priority: 100, estimatedCost: { latencyMs: 1, dbReads: 0, vectorQueries: 0, agentCalls: 0 } };
    },

    async execute(input: OutcomeIntakeInput, ctx: PluginContext): Promise<PluginResult<ObservedOutcome>> {
        const startedAt = new Date().toISOString();
        const now = ctx.now;

        const outcome: ObservedOutcome = {
            id: randomUUID(),
            contextId: input.contextId,
            outcomeType: input.outcomeType,
            label: input.label.toLowerCase().replace(/\s+/g, "_"),
            occurredAt: input.occurredAt ?? now,
            observedAt: now,
            source: input.source,
            sourceTrust: clamp(input.sourceTrust ?? 0.85),
            confidence: clamp(input.confidence ?? 0.9),
            relatedEventIds: input.relatedEventIds ?? [],
            relatedQuantIds: [],
            relatedPredictionIds: input.relatedPredictionIds ?? [],
            payload: input.payload ?? {},
            provenance: { sourceSystem: input.source, ingestedAt: now },
        };

        return successResult(manifest, outcome, outcome.sourceTrust, ctx, startedAt, "outcome_intake");
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
