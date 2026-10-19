import { randomUUID } from "crypto";
import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { HiddenStateInfluencePluginInput, HiddenStateInfluence } from "../types.js";
import { clamp, makeHiddenStateManifest, successResult } from "./plugin-helpers.js";

const manifest = makeHiddenStateManifest({
    name: "hidden-state-influence",
    subPod: "hidden-state-influence",
    capability: "hidden_state.emit_influences",
    description: "Emits influence signals to the Prediction and Pruning pods based on the current hidden-state estimate (spec §20).",
    inputTypes: ["HiddenStateInfluencePluginInput"],
    outputTypes: ["HiddenStateInfluence[]"],
    timeoutMs: 8,
});

export const hiddenStateInfluencePlugin: PredictionPlugin<HiddenStateInfluencePluginInput, HiddenStateInfluence[]> = {
    manifest,

    async canHandle(input: HiddenStateInfluencePluginInput): Promise<PluginDecision> {
        const ok = !!input?.contextId && !!input?.estimate;
        return {
            shouldRun: ok,
            reason: ok ? "valid influence input" : "missing contextId or estimate",
            priority: 80,
            estimatedCost: { latencyMs: 2, dbReads: 0, vectorQueries: 0, agentCalls: 0 },
        };
    },

    async execute(input: HiddenStateInfluencePluginInput, ctx: PluginContext): Promise<PluginResult<HiddenStateInfluence[]>> {
        const startedAt = new Date().toISOString();
        const influences: HiddenStateInfluence[] = [];

        const { estimate } = input;
        const top = estimate.candidates[0];

        if (!top || top.confidence < 0.3) {
            return successResult(manifest, [], 0, ctx, startedAt, "influence_emission");
        }

        // Boost influence for top candidate toward matching branches
        if (top.confidence >= 0.4) {
            for (const branchId of input.branchIds ?? []) {
                influences.push({
                    id: randomUUID(),
                    hiddenStateId: estimate.id,
                    targetType: "branch",
                    targetId: branchId,
                    effect: "boost",
                    amount: clamp(top.confidence * 0.3),
                    confidence: clamp(top.confidence),
                    explanation: `Hidden state '${top.label}' (conf=${top.confidence.toFixed(3)}) boosts branch`,
                    evidenceIds: top.supportingQuantIds.slice(0, 4),
                    createdAt: ctx.now,
                });
            }
        }

        // Warn influence when split detected (high entropy, multiple strong candidates)
        if (estimate.splitDetected || estimate.entropy > 0.6) {
            influences.push({
                id: randomUUID(),
                hiddenStateId: estimate.id,
                targetType: "prediction",
                effect: "warn",
                amount: clamp(estimate.entropy),
                confidence: 0.7,
                explanation: `High hidden-state entropy ${estimate.entropy.toFixed(3)} — multiple plausible latent states`,
                evidenceIds: [],
                createdAt: ctx.now,
            });
        }

        // Suppress influence for low-confidence risk states: surface anomaly warning
        const riskCandidate = estimate.candidates.find(c => c.type === "risk_state" && c.probability > 0.1);
        if (riskCandidate && input.mode !== "realtime") {
            influences.push({
                id: randomUUID(),
                hiddenStateId: estimate.id,
                targetType: "prediction",
                effect: "preserve",
                amount: clamp(riskCandidate.probability * 0.5),
                confidence: clamp(riskCandidate.confidence),
                explanation: `Risk state '${riskCandidate.label}' active at prob=${riskCandidate.probability.toFixed(3)} — preserving related branches`,
                evidenceIds: riskCandidate.supportingQuantIds.slice(0, 4),
                createdAt: ctx.now,
            });
        }

        return successResult(manifest, influences, clamp(top.confidence), ctx, startedAt, "influence_emission",
            top.supportingQuantIds.slice(0, 8));
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
