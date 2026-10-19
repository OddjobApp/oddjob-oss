// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN — QUANT POD
// Core TypeScript type definitions (spec §8, §9, §10)
// ============================================================================

// ---------------------------------------------------------------------------
// Quant Types
// ---------------------------------------------------------------------------

export type QuantType =
    | "event_signal"
    | "absence_signal"
    | "semantic_signal"
    | "temporal_signal"
    | "causal_signal"
    | "geographic_signal"
    | "spatial_signal"
    | "pattern_signal"
    | "contradiction_signal"
    | "hidden_state_signal"
    | "prediction_signal"
    | "anomaly_signal"
    | "resolution_signal";

// ---------------------------------------------------------------------------
// Epistemic State (spec §7)
// ---------------------------------------------------------------------------

export type EpistemicStatus =
    | "known_known"
    | "known_unknown"
    | "unknown_known"
    | "unknown_unknown";

export interface EpistemicState {
    /** Composite classification */
    status: EpistemicStatus;
    /** worldKnownness = evidenceStrength */
    worldKnownness: number;
    /** systemKnownness = recognitionLevel */
    systemKnownness: number;
    evidenceStrength: number;
    recognitionLevel: number;
    resolutionLevel: number;
}

// ---------------------------------------------------------------------------
// Quant Position & Trajectory (spec §9.3, §9.4)
// ---------------------------------------------------------------------------

export interface QuantPosition {
    epistemic: number[];
    semantic?: number[];
    causal?: number[];
    geographic?: number[];
    spatial?: number[];
    geometric?: number[];
}

export interface QuantTrajectory {
    velocity: number[];
    acceleration: number[];
    direction: number[];
    lastPosition?: QuantPosition;
    lastUpdatedAt?: string;
}

// ---------------------------------------------------------------------------
// Quant Lifecycle (spec §9.5)
// ---------------------------------------------------------------------------

export type QuantLifecycleStatus = "active" | "decaying" | "collapsed" | "archived" | "suppressed";

export interface QuantLifecycle {
    status: QuantLifecycleStatus;
    decayRate: number;
    ttlSeconds?: number;
    collapseTargetId?: string;
    archivedAt?: string;
    suppressionReason?: string;
}

// ---------------------------------------------------------------------------
// Realm Name (spec §10)
// ---------------------------------------------------------------------------

export type RealmName =
    | "temporal"
    | "semantic"
    | "causal"
    | "geographic"
    | "spatial"
    | "geometric"
    | "epistemic"
    | "pattern"
    | "attention"
    | "governance_awareness";

// ---------------------------------------------------------------------------
// Realm Contribution (spec §9 — full contract)
// ---------------------------------------------------------------------------

export type RealmEffect =
    | "boost" | "suppress" | "split" | "preserve" | "collapse"
    | "warn" | "constrain" | "explain" | "increase_entropy" | "decrease_entropy";

export type RealmTargetType = "quant" | "branch" | "hidden_state" | "prediction" | "field" | "governance";

export interface RealmContribution {
    id: string;
    contextId: string;
    quantId?: string;
    eventId?: string;
    episodeId?: string;
    branchId?: string;
    hiddenStateId?: string;

    realm: RealmName;
    pluginName: string;
    pluginVersion: string;

    effect: RealmEffect;
    targetType: RealmTargetType;
    targetId?: string;

    amount: number;
    confidence: number;
    uncertaintyDelta: number;
    entropyDelta: number;

    evidenceIds: string[];
    explanation: string;
    metadata: Record<string, unknown>;
    provenance: Provenance;

    createdAt: string;
}

// ---------------------------------------------------------------------------
// Branch Influence (spec §18)
// ---------------------------------------------------------------------------

export type BranchEffect = "boost" | "suppress" | "split" | "preserve" | "collapse";

export interface BranchInfluence {
    id: string;
    quantId: string;
    branchId: string;
    effect: BranchEffect;
    amount: number;
    confidence: number;
    explanation: string;
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Hidden State Influence (spec §19)
// ---------------------------------------------------------------------------

export type HiddenStateEffect = "support" | "oppose" | "split" | "stabilize" | "destabilize";

export interface HiddenStateInfluence {
    id: string;
    quantId: string;
    hiddenStateId: string;
    effect: HiddenStateEffect;
    amount: number;
    confidence: number;
    explanation: string;
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Quant Relationships (spec §10)
// ---------------------------------------------------------------------------

export type QuantRelationshipType =
    | "resonates_with"
    | "interferes_with"
    | "supports"
    | "contradicts"
    | "explains"
    | "causes"
    | "clusters_with"
    | "collapses_into"
    | "derived_from"
    | "supersedes"
    | "decays_into";

export interface QuantRelationship {
    id: string;
    sourceQuantId: string;
    targetQuantId: string;
    type: QuantRelationshipType;
    strength: number;
    confidence: number;
    evidenceIds: string[];
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

export interface Provenance {
    sourceSystem: string;
    sourceId?: string;
    ingestedAt: string;
    createdBy?: string;
}

// ---------------------------------------------------------------------------
// Core Quant (spec §8)
// ---------------------------------------------------------------------------

export interface Quant {
    id: string;
    contextId: string;

    type: QuantType;
    label?: string;

    sourceEventIds: string[];
    sourceEpisodeIds: string[];
    sourcePredictionIds: string[];
    sourceQuantIds: string[];

    magnitude: number;
    confidence: number;
    uncertainty: number;
    entropyContribution: number;

    epistemic: EpistemicState;

    position: QuantPosition;
    trajectory: QuantTrajectory;

    realmContributions: RealmContribution[];
    branchInfluences: BranchInfluence[];
    hiddenStateInfluences: HiddenStateInfluence[];

    relationships: QuantRelationship[];

    lifecycle: QuantLifecycle;

    provenance: Provenance;

    createdAt: string;
    updatedAt: string;
}

// ---------------------------------------------------------------------------
// Quant Field Summary (spec §17)
// ---------------------------------------------------------------------------

export interface QuantFieldSummary {
    id: string;
    contextId: string;
    windowId?: string;
    quantCount: number;
    fieldDensity: number;
    fieldMomentum: number[];
    fieldEntropy: number;
    fieldAlignment: number;
    fieldDivergence: number;
    fieldCoherence: number;
    epistemicCenterOfMass: number[];
    dominantStatus: EpistemicStatus;
    topAttractors: string[];
    collapseProbability: number;
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Collapse Signal (spec §21)
// ---------------------------------------------------------------------------

export type CollapseTargetType = "branch" | "hidden_state" | "attractor" | "resolution";

export interface PredictionCollapseSignal {
    id: string;
    contextId: string;
    collapseDetected: boolean;
    targetType: CollapseTargetType;
    targetId?: string;
    confidence: number;
    supportingQuantIds: string[];
    interferingQuantIds: string[];
    fieldEntropy: number;
    fieldCoherence: number;
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Canonical Event (minimal — enough for Quant Pod)
// ---------------------------------------------------------------------------

export type EventKind = "fact" | "inference" | "prediction" | "absence" | "synthetic";

export interface CanonicalEvent {
    id: string;
    contextId: string;
    source: string;
    actorId?: string;
    objectId?: string;
    action: string;
    eventKind: EventKind;
    occurredAt: string;
    ingestedAt: string;
    confidence: number;
    rawPayload: Record<string, unknown>;
    canonical: Record<string, unknown>;
    provenance: Provenance;
}

// ---------------------------------------------------------------------------
// Prediction Context (minimal)
// ---------------------------------------------------------------------------

export interface PredictionContext {
    id: string;
    tenantId?: string;
    actorId?: string;
    workflowId?: string;
    sessionId?: string;
    mode: "realtime" | "interactive" | "analysis" | "batch";
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Domain Context
// ---------------------------------------------------------------------------

export interface DomainContext {
    requestId: string;
    correlationId: string;
    organizationId?: number;
    userId?: string;
    now: string;
    mode: "realtime" | "interactive" | "analysis" | "batch";
}

// ---------------------------------------------------------------------------
// QuantPort inputs
// ---------------------------------------------------------------------------

export interface UpdateQuantInput {
    quantId: string;
    magnitude?: number;
    confidence?: number;
    uncertainty?: number;
    epistemic?: Partial<EpistemicState>;
    lifecycle?: Partial<QuantLifecycle>;
    realmContributions?: RealmContribution[];
}

export interface RelateQuantsInput {
    sourceQuantId: string;
    targetQuantId: string;
    type: QuantRelationshipType;
    strength: number;
    confidence: number;
    evidenceIds: string[];
}

export interface QuantFieldInput {
    contextId: string;
    windowId?: string;
    limit?: number;
}

export interface QuantBranchInfluenceInput {
    quants: Quant[];
    branchIds: string[];
    realmContributions?: RealmContribution[];
}

export interface QuantHiddenStateInfluenceInput {
    quants: Quant[];
    hiddenStateIds: string[];
}

export interface QuantCollapseInput {
    contextId: string;
    field: QuantFieldSummary;
    branchIds?: string[];
    hiddenStateIds?: string[];
}

// ---------------------------------------------------------------------------
// Episode (minimal — for createFromEpisode)
// ---------------------------------------------------------------------------

export interface Episode {
    id: string;
    contextId: string;
    startedAt: string;
    endedAt?: string;
    actorId?: string;
    action: string;
    confidence: number;
    source: string;
    eventIds: string[];
    summary?: string;
    provenance: Provenance;
}

// ---------------------------------------------------------------------------
// Plugin-specific input types
// ---------------------------------------------------------------------------

export interface QuantTrajectoryInput {
    quant: Quant;
    previousSnapshot?: Quant;
    deltaSeconds: number;
}

export interface QuantResonanceInput {
    quant: Quant;
    candidates: Quant[];
}

export interface QuantInterferenceInput {
    quant: Quant;
    candidates: Quant[];
}

export interface QuantFieldSummaryInput {
    quants: Quant[];
    contextId: string;
    windowId?: string;
}

export interface QuantSingleBranchInfluenceInput {
    quant: Quant;
    branchIds: string[];
    realmContributions?: RealmContribution[];
}

export interface QuantSingleHiddenStateInput {
    quant: Quant;
    hiddenStateIds: string[];
}

export interface QuantDecayInput {
    quant: Quant;
    nowMs: number;
    reinforcement?: number;
}

export interface QuantDecayOutput {
    magnitude: number;
    lifecycle: QuantLifecycle;
}

export interface QuantRelationshipInput {
    sourceQuantId: string;
    targetQuantId: string;
    type: QuantRelationshipType;
    strength: number;
    confidence: number;
    evidenceIds: string[];
    contextId: string;
}

// ---------------------------------------------------------------------------
// Scoring constants (spec §29)
// ---------------------------------------------------------------------------

export const EPISTEMIC_THRESHOLD = 0.5;
export const EPSILON = 1e-6;
