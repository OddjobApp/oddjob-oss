import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { PredictionConfidenceInput, PredictionConfidenceResult } from "../types.js";
import { PREDICTION_EPSILON } from "../types.js";
import { clamp, makePredictionManifest, successResult } from "./plugin-helpers.js";

const manifest = makePredictionManifest({
    name: "prediction-confidence",
    subPod: "confidence",
    capability: "prediction.compute_confidence",
    description: "Computes branch and prediction confidence from quant, realm, chamber, and entropy support.",
    inputTypes: ["PredictionConfidenceInput"],
    outputTypes: ["PredictionConfidenceResult"],
    timeoutMs: 10,
});

export const predictionConfidencePlugin: PredictionPlugin<PredictionConfidenceInput, PredictionConfidenceResult> = {
    manifest,
    async canHandle(input: PredictionConfidenceInput): Promise<PluginDecision> {
        const ok = Array.isArray(input?.branches);
        return {
            shouldRun: ok,
            reason: ok ? "valid confidence input" : "missing branches",
            priority: 78,
            estimatedCost: { latencyMs: 1, dbReads: 0, vectorQueries: 0, agentCalls: 0 },
        };
    },
    async execute(input: PredictionConfidenceInput, ctx: PluginContext): Promise<PluginResult<PredictionConfidenceResult>> {
        const startedAt = new Date().toISOString();
        const realmAgreement = clamp(input.realmAgreement?.score ?? 0.65);
        const hiddenStateConfidence = clamp(input.hiddenState?.confidence ?? 0.7);
        const calibrationWeight = clamp(input.calibrationWeight ?? 0.8, 0.1, 1);

        const branchConfidences = input.branches.map(branch => {
            const supportQuants = input.activeQuants.filter(q => branch.supportingQuantIds.includes(q.id));
            const quantSupport = supportQuants.length > 0
                ? supportQuants.reduce((sum, q) => sum + q.confidence * q.magnitude, 0) / supportQuants.length
                : 0.5;
            const forwardScore = input.forwardChamber?.branchScores.find(s => s.branchId === branch.id)?.score ?? branch.forwardScore ?? 0.6;
            const entropyPenalty = Math.max(branch.entropy, 0.25);
            const confidence = clamp(
                branch.probability
                * Math.max(quantSupport, 0.15)
                * realmAgreement
                * Math.max(forwardScore, 0.15)
                * hiddenStateConfidence
                * calibrationWeight
                / Math.max(entropyPenalty, PREDICTION_EPSILON)
            );
            const branchScore = clamp(branch.branchScore * 0.55 + confidence * 0.45);
            return { branchId: branch.id, confidence, branchScore };
        });

        const topConfidence = branchConfidences.reduce((max, b) => Math.max(max, b.confidence), 0);
        const predictionConfidence = clamp(topConfidence * (1 - input.quantField.fieldEntropy * 0.25));
        return successResult(manifest, { predictionConfidence, branchConfidences }, predictionConfidence, ctx, startedAt, "bounded_confidence_score");
    },
    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
