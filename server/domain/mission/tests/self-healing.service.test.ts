/**
 * Self-Healing Missions Service Tests
 * 
 * Comprehensive test suite for automatic failure recovery.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    selfHealingService,
    type FailurePattern,
    type Remedy,
    type HealingAttempt,
    type EscalationRequest,
} from "../core/self-healing.service.js";

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

vi.mock("./mission-correlation.service.js", () => ({
    missionCorrelationService: {
        getCorrelationId: vi.fn().mockReturnValue("corr_test_123"),
    },
}));

vi.mock("./retry.service.js", () => ({
    missionRetryService: {
        execute: vi.fn(),
    },
}));

vi.mock("./circuit-breaker.service.js", () => ({
    circuitBreakerService: {
        reset: vi.fn(),
    },
}));

describe("SelfHealingService", () => {
    const TEST_MISSION_ID = 123;
    const TEST_TOOL = "api_call";

    beforeEach(() => {
        selfHealingService.clearHealingAttempts();
        selfHealingService.clearEscalations();
    });

    describe("attemptHealing", () => {
        it("should attempt healing for timeout errors", async () => {
            const error = new Error("Request timeout");
            
            const attempt = await selfHealingService.attemptHealing(
                TEST_MISSION_ID,
                TEST_TOOL,
                error
            );

            expect(attempt).toBeDefined();
            expect(attempt.missionRunId).toBe(TEST_MISSION_ID);
            expect(attempt.toolName).toBe(TEST_TOOL);
            expect(attempt.error.message).toBe("Request timeout");
        });

        it("should match known patterns", async () => {
            const error = new Error("ETIMEDOUT");
            
            const attempt = await selfHealingService.attemptHealing(
                TEST_MISSION_ID,
                TEST_TOOL,
                error
            );

            expect(attempt.failurePatternId).toBeDefined();
        });

        it("should escalate unknown patterns", async () => {
            const error = new Error("Completely unknown XYZ error");
            
            const attempt = await selfHealingService.attemptHealing(
                TEST_MISSION_ID,
                TEST_TOOL,
                error
            );

            expect(attempt.finalStatus).toBe("escalated");
            expect(attempt.escalationId).toBeDefined();
        });

        it("should track remedies attempted", async () => {
            const error = new Error("timeout");
            
            const attempt = await selfHealingService.attemptHealing(
                TEST_MISSION_ID,
                TEST_TOOL,
                error
            );

            expect(attempt.remediesAttempted).toBeDefined();
            expect(Array.isArray(attempt.remediesAttempted)).toBe(true);
        });

        it("should generate unique attempt IDs", async () => {
            const attempt1 = await selfHealingService.attemptHealing(
                TEST_MISSION_ID,
                TEST_TOOL,
                new Error("error1")
            );
            
            const attempt2 = await selfHealingService.attemptHealing(
                TEST_MISSION_ID,
                TEST_TOOL,
                new Error("error2")
            );

            expect(attempt1.id).not.toBe(attempt2.id);
        });

        it("should include correlation ID", async () => {
            const attempt = await selfHealingService.attemptHealing(
                TEST_MISSION_ID,
                TEST_TOOL,
                new Error("test")
            );

            expect(attempt.correlationId).toBeDefined();
        });
    });

    describe("matchFailurePattern", () => {
        it("should match timeout patterns", () => {
            const pattern = selfHealingService.matchFailurePattern(
                new Error("Request timed out")
            );

            expect(pattern).toBeDefined();
            expect(pattern?.name).toContain("Timeout");
        });

        it("should match rate limit patterns", () => {
            const pattern = selfHealingService.matchFailurePattern(
                new Error("Rate limit exceeded 429")
            );

            expect(pattern).toBeDefined();
            expect(pattern?.name).toContain("Rate Limit");
        });

        it("should match auth failure patterns", () => {
            const pattern = selfHealingService.matchFailurePattern(
                new Error("Authentication failed 401")
            );

            expect(pattern).toBeDefined();
            expect(pattern?.name).toContain("Authentication");
        });

        it("should match connection refused patterns", () => {
            const pattern = selfHealingService.matchFailurePattern(
                new Error("ECONNREFUSED")
            );

            expect(pattern).toBeDefined();
            expect(pattern?.name).toContain("Connection");
        });

        it("should return undefined for unknown errors", () => {
            const pattern = selfHealingService.matchFailurePattern(
                new Error("XYZ_UNKNOWN_ERROR")
            );

            expect(pattern).toBeUndefined();
        });

        it("should match case insensitively", () => {
            const pattern1 = selfHealingService.matchFailurePattern(
                new Error("TIMEOUT")
            );
            const pattern2 = selfHealingService.matchFailurePattern(
                new Error("timeout")
            );

            expect(pattern1?.id).toBe(pattern2?.id);
        });

        it("should check error codes", () => {
            const error = new Error("Some error") as any;
            error.code = "ECONNREFUSED";
            
            const pattern = selfHealingService.matchFailurePattern(error);

            expect(pattern).toBeDefined();
            expect(pattern?.name).toContain("Connection");
        });
    });

    describe("applyRemedy", () => {
        it("should apply retry remedy", async () => {
            const remedy: Remedy = {
                id: "test_retry",
                name: "Test Retry",
                description: "Test",
                action: { type: "retry", config: { delay: 100, maxAttempts: 3 } },
                successRate: 0.8,
                maxAttempts: 3,
                estimatedTime: 1,
            };

            const attempt = await selfHealingService.attemptHealing(
                TEST_MISSION_ID,
                TEST_TOOL,
                new Error("test")
            );

            const result = await selfHealingService.applyRemedy(remedy, attempt);

            expect(result.success).toBe(true);
        });

        it("should apply circuit breaker reset", async () => {
            const remedy: Remedy = {
                id: "test_reset",
                name: "Reset CB",
                description: "Test",
                action: { type: "reset_circuit_breaker", toolName: TEST_TOOL },
                successRate: 0.5,
                maxAttempts: 1,
                estimatedTime: 1,
            };

            const attempt = await selfHealingService.attemptHealing(
                TEST_MISSION_ID,
                TEST_TOOL,
                new Error("test")
            );

            const result = await selfHealingService.applyRemedy(remedy, attempt);

            expect(result.success).toBe(true);
        });

        it("should handle unknown remedy types", async () => {
            const remedy: Remedy = {
                id: "test_unknown",
                name: "Unknown",
                description: "Test",
                action: { type: "unknown_type" as any },
                successRate: 0,
                maxAttempts: 1,
                estimatedTime: 1,
            };

            const attempt = await selfHealingService.attemptHealing(
                TEST_MISSION_ID,
                TEST_TOOL,
                new Error("test")
            );

            const result = await selfHealingService.applyRemedy(remedy, attempt);

            expect(result.success).toBe(false);
        });

        it("should handle remedy errors gracefully", async () => {
            const remedy: Remedy = {
                id: "test_error",
                name: "Error Test",
                description: "Test",
                action: { type: "retry", config: { delay: -1, maxAttempts: 3 } },
                successRate: 0.8,
                maxAttempts: 3,
                estimatedTime: 1,
            };

            const attempt = await selfHealingService.attemptHealing(
                TEST_MISSION_ID,
                TEST_TOOL,
                new Error("test")
            );

            // Should not throw
            const result = await selfHealingService.applyRemedy(remedy, attempt);
            expect(result).toBeDefined();
        });
    });

    describe("escalation workflow", () => {
        it("should escalate to human", async () => {
            const attempt = await selfHealingService.attemptHealing(
                TEST_MISSION_ID,
                TEST_TOOL,
                new Error("Unknown error")
            );

            expect(attempt.escalationId).toBeDefined();
            
            const escalation = selfHealingService.getEscalations()
                .find(e => e.id === attempt.escalationId);
            
            expect(escalation).toBeDefined();
            expect(escalation?.status).toBe("pending");
        });

        it("should acknowledge escalation", async () => {
            const attempt = await selfHealingService.attemptHealing(
                TEST_MISSION_ID,
                TEST_TOOL,
                new Error("Unknown error")
            );

            const acknowledged = selfHealingService.acknowledgeEscalation(
                attempt.escalationId!,
                "Working on it"
            );

            expect(acknowledged).toBeDefined();
            expect(acknowledged?.status).toBe("acknowledged");
            expect(acknowledged?.acknowledgedAt).toBeDefined();
        });

        it("should resolve escalation", async () => {
            const attempt = await selfHealingService.attemptHealing(
                TEST_MISSION_ID,
                TEST_TOOL,
                new Error("Unknown error")
            );

            const resolved = selfHealingService.resolveEscalation(
                attempt.escalationId!,
                "Fixed by restarting",
                false
            );

            expect(resolved).toBeDefined();
            expect(resolved?.status).toBe("resolved");
            expect(resolved?.resolvedAt).toBeDefined();
        });

        it("should update healing attempt on resolution", async () => {
            const attempt = await selfHealingService.attemptHealing(
                TEST_MISSION_ID,
                TEST_TOOL,
                new Error("Unknown error")
            );

            selfHealingService.resolveEscalation(
                attempt.escalationId!,
                "Fixed"
            );

            const updatedAttempt = selfHealingService.getHealingAttempt(attempt.id);
            expect(updatedAttempt?.finalStatus).toBe("resolved");
        });

        it("should return undefined for non-existent escalation", () => {
            const result = selfHealingService.acknowledgeEscalation("non-existent");
            expect(result).toBeUndefined();

            const resolved = selfHealingService.resolveEscalation("non-existent", "fix");
            expect(resolved).toBeUndefined();
        });
    });

    describe("getStats", () => {
        it("should return healing statistics", async () => {
            // Create some healing attempts
            await selfHealingService.attemptHealing(1, "tool1", new Error("timeout"));
            await selfHealingService.attemptHealing(2, "tool2", new Error("Unknown"));
            
            const stats = selfHealingService.getStats();

            expect(stats.totalAttempts).toBeGreaterThan(0);
            expect(stats.byPattern).toBeDefined();
            expect(stats.pendingEscalations).toBeDefined();
        });

        it("should track resolved vs escalated", async () => {
            // Clear first
            selfHealingService.clearHealingAttempts();

            const attempt1 = await selfHealingService.attemptHealing(
                1, "tool1", new Error("timeout")
            );
            
            const attempt2 = await selfHealingService.attemptHealing(
                2, "tool2", new Error("Unknown error")
            );

            // Resolve one escalation
            if (attempt2.escalationId) {
                selfHealingService.resolveEscalation(attempt2.escalationId, "Fixed");
            }

            const stats = selfHealingService.getStats();
            
            expect(stats.resolved).toBeGreaterThan(0);
        });

        it("should track by pattern", async () => {
            await selfHealingService.attemptHealing(
                1, "tool1", new Error("timeout")
            );

            const stats = selfHealingService.getStats();
            
            // Should have pattern_timeout stats
            const patternStats = Object.values(stats.byPattern)
                .find((p: any) => p.detected > 0);
            expect(patternStats).toBeDefined();
        });
    });

    describe("getEscalations", () => {
        it("should return all escalations", async () => {
            await selfHealingService.attemptHealing(
                1, "tool1", new Error("Unknown error 1")
            );
            await selfHealingService.attemptHealing(
                2, "tool2", new Error("Unknown error 2")
            );

            const escalations = selfHealingService.getEscalations();

            expect(escalations.length).toBe(2);
        });

        it("should filter by status", async () => {
            const attempt = await selfHealingService.attemptHealing(
                1, "tool1", new Error("Unknown")
            );

            // Acknowledge the escalation
            selfHealingService.acknowledgeEscalation(attempt.escalationId!);

            const pending = selfHealingService.getEscalations("pending");
            const acknowledged = selfHealingService.getEscalations("acknowledged");

            expect(pending.length).toBe(0);
            expect(acknowledged.length).toBe(1);
        });

        it("should sort by creation time descending", async () => {
            await selfHealingService.attemptHealing(1, "tool1", new Error("Unknown 1"));
            await new Promise(r => setTimeout(r, 10));
            await selfHealingService.attemptHealing(2, "tool2", new Error("Unknown 2"));

            const escalations = selfHealingService.getEscalations();

            expect(escalations[0].createdAt.getTime())
                .toBeGreaterThanOrEqual(escalations[1].createdAt.getTime());
        });
    });

    describe("getPatterns", () => {
        it("should return all patterns", () => {
            const patterns = selfHealingService.getPatterns();

            expect(patterns.length).toBeGreaterThan(0);
            expect(patterns[0].id).toBeDefined();
            expect(patterns[0].name).toBeDefined();
            expect(patterns[0].signature).toBeDefined();
        });

        it("should include built-in patterns", () => {
            const patterns = selfHealingService.getPatterns();

            const patternIds = patterns.map(p => p.id);
            expect(patternIds).toContain("pattern_timeout");
            expect(patternIds).toContain("pattern_rate_limit");
            expect(patternIds).toContain("pattern_auth_failure");
        });
    });

    describe("addPattern", () => {
        it("should add new pattern", () => {
            const newPattern = selfHealingService.addPattern({
                name: "Test Pattern",
                description: "Test",
                signature: {
                    errorMessagePatterns: ["test_error"],
                },
                severity: "medium",
                autoRemediate: false,
                remedies: [],
            });

            expect(newPattern.id).toMatch(/^pattern_\d+_/);
            expect(newPattern.metadata.detectedCount).toBe(0);

            // Should be in list
            const patterns = selfHealingService.getPatterns();
            expect(patterns.some(p => p.id === newPattern.id)).toBe(true);
        });
    });

    describe("clearHealingAttempts", () => {
        it("should clear all attempts", async () => {
            await selfHealingService.attemptHealing(1, "tool", new Error("test"));
            
            expect(selfHealingService.getStats().totalAttempts).toBeGreaterThan(0);

            selfHealingService.clearHealingAttempts();

            expect(selfHealingService.getStats().totalAttempts).toBe(0);
        });
    });

    describe("clearEscalations", () => {
        it("should clear all escalations", async () => {
            await selfHealingService.attemptHealing(1, "tool", new Error("Unknown"));

            expect(selfHealingService.getEscalations().length).toBeGreaterThan(0);

            selfHealingService.clearEscalations();

            expect(selfHealingService.getEscalations().length).toBe(0);
        });
    });

    describe("learnFromResolution", () => {
        it("should log learning opportunity", () => {
            const attempt: HealingAttempt = {
                id: "test_attempt",
                missionRunId: 1,
                toolName: "test",
                error: { message: "Test error" },
                timestamp: new Date(),
                correlationId: "corr_test",
                remediesAttempted: [],
                finalStatus: "escalated",
            };

            // Should not throw
            selfHealingService.learnFromResolution(attempt, "Fixed by X");
        });
    });

    describe("pattern metadata updates", () => {
        it("should increment detected count", async () => {
            const patterns = selfHealingService.getPatterns();
            const initialCount = patterns.find(p => p.id === "pattern_timeout")
                ?.metadata.detectedCount || 0;

            await selfHealingService.attemptHealing(
                1, "tool", new Error("timeout")
            );

            const updatedPatterns = selfHealingService.getPatterns();
            const newCount = updatedPatterns.find(p => p.id === "pattern_timeout")
                ?.metadata.detectedCount || 0;

            expect(newCount).toBe(initialCount + 1);
        });

        it("should update lastDetected timestamp", async () => {
            const before = new Date();

            await selfHealingService.attemptHealing(
                1, "tool", new Error("timeout")
            );

            const patterns = selfHealingService.getPatterns();
            const timeoutPattern = patterns.find(p => p.id === "pattern_timeout");

            expect(timeoutPattern?.metadata.lastDetected.getTime())
                .toBeGreaterThanOrEqual(before.getTime());
        });
    });
});
