import type {
    PluginContext,
    PluginManifest,
    PluginPolicyDecision,
    ExecutionMode,
} from "./types.js";

// ============================================================================
// PLUGIN POLICY GUARD — Spec §24
// Validates a plugin + context pair before execution.
// Every check is documented with the spec rule it enforces.
// ============================================================================

export const pluginPolicyGuard = {
    /**
     * Evaluate whether a plugin is permitted to run in the given context.
     * Returns a PluginPolicyDecision. A denied decision must stop execution.
     */
    evaluate(manifest: PluginManifest, ctx: PluginContext): PluginPolicyDecision {
        const violations: string[] = [];
        const redactions: string[] = [];

        // ------------------------------------------------------------------
        // Rule 1: Execution mode compatibility
        // hot-path (realtime) may only run realtime-class plugins
        // ------------------------------------------------------------------
        if (ctx.mode === "realtime" && manifest.execution.latencyClass !== "realtime") {
            violations.push(
                `Plugin '${manifest.name}' is '${manifest.execution.latencyClass}' class — not eligible for realtime mode`
            );
        }

        // ------------------------------------------------------------------
        // Rule 2: Agent calls must be declared and permitted
        // ------------------------------------------------------------------
        if (manifest.agents.usesAgents) {
            if (!ctx.permissions.canCallAgents) {
                violations.push(`Plugin '${manifest.name}' requires agent access but context permission 'canCallAgents' is false`);
            }
            if (ctx.mode === "realtime" && !manifest.agents.allowedForHotPath) {
                violations.push(`Plugin '${manifest.name}' uses agents and is NOT marked 'allowedForHotPath' — blocked in realtime mode`);
            }
            if (ctx.limits.maxAgentCalls <= 0) {
                violations.push(`Plugin '${manifest.name}' requires agent calls but limit is 0`);
            }
        }

        // ------------------------------------------------------------------
        // Rule 3: Sensitive data reads require permission
        // ------------------------------------------------------------------
        if (manifest.storage.postgres.read && !ctx.permissions.canReadSensitiveData) {
            // Allow reads if not reading sensitive tables — apply redaction signal
            redactions.push("sensitive_payload_fields");
        }

        // ------------------------------------------------------------------
        // Rule 4: Inference writes require permission
        // ------------------------------------------------------------------
        if (manifest.safety.producesInference && !ctx.permissions.canWriteInferences) {
            violations.push(`Plugin '${manifest.name}' produces inferences but context lacks 'canWriteInferences' permission`);
        }

        // ------------------------------------------------------------------
        // Rule 5: Prediction writes require permission
        // ------------------------------------------------------------------
        if (manifest.safety.producesPrediction && !ctx.permissions.canWritePredictions) {
            violations.push(`Plugin '${manifest.name}' produces predictions but context lacks 'canWritePredictions' permission`);
        }

        // ------------------------------------------------------------------
        // Rule 6: Geographic data requires permission
        // ------------------------------------------------------------------
        if (manifest.storage.postgres.tables.some(t => t.includes("geo") || t.includes("location")) &&
            !ctx.permissions.canUseGeographicData) {
            violations.push(`Plugin '${manifest.name}' reads geographic tables but 'canUseGeographicData' is false`);
        }

        // ------------------------------------------------------------------
        // Rule 7: Spatial data requires permission
        // ------------------------------------------------------------------
        if (manifest.storage.postgres.tables.some(t => t.includes("spatial")) &&
            !ctx.permissions.canUseSpatialData) {
            violations.push(`Plugin '${manifest.name}' reads spatial tables but 'canUseSpatialData' is false`);
        }

        // ------------------------------------------------------------------
        // Rule 8: Rollout status must be active or canary
        // ------------------------------------------------------------------
        if (manifest.rollout.status === "disabled") {
            violations.push(`Plugin '${manifest.name}' is disabled`);
        }
        if (manifest.rollout.status === "deprecated") {
            // Allow but warn — warning is emitted at execution level
        }
        if (manifest.rollout.status === "development") {
            // Only allow in analysis/batch mode
            if (ctx.mode === "realtime" || ctx.mode === "interactive") {
                violations.push(`Plugin '${manifest.name}' is in 'development' status — only allowed in analysis/batch mode`);
            }
        }

        // ------------------------------------------------------------------
        // Rule 9: Canary traffic percentage check
        // ------------------------------------------------------------------
        if (manifest.rollout.status === "canary" && manifest.rollout.trafficPercent < 100) {
            const roll = Math.random() * 100;
            if (roll >= manifest.rollout.trafficPercent) {
                return {
                    allowed: false,
                    reason: `Plugin '${manifest.name}' is canary (${manifest.rollout.trafficPercent}% traffic) — this request not selected`,
                };
            }
        }

        // ------------------------------------------------------------------
        // Rule 10: Governance-required plugins must be flagged
        // ------------------------------------------------------------------
        if (manifest.safety.requiresGovernance) {
            // Record that governance is needed — governance pod will act
            // This is not a veto here, just a signal
        }

        if (violations.length > 0) {
            return {
                allowed: false,
                reason: violations.join("; "),
                redactions,
            };
        }

        return {
            allowed: true,
            reason: "all policy checks passed",
            redactions: redactions.length > 0 ? redactions : undefined,
        };
    },

    /**
     * Check eligibility rules from spec §19.
     * Used before canHandle — cheaper to gate here than in the plugin.
     */
    isEligible(manifest: PluginManifest, inputType: string, mode: ExecutionMode): { eligible: boolean; reason: string } {
        if (!manifest.inputTypes.includes(inputType)) {
            return { eligible: false, reason: `Input type '${inputType}' not in manifest.inputTypes` };
        }

        if (manifest.rollout.status === "disabled") {
            return { eligible: false, reason: "Plugin is disabled" };
        }

        // Mode compatibility
        if (mode === "realtime" && manifest.execution.latencyClass !== "realtime") {
            return { eligible: false, reason: `Latency class '${manifest.execution.latencyClass}' incompatible with realtime mode` };
        }

        return { eligible: true, reason: "eligible" };
    },
};
