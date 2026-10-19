// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN - PRUNING POD
// Core TypeScript type definitions (spec §7-§26)
// ============================================================================

import type {
    Quant,
    QuantFieldSummary,
    DomainContext,
    RealmContribution,
    PredictionCollapseSignal,
} from "../quant/types.js";
import type {
    RealmConflictReport,
} from "../realm-mesh/types.js";
import type { HiddenStateEstimate } from "../hidden-state/types.js";
import type {
    PredictionBranch,
    PredictionMode,
    PredictionModePlan,
    BicameralResult,
} from "../prediction/types.js";

export type { PredictionBranch, PredictionMode, PredictionModePlan, BicameralResult };

// ---------------------------------------------------------------------------
// Branch Status (spec §7) — superset of PredictionBranchStatus, adds "merged"
// ---------------------------------------------------------------------------

export type BranchStatus =
    | "candidate"
    | "active"
    | "suppressed"
    | "pruned"
    | "reserved"
    | "merged"
    | "collapsed";

// ---------------------------------------------------------------------------
// Branch Score Breakdown (spec §8)
// ---------------------------------------------------------------------------

export interface BranchScoreBreakdown {
    branchId: string;
    probability: number;
    confidence: number;
    quantSupport: number;
    realmAgreement: number;
    hiddenStateAlignment: number;
    bicameralAgreement: number;
    expectedValue: number;
    consequenceWeight: number;
    entropyPenalty: number;
    finalScore: number;
    explanation: string;
}

// ---------------------------------------------------------------------------
// Suppression Decision (spec §10)
// ---------------------------------------------------------------------------

export interface SuppressionDecision {
    branchId: string;
    suppressionAmount: number;
    reason: string;
    evidenceIds: string[];
}

// ---------------------------------------------------------------------------
// Branch Merge Decision (spec §13/14/15)
// ---------------------------------------------------------------------------

export interface BranchMergeDecision {
    sourceBranchIds: string[];
    targetBranchId: string;
    mergeType: "semantic" | "geographic" | "spatial" | "epistemic";
    combinedProbability: number;
    combinedEvidenceIds: string[];
    explanation: string;
}

// ---------------------------------------------------------------------------
// Branch Genealogy Event (spec §19)
// ---------------------------------------------------------------------------

export type BranchGenealogyEventType =
    | "created"
    | "expanded"
    | "boosted"
    | "suppressed"
    | "merged"
    | "reserved"
    | "pruned"
    | "collapsed"
    | "reopened";

export interface BranchGenealogyEvent {
    id: string;
    predictionId: string;
    contextId: string;
    branchId: string;
    parentBranchId?: string;
    eventType: BranchGenealogyEventType;
    reason: string;
    evidenceIds: string[];
    sourcePlugin: string;
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Pruning Decision (spec §23)
// ---------------------------------------------------------------------------

export type PruningDecisionType =
    | "hard_prune"
    | "soft_suppress"
    | "reserve"
    | "merge"
    | "collapse"
    | "keep";

export interface PruningDecision {
    id: string;
    branchId: string;
    previousStatus: BranchStatus;
    newStatus: BranchStatus;
    decisionType: PruningDecisionType;
    reason: string;
    confidence: number;
    scoreBefore: number;
    scoreAfter: number;
    evidenceIds: string[];
    pluginName: string;
    pluginVersion: string;
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Pruning Result (spec §24)
// ---------------------------------------------------------------------------

export interface PruningResult {
    predictionId: string;
    contextId: string;

    activeBranches: PredictionBranch[];
    suppressedBranches: PredictionBranch[];
    prunedBranches: PredictionBranch[];
    reservedBranches: PredictionBranch[];
    mergedBranches: PredictionBranch[];
    collapsedBranch?: PredictionBranch;

    decisions: PruningDecision[];
    scoreBreakdowns: BranchScoreBreakdown[];
    mergeDecisions: BranchMergeDecision[];
    genealogyEvents: BranchGenealogyEvent[];

    summary: {
        inputBranchCount: number;
        outputActiveCount: number;
        prunedCount: number;
        suppressedCount: number;
        reservedCount: number;
        mergedCount: number;
        collapseDetected: boolean;
    };
}

// ---------------------------------------------------------------------------
// Pruning Input (spec §26)
// ---------------------------------------------------------------------------

export interface PruningInput {
    predictionId: string;
    contextId: string;
    branches: PredictionBranch[];
    quantField?: QuantFieldSummary;
    activeQuants: Quant[];
    realmContributions: RealmContribution[];
    realmConflicts: RealmConflictReport[];
    hiddenState?: HiddenStateEstimate;
    collapseSignal?: PredictionCollapseSignal;
    modePlan: PredictionModePlan;
    mode: PredictionMode;
}

// ---------------------------------------------------------------------------
// Plugin-specific input types
// ---------------------------------------------------------------------------

export interface BranchScoringInput {
    predictionId: string;
    contextId: string;
    branches: PredictionBranch[];
    quantField?: QuantFieldSummary;
    activeQuants: Quant[];
    realmContributions: RealmContribution[];
    hiddenState?: HiddenStateEstimate;
    bicameralResult?: BicameralResult;
    mode: PredictionMode;
}

export interface HardPruneInput {
    predictionId: string;
    contextId: string;
    branches: PredictionBranch[];
    scoreBreakdowns: BranchScoreBreakdown[];
    quantField?: QuantFieldSummary;
    mode: PredictionMode;
}

export interface SoftSuppressionInput {
    predictionId: string;
    contextId: string;
    branches: PredictionBranch[];
    scoreBreakdowns: BranchScoreBreakdown[];
    realmContributions: RealmContribution[];
    realmConflicts: RealmConflictReport[];
    activeQuants: Quant[];
    mode: PredictionMode;
}

export interface AnomalyReserveInput {
    predictionId: string;
    contextId: string;
    branches: PredictionBranch[];
    activeQuants: Quant[];
    scoreBreakdowns: BranchScoreBreakdown[];
    mode: PredictionMode;
}

export interface EntropyPruningInput {
    predictionId: string;
    contextId: string;
    branches: PredictionBranch[];
    scoreBreakdowns: BranchScoreBreakdown[];
    quantField?: QuantFieldSummary;
    modePlan: PredictionModePlan;
    mode: PredictionMode;
}

export interface BranchGenealogyInput {
    predictionId: string;
    contextId: string;
    decisions: PruningDecision[];
    branches: PredictionBranch[];
}

export interface AnomalyReservePluginInput {
    predictionId: string;
    contextId: string;
    branches: PredictionBranch[];
    activeQuants: Quant[];
    scoreBreakdowns: BranchScoreBreakdown[];
    mode: PredictionMode;
}

export interface BranchMergeInput {
    predictionId: string;
    contextId: string;
    branches: PredictionBranch[];
    mergeType: "semantic" | "geographic" | "spatial" | "epistemic";
    mode: PredictionMode;
}

// ---------------------------------------------------------------------------
// Pruning Port (spec §25)
// ---------------------------------------------------------------------------

export interface PruningPort {
    prune(input: PruningInput, ctx: DomainContext): Promise<PruningResult>;
    scoreBranches(input: BranchScoringInput, ctx: DomainContext): Promise<BranchScoreBreakdown[]>;
    mergeBranches(input: BranchMergeInput, ctx: DomainContext): Promise<BranchMergeDecision[]>;
    reserveAnomalies(input: AnomalyReserveInput, ctx: DomainContext): Promise<PruningDecision[]>;
}

// ---------------------------------------------------------------------------
// Branch limit defaults by mode (spec §27)
// ---------------------------------------------------------------------------

export const BRANCH_LIMITS: Record<PredictionMode, { active: number; reserved: number }> = {
    realtime:    { active: 8,   reserved: 2  },
    interactive: { active: 15,  reserved: 4  },
    analysis:    { active: 50,  reserved: 10 },
    batch:       { active: 100, reserved: 20 },
};

// High-consequence label fragments used to identify critical post-predicates
export const CONSEQUENCE_LABELS = [
    "security", "breach", "failure", "fraud", "loss", "deleted", "irreversible",
    "collision", "churn", "incident", "restricted", "unauthorized", "escalation",
] as const;

export const PRUNING_EPSILON = 1e-6;
export const HARD_PRUNE_PROBABILITY_FLOOR = 0.001;
export const HARD_PRUNE_EV_FLOOR = -0.95;
export const ANOMALY_RESERVE_PROBABILITY_THRESHOLD = 0.15;
export const ANOMALY_RESERVE_CONSEQUENCE_THRESHOLD = 0.6;
export const SUPPRESSION_REALM_AGREEMENT_THRESHOLD = 0.3;
export const SUPPRESSION_ENTROPY_THRESHOLD = 0.85;
