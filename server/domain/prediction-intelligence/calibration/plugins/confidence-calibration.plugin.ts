import { randomUUID } from "crypto";
import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { ConfidenceCalibrationPluginInput, CalibrationSignal } from "../types.js";
import { OVERCONFIDENCE_THRESHOLD, UNDERCONFIDENCE_THRESHOLD } from "../types.js";
import { clamp, makeCalibrationManifest, successResult } from "./plugin-helpers.js";

const manifest = makeCalibrationManifest({
    name: "confidence-calibration",
    subPod: "confidence-calibration",
    capability: "calibration.confidence_calibration",
    description: "Measures whether confidence values were honest and emits targeted adjustment signals (spec §16).",
    inputTypes: ["ConfidenceCalibrationPluginInput"],
    outputTypes: ["CalibrationSignal[]"],
    timeoutMs: 8,
});

export const confidenceCalibrationPlugin: PredictionPlugin<ConfidenceCalibrationPluginInput, CalibrationSignal[]> = {
    manifest,

    async canHandle(input: ConfidenceCalibrationPluginInput): Promise<PluginDecision> {
        return { shouldRun: !!input?.calibrationOutcome, reason: "always calibrate confidence", priority: 85, estimatedCost: { latencyMs: 1, dbReads: 0, vectorQueries: 0, agentCalls: 0 } };
    },

    async execute(input: ConfidenceCalibrationPluginInput, ctx: PluginContext): Promise<PluginResult<CalibrationSignal[]>> {
        const startedAt = new Date().toISOString();
        const { calibrationOutcome: co } = input;
        const signals: CalibrationSignal[] = [];
        const evidenceIds = [co.outcomeId];

        // Overconfidence: wrong and confident → decrease confidence model
        if (co.overconfident) {
            signals.push({
                id: randomUUID(), contextId: co.contextId,
                targetType: "confidence_model", signalType: "decrease_confidence",
                amount: clamp((co.confidenceAtPrediction - OVERCONFIDENCE_THRESHOLD) * 0.5),
                confidence: 0.85,
                reason: `Overconfident prediction (conf=${co.confidenceAtPrediction.toFixed(3)}, wrong) → reduce confidence model`,
                evidenceIds, createdAt: ctx.now,
            });
        }

        // Underconfidence: right but low confidence → increase confidence model
        if (co.underconfident) {
            signals.push({
                id: randomUUID(), contextId: co.contextId,
                targetType: "confidence_model", signalType: "increase_confidence",
                amount: clamp((UNDERCONFIDENCE_THRESHOLD - co.confidenceAtPrediction) * 0.4),
                confidence: 0.75,
                reason: `Underconfident prediction (conf=${co.confidenceAtPrediction.toFixed(3)}, correct) → increase confidence model`,
                evidenceIds, createdAt: ctx.now,
            });
        }

        // Lucky correct: right but weak confidence → mild increase
        if (co.luckyCorrect && !co.underconfident) {
            signals.push({
                id: randomUUID(), contextId: co.contextId,
                targetType: "confidence_model", signalType: "increase_confidence",
                amount: 0.02,
                confidence: 0.5,
                reason: `Lucky correct (conf=${co.confidenceAtPrediction.toFixed(3)}) → mild confidence increase, but avoid over-reinforcement`,
                evidenceIds, createdAt: ctx.now,
            });
        }

        // High calibration error → requires review
        if (co.calibrationError > 0.3) {
            signals.push({
                id: randomUUID(), contextId: co.contextId,
                targetType: "confidence_model", signalType: "requires_review",
                amount: clamp(co.calibrationError),
                confidence: 0.9,
                reason: `High calibration error (${co.calibrationError.toFixed(3)}) requires review`,
                evidenceIds, createdAt: ctx.now,
            });
        }

        return successResult(manifest, signals, 0.85, ctx, startedAt, "confidence_calibration");
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
