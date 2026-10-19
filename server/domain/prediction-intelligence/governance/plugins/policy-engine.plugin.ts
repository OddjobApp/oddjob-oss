import { randomUUID } from "crypto";
import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { PolicyEvaluationInput, GovernanceDecision, PolicyTrace, GovernanceConstraint, GovernanceDecisionType, ActionAuthorityLevel, RiskClass } from "../types.js";
import { CURRENT_POLICY_VERSION, RISK_CLASS_RANK, ACTION_AUTHORITY_RANK } from "../types.js";
import { makeGovManifest, successResult, makeConstraint, minAuthority } from "./plugin-helpers.js";

const manifest = makeGovManifest({
    name: "policy-engine",
    subPod: "policy-engine",
    capability: "governance.policy_engine",
    description: "Evaluates deterministic policy rules against subject, action, resource, and facts (spec §19).",
    inputTypes: ["PolicyEvaluationInput"],
    outputTypes: ["GovernanceDecision"],
    timeoutMs: 10,
});

interface PolicyRule {
    id: string;
    name: string;
    matches(facts: Record<string, unknown>): boolean;
    decision: GovernanceDecisionType;
    maxActionLevel: ActionAuthorityLevel;
    riskClass: RiskClass;
    requiresHuman: boolean;
    requiresExplanation: boolean;
    reason: string;
}

const MVP_POLICIES: PolicyRule[] = [
    {
        id: "pol_tenant_cross",
        name: "Cross-Tenant Denial",
        matches: f => f.crossTenant === true,
        decision: "deny", maxActionLevel: "observe", riskClass: "critical",
        requiresHuman: false, requiresExplanation: false,
        reason: "Cross-tenant access is forbidden",
    },
    {
        id: "pol_restricted_agent",
        name: "Restricted Data Agent Ban",
        matches: f => f.sensitivityLevel === "restricted" && (f.actionType === "call_agent" || f.actionType === "run_plugin"),
        decision: "deny", maxActionLevel: "observe", riskClass: "critical",
        requiresHuman: false, requiresExplanation: false,
        reason: "Restricted data cannot be exposed to agents or plugins",
    },
    {
        id: "pol_credential_exposure",
        name: "Credential Exposure Prevention",
        matches: f => Array.isArray(f.sensitivityCategories) && (f.sensitivityCategories as string[]).includes("credential"),
        decision: "redact", maxActionLevel: "observe", riskClass: "high",
        requiresHuman: false, requiresExplanation: true,
        reason: "Credentials must be redacted before any downstream use",
    },
    {
        id: "pol_catastrophic_auto",
        name: "Catastrophic Risk Automation Block",
        matches: f => RISK_CLASS_RANK[f.riskClass as RiskClass] >= RISK_CLASS_RANK.catastrophic && ACTION_AUTHORITY_RANK[f.requestedActionLevel as ActionAuthorityLevel] >= ACTION_AUTHORITY_RANK.automate_low_risk,
        decision: "block", maxActionLevel: "observe", riskClass: "catastrophic",
        requiresHuman: true, requiresExplanation: true,
        reason: "Catastrophic-risk actions must never be automated",
    },
    {
        id: "pol_critical_human",
        name: "Critical Risk Human Confirmation",
        matches: f => RISK_CLASS_RANK[f.riskClass as RiskClass] >= RISK_CLASS_RANK.critical && ACTION_AUTHORITY_RANK[f.requestedActionLevel as ActionAuthorityLevel] >= ACTION_AUTHORITY_RANK.automate_low_risk,
        decision: "require_human", maxActionLevel: "ask_confirmation", riskClass: "critical",
        requiresHuman: true, requiresExplanation: true,
        reason: "Critical-risk actions require human confirmation",
    },
    {
        id: "pol_unknown_unknown_cap",
        name: "Unknown-Unknown Automation Cap",
        matches: f => f.epistemicStatus === "unknown_unknown" && ACTION_AUTHORITY_RANK[f.requestedActionLevel as ActionAuthorityLevel] >= ACTION_AUTHORITY_RANK.notify,
        decision: "observe_only", maxActionLevel: "observe", riskClass: "high",
        requiresHuman: false, requiresExplanation: true,
        reason: "Unknown-unknown epistemic status prevents any action beyond observation",
    },
    {
        id: "pol_low_trust",
        name: "Low Trust Subject Cap",
        matches: f => typeof f.subjectTrust === "number" && f.subjectTrust < 0.3,
        decision: "observe_only", maxActionLevel: "observe", riskClass: "medium",
        requiresHuman: false, requiresExplanation: false,
        reason: "Low-trust subjects are restricted to observe-only",
    },
];

export const policyEnginePlugin: PredictionPlugin<PolicyEvaluationInput, GovernanceDecision> = {
    manifest,

    async canHandle(): Promise<PluginDecision> {
        return { shouldRun: true, reason: "always evaluate policy", priority: 85, estimatedCost: { latencyMs: 1, dbReads: 0, vectorQueries: 0, agentCalls: 0 } };
    },

    async execute(input: PolicyEvaluationInput, ctx: PluginContext): Promise<PluginResult<GovernanceDecision>> {
        const startedAt = new Date().toISOString();
        const trace: PolicyTrace[] = [];
        const constraints: GovernanceConstraint[] = [];

        let decision: GovernanceDecisionType = "allow";
        let maxActionLevel: ActionAuthorityLevel = input.action.requestedAuthority;
        let riskClass: RiskClass = "none";
        let requiresHuman = false;
        let requiresExplanation = false;
        let finalReason = "No policy restrictions matched";

        for (const policy of MVP_POLICIES) {
            const matched = policy.matches(input.facts);
            trace.push({
                policyId: policy.id,
                policyName: policy.name,
                policyVersion: CURRENT_POLICY_VERSION,
                result: matched ? (policy.decision === "allow" ? "allowed" : "denied") : "not_matched",
                explanation: matched ? policy.reason : `rule did not match current facts`,
            });

            if (matched) {
                // Take most restrictive decision
                const currentRank = ACTION_AUTHORITY_RANK[maxActionLevel] ?? 0;
                const policyRank = ACTION_AUTHORITY_RANK[policy.maxActionLevel] ?? 0;
                if (policyRank < currentRank) maxActionLevel = policy.maxActionLevel;
                if (RISK_CLASS_RANK[policy.riskClass] > RISK_CLASS_RANK[riskClass]) riskClass = policy.riskClass;
                if (policy.requiresHuman) requiresHuman = true;
                if (policy.requiresExplanation) requiresExplanation = true;
                if (decision === "allow" || policy.decision === "deny" || policy.decision === "block") {
                    decision = policy.decision;
                    finalReason = policy.reason;
                }
                constraints.push(makeConstraint("max_action_level", maxActionLevel, policy.reason));
                if (policy.requiresHuman) constraints.push(makeConstraint("require_human", true, policy.reason));
                if (policy.decision === "deny" || policy.decision === "block") break;
            }
        }

        const allowed = decision !== "deny" && decision !== "block";

        const govDecision: GovernanceDecision = {
            id: randomUUID(),
            contextId: input.context.id,
            subjectId: input.subject.id,
            decision,
            allowed,
            maxActionLevel,
            riskClass: riskClass === "none" ? (input.facts.riskClass as RiskClass ?? "none") : riskClass,
            requiresHumanConfirmation: requiresHuman,
            requiresExplanation,
            requiresAudit: true,
            redactions: [],
            constraints,
            policyTrace: trace,
            reason: finalReason,
            evidenceIds: [],
            policyVersion: CURRENT_POLICY_VERSION,
            createdAt: ctx.now,
        };

        return successResult(manifest, govDecision, allowed ? 0.9 : 1.0, ctx, startedAt, "policy_evaluation");
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
