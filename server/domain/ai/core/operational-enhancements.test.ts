import { describe, it, expect, beforeEach } from "vitest";
import { DynamicTuningService } from "./dynamic-tuning.service.js";
import { PredictionEngine, TrajectoryVector } from "./prediction-engine.service.js";
import { getPromptBusMetrics, onArchitectureReindexed, getCachedCompiledPrompt } from "./prompt-event-bus.js";
import { compilePhasePrompt } from "./phase-compiler.js";
import { H3HexagonalSpatialEngineService } from "./h3-hexagonal-spatial-engine.service.js";

describe("Operational Enhancements Suite", () => {
    describe("1. DynamicTuningService Adaptive Calibration", () => {
        it("escalates to frontier model, elevates threshold, and forces supervisor attestation on >=2 retries", () => {
            const result = DynamicTuningService.tuneRuntimeParameters({
                stage: "Improve",
                targetFileOrNode: "server/domain/ai/core/handler.ts",
                safeTransitionScore: 0.88,
                history: {
                    agentId: "agent-alpha",
                    consecutiveSuccesses: 0,
                    consecutiveRetries: 2,
                    averageLatencyMs: 1200,
                    lastSafeTransitionScore: 0.70,
                },
            });

            expect(result.recommendedModelTier).toBe("frontier_large");
            expect(result.requiredSafetyThreshold).toBeGreaterThanOrEqual(0.95);
            expect(result.forceSupervisorAttestation).toBe(true);
            expect(result.adjustedTokenBudget).toBe(450); // 300 * 1.5
        });

        it("applies latency throttle when agent response latency exceeds 5000ms", () => {
            const result = DynamicTuningService.tuneRuntimeParameters({
                stage: "Improve",
                targetFileOrNode: "client/src/components/Card.tsx",
                safeTransitionScore: 0.88,
                history: {
                    agentId: "agent-beta",
                    consecutiveSuccesses: 1,
                    consecutiveRetries: 0,
                    averageLatencyMs: 6500,
                    lastSafeTransitionScore: 0.85,
                },
            });

            expect(result.adjustedTokenBudget).toBeLessThan(300);
            expect(result.adaptiveReason).toContain("Latency throttle applied");
        });
    });

    describe("2. PredictionEngine Multi-Turn Cycle Detection", () => {
        it("detects repeating cycles across multi-turn step history and halts execution", () => {
            const trajectory: TrajectoryVector = {
                previousStep: { stage: "Validate", targetFileOrNode: "schema.ts" },
                currentState: { stage: "Diagnose", targetFileOrNode: "schema.ts" },
                candidateNextStep: { stage: "Improve", targetFileOrNode: "schema.ts" },
                stepHistory: [
                    { stage: "Improve", targetFileOrNode: "schema.ts" },
                    { stage: "Diagnose", targetFileOrNode: "schema.ts" },
                    { stage: "Improve", targetFileOrNode: "schema.ts" },
                    { stage: "Validate", targetFileOrNode: "schema.ts" },
                ],
            };

            const result = PredictionEngine.evaluateTrajectory(trajectory);

            expect(result.loopDetected).toBe(true);
            expect(result.recommendedAction).toBe("halt_loop");
            expect(result.selectedModelTier).toBe("frontier_large");
            expect(result.reason).toContain("Multi-turn cycle repetition detected");
        });
    });

    describe("3. PromptEventBus Telemetry & Cache Metrics", () => {
        it("tracks reindex compile duration and cache hit/miss statistics", async () => {
            const mockGraph: any = {
                scopeAppId: "test-app-observability",
                fingerprint: "fp-xyz-123",
                nodes: [{ id: 1, label: "RootNode", type: "service", filePath: "root.ts" }],
                edges: [],
            };
            const mockGuide: any = {
                readinessScore: 92,
                readinessGaps: [],
            };

            await onArchitectureReindexed(mockGraph, mockGuide);

            // Cache hit
            const cached = getCachedCompiledPrompt("test-app-observability");
            expect(cached).toBeDefined();

            // Cache miss
            const miss = getCachedCompiledPrompt("non-existent-app-id");
            expect(miss).toBeNull();

            const metrics = getPromptBusMetrics();
            expect(metrics.reindexCount).toBeGreaterThanOrEqual(1);
            expect(metrics.cacheHits).toBeGreaterThanOrEqual(1);
            expect(metrics.cacheMisses).toBeGreaterThanOrEqual(1);
            expect(metrics.cachedPromptCount).toBeGreaterThanOrEqual(1);
        });
    });

    describe("4. PhaseCompiler 150t-350t Budget Enforcement", () => {
        it("strictly bounds prompt token weight when graph scope contains many peripheral nodes", () => {
            const manyNodes = Array.from({ length: 30 }, (_, i) => ({
                id: i + 1,
                label: `ExtremelyLongDescriptiveServiceNodeNameNumber${i}`,
                type: "service",
                filePath: `path/to/service/module_${i}.ts`,
            }));

            const manyGaps = Array.from({ length: 10 }, (_, i) => ({
                severity: "critical",
                gap: `SecurityGapNumber${i}`,
                finding: `Detailed description of critical security vulnerability finding number ${i}`,
            }));

            const output = compilePhasePrompt(
                { scopeAppId: "app-large", fingerprint: "fp-large", nodes: manyNodes, edges: [] } as any,
                { readinessScore: 60, readinessGaps: manyGaps } as any,
                { phase: "diagnose", targetNodeId: "1" }
            );

            expect(output.tokenWeightEst).toBeLessThanOrEqual(350);
            expect(output.prompt).toContain("LOCAL GRAPH BOUNDARY");
        });
    });

    describe("5. H3HexagonalSpatialEngine Centroid Distance Memoization", () => {
        beforeEach(() => {
            H3HexagonalSpatialEngineService.clearDistanceCache();
        });

        it("memoizes distances and guarantees symmetric distance retrieval", () => {
            const cellA = "8828308281fffff";
            const cellB = "8828308287fffff";

            const d1 = H3HexagonalSpatialEngineService.centroidDistanceMeters(cellA, cellB);
            const d2 = H3HexagonalSpatialEngineService.centroidDistanceMeters(cellB, cellA);

            expect(d1).toBe(d2);
            expect(d1).toBeGreaterThan(0);

            // Distance from a cell to itself is 0
            expect(H3HexagonalSpatialEngineService.centroidDistanceMeters(cellA, cellA)).toBe(0);
        });
    });
});
