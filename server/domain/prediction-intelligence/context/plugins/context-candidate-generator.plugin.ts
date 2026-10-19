import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { ContextResolutionInput, ContextCandidate, PredictionContext, ContextType } from "../types.js";
import { MAX_CANDIDATES_REALTIME, MAX_CANDIDATES_INTERACTIVE } from "../types.js";
import { clamp, makeContextManifest, successResult, temporalProximity } from "./plugin-helpers.js";

export interface ContextCandidateGeneratorInput {
    input: ContextResolutionInput;
    activeContexts: PredictionContext[];
    now: string;
}

const manifest = makeContextManifest({
    name: "context-candidate-generator",
    subPod: "context-candidate-generator",
    capability: "context.generate_candidates",
    description: "Generates candidate contexts for an event using explicit IDs, workflow/session/actor fields, and temporal proximity (spec §13).",
    inputTypes: ["ContextCandidateGeneratorInput"],
    outputTypes: ["ContextCandidate[]"],
    timeoutMs: 8,
});

function inferContextType(input: ContextResolutionInput): ContextType {
    if (input.workflowId) return "workflow";
    if (input.sessionId) return "session";
    if (input.agentId) return "agent";
    if (input.taskId) return "task";
    if (input.regionId) return "region";
    if (input.actorId) return "actor";
    if (input.tenantId) return "tenant";
    return "custom";
}

export const contextCandidateGeneratorPlugin: PredictionPlugin<ContextCandidateGeneratorInput, ContextCandidate[]> = {
    manifest,

    async canHandle(): Promise<PluginDecision> {
        return { shouldRun: true, reason: "always generate candidates", priority: 100, estimatedCost: { latencyMs: 1, dbReads: 0, vectorQueries: 0, agentCalls: 0 } };
    },

    async execute(input: ContextCandidateGeneratorInput, ctx: PluginContext): Promise<PluginResult<ContextCandidate[]>> {
        const startedAt = new Date().toISOString();
        const { input: req, activeContexts, now } = input;
        const maxCandidates = req.mode === "realtime" ? MAX_CANDIDATES_REALTIME : MAX_CANDIDATES_INTERACTIVE;

        const candidates: ContextCandidate[] = [];

        // 1. Explicit context hint
        if (req.contextHint) {
            const exact = activeContexts.find(c => c.id === req.contextHint);
            if (exact) {
                candidates.push({ contextId: exact.id, type: exact.type, label: exact.label, score: 1.0, confidence: 0.99, evidenceIds: [], reason: "explicit context ID match" });
            }
        }

        // 2. Workflow ID match
        if (req.workflowId) {
            const wfMatches = activeContexts.filter(c => c.workflowId === req.workflowId && c.status === "active");
            for (const wf of wfMatches) {
                const prox = temporalProximity(req.event?.occurredAt ?? now, wf.lastSeenAt);
                const score = clamp(0.85 * prox + (req.actorId === wf.actorId ? 0.1 : 0));
                candidates.push({ contextId: wf.id, type: wf.type, label: wf.label, score, confidence: 0.92, evidenceIds: [], reason: `workflow_id match (${req.workflowId}), proximity=${prox.toFixed(3)}` });
            }
        }

        // 3. Session ID match
        if (req.sessionId) {
            const sessMatches = activeContexts.filter(c => c.sessionId === req.sessionId && c.status === "active");
            for (const s of sessMatches) {
                const prox = temporalProximity(req.event?.occurredAt ?? now, s.lastSeenAt);
                candidates.push({ contextId: s.id, type: s.type, label: s.label, score: clamp(0.80 * prox), confidence: 0.88, evidenceIds: [], reason: `session_id match (${req.sessionId})` });
            }
        }

        // 4. Correlation ID match
        if (req.correlationId) {
            const corrMatches = activeContexts.filter(c => c.metadata?.correlationId === req.correlationId && c.status === "active");
            for (const c of corrMatches) {
                candidates.push({ contextId: c.id, type: c.type, label: c.label, score: 0.75, confidence: 0.80, evidenceIds: [], reason: `correlation_id match (${req.correlationId})` });
            }
        }

        // 5. Actor match with temporal proximity
        if (req.actorId && !req.workflowId && !req.sessionId) {
            const actorMatches = activeContexts.filter(c => c.actorId === req.actorId && c.status === "active");
            for (const a of actorMatches.slice(0, 3)) {
                const prox = temporalProximity(req.event?.occurredAt ?? now, a.lastSeenAt);
                const score = clamp(0.60 * prox);
                if (score > 0.2) candidates.push({ contextId: a.id, type: a.type, label: a.label, score, confidence: 0.70, evidenceIds: [], reason: `actor_id match (${req.actorId}), proximity=${prox.toFixed(3)}` });
            }
        }

        // 6. Tenant-scoped recent contexts as fallback
        if (candidates.length === 0 && req.tenantId) {
            const tenantCtxs = activeContexts.filter(c => c.tenantId === req.tenantId && c.status === "active")
                .sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt))
                .slice(0, 2);
            for (const t of tenantCtxs) {
                const prox = temporalProximity(req.event?.occurredAt ?? now, t.lastSeenAt);
                if (prox > 0.1) candidates.push({ contextId: t.id, type: t.type, label: t.label, score: clamp(0.40 * prox), confidence: 0.55, evidenceIds: [], reason: `tenant fallback, proximity=${prox.toFixed(3)}` });
            }
        }

        // 7. Always offer "create new" candidate
        candidates.push({ type: inferContextType(req), score: 0.30, confidence: 0.70, evidenceIds: [], reason: "create new context" });

        const top = candidates.sort((a, b) => b.score - a.score).slice(0, maxCandidates);
        return successResult(manifest, top, top[0]?.confidence ?? 0.5, ctx, startedAt, "candidate_generation");
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
