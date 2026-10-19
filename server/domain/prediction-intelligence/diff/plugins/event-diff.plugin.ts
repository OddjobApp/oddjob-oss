import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { EventDiffPluginInput, DiffRecord } from "../types.js";
import { clamp, makeDiffManifest, successResult, buildDiff } from "./plugin-helpers.js";

const manifest = makeDiffManifest({
    name: "event-diff",
    subPod: "event-diff",
    capability: "diff.event_diff",
    description: "Detects changes in event behavior: frequency, type appearance/disappearance, timing shifts (spec §9).",
    inputTypes: ["EventDiffPluginInput"],
    outputTypes: ["DiffRecord[]"],
    timeoutMs: 12,
});

export const eventDiffPlugin: PredictionPlugin<EventDiffPluginInput, DiffRecord[]> = {
    manifest,

    async canHandle(input: EventDiffPluginInput): Promise<PluginDecision> {
        const ok = !!input?.contextId;
        return {
            shouldRun: ok,
            reason: ok ? "valid event diff input" : "missing contextId",
            priority: 80,
            estimatedCost: { latencyMs: 2, dbReads: 0, vectorQueries: 0, agentCalls: 0 },
        };
    },

    async execute(input: EventDiffPluginInput, ctx: PluginContext): Promise<PluginResult<DiffRecord[]>> {
        const startedAt = new Date().toISOString();
        const diffs: DiffRecord[] = [];
        const windowSec = Math.max(input.windowDurationMs / 1000, 1);

        // Frequency diff
        const prevCount = input.previousEvents.length;
        const currCount = input.currentEvents.length;
        if (prevCount > 0 || currCount > 0) {
            const prevRate = prevCount / windowSec;
            const currRate = currCount / windowSec;
            const relativeChange = prevRate > 0 ? Math.abs(currRate - prevRate) / prevRate : (currRate > 0 ? 1 : 0);
            if (relativeChange > 0.1) {
                diffs.push(buildDiff({
                    contextId: input.contextId,
                    type: "event_diff",
                    realm: "temporal",
                    before: prevRate,
                    after: currRate,
                    magnitude: clamp(relativeChange),
                    direction: currRate > prevRate ? "increasing" : "decreasing",
                    anomalyDetected: relativeChange > 3,
                    explanation: `Event frequency changed ${prevRate.toFixed(2)}/s → ${currRate.toFixed(2)}/s (${(relativeChange * 100).toFixed(0)}% change)`,
                    evidenceIds: input.currentEvents.slice(0, 4).map(e => e.id),
                    now: ctx.now,
                }));
            }
        }

        // New event types
        const prevActions = new Set(input.previousEvents.map(e => e.action));
        const currActions = new Set(input.currentEvents.map(e => e.action));

        const newActions = [...currActions].filter(a => !prevActions.has(a));
        if (newActions.length > 0) {
            diffs.push(buildDiff({
                contextId: input.contextId,
                type: "event_diff",
                realm: "semantic",
                before: [...prevActions],
                after: [...currActions],
                magnitude: clamp(newActions.length / Math.max(currActions.size, 1) * 0.8),
                direction: "new_type_emerged",
                explanation: `New event type(s) appeared: ${newActions.slice(0, 3).join(", ")}`,
                evidenceIds: input.currentEvents.filter(e => newActions.includes(e.action)).slice(0, 4).map(e => e.id),
                now: ctx.now,
            }));
        }

        // Disappeared event types
        const goneActions = [...prevActions].filter(a => !currActions.has(a));
        if (goneActions.length > 0) {
            diffs.push(buildDiff({
                contextId: input.contextId,
                type: "event_diff",
                realm: "temporal",
                before: [...prevActions],
                after: [...currActions],
                magnitude: clamp(goneActions.length / Math.max(prevActions.size, 1) * 0.6),
                direction: "type_disappeared",
                anomalyDetected: goneActions.length > 2,
                explanation: `Event type(s) no longer seen: ${goneActions.slice(0, 3).join(", ")}`,
                evidenceIds: input.previousEvents.filter(e => goneActions.includes(e.action)).slice(0, 4).map(e => e.id),
                now: ctx.now,
            }));
        }

        const maxSignificance = diffs.length > 0 ? Math.max(...diffs.map(d => d.significance)) : 0;
        return successResult(manifest, diffs, clamp(maxSignificance), ctx, startedAt, "event_diff",
            diffs.flatMap(d => d.evidenceIds));
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
