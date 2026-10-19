// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN - HIDDEN STATE POD
// Core TypeScript type definitions (spec §7-§26)
// ============================================================================

import type {
    Quant,
    QuantFieldSummary,
    DomainContext,
    RealmContribution,
    PredictionContext,
} from "../quant/types.js";
import type { RealmProcessingResult } from "../realm-mesh/types.js";
import type { MemoryRecallResult } from "../memory/types.js";
import type { GraphFeatureSet } from "../graph/types.js";

export type PredictionMode = "realtime" | "interactive" | "analysis" | "batch";

// ---------------------------------------------------------------------------
// Hidden State Type (spec §8)
// ---------------------------------------------------------------------------

export type HiddenStateType =
    | "intent_state"
    | "workflow_state"
    | "risk_state"
    | "agent_state"
    | "user_state"
    | "system_state"
    | "semantic_state"
    | "epistemic_state"
    | "geographic_state"
    | "spatial_state"
    | "resolution_state"
    | "anomaly_state";

// ---------------------------------------------------------------------------
// Hidden State Candidate (spec §7)
// ---------------------------------------------------------------------------

export interface HiddenStateCandidate {
    id: string;
    contextId: string;
    label: string;
    type: HiddenStateType;
    confidence: number;
    probability: number;
    activation: number;
    persistence: number;
    entropy: number;
    supportingQuantIds: string[];
    opposingQuantIds: string[];
    supportingEventIds: string[];
    opposingEventIds: string[];
    realmContributionIds: string[];
    memoryIds: string[];
    attractorIds: string[];
    explanation?: string;
    createdAt: string;
    updatedAt: string;
}

// ---------------------------------------------------------------------------
// Hidden State Estimate — full spec version (spec §9)
// ---------------------------------------------------------------------------

export interface HiddenStateEstimate {
    id: string;
    contextId: string;
    windowId?: string;
    candidates: HiddenStateCandidate[];
    topCandidateId?: string;
    topLabel?: string;
    confidence: number;
    entropy: number;
    splitDetected: boolean;
    collapseDetected: boolean;
    dominantAttractorId?: string;
    fieldSummaryId?: string;
    realmAgreementId?: string;
    createdAt: string;
    updatedAt: string;
}

// ---------------------------------------------------------------------------
// Hidden State Transition (spec §10)
// ---------------------------------------------------------------------------

export type HiddenStateTransitionType =
    | "emerged"
    | "strengthened"
    | "weakened"
    | "split"
    | "collapsed"
    | "resolved"
    | "contradicted"
    | "decayed";

export interface HiddenStateTransition {
    id: string;
    contextId: string;
    fromStateId?: string;
    toStateId: string;
    transitionType: HiddenStateTransitionType;
    probability: number;
    confidence: number;
    evidenceIds: string[];
    explanation: string;
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Attractor Alignment (spec §15)
// ---------------------------------------------------------------------------

export interface AttractorAlignment {
    id: string;
    hiddenStateId: string;
    attractorId: string;
    alignment: number;
    pullStrength: number;
    confidence: number;
    explanation: string;
}

// ---------------------------------------------------------------------------
// Hidden State Split (spec §16)
// ---------------------------------------------------------------------------

export interface HiddenStateSplit {
    id: string;
    contextId: string;
    candidateStateIds: string[];
    tensionScore: number;
    entropyDelta: number;
    possibleExplanations: string[];
    evidenceIds: string[];
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Hidden State Collapse Signal (spec §17)
// ---------------------------------------------------------------------------

export interface HiddenStateCollapseSignal {
    id: string;
    contextId: string;
    hiddenStateId: string;
    collapseConfidence: number;
    supportingQuantIds: string[];
    opposingQuantIds: string[];
    entropy: number;
    attractorId?: string;
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Hidden State Influence (spec §20) — hidden state → branch/quant/prediction
// Named separately from quant/types HiddenStateInfluence (quant → hidden state)
// ---------------------------------------------------------------------------

export type HiddenStateOutputEffect = "boost" | "suppress" | "split" | "preserve" | "collapse" | "warn";

export interface HiddenStateInfluence {
    id: string;
    hiddenStateId: string;
    targetType: "branch" | "quant" | "prediction" | "governance";
    targetId?: string;
    effect: HiddenStateOutputEffect;
    amount: number;
    confidence: number;
    explanation: string;
    evidenceIds: string[];
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Plugin-specific input types
// ---------------------------------------------------------------------------

export interface HiddenStateCandidatePluginInput {
    contextId: string;
    activeQuants: Quant[];
    quantField: QuantFieldSummary;
    realmContributions: RealmContribution[];
    memoryResults?: MemoryRecallResult[];
    mode: PredictionMode;
}

export interface HiddenStateScoringPluginInput {
    contextId: string;
    candidates: HiddenStateCandidate[];
    activeQuants: Quant[];
    realmContributions: RealmContribution[];
    quantField: QuantFieldSummary;
    previousEstimate?: HiddenStateEstimate;
    mode: PredictionMode;
}

export interface HiddenStateEntropyPluginInput {
    candidates: HiddenStateCandidate[];
}

export interface HiddenStateEntropyResult {
    globalEntropy: number;
    candidateEntropies: { candidateId: string; entropy: number }[];
}

export interface HiddenStatePersistencePluginInput {
    contextId: string;
    candidates: HiddenStateCandidate[];
    activeQuants: Quant[];
    previousEstimate?: HiddenStateEstimate;
}

export interface HiddenStatePersistenceResult {
    persistenceByCandidate: { candidateId: string; persistence: number; decayRate: number }[];
}

export interface HiddenStateInfluencePluginInput {
    contextId: string;
    estimate: HiddenStateEstimate;
    branchIds?: string[];
    mode: PredictionMode;
}

// ---------------------------------------------------------------------------
// Service port input types (spec §25-§26)
// ---------------------------------------------------------------------------

export interface HiddenStateEstimateInput {
    context: PredictionContext;
    activeQuants: Quant[];
    quantField: QuantFieldSummary;
    realmResults: RealmProcessingResult;
    memoryResults?: MemoryRecallResult[];
    graphFeatures?: GraphFeatureSet[];
    previousEstimate?: HiddenStateEstimate;
    mode: PredictionMode;
}

export interface HiddenStateCandidateInput {
    context: PredictionContext;
    activeQuants: Quant[];
    quantField: QuantFieldSummary;
    realmContributions: RealmContribution[];
    memoryResults?: MemoryRecallResult[];
    mode: PredictionMode;
}

export interface HiddenStateScoringInput {
    contextId: string;
    candidates: HiddenStateCandidate[];
    activeQuants: Quant[];
    realmContributions: RealmContribution[];
    quantField: QuantFieldSummary;
    previousEstimate?: HiddenStateEstimate;
    mode: PredictionMode;
}

export interface HiddenStateTransitionInput {
    contextId: string;
    previousEstimate: HiddenStateEstimate;
    currentEstimate: HiddenStateEstimate;
    mode: PredictionMode;
}

export interface HiddenStateSplitInput {
    contextId: string;
    candidates: HiddenStateCandidate[];
    realmConflicts?: import("../realm-mesh/types.js").RealmConflictReport[];
    quantField: QuantFieldSummary;
}

export interface HiddenStateCollapseInput {
    contextId: string;
    candidates: HiddenStateCandidate[];
    quantField: QuantFieldSummary;
    realmResults: RealmProcessingResult;
}

export interface HiddenStateInfluenceInput {
    contextId: string;
    estimate: HiddenStateEstimate;
    branchIds?: string[];
    mode: PredictionMode;
}

// ---------------------------------------------------------------------------
// Hidden State Port (spec §25)
// ---------------------------------------------------------------------------

export interface HiddenStatePort {
    estimate(input: HiddenStateEstimateInput, ctx: DomainContext): Promise<HiddenStateEstimate>;
    generateCandidates(input: HiddenStateCandidateInput, ctx: DomainContext): Promise<HiddenStateCandidate[]>;
    scoreCandidates(input: HiddenStateScoringInput, ctx: DomainContext): Promise<HiddenStateCandidate[]>;
    detectTransitions(input: HiddenStateTransitionInput, ctx: DomainContext): Promise<HiddenStateTransition[]>;
    detectSplit(input: HiddenStateSplitInput, ctx: DomainContext): Promise<HiddenStateSplit | null>;
    detectCollapse(input: HiddenStateCollapseInput, ctx: DomainContext): Promise<HiddenStateCollapseSignal | null>;
    emitInfluences(input: HiddenStateInfluenceInput, ctx: DomainContext): Promise<HiddenStateInfluence[]>;
}

// ---------------------------------------------------------------------------
// Candidate limits by mode (spec §31)
// ---------------------------------------------------------------------------

export const CANDIDATE_LIMITS: Record<PredictionMode, number> = {
    realtime:    5,
    interactive: 10,
    analysis:    20,
    batch:       50,
};

// Quant type → hidden state mapping
export const QUANT_TYPE_TO_STATE: Record<string, { label: string; type: HiddenStateType }> = {
    anomaly_signal:       { label: "anomaly_detected",      type: "anomaly_state"   },
    semantic_signal:      { label: "semantic_drift",         type: "semantic_state"  },
    hidden_state_signal:  { label: "latent_state",           type: "workflow_state"  },
    causal_signal:        { label: "causal_instability",     type: "workflow_state"  },
    absence_signal:       { label: "missing_evidence",       type: "epistemic_state" },
    contradiction_signal: { label: "contradictory_evidence", type: "epistemic_state" },
    temporal_signal:      { label: "temporal_anomaly",       type: "workflow_state"  },
    geographic_signal:    { label: "geographic_risk",        type: "geographic_state"},
    spatial_signal:       { label: "spatial_risk",           type: "spatial_state"   },
    resolution_signal:    { label: "resolution_emerging",    type: "resolution_state"},
    prediction_signal:    { label: "prediction_instability", type: "workflow_state"  },
};

// Keyword → candidate mapping for event_signal labels
export const EVENT_LABEL_KEYWORDS: Array<{ keywords: string[]; label: string; type: HiddenStateType }> = [
    { keywords: ["error", "failure", "failed", "exception"],  label: "unresolved_failure",   type: "workflow_state"  },
    { keywords: ["retry", "retrying", "retried"],             label: "workflow_instability",  type: "workflow_state"  },
    { keywords: ["escalat"],                                  label: "escalation_risk",        type: "risk_state"      },
    { keywords: ["fraud", "suspicious", "abuse", "attack"],   label: "fraud_risk",             type: "risk_state"      },
    { keywords: ["confusion", "help", "unclear", "lost"],     label: "agent_confusion",        type: "agent_state"     },
    { keywords: ["frustrat", "complaint", "angry", "upset"],  label: "user_frustration",       type: "user_state"      },
    { keywords: ["resolv", "success", "completed", "fixed"],  label: "resolution_emerging",    type: "resolution_state"},
    { keywords: ["degrad", "slow", "timeout", "hung"],        label: "system_degradation",     type: "system_state"    },
    { keywords: ["restrict", "forbidden", "unauthorized"],    label: "restricted_access_risk", type: "risk_state"      },
    { keywords: ["churn", "cancel", "unsubscribe"],           label: "churn_risk",             type: "risk_state"      },
];

export const HS_EPSILON = 1e-9;
export const COLLAPSE_CONFIDENCE_THRESHOLD = 0.75;
export const SPLIT_TENSION_THRESHOLD = 0.4;
