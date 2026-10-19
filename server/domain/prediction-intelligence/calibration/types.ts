// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN - CALIBRATION POD
// Core TypeScript type definitions (spec §8-§40)
// ============================================================================

import type { DomainContext, Provenance, QuantFieldSummary } from "../quant/types.js";
import type { PredictionBranch } from "../prediction/types.js";
import type { PruningDecision } from "../pruning/types.js";
import type { HiddenStateEstimate } from "../hidden-state/types.js";
import type { MemoryRecallResult } from "../memory/types.js";
import type { RealmProcessingResult } from "../realm-mesh/types.js";

export type PredictionMode = "interactive" | "analysis" | "batch";

// ---------------------------------------------------------------------------
// Observed Outcome (spec §8)
// ---------------------------------------------------------------------------

export interface ObservedOutcome {
    id: string;
    contextId: string;
    outcomeType: string;
    label: string;
    occurredAt: string;
    observedAt: string;
    source: string;
    sourceTrust: number;
    confidence: number;
    relatedEventIds: string[];
    relatedQuantIds: string[];
    relatedPredictionIds: string[];
    payload: Record<string, unknown>;
    provenance: Provenance;
}

// ---------------------------------------------------------------------------
// Outcome Match (spec §9)
// ---------------------------------------------------------------------------

export type OutcomeMatchType = "exact" | "semantic" | "causal" | "partial" | "missed" | "contradicted" | "ambiguous";

export interface OutcomeMatch {
    id: string;
    contextId: string;
    outcomeId: string;
    predictionId: string;
    matchedBranchId?: string;
    matchedPredicate?: string;
    matchType: OutcomeMatchType;
    matchScore: number;
    confidence: number;
    explanation: string;
    evidenceIds: string[];
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Calibration Outcome (spec §10)
// ---------------------------------------------------------------------------

export type TrueBranchStatus = "active" | "reserved" | "suppressed" | "pruned" | "missing" | "collapsed";

export interface CalibrationOutcome {
    id: string;
    contextId: string;
    predictionId: string;
    outcomeId: string;
    outcomeMatchId: string;
    topPredictionCorrect: boolean;
    trueBranchPresent: boolean;
    trueBranchStatus?: TrueBranchStatus;
    confidenceAtPrediction: number;
    entropyAtPrediction: number;
    calibratedConfidence?: number;
    predictionError: number;
    calibrationError: number;
    brierScore?: number;
    logLoss?: number;
    falsePositive: boolean;
    falseNegative: boolean;
    falsePrune: boolean;
    luckyCorrect: boolean;
    overconfident: boolean;
    underconfident: boolean;
    explanation: string;
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Calibration Signal (spec §11)
// ---------------------------------------------------------------------------

export type CalibrationSignalTargetType =
    | "plugin" | "realm" | "quant_type" | "branch_predicate" | "hidden_state"
    | "attractor" | "pattern" | "memory" | "pruning_rule" | "confidence_model"
    | "temporal_decay" | "governance_threshold";

export type CalibrationSignalType =
    | "increase_weight" | "decrease_weight"
    | "increase_confidence" | "decrease_confidence"
    | "increase_threshold" | "decrease_threshold"
    | "increase_decay" | "decrease_decay"
    | "mark_unreliable" | "mark_reliable"
    | "requires_review"
    | "preserve_branch_more_often" | "prune_branch_more_aggressively";

export interface CalibrationSignal {
    id: string;
    contextId?: string;
    targetType: CalibrationSignalTargetType;
    targetId?: string;
    targetName?: string;
    signalType: CalibrationSignalType;
    amount: number;
    confidence: number;
    reason: string;
    evidenceIds: string[];
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Calibration Error Analysis (spec §40)
// ---------------------------------------------------------------------------

export type CalibrationErrorType =
    | "false_positive" | "false_negative" | "false_prune" | "missed_branch"
    | "overconfidence" | "underconfidence" | "lucky_correct" | "context_failure"
    | "memory_failure" | "realm_failure" | "plugin_failure" | "hidden_state_failure"
    | "quant_generation_failure" | "epistemic_failure" | "observation_failure"
    | "governance_suppression";

export interface CalibrationErrorAnalysis {
    id: string;
    contextId: string;
    predictionId: string;
    errorTypes: CalibrationErrorType[];
    primaryErrorType?: CalibrationErrorType;
    suspectedCauses: { cause: string; confidence: number; evidenceIds: string[]; explanation: string }[];
    recommendedSignals: CalibrationSignal[];
    explanation: string;
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Calibration Report
// ---------------------------------------------------------------------------

export interface CalibrationReport {
    id: string;
    contextId?: string;
    period: { from: string; to: string };
    accuracy: number;
    precision: number;
    recall: number;
    falsePositiveRate: number;
    falseNegativeRate: number;
    falsePruneRate: number;
    branchSurvivalRate: number;
    expectedCalibrationError: number;
    brierScore: number;
    overconfidenceRate: number;
    underconfidenceRate: number;
    sampleSize: number;
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Port input/output types
// ---------------------------------------------------------------------------

export interface OutcomeIntakeInput {
    contextId: string;
    label: string;
    outcomeType: string;
    source: string;
    sourceTrust?: number;
    confidence?: number;
    occurredAt?: string;
    relatedEventIds?: string[];
    relatedPredictionIds?: string[];
    payload?: Record<string, unknown>;
}

export interface OutcomeMatchingInput {
    outcome: ObservedOutcome;
    predictions: {
        id: string;
        topPredicate?: string;
        branches: { id: string; predicate: string; status: string; probability: number }[];
    }[];
    windowMs?: number;
}

export interface PredictionCalibrationInput {
    contextId: string;
    predictionId: string;
    topPredicate?: string;
    confidence: number;
    entropy: number;
    branches: PredictionBranch[];
    pruningDecisions?: PruningDecision[];
    outcome: ObservedOutcome;
    outcomeMatches: OutcomeMatch[];
    quantField?: QuantFieldSummary;
    hiddenState?: HiddenStateEstimate;
    realmResults?: RealmProcessingResult;
    memoryResults?: MemoryRecallResult[];
    mode: PredictionMode;
}

export interface CalibrationErrorAnalysisInput {
    calibrationOutcome: CalibrationOutcome;
    branches: PredictionBranch[];
    pruningDecisions?: PruningDecision[];
    realmResults?: RealmProcessingResult;
    memoryResults?: MemoryRecallResult[];
}

export interface CalibrationSignalInput {
    calibrationOutcome: CalibrationOutcome;
    errorAnalysis?: CalibrationErrorAnalysis;
    branches?: PredictionBranch[];
    pruningDecisions?: PruningDecision[];
    mode: PredictionMode;
}

export interface CalibrationReplayInput {
    contextId?: string;
    from: string;
    to: string;
    mode: PredictionMode;
}

export interface CalibrationReplayResult {
    contextId?: string;
    period: { from: string; to: string };
    totalReplayed: number;
    outcomes: CalibrationOutcome[];
    report: CalibrationReport;
}

export interface CalibrationReportInput {
    contextId?: string;
    from?: string;
    to?: string;
    mode: PredictionMode;
}

// ---------------------------------------------------------------------------
// Plugin-specific inputs
// ---------------------------------------------------------------------------

export interface OutcomeMatchingPluginInput extends OutcomeMatchingInput {}

export interface PredictionAccuracyPluginInput {
    contextId: string;
    predictionId: string;
    topPredicate?: string;
    confidence: number;
    entropy: number;
    branches: PredictionBranch[];
    pruningDecisions?: PruningDecision[];
    outcome: ObservedOutcome;
    bestMatch: OutcomeMatch;
}

export interface FalsePruneDetectorPluginInput {
    calibrationOutcome: CalibrationOutcome;
    branches: PredictionBranch[];
    pruningDecisions: PruningDecision[];
}

export interface ConfidenceCalibrationPluginInput {
    calibrationOutcome: CalibrationOutcome;
    historicalAccuracy?: number;
}

// ---------------------------------------------------------------------------
// CalibrationPort (spec §38)
// ---------------------------------------------------------------------------

export interface CalibrationPort {
    recordOutcome(input: OutcomeIntakeInput, ctx: DomainContext): Promise<ObservedOutcome>;
    matchOutcome(input: OutcomeMatchingInput, ctx: DomainContext): Promise<OutcomeMatch[]>;
    calibratePrediction(input: PredictionCalibrationInput, ctx: DomainContext): Promise<CalibrationOutcome>;
    analyzeErrors(input: CalibrationErrorAnalysisInput, ctx: DomainContext): Promise<CalibrationErrorAnalysis>;
    emitSignals(input: CalibrationSignalInput, ctx: DomainContext): Promise<CalibrationSignal[]>;
    replay(input: CalibrationReplayInput, ctx: DomainContext): Promise<CalibrationReplayResult>;
    report(input: CalibrationReportInput, ctx: DomainContext): Promise<CalibrationReport>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const OVERCONFIDENCE_THRESHOLD = 0.70;
export const UNDERCONFIDENCE_THRESHOLD = 0.40;
export const LUCKY_CORRECT_THRESHOLD = 0.50;
export const MIN_MATCH_SCORE_FOR_CORRECTNESS = 0.50;
export const CALIBRATION_EPSILON = 1e-7;

/** Keyword pairs for semantic matching (outcome label ↔ branch predicate) */
export const SEMANTIC_SYNONYM_PAIRS: Array<[string, string]> = [
    ["escalat", "intervention"],
    ["escalat", "manual"],
    ["operator", "human"],
    ["fail", "error"],
    ["fail", "abort"],
    ["resolv", "complet"],
    ["resolv", "success"],
    ["cancel", "abandon"],
    ["fraud", "suspicious"],
    ["security", "breach"],
    ["restrict", "forbidden"],
    ["churn", "cancel"],
];
