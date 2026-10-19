import { randomUUID } from "crypto";
import type {
    PredictionPlugin,
    PluginManifest,
    PluginContext,
    PluginDecision,
    PluginResult,
    PluginHealth,
    Provenance,
    PluginMetrics,
} from "../../plugin-runtime/types.js";
import type { CanonicalEvent, Quant, EpistemicState } from "../types.js";
import { pluginRegistry } from "../../plugin-runtime/plugin-registry.js";

// ============================================================================
// QUANT GENERATOR PLUGIN — Spec §12 (full manifest / spec §34 structure)
// ============================================================================

const EPISTEMIC_THRESHOLD = 0.5;

function computeEpistemicStatus(evidenceStrength: number, recognitionLevel: number) {
    const worldKnown = evidenceStrength >= EPISTEMIC_THRESHOLD;
    const systemKnown = recognitionLevel >= EPISTEMIC_THRESHOLD;
    if (worldKnown && systemKnown) return "known_known" as const;
    if (!worldKnown && systemKnown) return "known_unknown" as const;
    if (worldKnown && !systemKnown) return "unknown_known" as const;
    return "unknown_unknown" as const;
}

function buildEpistemicState(evidence: number, recognition: number, resolution = 0.1): EpistemicState {
    return {
        status: computeEpistemicStatus(evidence, recognition),
        worldKnownness: evidence,
        systemKnownness: recognition,
        evidenceStrength: evidence,
        recognitionLevel: recognition,
        resolutionLevel: resolution,
    };
}

function makeProvenance(name: string, version: string, ctx: PluginContext, eventId: string): Provenance {
    return {
        source: "plugin",
        method: "event_signal_generation",
        pluginName: name,
        pluginVersion: version,
        evidenceIds: [eventId],
        createdAt: ctx.now,
    };
}

function makeMetrics(startedAt: string, ctx: PluginContext): PluginMetrics {
    const completedAt = new Date().toISOString();
    return {
        startedAt,
        completedAt,
        durationMs: Date.parse(completedAt) - Date.parse(startedAt),
        dbReads: 0,
        dbWrites: 0,
        vectorQueries: 0,
        cacheReads: 0,
        cacheWrites: 0,
        agentCalls: 0,
        outputSizeBytes: 0,
    };
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

const generatorManifest: PluginManifest = {
    name: "quant-generator",
    version: "1.0.0",
    pod: "quant",
    subPod: "generator",
    capability: "quant.generate_from_event",
    description: "Creates initial event_signal quants from canonical events",
    owner: "prediction-intelligence",
    inputTypes: ["CanonicalEvent"],
    outputTypes: ["Quant[]"],
    execution: {
        type: "typescript_in_process",
        mode: "sync",
        latencyClass: "realtime",
        timeoutMs: 50,
        retryable: false,
        maxRetries: 0,
    },
    state: { readsState: false, writesState: false, stateKeys: [] },
    storage: {
        postgres: { read: false, write: false, tables: [] },
        qdrant: { read: false, write: false, collections: [] },
        redis: { read: false, write: false, keyPrefixes: [] },
        objectStorage: { read: false, write: false, buckets: [] },
    },
    agents: { usesAgents: false, allowedForHotPath: true, maxAgentCalls: 0 },
    safety: {
        deterministic: true,
        requiresGovernance: false,
        producesAction: false,
        producesInference: false,
        producesPrediction: false,
        mayIncreaseRisk: false,
    },
    dependencies: { requiredPlugins: [], optionalPlugins: [], externalServices: [] },
    rollout: { status: "active", trafficPercent: 100 },
};

// ---------------------------------------------------------------------------
// Plugin impl
// ---------------------------------------------------------------------------

const quantGeneratorPlugin: PredictionPlugin<CanonicalEvent, Quant[]> = {
    manifest: generatorManifest,

    async canHandle(input: CanonicalEvent): Promise<PluginDecision> {
        const ok = !!input?.id && !!input?.contextId && !!input?.action;
        return {
            shouldRun: ok,
            reason: ok ? "valid canonical event" : "missing required CanonicalEvent fields",
            priority: 100,
            estimatedCost: { latencyMs: 2, dbReads: 0, vectorQueries: 0, agentCalls: 0 },
        };
    },

    async execute(event: CanonicalEvent, ctx: PluginContext): Promise<PluginResult<Quant[]>> {
        const startedAt = new Date().toISOString();
        const confidence = Math.max(0, Math.min(1, event.confidence));
        const uncertainty = Math.max(0, 1 - confidence);
        const magnitude = 0.5;
        const epistemic = buildEpistemicState(confidence, 0.35);

        const quant: Quant = {
            id: randomUUID(),
            contextId: event.contextId,
            type: "event_signal",
            label: `${event.action}_signal`,
            sourceEventIds: [event.id],
            sourceEpisodeIds: [],
            sourcePredictionIds: [],
            sourceQuantIds: [],
            magnitude,
            confidence,
            uncertainty,
            entropyContribution: uncertainty * magnitude,
            epistemic,
            position: { epistemic: [epistemic.worldKnownness, epistemic.systemKnownness, epistemic.resolutionLevel] },
            trajectory: { velocity: [0, 0, 0], acceleration: [0, 0, 0], direction: [0, 0, 0] },
            realmContributions: [],
            branchInfluences: [],
            hiddenStateInfluences: [],
            relationships: [],
            lifecycle: { status: "active", decayRate: 0.01 },
            provenance: { sourceSystem: event.source, sourceId: event.id, ingestedAt: event.ingestedAt, createdBy: "quant-generator" },
            createdAt: ctx.now,
            updatedAt: ctx.now,
        };

        return {
            pluginName: generatorManifest.name,
            pluginVersion: generatorManifest.version,
            status: "success",
            output: [quant],
            confidence: 1.0,
            evidenceIds: [event.id],
            warnings: [],
            errors: [],
            metrics: makeMetrics(startedAt, ctx),
            provenance: makeProvenance(generatorManifest.name, generatorManifest.version, ctx, event.id),
        };
    },

    async health(): Promise<PluginHealth> {
        return {
            pluginName: generatorManifest.name,
            pluginVersion: generatorManifest.version,
            status: "healthy",
            lastCheckedAt: new Date().toISOString(),
            dependencyStatus: {},
        };
    },
};

// ============================================================================
// QUANT EPISTEMIC STATUS PLUGIN — Spec §13
// ============================================================================

const epistemicManifest: PluginManifest = {
    name: "quant-epistemic-status",
    version: "1.0.0",
    pod: "quant",
    subPod: "epistemic",
    capability: "quant.compute_epistemic_state",
    description: "Computes or recomputes epistemic state for a given quant",
    owner: "prediction-intelligence",
    inputTypes: ["Quant"],
    outputTypes: ["EpistemicState"],
    execution: {
        type: "typescript_in_process",
        mode: "sync",
        latencyClass: "realtime",
        timeoutMs: 10,
        retryable: false,
        maxRetries: 0,
    },
    state: { readsState: false, writesState: false, stateKeys: [] },
    storage: {
        postgres: { read: false, write: false, tables: [] },
        qdrant: { read: false, write: false, collections: [] },
        redis: { read: false, write: false, keyPrefixes: [] },
        objectStorage: { read: false, write: false, buckets: [] },
    },
    agents: { usesAgents: false, allowedForHotPath: true, maxAgentCalls: 0 },
    safety: {
        deterministic: true,
        requiresGovernance: false,
        producesAction: false,
        producesInference: false,
        producesPrediction: false,
        mayIncreaseRisk: false,
    },
    dependencies: { requiredPlugins: [], optionalPlugins: [], externalServices: [] },
    rollout: { status: "active", trafficPercent: 100 },
};

const quantEpistemicPlugin: PredictionPlugin<Quant, EpistemicState> = {
    manifest: epistemicManifest,

    async canHandle(input: Quant): Promise<PluginDecision> {
        return {
            shouldRun: !!input?.id,
            reason: input?.id ? "valid quant" : "missing quant id",
            priority: 90,
            estimatedCost: { latencyMs: 1, dbReads: 0, vectorQueries: 0, agentCalls: 0 },
        };
    },

    async execute(quant: Quant, ctx: PluginContext): Promise<PluginResult<EpistemicState>> {
        const startedAt = new Date().toISOString();
        const updated = buildEpistemicState(
            quant.epistemic.evidenceStrength,
            quant.epistemic.recognitionLevel,
            quant.epistemic.resolutionLevel
        );

        return {
            pluginName: epistemicManifest.name,
            pluginVersion: epistemicManifest.version,
            status: "success",
            output: updated,
            confidence: 1.0,
            evidenceIds: quant.sourceEventIds,
            warnings: [],
            errors: [],
            metrics: makeMetrics(startedAt, ctx),
            provenance: {
                source: "plugin",
                method: "threshold_classification",
                pluginName: epistemicManifest.name,
                pluginVersion: epistemicManifest.version,
                evidenceIds: quant.sourceEventIds,
                createdAt: ctx.now,
            },
        };
    },

    async health(): Promise<PluginHealth> {
        return {
            pluginName: epistemicManifest.name,
            pluginVersion: epistemicManifest.version,
            status: "healthy",
            lastCheckedAt: new Date().toISOString(),
            dependencyStatus: {},
        };
    },
};

// ============================================================================
// Self-registration
// ============================================================================

export function registerQuantPlugins(): void {
    pluginRegistry.register(quantGeneratorPlugin);
    pluginRegistry.register(quantEpistemicPlugin);
}

export { quantGeneratorPlugin, quantEpistemicPlugin };
