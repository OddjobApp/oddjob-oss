import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { SensitivityEnforcementPluginInput, GovernanceRedaction } from "../types.js";
import { makeGovManifest, successResult } from "./plugin-helpers.js";

interface SensitivityOutput { allowed: boolean; redactions: GovernanceRedaction[]; reason: string }

const manifest = makeGovManifest({
    name: "sensitivity-enforcement",
    subPod: "sensitivity-enforcement",
    capability: "governance.sensitivity_enforcement",
    description: "Prevents sensitive data from flowing to unauthorized action types; generates redaction list (spec §22).",
    inputTypes: ["SensitivityEnforcementPluginInput"],
    outputTypes: ["SensitivityOutput"],
    timeoutMs: 5,
});

const AGENT_SENSITIVE_DENY = new Set(["restricted", "high"]);
const SENSITIVE_AGENT_ACTIONS = new Set(["call_agent", "run_plugin"]);

export const sensitivityEnforcementPlugin: PredictionPlugin<SensitivityEnforcementPluginInput, SensitivityOutput> = {
    manifest,

    async canHandle(): Promise<PluginDecision> {
        return { shouldRun: true, reason: "always enforce sensitivity", priority: 98, estimatedCost: { latencyMs: 0, dbReads: 0, vectorQueries: 0, agentCalls: 0 } };
    },

    async execute(input: SensitivityEnforcementPluginInput, ctx: PluginContext): Promise<PluginResult<SensitivityOutput>> {
        const startedAt = new Date().toISOString();
        const { sensitivity, action } = input;
        const redactions: GovernanceRedaction[] = [];

        if (!sensitivity.containsSensitiveData) {
            return successResult(manifest, { allowed: true, redactions: [], reason: "no sensitive data" }, 1.0, ctx, startedAt, "sensitivity_enforcement");
        }

        // Restricted or high-sensitivity + agent/plugin call → deny
        if (AGENT_SENSITIVE_DENY.has(sensitivity.sensitivityLevel) && SENSITIVE_AGENT_ACTIONS.has(action.type)) {
            return successResult(manifest, {
                allowed: false,
                redactions: [],
                reason: `${sensitivity.sensitivityLevel} sensitive data cannot be exposed to ${action.type}`,
            }, 1.0, ctx, startedAt, "sensitivity_enforcement");
        }

        // Build redactions for sensitive fields
        for (const field of sensitivity.redactedFields) {
            redactions.push({ field, action: "mask", reason: `field marked sensitive: ${sensitivity.sensitivityLevel}` });
        }

        // Precise location → generalize
        if (sensitivity.categories.includes("precise_location")) {
            redactions.push({ field: "location", action: "generalize", reason: "precise location must be generalized" });
        }

        // Credentials → remove
        if (sensitivity.categories.includes("credential")) {
            redactions.push({ field: "credential", action: "remove", reason: "credentials must be removed" });
        }

        const allowed = sensitivity.allowedForPrediction;
        return successResult(manifest, {
            allowed,
            redactions,
            reason: allowed ? `sensitive data allowed with ${redactions.length} redaction(s)` : "sensitive data not allowed for prediction",
        }, 1.0, ctx, startedAt, "sensitivity_enforcement");
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
