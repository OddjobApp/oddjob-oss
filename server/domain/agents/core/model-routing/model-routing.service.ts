/**
 * Model Routing Service
 * 
 * The core routing engine that determines which LLM model tier (economy/premium)
 * should handle each tool invocation in the agent loop. Routes read-only and
 * search tools to cheap models, write tools to expensive models, with
 * complexity-based overrides and per-org configuration.
 * 
 * Integration point: called by AgentOrchestrator before each think() phase.
 */

import type { ToolDefinition } from "../../../tools/v1/capabilities/types.js";
import { classifyTool, getDefaultTier } from "./tool-classifier.js";
import {
    ModelTier,
    ToolTypeClassification,
    RoutingDecision,
    RoutingContext,
    OrgRoutingConfig,
    DEFAULT_ROUTING_CONFIG,
    ComplexitySignals,
} from "./types.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ModelRouting");

export const modelRoutingService = {
    /**
     * Resolve which model tier should handle the next LLM call
     * based on the tool about to be invoked.
     * 
     * Decision flow:
     * 1. Check org config overrides for this specific tool
     * 2. Classify tool → default tier mapping
     * 3. Apply complexity signals (escalate reads, downgrade writes)
     * 4. Return final decision with full context
     */
    resolveModelTier(
        toolName: string,
        toolDefinition: ToolDefinition | null,
        context: RoutingContext,
        config?: OrgRoutingConfig,
        complexitySignals?: ComplexitySignals | null
    ): RoutingDecision {
        const routingConfig = config || DEFAULT_ROUTING_CONFIG;

        // Early exit if routing disabled
        if (!routingConfig.enabled) {
            return this._buildDecision("premium", routingConfig, "write_tools", complexitySignals || null, "Routing disabled — using premium", false);
        }

        // 1. Check explicit per-tool override
        if (routingConfig.toolOverrides[toolName]) {
            const overrideTier = routingConfig.toolOverrides[toolName];
            const classification = toolDefinition ? classifyTool(toolDefinition) : "write_tools";
            return this._buildDecision(overrideTier, routingConfig, classification, complexitySignals || null, `Override: ${toolName} → ${overrideTier}`, true, routingConfig.experimentId);
        }

        // 2. Classify tool
        const classification = toolDefinition ? classifyTool(toolDefinition) : "write_tools";
        let tier = getDefaultTier(classification);

        // 3. Apply complexity-based overrides
        if (complexitySignals) {
            // Escalate read tools if high complexity
            if (classification === "read_tools" || classification === "search_tools") {
                if (complexitySignals.cyclomaticComplexity !== null &&
                    complexitySignals.cyclomaticComplexity > routingConfig.complexityEscalationThreshold) {
                    tier = "premium";
                    return this._buildDecision(tier, routingConfig, classification, complexitySignals, `Escalated: cyclomatic complexity ${complexitySignals.cyclomaticComplexity} > threshold ${routingConfig.complexityEscalationThreshold}`, false, routingConfig.experimentId);
                }
                if (complexitySignals.historicalFailureRate > 0.3) {
                    tier = "premium";
                    return this._buildDecision(tier, routingConfig, classification, complexitySignals, `Escalated: historical failure rate ${(complexitySignals.historicalFailureRate * 100).toFixed(0)}% > 30%`, false, routingConfig.experimentId);
                }
            }

            // Downgrade write tools if very simple
            if (classification === "write_tools") {
                const allSignalsLow = (
                    (complexitySignals.targetFileLines !== null && complexitySignals.targetFileLines < routingConfig.writeDowngradeThreshold * 10) &&
                    complexitySignals.dependencyCount < routingConfig.writeDowngradeThreshold &&
                    !complexitySignals.isMultiFile &&
                    complexitySignals.hasPatternMatch &&
                    complexitySignals.historicalFailureRate < 0.1
                );
                if (allSignalsLow) {
                    tier = "economy";
                    return this._buildDecision(tier, routingConfig, classification, complexitySignals, `Downgraded: all complexity signals below threshold`, false, routingConfig.experimentId);
                }
            }
        }

        const reason = `Default: ${classification} → ${tier}`;
        return this._buildDecision(tier, routingConfig, classification, complexitySignals || null, reason, false, routingConfig.experimentId);
    },

    /**
     * Handle escalation after quality gate failure.
     * Returns a premium routing decision with the failure context.
     */
    escalate(
        originalDecision: RoutingDecision,
        failedOutput: string,
        failureMode: string,
        config?: OrgRoutingConfig
    ): RoutingDecision {
        const routingConfig = config || DEFAULT_ROUTING_CONFIG;

        logger.info(`[ModelRouting] Escalating from economy to premium: ${failureMode} (tool classification: ${originalDecision.toolTypeClassification})`);

        return {
            tier: "premium",
            model: routingConfig.premiumModel.model,
            provider: routingConfig.premiumModel.provider,
            toolTypeClassification: originalDecision.toolTypeClassification,
            complexitySignals: originalDecision.complexitySignals,
            reason: `Escalated: quality gate failure (${failureMode}). Previous economy output rejected.`,
            overrideApplied: false,
            experimentId: originalDecision.experimentId,
        };
    },

    /**
     * Build a routing decision object.
     */
    _buildDecision(
        tier: ModelTier,
        config: OrgRoutingConfig,
        classification: ToolTypeClassification,
        complexitySignals: ComplexitySignals | null,
        reason: string,
        overrideApplied: boolean,
        experimentId?: string
    ): RoutingDecision {
        const modelConfig = tier === "economy" ? config.economyModel : config.premiumModel;
        return {
            tier,
            model: modelConfig.model,
            provider: modelConfig.provider,
            toolTypeClassification: classification,
            complexitySignals,
            reason,
            overrideApplied,
            experimentId,
        };
    },

    /**
     * Compute estimated savings for a routing decision.
     * Returns the dollar amount saved by routing to economy vs premium.
     */
    computeSavings(
        tier: ModelTier,
        inputTokens: number,
        outputTokens: number,
        config?: OrgRoutingConfig
    ): number {
        if (tier !== "economy") return 0;

        // Use cost registry pricing
        try {
            const { MODEL_PRICING } = require("@server/domain/ai/core/cost-registry.js");
            const routingConfig = config || DEFAULT_ROUTING_CONFIG;
            
            const premiumPricing = MODEL_PRICING[routingConfig.premiumModel.model] || MODEL_PRICING["default"];
            const economyPricing = MODEL_PRICING[routingConfig.economyModel.model] || MODEL_PRICING["default"];

            const premiumCost = (inputTokens * premiumPricing.input1M / 1_000_000) + (outputTokens * premiumPricing.output1M / 1_000_000);
            const economyCost = (inputTokens * economyPricing.input1M / 1_000_000) + (outputTokens * economyPricing.output1M / 1_000_000);

            return Math.max(0, premiumCost - economyCost);
        } catch {
            // Fallback: estimate ~60% savings on economy
            const estimatedPremiumCost = (inputTokens + outputTokens) * 0.000015; // ~$15/1M tokens
            return estimatedPremiumCost * 0.6;
        }
    },
};
