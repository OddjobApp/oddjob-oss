import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { HiddenStatePersistencePluginInput, HiddenStatePersistenceResult } from "../types.js";
import { clamp, makeHiddenStateManifest, successResult } from "./plugin-helpers.js";

const manifest = makeHiddenStateManifest({
    name: "hidden-state-persistence",
    subPod: "hidden-state-persistence",
    capability: "hidden_state.persistence",
    description: "Measures whether each hidden-state candidate is transient or persistent (spec §14).",
    inputTypes: ["HiddenStatePersistencePluginInput"],
    outputTypes: ["HiddenStatePersistenceResult"],
    timeoutMs: 8,
});

export const hiddenStatePersistencePlugin: PredictionPlugin<HiddenStatePersistencePluginInput, HiddenStatePersistenceResult> = {
    manifest,

    async canHandle(input: HiddenStatePersistencePluginInput): Promise<PluginDecision> {
        const ok = !!input?.contextId && Array.isArray(input?.candidates);
        return {
            shouldRun: ok,
            reason: ok ? "valid persistence input" : "missing contextId or candidates",
            priority: 85,
            estimatedCost: { latencyMs: 2, dbReads: 0, vectorQueries: 0, agentCalls: 0 },
        };
    },

    async execute(input: HiddenStatePersistencePluginInput, ctx: PluginContext): Promise<PluginResult<HiddenStatePersistenceResult>> {
        const startedAt = new Date().toISOString();
        const previousCandidates = input.previousEstimate?.candidates ?? [];

        const persistenceByCandidate = input.candidates.map(candidate => {
            // Base persistence for new states
            let persistence = 0.15;
            let decayRate = 0.05;

            // Boost if previously observed
            const prev = previousCandidates.find(p => p.label === candidate.label);
            if (prev) {
                persistence = clamp(0.3 + prev.probability * 0.5 + prev.persistence * 0.2);
                decayRate = clamp(0.02 + (1 - prev.persistence) * 0.05);
            }

            // Quant resonance: active supporting quants raise persistence
            const supportingQuants = input.activeQuants.filter(q =>
                candidate.supportingQuantIds.includes(q.id)
            );
            const activeCount = supportingQuants.filter(q =>
                q.lifecycle.status === "active"
            ).length;
            const resonance = supportingQuants.length > 0
                ? activeCount / supportingQuants.length
                : 0;
            persistence = clamp(persistence + resonance * 0.15);

            // Safety-critical states persist longer (risk_state, anomaly_state)
            if (candidate.type === "risk_state" || candidate.type === "anomaly_state") {
                persistence = clamp(persistence + 0.1);
                decayRate = Math.max(0.005, decayRate - 0.01);
            }

            return { candidateId: candidate.id, persistence, decayRate };
        });

        return successResult(manifest, { persistenceByCandidate }, 0.85, ctx, startedAt, "persistence_calculation");
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
