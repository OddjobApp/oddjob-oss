import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { QuantDiffPluginInput, DiffRecord } from "../types.js";
import { clamp, makeDiffManifest, successResult, buildDiff } from "./plugin-helpers.js";
import type { Quant } from "../../quant/types.js";

const manifest = makeDiffManifest({
    name: "quant-diff",
    subPod: "quant-diff",
    capability: "diff.quant_diff",
    description: "Detects changes in quant magnitude, confidence, and epistemic status (spec §10).",
    inputTypes: ["QuantDiffPluginInput"],
    outputTypes: ["DiffRecord[]"],
    timeoutMs: 12,
});

function quantKey(q: Quant): string {
    return q.label ?? q.type;
}

export const quantDiffPlugin: PredictionPlugin<QuantDiffPluginInput, DiffRecord[]> = {
    manifest,

    async canHandle(input: QuantDiffPluginInput): Promise<PluginDecision> {
        const ok = !!input?.contextId;
        return {
            shouldRun: ok,
            reason: ok ? "valid quant diff input" : "missing contextId",
            priority: 85,
            estimatedCost: { latencyMs: 3, dbReads: 0, vectorQueries: 0, agentCalls: 0 },
        };
    },

    async execute(input: QuantDiffPluginInput, ctx: PluginContext): Promise<PluginResult<DiffRecord[]>> {
        const startedAt = new Date().toISOString();
        const diffs: DiffRecord[] = [];

        // Map previous quants by ID for O(1) lookup, with fallback to label match
        const prevById = new Map<string, Quant>(input.previousQuants.map(q => [q.id, q]));
        const prevByLabel = new Map<string, Quant>(input.previousQuants.map(q => [quantKey(q), q]));

        for (const curr of input.currentQuants) {
            const prev = prevById.get(curr.id) ?? prevByLabel.get(quantKey(curr));
            if (!prev) {
                // New quant emerged
                if (curr.magnitude > 0.3) {
                    diffs.push(buildDiff({
                        contextId: input.contextId,
                        type: "quant_diff",
                        sourceRefId: curr.id,
                        before: null,
                        after: { magnitude: curr.magnitude, confidence: curr.confidence, type: curr.type },
                        magnitude: clamp(curr.magnitude * curr.confidence),
                        direction: "emerged",
                        anomalyDetected: curr.type === "anomaly_signal" && curr.magnitude > 0.6,
                        explanation: `New quant '${quantKey(curr)}' emerged with magnitude ${curr.magnitude.toFixed(3)}`,
                        evidenceIds: [curr.id, ...curr.sourceEventIds.slice(0, 2)],
                        now: ctx.now,
                    }));
                }
                continue;
            }

            // Magnitude change
            const magDelta = curr.magnitude - prev.magnitude;
            const magMagnitude = Math.abs(magDelta);
            if (magMagnitude > 0.05) {
                diffs.push(buildDiff({
                    contextId: input.contextId,
                    type: "quant_diff",
                    sourceRefId: curr.id,
                    before: { magnitude: prev.magnitude, confidence: prev.confidence },
                    after: { magnitude: curr.magnitude, confidence: curr.confidence },
                    magnitude: magMagnitude,
                    direction: magDelta > 0 ? "increasing" : "decreasing",
                    anomalyDetected: magMagnitude > 0.5,
                    explanation: `Quant '${quantKey(curr)}' magnitude ${prev.magnitude.toFixed(3)} → ${curr.magnitude.toFixed(3)} (${magDelta > 0 ? "+" : ""}${magDelta.toFixed(3)})`,
                    evidenceIds: [curr.id],
                    now: ctx.now,
                }));
            }

            // Epistemic status change
            if (prev.epistemic.status !== curr.epistemic.status) {
                diffs.push(buildDiff({
                    contextId: input.contextId,
                    type: "epistemic_diff",
                    realm: "epistemic",
                    sourceRefId: curr.id,
                    before: prev.epistemic.status,
                    after: curr.epistemic.status,
                    magnitude: 0.7,
                    direction: `${prev.epistemic.status}→${curr.epistemic.status}`,
                    explanation: `Quant '${quantKey(curr)}' epistemic status: ${prev.epistemic.status} → ${curr.epistemic.status}`,
                    evidenceIds: [curr.id],
                    now: ctx.now,
                }));
            }
        }

        // Quants that disappeared
        const currIds = new Set([...input.currentQuants.map(q => q.id), ...input.currentQuants.map(q => quantKey(q))]);
        for (const prev of input.previousQuants) {
            if (!currIds.has(prev.id) && !currIds.has(quantKey(prev))) {
                if (prev.magnitude > 0.4) {
                    diffs.push(buildDiff({
                        contextId: input.contextId,
                        type: "quant_diff",
                        sourceRefId: prev.id,
                        before: { magnitude: prev.magnitude, confidence: prev.confidence },
                        after: null,
                        magnitude: clamp(prev.magnitude * 0.6),
                        direction: "collapsed",
                        explanation: `Quant '${quantKey(prev)}' collapsed or decayed (was magnitude ${prev.magnitude.toFixed(3)})`,
                        evidenceIds: [prev.id],
                        now: ctx.now,
                    }));
                }
            }
        }

        const maxSig = diffs.length > 0 ? Math.max(...diffs.map(d => d.significance)) : 0;
        return successResult(manifest, diffs, clamp(maxSig), ctx, startedAt, "quant_diff",
            diffs.flatMap(d => d.evidenceIds).slice(0, 10));
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
