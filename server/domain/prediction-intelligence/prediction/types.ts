// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN - PREDICTION POD
// Core TypeScript type definitions (Prediction Pod spec MVP)
// ============================================================================

import type {
    Quant,
    QuantFieldSummary,
    PredictionContext,
    DomainContext,
    RealmContribution,
    BranchInfluence,
    Provenance,
} from "../quant/types.js";
import type {
    BranchConstraint,
    RealmAgreementScore,
    RealmConflictReport,
    RealmProcessingResult,
} from "../realm-mesh/types.js";
import type { HiddenStateEstimate } from "../hidden-state/types.js";

export type PredictionMode = "realtime" | "interactive" | "analysis" | "batch";
export type PredictionBranchStatus = "candidate" | "active" | "suppressed" | "pruned" | "reserved" | "collapsed";
export const PREDICTION_MODES = ["realtime", "interactive", "analysis", "batch"] as const;

export function isPredictionMode(value: unknown): value is PredictionMode {
    return typeof value === "string" && (PREDICTION_MODES as readonly string[]).includes(value);
}

export function normalizePredictionMode(value: unknown, fallback: PredictionMode = "realtime"): PredictionMode {
    return isPredictionMode(value) ? value : fallback;
}

export interface PatternMatchResult {
    id: string;
    label: string;
    confidence: number;
    similarity?: number;
    expectedValue?: number;
    supportingQuantIds?: string[];
}

export interface DiffReport {
    id: string;
    label: string;
    severity?: "low" | "medium" | "high" | "critical";
    confidence?: number;
    evidenceIds?: string[];
}

export interface ExplanationBundle {
    summary: string;
    evidenceIds: string[];
    caveats: string[];
}

export interface GovernanceDecision {
    status: "allowed" | "requires_review" | "blocked";
    reason: string;
}

export interface PredicateCandidate {
    id: string;
    label: string;
    source: "quant" | "realm" | "hidden_state" | "pattern" | "baseline" | "agent";
    confidence: number;
    supportingQuantIds: string[];
    supportingRealmContributionIds: string[];
    expectedValue: number;
    riskClass?: "low" | "medium" | "high" | "critical";
    createdAt: string;
}

export interface PostPredicateCandidate {
    id: string;
    predicateId: string;
    label: string;
    probability: number;
    expectedValue: number;
    consequenceClass: "neutral" | "beneficial" | "risk" | "critical";
    evidenceIds: string[];
}

export interface PredictionBranch {
    id: string;
    predictionId: string;
    contextId: string;
    parentBranchId?: string;
    generation: number;
    predicate: string;
    postPredicates: string[];
    probability: number;
    confidence: number;
    branchScore: number;
    entropy: number;
    expectedValue: number;
    status: PredictionBranchStatus;
    supportingQuantIds: string[];
    interferingQuantIds: string[];
    supportingEventIds: string[];
    opposingEventIds: string[];
    realmContributions: RealmContribution[];
    branchInfluences: BranchInfluence[];
    constraints: BranchConstraint[];
    payload?: Record<string, unknown>;
    forwardScore?: number;
    reverseScore?: number;
    bicameralAgreement?: number;
    collapseSignalId?: string;
    createdFrom: {
        eventIds: string[];
        episodeIds: string[];
        quantIds: string[];
        hiddenStateIds: string[];
        patternIds: string[];
    };
    prunedReason?: string;
    explanation?: string;
    createdAt: string;
    updatedAt: string;
}

export interface ForwardChamberResult {
    id: string;
    contextId: string;
    branchScores: {
        branchId: string;
        score: number;
        confidence: number;
        explanation: string;
    }[];
    dominantBranchId?: string;
    entropy: number;
    createdAt: string;
}

export interface ReverseChamberResult {
    id: string;
    contextId: string;
    inferredCauses: {
        label: string;
        confidence: number;
        supportingQuantIds: string[];
        supportingEventIds: string[];
        explanation: string;
    }[];
    branchSupport: {
        branchId: string;
        reverseSupport: number;
        explanation: string;
    }[];
    missingEvidenceHypotheses: string[];
    anomalyScore: number;
    entropy: number;
    createdAt: string;
}

export interface BicameralResult {
    id: string;
    contextId: string;
    agreementScore: number;
    branchAgreements: {
        branchId: string;
        forwardScore: number;
        reverseScore: number;
        agreement: number;
        adjustment: number;
    }[];
    disagreementType?: "none" | "missing_evidence" | "hidden_variable" | "false_causal_assumption" | "semantic_conflict" | "unknown_unknown_risk";
    entropyDelta: number;
    explanation: string;
    createdAt: string;
}

export interface Prediction {
    id: string;
    contextId: string;
    createdAt: string;
    mode: PredictionMode;
    topPredicate?: string;
    confidence: number;
    entropy: number;
    collapseDetected: boolean;
    branches: PredictionBranch[];
    activeBranchIds: string[];
    reservedBranchIds: string[];
    collapsedBranchId?: string;
    quantFieldSummaryId?: string;
    hiddenStateEstimateId?: string;
    realmAgreementId?: string;
    forwardChamber?: ForwardChamberResult;
    reverseChamber?: ReverseChamberResult;
    bicameral?: BicameralResult;
    provenance: Provenance;
}

export interface PredictionContract {
    predictionId: string;
    contextId: string;
    createdAt: string;
    topPrediction?: {
        predicate: string;
        confidence: number;
        branchScore: number;
    };
    entropy: number;
    collapseDetected: boolean;
    topAlternatives: PredictionBranch[];
    quantField?: QuantFieldSummary;
    hiddenState?: HiddenStateEstimate;
    realmAgreement?: RealmAgreementScore;
    bicameral?: BicameralResult;
    supportingEvidence: string[];
    opposingEvidence: string[];
    activeBranches: PredictionBranch[];
    reservedBranches: PredictionBranch[];
    prunedBranches?: PredictionBranch[];
    explanation?: ExplanationBundle;
    governance?: GovernanceDecision;
    provenance: Provenance;
}

export interface PredictionModePlan {
    mode: PredictionMode;
    maxBranches: number;
    maxDepth: number;
    runForwardChamber: boolean;
    runReverseChamber: boolean;
    runBicameral: boolean;
    includeAlternatives: boolean;
    includePatternMemory: boolean;
    timeoutMs: number;
}

export interface PredictionInput {
    context: PredictionContext;
    activeQuants: Quant[];
    quantField: QuantFieldSummary;
    realmResults: RealmProcessingResult;
    hiddenState?: HiddenStateEstimate;
    diffs?: DiffReport[];
    memoryMatches?: PatternMatchResult[];
    mode: PredictionMode;
}

export interface PredictionResult {
    prediction: Prediction;
    branches: PredictionBranch[];
    contract: PredictionContract;
    modePlan: PredictionModePlan;
}

export interface PredictionModePlanInput {
    mode: PredictionMode;
    context: PredictionContext;
    quantField: QuantFieldSummary;
    riskLevel?: "low" | "medium" | "high" | "critical";
    latencyBudgetMs?: number;
}

export interface PredicateGenerationInput {
    context: PredictionContext;
    activeQuants: Quant[];
    quantField: QuantFieldSummary;
    realmResults: RealmProcessingResult;
    hiddenState?: HiddenStateEstimate;
    memoryMatches?: PatternMatchResult[];
    modePlan: PredictionModePlan;
    now: string;
}

export interface BranchGenerationInput {
    predictionId: string;
    context: PredictionContext;
    predicates: PredicateCandidate[];
    postPredicates?: PostPredicateCandidate[];
    quantField: QuantFieldSummary;
    hiddenState?: HiddenStateEstimate;
    realmContributions: RealmContribution[];
    memoryMatches?: PatternMatchResult[];
    modePlan: PredictionModePlan;
    now: string;
}

export interface ForwardChamberInput {
    context: PredictionContext;
    branches: PredictionBranch[];
    activeQuants: Quant[];
    quantField: QuantFieldSummary;
    realmResults: RealmProcessingResult;
    hiddenState?: HiddenStateEstimate;
    memoryMatches?: PatternMatchResult[];
    now: string;
}

export interface ReverseChamberInput {
    context: PredictionContext;
    branches: PredictionBranch[];
    activeQuants: Quant[];
    quantField: QuantFieldSummary;
    realmResults: RealmProcessingResult;
    hiddenState?: HiddenStateEstimate;
    now: string;
}

export interface BicameralInput {
    contextId: string;
    branches: PredictionBranch[];
    forward: ForwardChamberResult;
    reverse: ReverseChamberResult;
    now: string;
}

export interface PredictionEntropyInput {
    branches: PredictionBranch[];
    quantField: QuantFieldSummary;
    realmConflicts?: RealmConflictReport[];
}

export interface PredictionEntropyResult {
    predictionEntropy: number;
    branchEntropies: { branchId: string; entropy: number }[];
}

export interface PredictionConfidenceInput {
    branches: PredictionBranch[];
    activeQuants: Quant[];
    quantField: QuantFieldSummary;
    realmAgreement?: RealmAgreementScore;
    hiddenState?: HiddenStateEstimate;
    forwardChamber?: ForwardChamberResult;
    calibrationWeight?: number;
}

export interface PredictionConfidenceResult {
    predictionConfidence: number;
    branchConfidences: {
        branchId: string;
        confidence: number;
        branchScore: number;
    }[];
}

export interface PredictionContractInput {
    prediction: Prediction;
    activeBranches: PredictionBranch[];
    reservedBranches: PredictionBranch[];
    prunedBranches?: PredictionBranch[];
    quantField?: QuantFieldSummary;
    hiddenState?: HiddenStateEstimate;
    realmAgreement?: RealmAgreementScore;
    explanation?: ExplanationBundle;
    governance?: GovernanceDecision;
}

export interface PredictionPort {
    generatePredictions(input: PredictionInput, ctx: DomainContext): Promise<PredictionResult>;
    generateBranches(input: BranchGenerationInput, ctx: DomainContext): Promise<PredictionBranch[]>;
    runForwardChamber(input: ForwardChamberInput, ctx: DomainContext): Promise<ForwardChamberResult>;
    runReverseChamber(input: ReverseChamberInput, ctx: DomainContext): Promise<ReverseChamberResult>;
    reconcileBicameral(input: BicameralInput, ctx: DomainContext): Promise<BicameralResult>;
    contract(input: PredictionContractInput, ctx: DomainContext): Promise<PredictionContract>;
}

export const PREDICTION_EPSILON = 1e-6;
