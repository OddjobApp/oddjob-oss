// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN - MEMORY POD
// Core TypeScript type definitions (spec §7-§26)
// ============================================================================

import type { DomainContext, Provenance } from "../quant/types.js";
import type { VectorPort } from "../plugin-runtime/types.js";

export type PredictionMode = "realtime" | "interactive" | "analysis" | "batch";

// ---------------------------------------------------------------------------
// Memory Type (spec §8)
// ---------------------------------------------------------------------------

export type MemoryType =
    | "short_term"
    | "long_term"
    | "pattern"
    | "quant"
    | "attractor"
    | "outcome"
    | "baseline"
    | "branch"
    | "hidden_state"
    | "epistemic";

// ---------------------------------------------------------------------------
// Pattern Memory (spec §13)
// ---------------------------------------------------------------------------

export type PatternType =
    | "event_sequence_pattern"
    | "quant_field_pattern"
    | "semantic_pattern"
    | "causal_pattern"
    | "geographic_route_pattern"
    | "spatial_relationship_pattern"
    | "epistemic_trajectory_pattern"
    | "branch_collapse_pattern"
    | "resolution_pattern"
    | "failure_pattern";

export interface HistoricalOutcomeSummary {
    actualOutcome: string;
    matchRate: number;
    sampleCount: number;
}

export interface PatternMemory {
    id: string;
    name: string;
    patternType: PatternType;
    signature?: string;
    embeddingId?: string;
    typicalPredicates: string[];
    typicalPostPredicates: string[];
    historicalOutcomes: HistoricalOutcomeSummary[];
    confidence: number;
    supportCount: number;
    falsePositiveRate?: number;
    createdAt: string;
    updatedAt: string;
}

// ---------------------------------------------------------------------------
// Attractor Memory (spec §15)
// ---------------------------------------------------------------------------

export type AttractorType =
    | "semantic_attractor"
    | "hidden_state_attractor"
    | "geographic_attractor"
    | "spatial_attractor"
    | "epistemic_attractor"
    | "branch_attractor";

export interface AttractorMemory {
    id: string;
    name: string;
    type: AttractorType;
    embeddingId?: string;
    description: string;
    associatedPredicates: string[];
    associatedHiddenStates: string[];
    confidence: number;
    pullStrength: number;
    createdAt: string;
    updatedAt: string;
}

// ---------------------------------------------------------------------------
// Historical Outcome (spec §16)
// ---------------------------------------------------------------------------

export interface HistoricalOutcome {
    id: string;
    contextId: string;
    predictionId: string;
    branchId?: string;
    predictedPredicate: string;
    actualOutcome: string;
    matched: boolean;
    confidenceAtPrediction: number;
    entropyAtPrediction: number;
    occurredAt: string;
    recordedAt: string;
}

// ---------------------------------------------------------------------------
// Baseline Memory (spec §17)
// ---------------------------------------------------------------------------

export interface BaselineMemory {
    id: string;
    contextId: string;
    baselineType: string;
    scope: string;
    value: Record<string, unknown>;
    confidence: number;
    sampleSize: number;
    validFrom?: string;
    validTo?: string;
    updatedAt: string;
}

// ---------------------------------------------------------------------------
// Memory Recall Result (spec §7)
// ---------------------------------------------------------------------------

export interface MemoryRecallResult<T = unknown> {
    id: string;
    contextId: string;
    memoryType: MemoryType;
    item: T;
    relevance: number;
    confidence: number;
    similarity?: number;
    recency?: number;
    frequency?: number;
    outcomeReliability?: number;
    evidenceIds: string[];
    provenance: Provenance;
    explanation: string;
}

// ---------------------------------------------------------------------------
// Memory Recall Input (spec §9)
// ---------------------------------------------------------------------------

export interface MemoryRecallInput {
    contextId: string;
    memoryTypes: MemoryType[];
    query?: string;
    embedding?: number[];
    quantIds?: string[];
    eventIds?: string[];
    branchIds?: string[];
    hiddenStateIds?: string[];
    windowId?: string;
    mode: PredictionMode;
    limit: number;
    filters?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Plugin-specific input types
// ---------------------------------------------------------------------------

export interface ShortTermMemoryPluginInput {
    contextId: string;
    recentQuants: {
        id: string;
        label?: string;
        type: string;
        magnitude: number;
        confidence: number;
        updatedAt: string;
    }[];
    activeBranches: {
        id: string;
        predicate: string;
        probability: number;
        branchScore: number;
        status: string;
    }[];
    mode: PredictionMode;
}

export interface PatternMemoryPluginInput {
    contextId: string;
    patterns: PatternMemory[];
    activePredicates: string[];
    vectorResults: { id: string; score: number }[];
    mode: PredictionMode;
}

export interface BaselineMemoryPluginInput {
    contextId: string;
    baselines: BaselineMemory[];
    requestedTypes: string[];
    mode: PredictionMode;
}

export interface OutcomeMemoryPluginInput {
    contextId: string;
    outcomes: HistoricalOutcome[];
    targetPredicates: string[];
    mode: PredictionMode;
}

export interface AttractorMemoryPluginInput {
    contextId: string;
    attractors: AttractorMemory[];
    queryPredicates: string[];
    queryHiddenStates: string[];
    vectorResults: { id: string; score: number }[];
    mode: PredictionMode;
}

export interface MemoryRecallScorerInput {
    contextId: string;
    candidates: MemoryRecallResult[];
    mode: PredictionMode;
    limit: number;
}

// ---------------------------------------------------------------------------
// Store inputs
// ---------------------------------------------------------------------------

export interface StorePatternInput {
    name: string;
    patternType: PatternType;
    signature?: string;
    typicalPredicates: string[];
    typicalPostPredicates: string[];
    historicalOutcomes?: HistoricalOutcomeSummary[];
    confidence: number;
    embedding?: number[];
}

export interface StoreOutcomeInput {
    contextId: string;
    predictionId: string;
    branchId?: string;
    predictedPredicate: string;
    actualOutcome: string;
    matched: boolean;
    confidenceAtPrediction: number;
    entropyAtPrediction: number;
    occurredAt: string;
}

export interface BaselineRecallInput {
    contextId: string;
    baselineTypes?: string[];
    scope?: string;
    mode: PredictionMode;
}

export interface AttractorRecallInput {
    contextId: string;
    embedding?: number[];
    predicates?: string[];
    hiddenStates?: string[];
    mode: PredictionMode;
    limit?: number;
}

export interface MemoryConsolidationInput {
    contextId: string;
    mode: PredictionMode;
}

export interface MemoryConsolidationResult {
    patternsCreated: number;
    baselinesUpdated: number;
    attractorsUpdated: number;
}

export interface MemoryDecayInput {
    contextId?: string;
    maxAgeSeconds?: number;
}

export interface MemoryDecayResult {
    memoriesDecayed: number;
    memoriesInvalidated: number;
}

// ---------------------------------------------------------------------------
// Memory Port (spec §26)
// ---------------------------------------------------------------------------

export interface MemoryPort {
    recall(input: MemoryRecallInput, ctx: DomainContext): Promise<MemoryRecallResult[]>;
    storePattern(input: StorePatternInput, ctx: DomainContext): Promise<PatternMemory>;
    storeOutcome(input: StoreOutcomeInput, ctx: DomainContext): Promise<HistoricalOutcome>;
    getBaselines(input: BaselineRecallInput, ctx: DomainContext): Promise<BaselineMemory[]>;
    getNearestAttractors(input: AttractorRecallInput, ctx: DomainContext): Promise<MemoryRecallResult<AttractorMemory>[]>;
    consolidate(input: MemoryConsolidationInput, ctx: DomainContext): Promise<MemoryConsolidationResult>;
    decay(input: MemoryDecayInput, ctx: DomainContext): Promise<MemoryDecayResult>;
}

// ---------------------------------------------------------------------------
// Mode limits
// ---------------------------------------------------------------------------

export const MEMORY_LIMITS: Record<PredictionMode, { maxResults: number; maxPatterns: number; maxOutcomes: number; useVector: boolean }> = {
    realtime:    { maxResults: 5,  maxPatterns: 3,  maxOutcomes: 5,  useVector: false },
    interactive: { maxResults: 15, maxPatterns: 10, maxOutcomes: 20, useVector: true  },
    analysis:    { maxResults: 50, maxPatterns: 50, maxOutcomes: 100, useVector: true },
    batch:       { maxResults: 100, maxPatterns: 100, maxOutcomes: 500, useVector: true },
};

// Qdrant collection names (spec §27)
export const QDRANT_COLLECTIONS = {
    patterns: "pattern_embeddings",
    quants: "quant_embeddings",
    attractors: "attractor_embeddings",
    episodes: "episode_embeddings",
    trajectories: "trajectory_embeddings",
    hiddenStates: "hidden_state_embeddings",
} as const;

export const MEMORY_EPSILON = 1e-6;

// Recency decay constant (spec §23): memory_strength_t = base × exp(-λ Δt)
export const MEMORY_DECAY_LAMBDA = 0.1; // per day
