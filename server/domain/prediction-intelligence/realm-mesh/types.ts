// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN — REALM MESH POD
// Type contracts (spec §9-§15, §26-§35)
// ============================================================================

import type {
    Quant, QuantFieldSummary, QuantRelationship, BranchInfluence, HiddenStateInfluence,
    RealmContribution, RealmName, RealmEffect, RealmTargetType, CanonicalEvent, PredictionContext,
} from "../quant/types.js";
import type { PredictionPlugin, PluginContext, PluginResult } from "../plugin-runtime/types.js";

// ---------------------------------------------------------------------------
// Re-export quant types used across realm-mesh
// ---------------------------------------------------------------------------
export type { RealmContribution, RealmName, RealmEffect, RealmTargetType };

// ---------------------------------------------------------------------------
// Realm Warning (spec §14)
// ---------------------------------------------------------------------------

export interface RealmWarning {
    realm: RealmName;
    code: string;
    severity: "low" | "medium" | "high";
    message: string;
    evidenceIds: string[];
}

// ---------------------------------------------------------------------------
// Branch Constraint (spec §15)
// ---------------------------------------------------------------------------

export type BranchConstraintType =
    | "temporal_impossible" | "semantic_conflict" | "causal_unsupported"
    | "geographic_impossible" | "spatial_impossible"
    | "epistemic_unresolved" | "governance_risk";

export interface BranchConstraint {
    id: string;
    branchId: string;
    realm: RealmName;
    type: BranchConstraintType;
    severity: "soft" | "hard";
    confidence: number;
    explanation: string;
    evidenceIds: string[];
}

// ---------------------------------------------------------------------------
// Realm Execution Plan (spec §26)
// ---------------------------------------------------------------------------

export interface RealmExecutionPlan {
    id: string;
    mode: "realtime" | "interactive" | "analysis" | "batch";
    orderedRealms: RealmName[];
    skippedRealms: { realm: RealmName; reason: string }[];
    parallelGroups: RealmName[][];
    timeoutMs: number;
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Realm Execution Trace (spec §35)
// ---------------------------------------------------------------------------

export interface RealmExecutionTrace {
    id: string;
    contextId: string;
    startedAt: string;
    completedAt: string;
    durationMs: number;
    realmRuns: {
        realm: RealmName;
        pluginName: string;
        status: "success" | "partial" | "skipped" | "failed" | "timeout";
        durationMs: number;
        contributionCount: number;
        warningCount: number;
    }[];
}

// ---------------------------------------------------------------------------
// Realm Agreement Score (spec §29)
// ---------------------------------------------------------------------------

export interface RealmAgreementScore {
    id: string;
    contextId: string;
    branchId?: string;
    quantId?: string;
    score: number;
    agreeingRealms: RealmName[];
    disagreeingRealms: RealmName[];
    neutralRealms: RealmName[];
    explanation: string;
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Realm Conflict Report (spec §30)
// ---------------------------------------------------------------------------

export type RealmConflictAction =
    | "ignore" | "increase_uncertainty" | "split_branch"
    | "create_investigation_quant" | "request_more_evidence";

export interface RealmConflictReport {
    id: string;
    contextId: string;
    conflictType: string;
    realms: RealmName[];
    severity: "low" | "medium" | "high";
    entropyDelta: number;
    suggestedAction: RealmConflictAction;
    explanation: string;
    evidenceIds: string[];
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Realm Input / Output Contracts (spec §12-§13)
// ---------------------------------------------------------------------------

export interface WindowSummary {
    windowId: string;
    contextId: string;
    startedAt: string;
    endedAt?: string;
    eventCount: number;
    quantCount: number;
}

export interface PredictionBranch {
    id: string;
    contextId: string;
    label: string;
    confidence: number;
    probability: number;
    supportingQuantIds: string[];
    createdAt: string;
}

export interface HiddenStateEstimate {
    id: string;
    contextId: string;
    label: string;
    probability: number;
    supportingQuantIds: string[];
    createdAt: string;
}

// Quant-realm input (spec §12.1)
export interface QuantRealmInput {
    quant: Quant;
    context: PredictionContext;
    activeWindows: WindowSummary[];
    fieldSummary?: QuantFieldSummary;
    candidateBranches?: PredictionBranch[];
    hiddenStateCandidates?: HiddenStateEstimate[];
}

// Quant-realm output (spec §13.1)
export interface QuantRealmOutput {
    quantId: string;
    realm: RealmName;
    transformedQuant?: Partial<Quant>;
    contributions: RealmContribution[];
    branchInfluences: BranchInfluence[];
    hiddenStateInfluences: HiddenStateInfluence[];
    relationships: QuantRelationship[];
    warnings: RealmWarning[];
}

// Event-realm input (spec §12.2)
export interface EventRealmInput {
    event: CanonicalEvent;
    context: PredictionContext;
    activeWindows: WindowSummary[];
}

// Event-realm output (spec §13.2)
export interface EventRealmOutput {
    eventId: string;
    realm: RealmName;
    contributions: RealmContribution[];
    generatedQuants: Partial<Quant>[];
    warnings: RealmWarning[];
}

// Branch-realm input/output (spec §12.3 / §13.3)
export interface BranchRealmInput {
    branch: PredictionBranch;
    context: PredictionContext;
    supportingQuants: Quant[];
    fieldSummary: QuantFieldSummary;
}

export interface BranchRealmOutput {
    branchId: string;
    realm: RealmName;
    contributions: RealmContribution[];
    constraints: BranchConstraint[];
    warnings: RealmWarning[];
}

// Hidden-state-realm input/output (spec §12.4 / §13.4)
export interface HiddenStateRealmInput {
    hiddenState: HiddenStateEstimate;
    context: PredictionContext;
    supportingQuants: Quant[];
    fieldSummary: QuantFieldSummary;
}

export interface HiddenStateRealmOutput {
    hiddenStateId: string;
    realm: RealmName;
    contributions: RealmContribution[];
    warnings: RealmWarning[];
}

// ---------------------------------------------------------------------------
// Realm Plugin Interface (spec §11)
// ---------------------------------------------------------------------------

export interface RealmPlugin<TInput = QuantRealmInput, TOutput = QuantRealmOutput>
    extends PredictionPlugin<TInput, TOutput> {
    realm: RealmName;
    transformQuant?(input: QuantRealmInput, ctx: PluginContext): Promise<QuantRealmOutput>;
    analyzeEvent?(input: EventRealmInput, ctx: PluginContext): Promise<EventRealmOutput>;
    contributeToBranch?(input: BranchRealmInput, ctx: PluginContext): Promise<BranchRealmOutput>;
    contributeToHiddenState?(input: HiddenStateRealmInput, ctx: PluginContext): Promise<HiddenStateRealmOutput>;
}

// ---------------------------------------------------------------------------
// Realm Mesh Port inputs / outputs (spec §32-§34)
// ---------------------------------------------------------------------------

export interface RealmQuantProcessingInput {
    context: PredictionContext;
    quants: Quant[];
    activeWindows: WindowSummary[];
    fieldSummary?: QuantFieldSummary;
    mode: "realtime" | "interactive" | "analysis" | "batch";
}

export interface RealmEventProcessingInput {
    context: PredictionContext;
    event: CanonicalEvent;
    activeWindows: WindowSummary[];
    mode: "realtime" | "interactive" | "analysis" | "batch";
}

export interface RealmBranchContributionInput {
    context: PredictionContext;
    branches: PredictionBranch[];
    supportingQuants: Quant[];
    fieldSummary: QuantFieldSummary;
    mode: "realtime" | "interactive" | "analysis" | "batch";
}

export interface RealmBranchContributionResult {
    contextId: string;
    contributions: RealmContribution[];
    constraints: BranchConstraint[];
    warnings: RealmWarning[];
}

export interface RealmHiddenStateContributionInput {
    context: PredictionContext;
    hiddenStates: HiddenStateEstimate[];
    supportingQuants: Quant[];
    fieldSummary: QuantFieldSummary;
    mode: "realtime" | "interactive" | "analysis" | "batch";
}

export interface RealmHiddenStateContributionResult {
    contextId: string;
    contributions: RealmContribution[];
    warnings: RealmWarning[];
}

export interface RealmAgreementInput {
    contextId: string;
    contributions: RealmContribution[];
    quantId?: string;
    branchId?: string;
}

export interface RealmConflictInput {
    contextId: string;
    contributions: RealmContribution[];
    quantId?: string;
}

export interface RealmProcessingResult {
    contextId: string;
    executionPlan: RealmExecutionPlan;
    contributions: RealmContribution[];
    branchInfluences: BranchInfluence[];
    hiddenStateInfluences: HiddenStateInfluence[];
    quantRelationships: QuantRelationship[];
    agreement?: RealmAgreementScore;
    conflicts: RealmConflictReport[];
    warnings: RealmWarning[];
    trace: RealmExecutionTrace;
}

// ---------------------------------------------------------------------------
// Realm Mesh Port (spec §32)
// ---------------------------------------------------------------------------

export interface RealmMeshPort {
    processEvent(input: RealmEventProcessingInput, ctx: import("../quant/types.js").DomainContext): Promise<RealmProcessingResult>;
    processQuants(input: RealmQuantProcessingInput, ctx: import("../quant/types.js").DomainContext): Promise<RealmProcessingResult>;
    contributeToBranches(input: RealmBranchContributionInput, ctx: import("../quant/types.js").DomainContext): Promise<RealmBranchContributionResult>;
    contributeToHiddenStates(input: RealmHiddenStateContributionInput, ctx: import("../quant/types.js").DomainContext): Promise<RealmHiddenStateContributionResult>;
    scoreAgreement(input: RealmAgreementInput, ctx: import("../quant/types.js").DomainContext): Promise<RealmAgreementScore>;
    detectConflicts(input: RealmConflictInput, ctx: import("../quant/types.js").DomainContext): Promise<RealmConflictReport[]>;
}
