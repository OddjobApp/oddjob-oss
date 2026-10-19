/**
 * Model Routing Intelligence — Core Types
 * 
 * Defines all interfaces for per-tool-invocation model routing,
 * complexity analysis, quality gating, and cost tracking.
 */

export type ModelTier = "economy" | "premium";

export type ToolTypeClassification =
    | "read_tools"
    | "write_tools"
    | "search_tools"
    | "analysis_tools";

export type StrictnessLevel = "strict" | "moderate" | "lenient";

export interface RoutingDecision {
    tier: ModelTier;
    model: string;
    provider: string;
    toolTypeClassification: ToolTypeClassification;
    complexitySignals: ComplexitySignals | null;
    reason: string;
    overrideApplied: boolean;
    experimentId?: string;
}

export interface ComplexitySignals {
    targetFileLines: number | null;
    dependencyCount: number;
    cyclomaticComplexity: number | null;
    historicalFailureRate: number; // 0.0 - 1.0
    isMultiFile: boolean;
    hasPatternMatch: boolean;
}

export interface RoutingContext {
    orgId: number;
    missionId?: number;
    agentId?: string;
    repoId?: string;
    toolParams?: Record<string, any>;
}

export interface OrgRoutingConfig {
    enabled: boolean;
    economyModel: { provider: string; model: string };
    premiumModel: { provider: string; model: string };
    toolOverrides: Record<string, ModelTier>;
    complexityEscalationThreshold: number; // default: 20
    writeDowngradeThreshold: number; // default: 5
    qualityGateStrictness: StrictnessLevel;
    qualityGateTimeoutMs: number; // default: 30000
    enableDynamicThresholds: boolean;
    experimentId?: string;
    negativeSavingsAlertEnabled: boolean;
}

export const DEFAULT_ROUTING_CONFIG: OrgRoutingConfig = {
    enabled: true,
    economyModel: { provider: "google", model: "gemini-2.0-flash" },
    premiumModel: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
    toolOverrides: {},
    complexityEscalationThreshold: 20,
    writeDowngradeThreshold: 5,
    qualityGateStrictness: "moderate",
    qualityGateTimeoutMs: 30000,
    enableDynamicThresholds: true,
    negativeSavingsAlertEnabled: true,
};

export interface ValidationResult {
    passed: boolean;
    failureMode?: "syntax" | "lint" | "type_check" | "test_failure";
    details?: string;
    durationMs: number;
    timedOut: boolean;
}

export interface RoutingCostEvent {
    requestId: string;
    orgId: number;
    missionId?: number;
    agentId?: string;
    toolName: string;
    toolTypeClassification: ToolTypeClassification;
    tier: ModelTier;
    model: string;
    inputTokens: number;
    outputTokens: number;
    escalated: boolean;
    escalationInputTokens?: number;
    escalationOutputTokens?: number;
    qualityGateResult?: "passed" | "failed" | "skipped" | "timed_out";
    timestamp: Date;
}

export interface SavingsSummary {
    totalSavingsUsd: number;
    savingsPercentage: number;
    netSavingsAfterEscalations: number;
    requestsRoutedEconomy: number;
    requestsRoutedPremium: number;
    escalations: number;
}
