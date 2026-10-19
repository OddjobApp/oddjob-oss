// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN - GOVERNANCE POD
// Core TypeScript type definitions (spec §6-§41)
// ============================================================================

import type { DomainContext, QuantFieldSummary } from "../quant/types.js";
import type { SensitivityProfile } from "../canonical-event/types.js";
import type { PredictionContext, ContextPermissions } from "../context/types.js";
import type { HiddenStateEstimate } from "../hidden-state/types.js";
import type { MemoryRecallResult } from "../memory/types.js";
import type { RealmProcessingResult } from "../realm-mesh/types.js";
import type { PredictionBranch } from "../prediction/types.js";

export type PredictionMode = "realtime" | "interactive" | "analysis" | "batch";

// ---------------------------------------------------------------------------
// Governance Decision Type (spec §6)
// ---------------------------------------------------------------------------

export type GovernanceDecisionType =
    | "allow"
    | "deny"
    | "redact"
    | "generalize"
    | "defer"
    | "require_human"
    | "observe_only"
    | "suggest_only"
    | "notify_allowed"
    | "automation_allowed"
    | "sandbox"
    | "reduce_confidence"
    | "suppress_output"
    | "escalate"
    | "block";

// ---------------------------------------------------------------------------
// Action Authority Level (spec §7)
// ---------------------------------------------------------------------------

export type ActionAuthorityLevel =
    | "observe"
    | "explain"
    | "suggest"
    | "notify"
    | "ask_confirmation"
    | "automate_low_risk"
    | "automate_high_risk"
    | "block";

export const ACTION_AUTHORITY_RANK: Record<ActionAuthorityLevel, number> = {
    observe: 0,
    explain: 1,
    suggest: 2,
    notify: 3,
    ask_confirmation: 4,
    automate_low_risk: 5,
    automate_high_risk: 6,
    block: 7,
};

// ---------------------------------------------------------------------------
// Risk Class (spec §8)
// ---------------------------------------------------------------------------

export type RiskClass = "none" | "low" | "medium" | "high" | "critical" | "catastrophic";

export const RISK_CLASS_RANK: Record<RiskClass, number> = {
    none: 0, low: 1, medium: 2, high: 3, critical: 4, catastrophic: 5,
};

// ---------------------------------------------------------------------------
// Governance structures (spec §11-§14)
// ---------------------------------------------------------------------------

export interface GovernanceRedaction {
    field: string;
    action: "remove" | "mask" | "hash" | "generalize" | "reference_only";
    reason: string;
}

export type GovernanceConstraintType =
    | "max_action_level"
    | "require_human"
    | "observe_only"
    | "suggest_only"
    | "memory_forbidden"
    | "agent_forbidden"
    | "geo_generalization_required"
    | "spatial_safety_required"
    | "explanation_required"
    | "confidence_floor"
    | "automation_forbidden"
    | "rate_limit"
    | "tenant_boundary";

export interface GovernanceConstraint {
    id: string;
    type: GovernanceConstraintType;
    value: unknown;
    reason: string;
    policyId: string;
}

export interface PolicyTrace {
    policyId: string;
    policyName: string;
    policyVersion: string;
    result: "matched" | "not_matched" | "denied" | "allowed" | "constrained";
    explanation: string;
}

// ---------------------------------------------------------------------------
// Governance Decision (spec §11)
// ---------------------------------------------------------------------------

export interface GovernanceDecision {
    id: string;
    contextId: string;
    subjectId?: string;
    decision: GovernanceDecisionType;
    allowed: boolean;
    maxActionLevel: ActionAuthorityLevel;
    riskClass: RiskClass;
    requiresHumanConfirmation: boolean;
    requiresExplanation: boolean;
    requiresAudit: boolean;
    confidenceThreshold?: number;
    confidenceAdjustment?: number;
    redactions: GovernanceRedaction[];
    constraints: GovernanceConstraint[];
    policyTrace: PolicyTrace[];
    reason: string;
    evidenceIds: string[];
    policyVersion: string;
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Subject, Action, Resource (spec §16-§18)
// ---------------------------------------------------------------------------

export interface GovernanceSubject {
    id: string;
    type: "user" | "agent" | "service" | "system" | "plugin";
    tenantId?: string;
    roles: string[];
    permissions: string[];
    trustLevel: number;
}

export type GovernanceActionType =
    | "process_event"
    | "create_quant"
    | "recall_memory"
    | "write_memory"
    | "run_plugin"
    | "call_agent"
    | "surface_prediction"
    | "explain_prediction"
    | "notify"
    | "automate_action"
    | "block_action";

export interface GovernanceAction {
    id?: string;
    type: GovernanceActionType;
    requestedAuthority: ActionAuthorityLevel;
    payload?: Record<string, unknown>;
}

export interface GovernanceResource {
    id?: string;
    type: "event" | "quant" | "memory" | "prediction" | "branch" | "hidden_state" | "plugin" | "agent" | "geographic_data" | "spatial_data" | "action";
    sensitivity?: SensitivityProfile;
    tenantId?: string;
    metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Evaluation inputs (spec §15, §40)
// ---------------------------------------------------------------------------

export interface GovernanceEvaluationInput {
    context: PredictionContext;
    subject?: GovernanceSubject;
    action?: GovernanceAction;
    resource?: GovernanceResource;
    branches?: PredictionBranch[];
    hiddenState?: HiddenStateEstimate;
    quantField?: QuantFieldSummary;
    memoryResults?: MemoryRecallResult[];
    realmResults?: RealmProcessingResult;
    requestedActionLevel?: ActionAuthorityLevel;
    confidence?: number;
    entropy?: number;
    mode: PredictionMode;
}

export interface PolicyEvaluationInput {
    subject: GovernanceSubject;
    action: GovernanceAction;
    resource: GovernanceResource;
    context: PredictionContext;
    facts: Record<string, unknown>;
    mode: PredictionMode;
}

export interface ActionAuthorizationInput {
    contextId: string;
    requestedActionLevel: ActionAuthorityLevel;
    riskClass: RiskClass;
    confidence: number;
    entropy?: number;
    subjectTrustLevel?: number;
    contextPermissions?: ContextPermissions;
    requiresHuman?: boolean;
}

export interface MemoryGovernanceInput {
    contextId: string;
    requestType: "recall" | "write";
    memoryType: string;
    tenantId?: string;
    sensitivity?: SensitivityProfile;
    requestingSubject?: GovernanceSubject;
}

export interface AgentGovernanceInput {
    contextId: string;
    agentId: string;
    purpose: string;
    requestedData?: Record<string, unknown>;
    sensitivity?: SensitivityProfile;
}

export interface RiskClassificationInput {
    contextId: string;
    requestedActionLevel: ActionAuthorityLevel;
    confidence: number;
    entropy?: number;
    sensitivity?: SensitivityProfile;
    branches?: PredictionBranch[];
    hiddenState?: HiddenStateEstimate;
    irreversible?: boolean;
}

// ---------------------------------------------------------------------------
// Risk classification result (spec §41)
// ---------------------------------------------------------------------------

export interface RiskClassificationResult {
    riskClass: RiskClass;
    score: number;
    factors: { name: string; value: number; explanation: string }[];
    explanation: string;
}

// ---------------------------------------------------------------------------
// Simulation (deferred, but define types)
// ---------------------------------------------------------------------------

export interface GovernanceSimulationInput {
    contextId?: string;
    policyVersion: string;
    evaluationInput: GovernanceEvaluationInput;
    dryRun: boolean;
}

export interface GovernanceSimulationResult {
    simulatedDecision: GovernanceDecision;
    productionDecision?: GovernanceDecision;
    differs: boolean;
    differences: string[];
}

// ---------------------------------------------------------------------------
// Plugin-specific inputs
// ---------------------------------------------------------------------------

export interface TenantIsolationPluginInput {
    contextTenantId?: string;
    subjectTenantId?: string;
    resourceTenantId?: string;
    isCrossTenantMerge?: boolean;
    mode: PredictionMode;
}

export interface SensitivityEnforcementPluginInput {
    sensitivity: SensitivityProfile;
    action: GovernanceAction;
    subject?: GovernanceSubject;
    mode: PredictionMode;
}

export interface ConfidenceGatingPluginInput {
    confidence: number;
    entropy: number;
    epistemicStatus?: string;
    requestedActionLevel: ActionAuthorityLevel;
    riskClass: RiskClass;
}

// ---------------------------------------------------------------------------
// Governance Port (spec §39)
// ---------------------------------------------------------------------------

export interface GovernancePort {
    evaluate(input: GovernanceEvaluationInput, ctx: DomainContext): Promise<GovernanceDecision>;
    evaluatePolicy(input: PolicyEvaluationInput, ctx: DomainContext): Promise<GovernanceDecision>;
    authorizeAction(input: ActionAuthorizationInput, ctx: DomainContext): Promise<GovernanceDecision>;
    governMemory(input: MemoryGovernanceInput, ctx: DomainContext): Promise<GovernanceDecision>;
    governAgentCall(input: AgentGovernanceInput, ctx: DomainContext): Promise<GovernanceDecision>;
    classifyRisk(input: RiskClassificationInput, ctx: DomainContext): Promise<RiskClassificationResult>;
    simulate(input: GovernanceSimulationInput, ctx: DomainContext): Promise<GovernanceSimulationResult>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CURRENT_POLICY_VERSION = "1.0.0";

/** Min confidence required per action authority level */
export const CONFIDENCE_GATE: Record<ActionAuthorityLevel, number> = {
    observe: 0,
    explain: 0.2,
    suggest: 0.4,
    notify: 0.65,
    ask_confirmation: 0.7,
    automate_low_risk: 0.80,
    automate_high_risk: 0.92,
    block: 0,
};

/** Max action authority allowed per risk class (policy default) */
export const MAX_AUTHORITY_BY_RISK: Record<RiskClass, ActionAuthorityLevel> = {
    none: "automate_high_risk",
    low: "automate_low_risk",
    medium: "notify",
    high: "ask_confirmation",
    critical: "ask_confirmation",
    catastrophic: "observe",
};

export const GOVERNANCE_EPSILON = 1e-6;
