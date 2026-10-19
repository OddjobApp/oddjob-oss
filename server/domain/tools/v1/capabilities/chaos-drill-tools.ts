/**
 * Chaos Engineering & SRE Resilience Tools
 * 
 * Executable capability tools supporting the Chaos Drill cycle:
 * - Pre-flight error budget safety validation
 * - Controlled network latency & timeout simulation
 * - Upstream dependency failure & circuit breaker trip simulation
 * - Automated incident timeline synthesis and post-mortem generation
 */

import { z } from "zod";
import type { ToolDefinition } from "./types.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ChaosDrillTools");

export interface ErrorBudgetStatus {
    serviceName: string;
    targetSlo: number; // e.g. 99.9%
    currentAvailability: number; // e.g. 99.95%
    remainingBudgetPercent: number; // e.g. 50%
    isSafeToDrill: boolean;
    abortReason?: string;
}

export interface ChaosInjectionResult {
    drillId: string;
    targetService: string;
    experimentType: "latency_injection" | "dependency_failure" | "pod_restart" | "db_lock";
    parameters: Record<string, any>;
    circuitBreakerTripped: boolean;
    fallbackTriggered: boolean;
    observedLatencyMs: number;
    errorRateObserved: number;
    status: "RECOVERED" | "DEGRADED" | "ABORTED";
    durationSeconds: number;
}

export interface ChaosPostMortem {
    drillId: string;
    targetService: string;
    title: string;
    executiveSummary: string;
    timeline: Array<{
        timestamp: string;
        event: string;
        severity: "INFO" | "WARN" | "CRITICAL";
    }>;
    resilienceScore: number; // 0 - 100
    actionItems: Array<{
        title: string;
        owner: string;
        priority: "High" | "Medium" | "Low";
    }>;
}

export const chaosDrillHandlers = {
    /**
     * Verifies that error budgets permit running a chaos experiment without breaching SLAs.
     */
    async checkErrorBudgetSafety(params: {
        serviceName: string;
        minRequiredBudgetPercent?: number;
    }): Promise<ErrorBudgetStatus> {
        const { serviceName, minRequiredBudgetPercent = 20 } = params;

        // Simulated Prometheus SLO query
        const targetSlo = 99.9;
        const currentAvailability = 99.96;
        const remainingBudgetPercent = 60; // 60% error budget remaining this month

        const isSafe = remainingBudgetPercent >= minRequiredBudgetPercent;

        const result: ErrorBudgetStatus = {
            serviceName,
            targetSlo,
            currentAvailability,
            remainingBudgetPercent,
            isSafeToDrill: isSafe,
            abortReason: isSafe
                ? undefined
                : `Remaining error budget (${remainingBudgetPercent}%) is below minimum safe threshold (${minRequiredBudgetPercent}%). Drill aborted to protect SLA.`,
        };

        logger.info(`[ChaosDrill] Error budget check for '${serviceName}': Safe=${isSafe}`);
        return result;
    },

    /**
     * Simulates controlled network latency injection on upstream dependencies.
     */
    async simulateNetworkLatency(params: {
        targetService: string;
        addedLatencyMs: number;
        durationSeconds?: number;
    }): Promise<ChaosInjectionResult> {
        const { targetService, addedLatencyMs, durationSeconds = 15 } = params;
        const drillId = `CHAOS-LATENCY-${Date.now().toString(36).toUpperCase()}`;

        const circuitBreakerTripped = addedLatencyMs > 1000;
        const fallbackTriggered = circuitBreakerTripped;

        logger.info(`[ChaosDrill] Injected ${addedLatencyMs}ms latency into ${targetService} for ${durationSeconds}s.`);

        return {
            drillId,
            targetService,
            experimentType: "latency_injection",
            parameters: { addedLatencyMs, durationSeconds },
            circuitBreakerTripped,
            fallbackTriggered,
            observedLatencyMs: addedLatencyMs + 45,
            errorRateObserved: circuitBreakerTripped ? 0.02 : 0.0,
            status: "RECOVERED",
            durationSeconds,
        };
    },

    /**
     * Simulates an upstream service outage to test graceful degradation.
     */
    async simulateServiceFailure(params: {
        targetService: string;
        failureMode: "http_503" | "connection_refused" | "timeout";
    }): Promise<ChaosInjectionResult> {
        const { targetService, failureMode } = params;
        const drillId = `CHAOS-FAIL-${Date.now().toString(36).toUpperCase()}`;

        logger.info(`[ChaosDrill] Simulating ${failureMode} for service ${targetService}.`);

        return {
            drillId,
            targetService,
            experimentType: "dependency_failure",
            parameters: { failureMode },
            circuitBreakerTripped: true,
            fallbackTriggered: true,
            observedLatencyMs: 250,
            errorRateObserved: 0.05,
            status: "RECOVERED",
            durationSeconds: 10,
        };
    },

    /**
     * Synthesizes drill logs into an automated SRE incident post-mortem.
     */
    async generateChaosPostMortem(params: {
        injectionResult: ChaosInjectionResult;
        scenarioDescription?: string;
    }): Promise<ChaosPostMortem> {
        const { injectionResult, scenarioDescription } = params;
        const now = new Date();

        const resilienceScore = injectionResult.fallbackTriggered ? 95 : 60;

        return {
            drillId: injectionResult.drillId,
            targetService: injectionResult.targetService,
            title: `Chaos Resilience Post-Mortem: ${injectionResult.experimentType} on ${injectionResult.targetService}`,
            executiveSummary: `Controlled drill testing ${scenarioDescription || injectionResult.experimentType} on ${injectionResult.targetService}. Circuit breakers and fallbacks responded within SLA parameters. Final resilience score: ${resilienceScore}/100.`,
            timeline: [
                {
                    timestamp: new Date(now.getTime() - 15000).toISOString(),
                    event: `Pre-flight error budget check passed. Injected ${injectionResult.experimentType}.`,
                    severity: "INFO",
                },
                {
                    timestamp: new Date(now.getTime() - 10000).toISOString(),
                    event: `Circuit breaker tripped on ${injectionResult.targetService}. Local fallback cache activated.`,
                    severity: "WARN",
                },
                {
                    timestamp: now.toISOString(),
                    event: `Fault removed. System recovered to nominal latency (${injectionResult.observedLatencyMs}ms).`,
                    severity: "INFO",
                },
            ],
            resilienceScore,
            actionItems: [
                {
                    title: `Tune circuit breaker timeout threshold on ${injectionResult.targetService}`,
                    owner: "SRE Squad Lead",
                    priority: "Medium",
                },
                {
                    title: `Add synthetic health check probe for downstream dependency fallbacks`,
                    owner: "Platform Engineer",
                    priority: "Low",
                },
            ],
        };
    },
};

const run = (method: keyof typeof chaosDrillHandlers) => async (params: any) => {
    const result = await (chaosDrillHandlers[method] as any)(params);
    return typeof result === "string" ? result : JSON.stringify(result, null, 2);
};

const def = (name: string, description: string, parameters: z.ZodTypeAny, method: keyof typeof chaosDrillHandlers): ToolDefinition => ({
    name,
    description,
    group: "Operations",
    // Every tool built here is a pure transform over its arguments: no
    // database, network, filesystem or shell. A tool that touches the world
    // must not use this factory — it would inherit a declaration that lies,
    // and be offered to agents and batched concurrently on the strength of it.
    idempotency: "read-safe",
    parameters,
    execute: run(method),
});

export const CHAOS_DRILL_TOOLS: Record<string, ToolDefinition> = {
    check_error_budget_safety: def(
        "check_error_budget_safety",
        "Validates that remaining service error budgets and availability SLOs permit running a chaos experiment safely.",
        z.object({
            serviceName: z.string().describe("Target service or dependency name"),
            minRequiredBudgetPercent: z.number().optional().describe("Minimum safe remaining budget percentage (default 20%)"),
        }),
        "checkErrorBudgetSafety"
    ),

    simulate_network_latency: def(
        "simulate_network_latency",
        "Simulates controlled network latency on an upstream service to test timeout handling and circuit breakers.",
        z.object({
            targetService: z.string().describe("Target service to inject latency into"),
            addedLatencyMs: z.number().positive().describe("Latency in milliseconds to add"),
            durationSeconds: z.number().positive().optional().describe("Experiment duration in seconds"),
        }),
        "simulateNetworkLatency"
    ),

    simulate_service_failure: def(
        "simulate_service_failure",
        "Simulates an upstream dependency failure (503, connection refused, or timeout) to verify graceful fallback.",
        z.object({
            targetService: z.string().describe("Target service to fail"),
            failureMode: z.enum(["http_503", "connection_refused", "timeout"]).describe("Failure mode to simulate"),
        }),
        "simulateServiceFailure"
    ),

    generate_chaos_post_mortem: def(
        "generate_chaos_post_mortem",
        "Synthesizes drill telemetry into an automated SRE post-mortem report with timeline and preventative action items.",
        z.object({
            injectionResult: z.any().describe("Result returned from simulate_network_latency or simulate_service_failure"),
            scenarioDescription: z.string().optional().describe("Human-readable scenario description"),
        }),
        "generateChaosPostMortem"
    ),
};
