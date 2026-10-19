import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { ContextLifecycleInput, PredictionContext, ContextStatus } from "../types.js";
import { CONTEXT_IDLE_TIMEOUT_MS } from "../types.js";
import { makeContextManifest, successResult } from "./plugin-helpers.js";

export interface ContextLifecyclePluginInput {
    input: ContextLifecycleInput;
    context: PredictionContext;
}

const manifest = makeContextManifest({
    name: "context-lifecycle",
    subPod: "context-lifecycle",
    capability: "context.lifecycle",
    description: "Manages context status transitions: active → idle → closed → archived (spec §16).",
    inputTypes: ["ContextLifecyclePluginInput"],
    outputTypes: ["PredictionContext"],
    timeoutMs: 5,
});

export const contextLifecyclePlugin: PredictionPlugin<ContextLifecyclePluginInput, PredictionContext> = {
    manifest,

    async canHandle(input: ContextLifecyclePluginInput): Promise<PluginDecision> {
        const ok = !!input?.input?.contextId && !!input?.context;
        return { shouldRun: ok, reason: ok ? "valid lifecycle input" : "missing contextId or context", priority: 85, estimatedCost: { latencyMs: 0, dbReads: 0, vectorQueries: 0, agentCalls: 0 } };
    },

    async execute(input: ContextLifecyclePluginInput, ctx: PluginContext): Promise<PluginResult<PredictionContext>> {
        const startedAt = new Date().toISOString();
        const now = ctx.now;

        const updated: PredictionContext = {
            ...input.context,
            status: input.input.status,
            lastSeenAt: now,
            closedAt: (input.input.status === "closed" || input.input.status === "merged" || input.input.status === "archived")
                ? input.input.closedAt ?? now
                : input.context.closedAt,
            metadata: {
                ...input.context.metadata,
                lifecycleReason: input.input.reason,
                lifecycleUpdatedAt: now,
            },
        };

        return successResult(manifest, updated, input.context.confidence, ctx, startedAt, "lifecycle_update");
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
