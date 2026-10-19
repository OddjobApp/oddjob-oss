// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN - EXPLANATION POD
// Core TypeScript type definitions (spec §5-§48)
// ============================================================================

import type { DomainContext, QuantFieldSummary } from "../quant/types.js";
import type { PredictionBranch } from "../prediction/types.js";
import type { HiddenStateEstimate } from "../hidden-state/types.js";
import type { MemoryRecallResult } from "../memory/types.js";
import type { GovernanceDecision } from "../governance/types.js";
import type { RealmProcessingResult } from "../realm-mesh/types.js";
import type { CalibrationOutcome } from "../calibration/types.js";

export type PredictionMode = "realtime" | "interactive" | "analysis" | "batch";

export type ExplanationType =
    | "summary" | "detailed" | "technical" | "causal" | "counterfactual"
    | "temporal" | "graph" | "governance" | "calibration" | "epistemic"
    | "branch" | "hidden_state" | "memory" | "audit" | "diff";

export type ExplanationAudience = "user" | "operator" | "analyst" | "developer" | "governance" | "auditor" | "agent" | "system";

export interface ExplanationEvidence {
    id: string;
    evidenceType: "event" | "quant" | "memory" | "graph" | "hidden_state" | "realm" | "causal_link" | "pattern" | "attractor";
    label: string;
    contribution: number;
    confidence: number;
    polarity: "supporting" | "contradicting";
    explanation: string;
    references: string[];
}

export interface QuantContribution {
    quantId: string;
    quantType: string;
    contribution: number;
    confidence: number;
    direction: "positive" | "negative" | "stabilizing" | "destabilizing";
    explanation: string;
}

export interface ExplanationRealmContribution {
    realm: string;
    contribution: number;
    confidence: number;
    agreementScore: number;
    explanation: string;
}

export interface HiddenStateNarrative {
    hiddenStateId: string;
    label: string;
    probability: number;
    confidence: number;
    evidenceIds: string[];
    explanation: string;
}

export interface BranchNarrative {
    branchId: string;
    predicate: string;
    status: "active" | "reserved" | "suppressed" | "pruned" | "collapsed";
    probability: number;
    contribution: number;
    explanation: string;
    pruneReason?: string;
}

export interface CausalNarrative {
    id: string;
    sourceEventId: string;
    targetEventId: string;
    causalStrength: number;
    causalType: "causes" | "contributes_to" | "correlates_with" | "precedes" | "enables";
    explanation: string;
}

export interface EpistemicNarrative {
    knownKnowns: string[];
    knownUnknowns: string[];
    unknownKnownSignals: string[];
    unknownUnknownPressure: number;
    uncertaintySummary: string;
    explanation: string;
}

export interface GovernanceNarrative {
    decision: string;
    riskClass: string;
    actionAuthority: string;
    constraints: string[];
    redactions: string[];
    explanation: string;
}

export interface ConfidenceNarrative {
    confidence: number;
    calibrationAdjusted: boolean;
    supportingWeight: number;
    contradictoryWeight: number;
    explanation: string;
}

export interface EntropyNarrative {
    entropy: number;
    disagreementLevel: number;
    branchDiversity: number;
    explanation: string;
}

export interface CounterfactualExplanation {
    id: string;
    changedCondition: string;
    changedPrediction: string;
    probabilityShift: number;
    explanation: string;
}

export interface CalibrationNarrative {
    historicalAccuracy: number;
    confidenceCalibration: number;
    similarPatternReliability: number;
    explanation: string;
}

export interface ExplanationRedaction {
    field: string;
    action: "remove" | "mask" | "generalize";
    reason: string;
}

export interface PredictionExplanation {
    id: string;
    predictionId: string;
    contextId: string;
    explanationType: ExplanationType;
    summary: string;
    supportingEvidence: ExplanationEvidence[];
    contradictoryEvidence: ExplanationEvidence[];
    topQuants: QuantContribution[];
    topRealms: ExplanationRealmContribution[];
    hiddenStateNarratives: HiddenStateNarrative[];
    branchNarratives: BranchNarrative[];
    causalNarratives: CausalNarrative[];
    epistemicNarrative?: EpistemicNarrative;
    governanceNarrative?: GovernanceNarrative;
    counterfactuals?: CounterfactualExplanation[];
    confidenceNarrative?: ConfidenceNarrative;
    entropyNarrative?: EntropyNarrative;
    calibrationNarrative?: CalibrationNarrative;
    explanationScore: number;
    audience: ExplanationAudience;
    redactions: ExplanationRedaction[];
    createdAt: string;
}

export interface PredictionDiffExplanation {
    id: string;
    predictionId: string;
    contextId: string;
    changes: string[];
    confidenceShift: number;
    entropyShift: number;
    branchChanges: string[];
    explanation: string;
    createdAt: string;
}

export interface RenderedExplanation {
    id: string;
    explanationId: string;
    audience: ExplanationAudience;
    format: "text" | "json" | "markdown";
    content: string;
    createdAt: string;
}

// Port input types
export interface PredictionExplanationInput {
    predictionId: string;
    contextId: string;
    topPredicate?: string;
    confidence: number;
    entropy: number;
    branches: PredictionBranch[];
    hiddenStates?: HiddenStateEstimate[];
    quantField?: QuantFieldSummary;
    memoryResults?: MemoryRecallResult[];
    governanceDecision?: GovernanceDecision;
    calibrationData?: CalibrationOutcome[];
    realmResults?: RealmProcessingResult;
    audience: ExplanationAudience;
    explanationType: ExplanationType;
    mode: PredictionMode;
}

export interface BranchExplanationInput {
    branch: PredictionBranch;
    contextId: string;
    realmResults?: RealmProcessingResult;
    pruneReason?: string;
}

export interface HiddenStateExplanationInput {
    hiddenState: HiddenStateEstimate;
    contextId: string;
    realmResults?: RealmProcessingResult;
}

export interface CounterfactualInput {
    predictionId: string;
    contextId: string;
    branches: PredictionBranch[];
    confidence: number;
}

export interface PredictionDiffInput {
    predictionId: string;
    contextId: string;
    previousConfidence?: number;
    currentConfidence: number;
    previousEntropy?: number;
    currentEntropy: number;
    branchChanges?: string[];
}

export interface ExplanationRenderInput {
    explanation: PredictionExplanation;
    audience: ExplanationAudience;
    format?: "text" | "json" | "markdown";
    governanceDecision?: GovernanceDecision;
}

// Port
export interface ExplanationPort {
    explainPrediction(input: PredictionExplanationInput, ctx: DomainContext): Promise<PredictionExplanation>;
    explainBranch(input: BranchExplanationInput, ctx: DomainContext): Promise<BranchNarrative>;
    explainHiddenState(input: HiddenStateExplanationInput, ctx: DomainContext): Promise<HiddenStateNarrative>;
    explainCounterfactual(input: CounterfactualInput, ctx: DomainContext): Promise<CounterfactualExplanation[]>;
    explainDiff(input: PredictionDiffInput, ctx: DomainContext): Promise<PredictionDiffExplanation>;
    render(input: ExplanationRenderInput, ctx: DomainContext): Promise<RenderedExplanation>;
}
