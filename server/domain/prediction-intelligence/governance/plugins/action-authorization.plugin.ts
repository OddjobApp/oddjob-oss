import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { ActionAuthorizationInput, GovernanceDecisionType, ActionAuthorityLevel } from "../types.js";
import { ACTION_AUTHORITY_RANK, RISK_CLASS_RANK } from "../types.js";
import { clamp, makeGovManifest, successResult, minAuthority } from "./plugin-helpers.js";

interface ActionAuthorizationOutput {
    maxActionLevel: ActionAuthorityLevel;
    decision: GovernanceDecisionType;
    allowed: boolean;
    requiresHumanConfirmation: boolean;
    reason: string;
}

const manifest = makeGovManifest({
    name: "action-authorization",
    subPod: "action-authorization",
    capability: "governance.action_authorization",
    description: "Determines final action authority and whether human confirmation is required (spec §24).",
    inputTypes: ["ActionAuthorizationInput"],
    outputTypes: ["ActionAuthorizationOutput"],
    timeoutMs: 5,
});

export const actionAuthorizationPlugin: PredictionPlugin<ActionAuthorizationInput, ActionAuthorizationOutput> = {
    manifest,

    async canHandle(): Promise<PluginDecision> {
        return { shouldRun: true, reason: "always authorize actions", priority: 88, estimatedCost: { latencyMs: 0, dbReads: 0, vectorQueries: 0, agentCalls: 0 } };
    },

    async execute(input: ActionAuthorizationInput, ctx: PluginContext): Promise<PluginResult<ActionAuthorizationOutput>> {
        const startedAt = new Date().toISOString();

        const requestedRank = ACTION_AUTHORITY_RANK[input.requestedActionLevel] ?? 0;
        const riskRank = RISK_CLASS_RANK[input.riskClass];
        const requiresHuman = input.requiresHuman ?? (riskRank >= RISK_CLASS_RANK.high);
        const subjectTrust = clamp(input.subjectTrustLevel ?? 0.8);
        const contextMax = input.contextPermissions?.maxActionLevel ?? "automate_high_risk";
        const normalizedContextMax: ActionAuthorityLevel = contextMax === "automate" ? "automate_low_risk" : contextMax as ActionAuthorityLevel;
        
        // Compute granted level: min of what's requested and what's safe
        let granted: ActionAuthorityLevel = input.requestedActionLevel;

        // Require human confirmation for high risk
        if (requiresHuman && requestedRank >= ACTION_AUTHORITY_RANK.automate_low_risk) {
            granted = "ask_confirmation";
        }

        // Low trust subjects: cap at suggest
        if (subjectTrust < 0.5 && requestedRank > ACTION_AUTHORITY_RANK.suggest) {
            granted = minAuthority(granted, "suggest");
        }

        // Respect context max
        granted = minAuthority(granted, normalizedContextMax);

        const grantedRank = ACTION_AUTHORITY_RANK[granted];
        const allowed = grantedRank >= requestedRank;

        let decision: GovernanceDecisionType;
        if (!allowed) decision = "deny";
        else if (requiresHuman) decision = "require_human";
        else if (granted === "notify") decision = "notify_allowed";
        else if (granted === "automate_low_risk" || granted === "automate_high_risk") decision = "automation_allowed";
        else if (granted === "suggest") decision = "suggest_only";
        else decision = "allow";

        const reason = allowed
            ? `${input.requestedActionLevel} authorized at ${granted} (risk=${input.riskClass}, conf=${input.confidence.toFixed(3)}, trust=${subjectTrust.toFixed(2)})`
            : `${input.requestedActionLevel} denied: granted level is ${granted}`;

        return successResult(manifest, { maxActionLevel: granted, decision, allowed, requiresHumanConfirmation: requiresHuman, reason }, 0.95, ctx, startedAt, "action_authorization");
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
