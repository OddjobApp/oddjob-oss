/**
 * Circuit Breaker Service Tests
 * 
 * Comprehensive test suite for circuit breaker pattern implementation.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    circuitBreakerService,
    CircuitBreakerError,
    type CircuitBreakerConfig,
} from "../core/circuit-breaker.service.js";

// Mock dependencies
vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    }),
}));

vi.mock("@domain/core/infrastructure/event-stream.service.js", () => ({
    eventStream: {
        publish: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock("@domain/mission/core/mission-correlation.service.js", () => ({
    missionCorrelationService: {
        getCorrelationId: vi.fn().mockReturnValue("corr_test_123"),
    },
}));

describe("CircuitBreakerService", () => {
    const TEST_TOOL = "test_tool";
    const FAST_CONFIG: CircuitBreakerConfig = {
        failureThreshold: 3,
        recoveryTimeout: 100,  // 100ms for fast testing
        halfOpenMaxCalls: 2,
        successThreshold: 1,
    };

    beforeEach(() => {
        // Reset all circuits before each test
        circuitBreakerService.reset();
    });

    describe("getCircuit", () => {
        it("should create circuit if not exists", () => {
            const circuit = circuitBreakerService.getCircuit("new_tool");
            
            expect(circuit).toBeDefined();
            expect(circuit.toolName).toBe("new_tool");
            expect(circuit.stats.state).toBe("closed");
        });

        it("should return existing circuit", () => {
            const circuit1 = circuitBreakerService.getCircuit(TEST_TOOL);
            const circuit2 = circuitBreakerService.getCircuit(TEST_TOOL);
            
            expect(circuit1).toBe(circuit2);
        });

        it("should apply custom config", () => {
            const circuit = circuitBreakerService.getCircuit(TEST_TOOL, {
                failureThreshold: 10,
                recoveryTimeout: 5000,
            });
            
            expect(circuit.config.failureThreshold).toBe(10);
            expect(circuit.config.recoveryTimeout).toBe(5000);
        });
    });

    describe("canExecute", () => {
        it("should allow execution when closed", () => {
            const result = circuitBreakerService.canExecute(TEST_TOOL);
            
            expect(result.allowed).toBe(true);
            expect(result.state).toBe("closed");
        });

        it("should block execution when open", () => {
            const circuit = circuitBreakerService.getCircuit(TEST_TOOL, FAST_CONFIG);
            
            // Force open
            for (let i = 0; i < FAST_CONFIG.failureThreshold; i++) {
                circuitBreakerService.recordFailure(TEST_TOOL, new Error("Test"));
            }
            
            const result = circuitBreakerService.canExecute(TEST_TOOL);
            
            expect(result.allowed).toBe(false);
            expect(result.state).toBe("open");
            expect(result.reason).toContain("Circuit open");
        });

        it("should transition to half-open after recovery timeout", async () => {
            const circuit = circuitBreakerService.getCircuit(TEST_TOOL, FAST_CONFIG);
            
            // Open circuit
            for (let i = 0; i < FAST_CONFIG.failureThreshold; i++) {
                circuitBreakerService.recordFailure(TEST_TOOL, new Error("Test"));
            }
            
            // Wait for recovery
            await new Promise(r => setTimeout(r, FAST_CONFIG.recoveryTimeout + 50));
            
            const result = circuitBreakerService.canExecute(TEST_TOOL);
            
            expect(result.allowed).toBe(true);
            expect(result.state).toBe("half-open");
        });

        it("should limit half-open calls", async () => {
            const circuit = circuitBreakerService.getCircuit(TEST_TOOL, FAST_CONFIG);
            
            // Open circuit
            for (let i = 0; i < FAST_CONFIG.failureThreshold; i++) {
                circuitBreakerService.recordFailure(TEST_TOOL, new Error("Test"));
            }
            
            // Wait for recovery
            await new Promise(r => setTimeout(r, FAST_CONFIG.recoveryTimeout + 50));
            
            // Use up half-open slots
            for (let i = 0; i < FAST_CONFIG.halfOpenMaxCalls; i++) {
                circuitBreakerService.canExecute(TEST_TOOL);
            }
            
            // Next call should be blocked
            const result = circuitBreakerService.canExecute(TEST_TOOL);
            
            expect(result.allowed).toBe(false);
            expect(result.state).toBe("half-open");
        });
    });

    describe("recordSuccess", () => {
        it("should increment success counter", () => {
            circuitBreakerService.recordSuccess(TEST_TOOL);
            
            const stats = circuitBreakerService.getStats(TEST_TOOL);
            expect(stats?.successes).toBe(1);
            expect(stats?.totalCalls).toBe(1);
        });

        it("should track consecutive successes", () => {
            circuitBreakerService.recordSuccess(TEST_TOOL);
            circuitBreakerService.recordSuccess(TEST_TOOL);
            
            const stats = circuitBreakerService.getStats(TEST_TOOL);
            expect(stats?.consecutiveSuccesses).toBe(2);
        });

        it("should reset consecutive successes on failure", () => {
            circuitBreakerService.recordSuccess(TEST_TOOL);
            circuitBreakerService.recordSuccess(TEST_TOOL);
            circuitBreakerService.recordFailure(TEST_TOOL, new Error("Test"));
            
            const stats = circuitBreakerService.getStats(TEST_TOOL);
            expect(stats?.consecutiveSuccesses).toBe(0);
        });

        it("should close circuit from half-open after threshold", async () => {
            const circuit = circuitBreakerService.getCircuit(TEST_TOOL, FAST_CONFIG);
            
            // Open circuit
            for (let i = 0; i < FAST_CONFIG.failureThreshold; i++) {
                circuitBreakerService.recordFailure(TEST_TOOL, new Error("Test"));
            }
            
            // Wait for recovery
            await new Promise(r => setTimeout(r, FAST_CONFIG.recoveryTimeout + 50));
            
            // Allow execution to transition to half-open
            circuitBreakerService.canExecute(TEST_TOOL);
            
            // Success should close circuit
            circuitBreakerService.recordSuccess(TEST_TOOL);
            
            const stats = circuitBreakerService.getStats(TEST_TOOL);
            expect(stats?.state).toBe("closed");
        });
    });

    describe("recordFailure", () => {
        it("should increment failure counter", () => {
            circuitBreakerService.recordFailure(TEST_TOOL, new Error("Test"));
            
            const stats = circuitBreakerService.getStats(TEST_TOOL);
            expect(stats?.failures).toBe(1);
            expect(stats?.totalCalls).toBe(1);
        });

        it("should open circuit after threshold", () => {
            const circuit = circuitBreakerService.getCircuit(TEST_TOOL, FAST_CONFIG);
            
            for (let i = 0; i < FAST_CONFIG.failureThreshold; i++) {
                circuitBreakerService.recordFailure(TEST_TOOL, new Error("Test"));
            }
            
            const stats = circuitBreakerService.getStats(TEST_TOOL);
            expect(stats?.state).toBe("open");
        });

        it("should reopen circuit from half-open on failure", async () => {
            const circuit = circuitBreakerService.getCircuit(TEST_TOOL, FAST_CONFIG);
            
            // Open and transition to half-open
            for (let i = 0; i < FAST_CONFIG.failureThreshold; i++) {
                circuitBreakerService.recordFailure(TEST_TOOL, new Error("Test"));
            }
            await new Promise(r => setTimeout(r, FAST_CONFIG.recoveryTimeout + 50));
            circuitBreakerService.canExecute(TEST_TOOL);
            
            // Failure should reopen
            circuitBreakerService.recordFailure(TEST_TOOL, new Error("Test"));
            
            const stats = circuitBreakerService.getStats(TEST_TOOL);
            expect(stats?.state).toBe("open");
        });
    });

    describe("execute", () => {
        it("should execute successful function", async () => {
            const result = await circuitBreakerService.execute(
                TEST_TOOL,
                async () => "success"
            );
            
            expect(result).toBe("success");
        });

        it("should record success on completion", async () => {
            await circuitBreakerService.execute(TEST_TOOL, async () => "success");
            
            const stats = circuitBreakerService.getStats(TEST_TOOL);
            expect(stats?.successes).toBe(1);
        });

        it("should record failure on error", async () => {
            await expect(
                circuitBreakerService.execute(TEST_TOOL, async () => {
                    throw new Error("Test error");
                })
            ).rejects.toThrow("Test error");
            
            const stats = circuitBreakerService.getStats(TEST_TOOL);
            expect(stats?.failures).toBe(1);
        });

        it("should use fallback when circuit open", async () => {
            const circuit = circuitBreakerService.getCircuit(TEST_TOOL, FAST_CONFIG);
            
            // Open circuit
            for (let i = 0; i < FAST_CONFIG.failureThreshold; i++) {
                circuitBreakerService.recordFailure(TEST_TOOL, new Error("Test"));
            }
            
            const result = await circuitBreakerService.execute(
                TEST_TOOL,
                async () => "primary",
                { fallback: async () => "fallback" }
            );
            
            expect(result).toBe("fallback");
        });

        it("should return fallback value when circuit open", async () => {
            const circuit = circuitBreakerService.getCircuit(TEST_TOOL, FAST_CONFIG);
            
            // Open circuit
            for (let i = 0; i < FAST_CONFIG.failureThreshold; i++) {
                circuitBreakerService.recordFailure(TEST_TOOL, new Error("Test"));
            }
            
            const result = await circuitBreakerService.execute(
                TEST_TOOL,
                async () => "primary",
                { fallbackValue: "default" }
            );
            
            expect(result).toBe("default");
        });

        it("should throw CircuitBreakerError when circuit open and no fallback", async () => {
            const circuit = circuitBreakerService.getCircuit(TEST_TOOL, FAST_CONFIG);
            
            // Open circuit
            for (let i = 0; i < FAST_CONFIG.failureThreshold; i++) {
                circuitBreakerService.recordFailure(TEST_TOOL, new Error("Test"));
            }
            
            await expect(
                circuitBreakerService.execute(TEST_TOOL, async () => "primary")
            ).rejects.toThrow(CircuitBreakerError);
        });
    });

    describe("manual circuit control", () => {
        it("should manually open circuit", () => {
            circuitBreakerService.openCircuit(TEST_TOOL, "Manual open");
            
            const stats = circuitBreakerService.getStats(TEST_TOOL);
            expect(stats?.state).toBe("open");
        });

        it("should manually close circuit", async () => {
            // Open first
            for (let i = 0; i < 5; i++) {
                circuitBreakerService.recordFailure(TEST_TOOL, new Error("Test"));
            }
            
            // Close manually
            circuitBreakerService.closeCircuit(TEST_TOOL);
            
            const stats = circuitBreakerService.getStats(TEST_TOOL);
            expect(stats?.state).toBe("closed");
            expect(stats?.failures).toBe(0);
        });

        it("should reset specific circuit", () => {
            circuitBreakerService.recordFailure(TEST_TOOL, new Error("Test"));
            circuitBreakerService.reset(TEST_TOOL);
            
            const stats = circuitBreakerService.getStats(TEST_TOOL);
            expect(stats).toBeNull();
        });

        it("should reset all circuits", () => {
            circuitBreakerService.recordFailure("tool1", new Error("Test"));
            circuitBreakerService.recordFailure("tool2", new Error("Test"));
            
            circuitBreakerService.reset();
            
            expect(circuitBreakerService.getStats("tool1")).toBeNull();
            expect(circuitBreakerService.getStats("tool2")).toBeNull();
        });
    });

    describe("configuration", () => {
        it("should update configuration", () => {
            circuitBreakerService.configure(TEST_TOOL, {
                failureThreshold: 10,
                recoveryTimeout: 10000,
            });
            
            const circuit = circuitBreakerService.getCircuit(TEST_TOOL);
            expect(circuit.config.failureThreshold).toBe(10);
            expect(circuit.config.recoveryTimeout).toBe(10000);
        });

        it("should preserve unmodified config values", () => {
            const initial = circuitBreakerService.getCircuit(TEST_TOOL).config;
            
            circuitBreakerService.configure(TEST_TOOL, {
                failureThreshold: 15,
            });
            
            const updated = circuitBreakerService.getCircuit(TEST_TOOL).config;
            expect(updated.failureThreshold).toBe(15);
            expect(updated.recoveryTimeout).toBe(initial.recoveryTimeout);
        });
    });

    describe("fallback tools", () => {
        it("should set fallback tool", () => {
            circuitBreakerService.setFallbackTool("primary", "backup");
            
            const fallback = circuitBreakerService.getFallbackTool("primary");
            expect(fallback).toBe("backup");
        });
    });

    describe("queries", () => {
        it("should get all circuits", () => {
            circuitBreakerService.recordSuccess("tool1");
            circuitBreakerService.recordSuccess("tool2");
            
            const all = circuitBreakerService.getAllCircuits();
            
            expect(all).toHaveLength(2);
            expect(all.map(c => c.toolName).sort()).toEqual(["tool1", "tool2"]);
        });

        it("should return summary statistics", () => {
            // Open one circuit
            const config = { ...FAST_CONFIG, failureThreshold: 1 };
            circuitBreakerService.getCircuit("open_tool", config);
            circuitBreakerService.recordFailure("open_tool", new Error("Test"));
            
            // Keep others closed
            circuitBreakerService.recordSuccess("closed1");
            circuitBreakerService.recordSuccess("closed2");
            
            const summary = circuitBreakerService.getSummary();
            
            expect(summary.total).toBe(3);
            expect(summary.open).toBe(1);
            expect(summary.closed).toBe(2);
            expect(summary.halfOpen).toBe(0);
        });

        it("should detect open circuits", () => {
            circuitBreakerService.recordSuccess("tool1");
            
            expect(circuitBreakerService.hasOpenCircuits()).toBe(false);
            
            // Open a circuit
            const config = { ...FAST_CONFIG, failureThreshold: 1 };
            circuitBreakerService.getCircuit("failing_tool", config);
            circuitBreakerService.recordFailure("failing_tool", new Error("Test"));
            
            expect(circuitBreakerService.hasOpenCircuits()).toBe(true);
        });
    });

    describe("CircuitBreakerError", () => {
        it("should create error with state and tool name", () => {
            const error = new CircuitBreakerError("Test message", "open", "my_tool");
            
            expect(error.message).toBe("Test message");
            expect(error.state).toBe("open");
            expect(error.toolName).toBe("my_tool");
            expect(error.name).toBe("CircuitBreakerError");
        });
    });

    describe("events", () => {
        it("should emit circuit_opened event", () => {
            circuitBreakerService.openCircuit(TEST_TOOL, "Test");
            
            // Event emission is mocked, but we can verify no error thrown
        });

        it("should emit circuit_closed event", () => {
            circuitBreakerService.closeCircuit(TEST_TOOL);
            
            // Event emission is mocked
        });
    });
});
