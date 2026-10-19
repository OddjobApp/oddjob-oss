import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { HiddenStateDiffPluginInput, DiffRecord } from "../types.js";
import { clamp, makeDiffManifest, successResult, buildDiff } from "./plugin-helpers.js";

const manifest = makeDiffManifest({
    name: "hidden-state-diff",
    subPod: "hidden-state-diff",
    capability: "diff.hidden_state_diff",
    description: "Detects changes in hidden-state estimates: emergence, collapse, confidence shift, entropy shift (spec §12).",
    inputTypes: ["HiddenStateDiffPluginInput"],
    outputTypes: ["DiffRecord[]"],
    timeoutMs: 10,
    latencyClass: "interactive",
});

export const hiddenStateDiffPlugin: PredictionPlugin<HiddenStateDiffPluginInput, DiffRecord[]> = {
    manifest,

    async canHandle(input: HiddenStateDiffPluginInput): Promise<PluginDecision> {
        const ok = !!input?.contextId && !!input?.previousEstimate && !!input?.currentEstimate;
        return {
            shouldRun: ok,
            reason: ok ? "valid hidden-state diff input" : "missing estimates",
            priority: 82,
            estimatedCost: { latencyMs: 2, dbReads: 0, vectorQueries: 0, agentCalls: 0 },
        };
    },

    async execute(input: HiddenStateDiffPluginInput, ctx: PluginContext): Promise<PluginResult<DiffRecord[]>> {
        const startedAt = new Date().toISOString();
        const diffs: DiffRecord[] = [];
        const { previousEstimate: prev, currentEstimate: curr } = input;

        // Top label change — major diff
        if (prev.topLabel !== curr.topLabel) {
            diffs.push(buildDiff({
                contextId: input.contextId,
                type: "hidden_state_diff",
                sourceRefId: prev.id,
                targetRefId: curr.id,
                before: prev.topLabel,
                after: curr.topLabel,
                magnitude: 0.85,
                direction: `${prev.topLabel ?? "none"} → ${curr.topLabel ?? "none"}`,
                anomalyDetected: !prev.topLabel && !!curr.topLabel,
                explanation: `Dominant hidden state shifted from '${prev.topLabel ?? "none"}' to '${curr.topLabel ?? "none"}'`,
                evidenceIds: curr.candidates[0]?.supportingQuantIds.slice(0, 4) ?? [],
                now: ctx.now,
            }));
        }

        // Confidence shift
        const confDelta = curr.confidence - prev.confidence;
        if (Math.abs(confDelta) > 0.1) {
            diffs.push(buildDiff({
                contextId: input.contextId,
                type: "hidden_state_diff",
                sourceRefId: curr.id,
                before: prev.confidence,
                after: curr.confidence,
                magnitude: clamp(Math.abs(confDelta)),
                direction: confDelta > 0 ? "confidence_increasing" : "confidence_decreasing",
                anomalyDetected: Math.abs(confDelta) > 0.4,
                explanation: `Hidden-state confidence ${prev.confidence.toFixed(3)} → ${curr.confidence.toFixed(3)} (${confDelta > 0 ? "+" : ""}${confDelta.toFixed(3)})`,
                evidenceIds: curr.candidates[0]?.supportingQuantIds.slice(0, 2) ?? [],
                now: ctx.now,
            }));
        }

        // Entropy shift
        const entropyDelta = curr.entropy - prev.entropy;
        if (Math.abs(entropyDelta) > 0.15) {
            diffs.push(buildDiff({
                contextId: input.contextId,
                type: "hidden_state_diff",
                sourceRefId: curr.id,
                before: prev.entropy,
                after: curr.entropy,
                magnitude: clamp(Math.abs(entropyDelta)),
                entropyDelta,
                direction: entropyDelta > 0 ? "entropy_increasing" : "entropy_decreasing",
                explanation: `Hidden-state entropy ${prev.entropy.toFixed(3)} → ${curr.entropy.toFixed(3)}`,
                evidenceIds: [],
                now: ctx.now,
            }));
        }

        // Collapse emerged
        if (!prev.collapseDetected && curr.collapseDetected) {
            diffs.push(buildDiff({
                contextId: input.contextId,
                type: "collapse_diff",
                sourceRefId: curr.id,
                before: false,
                after: true,
                magnitude: 0.9,
                direction: "collapse_emerged",
                explanation: `Hidden state collapsed to dominant estimate '${curr.topLabel}'`,
                evidenceIds: curr.candidates[0]?.supportingQuantIds.slice(0, 4) ?? [],
                now: ctx.now,
            }));
        }

        // Split emerged
        if (!prev.splitDetected && curr.splitDetected) {
            diffs.push(buildDiff({
                contextId: input.contextId,
                type: "hidden_state_diff",
                sourceRefId: curr.id,
                before: false,
                after: true,
                magnitude: 0.75,
                direction: "split_emerged",
                explanation: `Hidden-state split detected: ${curr.candidates.slice(0, 2).map(c => c.label).join(" vs ")}`,
                evidenceIds: curr.candidates.flatMap(c => c.supportingQuantIds.slice(0, 2)),
                now: ctx.now,
            }));
        }

        const maxSig = diffs.length > 0 ? Math.max(...diffs.map(d => d.significance)) : 0;
        return successResult(manifest, diffs, clamp(maxSig), ctx, startedAt, "hidden_state_diff");
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
