import { randomUUID } from "crypto";
import type {
    PredictionPlugin, PluginManifest, PluginContext, PluginDecision, PluginResult, PluginHealth, PluginMetrics,
} from "../../plugin-runtime/types.js";
import type { RealmAgreementScore, RealmAgreementInput } from "../types.js";
import type { RealmContribution, RealmName } from "../../quant/types.js";

// ============================================================================
// REALM AGREEMENT PLUGIN — Spec §29
// Scores how much realms agree using effect direction consensus.
// ============================================================================

const manifest: PluginManifest = {
    name: "realm-agreement", version: "1.0.0", pod: "realm-mesh", subPod: "agreement",
    capability: "realm.score_agreement",
    description: "Scores realm agreement by comparing contribution effect directions",
    owner: "prediction-intelligence", inputTypes: ["RealmAgreementInput"], outputTypes: ["RealmAgreementScore"],
    execution: { type: "typescript_in_process", mode: "sync", latencyClass: "realtime", timeoutMs: 15, retryable: false, maxRetries: 0 },
    state: { readsState: false, writesState: false, stateKeys: [] },
    storage: { postgres: { read: false, write: false, tables: [] }, qdrant: { read: false, write: false, collections: [] }, redis: { read: false, write: false, keyPrefixes: [] }, objectStorage: { read: false, write: false, buckets: [] } },
    agents: { usesAgents: false, allowedForHotPath: true, maxAgentCalls: 0 },
    safety: { deterministic: true, requiresGovernance: false, producesAction: false, producesInference: true, producesPrediction: false, mayIncreaseRisk: false },
    dependencies: { requiredPlugins: [], optionalPlugins: [], externalServices: [] },
    rollout: { status: "active", trafficPercent: 100 },
};

function met(start: string): PluginMetrics {
    const end = new Date().toISOString();
    return { startedAt: start, completedAt: end, durationMs: Date.parse(end) - Date.parse(start), dbReads: 0, dbWrites: 0, vectorQueries: 0, cacheReads: 0, cacheWrites: 0, agentCalls: 0, outputSizeBytes: 0 };
}

// Effect polarity — positive increases confidence/collapse, negative increases entropy
const POSITIVE_EFFECTS = new Set(["boost", "collapse", "decrease_entropy", "explain"]);
const NEGATIVE_EFFECTS = new Set(["suppress", "split", "increase_entropy", "warn", "constrain"]);

function realmPolarity(contribs: RealmContribution[]): "positive" | "negative" | "neutral" {
    let pos = 0; let neg = 0;
    contribs.forEach(c => {
        if (POSITIVE_EFFECTS.has(c.effect)) pos += c.amount * c.confidence;
        else if (NEGATIVE_EFFECTS.has(c.effect)) neg += c.amount * c.confidence;
    });
    if (pos > neg * 1.2) return "positive";
    if (neg > pos * 1.2) return "negative";
    return "neutral";
}

export const realmAgreementPlugin: PredictionPlugin<RealmAgreementInput, RealmAgreementScore> = {
    manifest,
    async canHandle(input: RealmAgreementInput): Promise<PluginDecision> {
        const ok = !!input?.contextId && Array.isArray(input?.contributions) && input.contributions.length > 0;
        return { shouldRun: ok, reason: ok ? "valid" : "missing contextId or contributions", priority: 45, estimatedCost: { latencyMs: 1, dbReads: 0, vectorQueries: 0, agentCalls: 0 } };
    },
    async execute(input: RealmAgreementInput, ctx: PluginContext): Promise<PluginResult<RealmAgreementScore>> {
        const start = new Date().toISOString();
        const { contextId, contributions, quantId, branchId } = input;

        // Group contributions by realm
        const byRealm = new Map<RealmName, RealmContribution[]>();
        for (const c of contributions) {
            const existing = byRealm.get(c.realm) ?? [];
            existing.push(c);
            byRealm.set(c.realm, existing);
        }

        const polarities = new Map<RealmName, "positive" | "negative" | "neutral">();
        byRealm.forEach((contribs, realm) => polarities.set(realm, realmPolarity(contribs)));

        // Determine dominant polarity
        let pos = 0; let neg = 0;
        polarities.forEach(p => { if (p === "positive") pos++; else if (p === "negative") neg++; });
        const dominant = pos > neg ? "positive" : neg > pos ? "negative" : "neutral";

        const agreeing: RealmName[] = [];
        const disagreeing: RealmName[] = [];
        const neutral: RealmName[] = [];

        polarities.forEach((p, realm) => {
            if (p === dominant) agreeing.push(realm);
            else if (p === "neutral") neutral.push(realm);
            else disagreeing.push(realm);
        });

        const total = agreeing.length + disagreeing.length + neutral.length;
        const score = total > 0 ? agreeing.length / total : 0;

        const agreementScore: RealmAgreementScore = {
            id: randomUUID(), contextId, branchId, quantId, score,
            agreeingRealms: agreeing, disagreeingRealms: disagreeing, neutralRealms: neutral,
            explanation: `${agreeing.length}/${total} realms agree (dominant=${dominant})`,
            createdAt: ctx.now,
        };

        return {
            pluginName: manifest.name, pluginVersion: manifest.version, status: "success",
            output: agreementScore, confidence: 1.0, evidenceIds: [], warnings: [], errors: [], metrics: met(start),
            provenance: { source: "plugin", method: "polarity_consensus", pluginName: manifest.name, pluginVersion: manifest.version, evidenceIds: [], createdAt: ctx.now },
        };
    },
    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
