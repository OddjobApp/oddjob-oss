import { randomUUID } from "crypto";
import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { ContextCreationInput, PredictionContext, ContextType } from "../types.js";
import { DEFAULT_CONTEXT_PERMISSIONS } from "../types.js";
import { clamp, makeContextManifest, successResult } from "./plugin-helpers.js";

const manifest = makeContextManifest({
    name: "context-creator",
    subPod: "context-creator",
    capability: "context.create",
    description: "Creates a new prediction context with permissions, provenance, and hierarchy links (spec §15).",
    inputTypes: ["ContextCreationInput"],
    outputTypes: ["PredictionContext"],
    timeoutMs: 8,
});

function deriveLabel(input: ContextCreationInput): string {
    if (input.label) return input.label;
    const parts: string[] = [input.type];
    if (input.workflowId) parts.push(input.workflowId);
    else if (input.sessionId) parts.push(input.sessionId);
    else if (input.actorId) parts.push(input.actorId);
    return parts.join("_");
}

export const contextCreatorPlugin: PredictionPlugin<ContextCreationInput, PredictionContext> = {
    manifest,

    async canHandle(input: ContextCreationInput): Promise<PluginDecision> {
        const ok = !!input?.type && !!input?.mode;
        return { shouldRun: ok, reason: ok ? "valid creation input" : "missing type or mode", priority: 90, estimatedCost: { latencyMs: 1, dbReads: 0, vectorQueries: 0, agentCalls: 0 } };
    },

    async execute(input: ContextCreationInput, pluginCtx: PluginContext): Promise<PluginResult<PredictionContext>> {
        const startedAt = new Date().toISOString();
        const now = pluginCtx.now;

        // Compute permissions based on type and sensitivity
        const permissions = {
            ...DEFAULT_CONTEXT_PERMISSIONS,
            allowSensitiveData: false,
            allowGeographicProcessing: input.type === "region" || input.type === "spatial_scene",
            allowSpatialProcessing: input.type === "spatial_scene",
            allowAgentAssist: input.type === "agent" || input.type === "task",
        };

        const context: PredictionContext = {
            id: randomUUID(),
            type: input.type,
            label: deriveLabel(input),
            tenantId: input.tenantId,
            applicationId: input.applicationId,
            actorId: input.actorId,
            workflowId: input.workflowId,
            sessionId: input.sessionId,
            taskId: input.taskId,
            agentId: input.agentId,
            regionId: input.regionId,
            parentContextIds: input.parentContextIds ?? [],
            childContextIds: [],
            relatedContextIds: [],
            status: "active",
            confidence: clamp(input.confidence ?? 0.8),
            resolutionMethod: input.resolutionMethod ?? "created",
            evidenceEventIds: input.evidenceEventIds ?? [],
            evidenceQuantIds: [],
            permissions,
            baselineRefs: [],
            startedAt: now,
            lastSeenAt: now,
            provenance: { source: "context-pod", method: "context_creation", resolvedBy: "context-creator-plugin", evidenceIds: input.evidenceEventIds ?? [], createdAt: now },
            metadata: input.metadata ?? {},
            mode: input.mode,
            createdAt: now,
        };

        return successResult(manifest, context, context.confidence, pluginCtx, startedAt, "context_creation");
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
