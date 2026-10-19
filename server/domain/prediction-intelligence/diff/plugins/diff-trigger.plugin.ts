import { randomUUID } from "crypto";
import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { DiffTriggerPluginInput, DiffTrigger } from "../types.js";
import { SIGNIFICANCE_THRESHOLD } from "../types.js";
import { clamp, makeDiffManifest, successResult } from "./plugin-helpers.js";

const manifest = makeDiffManifest({
    name: "diff-trigger",
    subPod: "diff-trigger",
    capability: "diff.trigger_emission",
    description: "Emits action triggers when significant diffs exceed threshold (spec §28).",
    inputTypes: ["DiffTriggerPluginInput"],
    outputTypes: ["DiffTrigger[]"],
    timeoutMs: 6,
});

export const diffTriggerPlugin: PredictionPlugin<DiffTriggerPluginInput, DiffTrigger[]> = {
    manifest,

    async canHandle(input: DiffTriggerPluginInput): Promise<PluginDecision> {
        const ok = !!input?.contextId && Array.isArray(input?.diffs);
        return {
            shouldRun: ok,
            reason: ok ? "valid trigger input" : "missing contextId or diffs",
            priority: 70,
            estimatedCost: { latencyMs: 1, dbReads: 0, vectorQueries: 0, agentCalls: 0 },
        };
    },

    async execute(input: DiffTriggerPluginInput, ctx: PluginContext): Promise<PluginResult<DiffTrigger[]>> {
        const startedAt = new Date().toISOString();
        const threshold = input.significanceThreshold ?? SIGNIFICANCE_THRESHOLD;
        const triggers: DiffTrigger[] = [];
        const seen = new Set<string>();

        const addTrigger = (type: DiffTrigger["type"], significance: number, reason: string, evidenceIds: string[]) => {
            if (!seen.has(type)) {
                seen.add(type);
                triggers.push({ id: randomUUID(), type, significance: clamp(significance), reason, evidenceIds, createdAt: ctx.now });
            }
        };

        const significantDiffs = input.diffs.filter(d => d.significance >= threshold);

        for (const diff of significantDiffs) {
            const ev = diff.evidenceIds.slice(0, 4);

            // prediction_recompute: major hidden-state, prediction, or branch diffs
            if (diff.type === "hidden_state_diff" || diff.type === "prediction_diff" || diff.type === "collapse_diff") {
                if (diff.significance >= 0.75) {
                    addTrigger("prediction_recompute", diff.significance, `${diff.type}: ${diff.explanation ?? diff.direction}`, ev);
                }
            }

            // branch_recompute: quant and quant_field diffs
            if (diff.type === "quant_diff" || diff.type === "quant_field_diff") {
                if (diff.significance >= 0.70) {
                    addTrigger("branch_recompute", diff.significance, `${diff.type}: ${diff.explanation ?? diff.direction}`, ev);
                }
            }

            // hidden_state_recompute: realm or quant changes
            if (diff.type === "realm_diff" || diff.type === "quant_diff") {
                if (diff.significance >= 0.72) {
                    addTrigger("hidden_state_recompute", diff.significance, `${diff.type}: ${diff.explanation ?? diff.direction}`, ev);
                }
            }

            // collapse_recheck: any collapse signal
            if (diff.type === "collapse_diff") {
                addTrigger("collapse_recheck", diff.significance, `Collapse detected: ${diff.explanation ?? diff.direction}`, ev);
            }

            // anomaly_alert: any anomaly above threshold
            if (diff.anomalyDetected && diff.significance >= 0.60) {
                addTrigger("anomaly_alert", diff.significance, `Anomaly in ${diff.type}: ${diff.explanation ?? diff.direction}`, ev);
            }

            // memory_refresh: drift or high-significance event shift
            if (diff.driftDetected || (diff.type === "event_diff" && diff.significance >= 0.80)) {
                addTrigger("memory_refresh", diff.significance, `${diff.driftDetected ? "Drift detected" : "Event anomaly"}: ${diff.explanation ?? ""}`, ev);
            }

            // investigation_branch: very high significance
            if (diff.significance >= 0.90) {
                addTrigger("investigation_branch", diff.significance, `High significance diff ${diff.type}: ${diff.explanation ?? diff.direction}`, ev);
            }
        }

        triggers.sort((a, b) => b.significance - a.significance);

        return successResult(manifest, triggers, triggers.length > 0 ? Math.max(...triggers.map(t => t.significance)) : 0,
            ctx, startedAt, "trigger_emission");
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
