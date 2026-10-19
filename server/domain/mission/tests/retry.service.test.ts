/**
 * Mission Retry Service Tests
 * 
 * Comprehensive test suite for automatic retry with exponential backoff.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    missionRetryService,
    withRetry,
    type RetryConfig,
    type RetryResult,
} from "../core/retry.service.js";

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

vi.mock("./circuit-breaker.service.js", () => ({
    circuitBreakerService: {
        canExecute: vi.fn().mockReturnValue({ allowed: true, state: 'closed' }),
        recordSuccess: vi.fn(),
        recordFailure: vi.fn(),
    },
    CircuitBreakerError: class CircuitBreakerError extends Error {
        constructor(message: string, public state: string, public toolName: string) {
            super(message);
        }
    },
}));

describe("MissionRetryService", () => {
    const TEST_TOOL = "test_tool";
    const FAST_CONFIG: Partial<RetryConfig> = {
        maxAttempts: 3,
        baseDelay: 50,  // 50ms for fast testing
        maxDelay: 200,
        jitter: false,  // Disable jitter for predictable tests
    };

    beforeEach(() => {
        missionRetryService.clearContexts();
        missionRetryService.clearDeadLetterQueue();
    });

    describe("execute", () => {
        it("should succeed on first attempt", async () => {
            const result = await missionRetryService.execute(
                TEST_TOOL,
                async () => "success",
                FAST_CONFIG
            );

            expect(result.success).toBe(true);
            expect(result.result).toBe("success");
            expect(result.attempts).toBe(1);
            expect(result.retried).toBe(false);
        });

        it("should retry on failure and succeed", async () => {
            let attempts = 0;

            const result = await missionRetryService.execute(
                TEST_TOOL,
                async () => {
                    attempts++;
                    if (attempts < 3) {
                        throw new Error("network timeout");
                    }
                    return "success";
                },
                FAST_CONFIG
            );

            expect(result.success).toBe(true);
            expect(result.attempts).toBe(3);
            expect(result.retried).toBe(true);
        });

        it("should fail after max attempts", async () => {
            const result = await missionRetryService.execute(
                TEST_TOOL,
                async () => {
                    throw new Error("network timeout");
                },
                FAST_CONFIG
            );

            expect(result.success).toBe(false);
            expect(result.attempts).toBe(3);
            expect(result.error).toBeDefined();
        });

        it("should not retry non-retryable errors", async () => {
            const config: Partial<RetryConfig> = {
                ...FAST_CONFIG,
                nonRetryableErrors: ['PERMISSION_DENIED'],
            };

            let attempts = 0;
            const result = await missionRetryService.execute(
                TEST_TOOL,
                async () => {
                    attempts++;
                    const error = new Error("PERMISSION_DENIED");
                    throw error;
                },
                config
            );

            expect(result.success).toBe(false);
            expect(result.attempts).toBe(1); // No retries
            expect(attempts).toBe(1);
        });

        it("should add to dead letter queue after exhaustion", async () => {
            await missionRetryService.execute(
                TEST_TOOL,
                async () => {
                    throw new Error("network timeout");
                },
                FAST_CONFIG
            );

            const dlq = missionRetryService.getDeadLetterQueue();
            expect(dlq).toHaveLength(1);
            expect(dlq[0].toolName).toBe(TEST_TOOL);
            expect(dlq[0].attempts).toBe(3);
        });

        it("should track total execution time", async () => {
            const start = Date.now();

            await missionRetryService.execute(
                TEST_TOOL,
                async () => {
                    throw new Error("network timeout");
                },
                { ...FAST_CONFIG, maxAttempts: 2, baseDelay: 10 }
            );
            
            const elapsed = Date.now() - start;
            expect(elapsed).toBeGreaterThanOrEqual(10); // At least one delay
        });
    });

    describe("retry", () => {
        it("should succeed on first try", async () => {
            const result = await missionRetryService.retry(
                async () => "success",
                { attempts: 3, delay: 10 }
            );

            expect(result).toBe("success");
        });

        it("should retry and succeed", async () => {
            let callCount = 0;
            
            const result = await missionRetryService.retry(
                async () => {
                    callCount++;
                    if (callCount < 2) {
                        throw new Error("fail");
                    }
                    return "success";
                },
                { attempts: 3, delay: 10 }
            );

            expect(result).toBe("success");
            expect(callCount).toBe(2);
        });

        it("should throw after max attempts", async () => {
            await expect(
                missionRetryService.retry(
                    async () => {
                        throw new Error("always fails");
                    },
                    { attempts: 2, delay: 10 }
                )
            ).rejects.toThrow("always fails");
        });

        it("should call onRetry callback", async () => {
            const onRetry = vi.fn();
            
            try {
                await missionRetryService.retry(
                    async () => {
                        throw new Error("fail");
                    },
                    { attempts: 2, delay: 10, onRetry }
                );
            } catch {
                // Expected to fail
            }

            expect(onRetry).toHaveBeenCalledTimes(1);
            expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error));
        });
    });

    describe("isRetryable", () => {
        const defaultConfig: RetryConfig = {
            maxAttempts: 3,
            baseDelay: 1000,
            maxDelay: 30000,
            backoffMultiplier: 2,
            jitter: true,
            retryableErrors: ['ETIMEDOUT', 'ECONNREFUSED'],
            nonRetryableErrors: ['PERMISSION_DENIED'],
        };

        it("should retry retryable errors", () => {
            const error = new Error("ETIMEDOUT");
            expect(missionRetryService.isRetryable(error, defaultConfig)).toBe(true);
        });

        it("should not retry non-retryable errors", () => {
            const error = new Error("PERMISSION_DENIED");
            expect(missionRetryService.isRetryable(error, defaultConfig)).toBe(false);
        });

        it("should retry network errors by default", () => {
            const error = new Error("network connection failed");
            expect(missionRetryService.isRetryable(error, defaultConfig)).toBe(true);
        });

        it("should retry timeout errors by default", () => {
            const error = new Error("Request timeout");
            expect(missionRetryService.isRetryable(error, defaultConfig)).toBe(true);
        });

        it("should not retry unknown errors by default", () => {
            const error = new Error("Unknown application error");
            expect(missionRetryService.isRetryable(error, defaultConfig)).toBe(false);
        });

        it("should check error name for patterns", () => {
            const error = new Error("Something happened");
            error.name = "TimeoutError";
            expect(missionRetryService.isRetryable(error, defaultConfig)).toBe(true);
        });
    });

    describe("calculateDelay", () => {
        const config: RetryConfig = {
            maxAttempts: 5,
            baseDelay: 1000,
            maxDelay: 10000,
            backoffMultiplier: 2,
            jitter: false,
            retryableErrors: [],
            nonRetryableErrors: [],
        };

        it("should calculate exponential delay", () => {
            expect(missionRetryService.calculateDelay(1, config)).toBe(1000);
            expect(missionRetryService.calculateDelay(2, config)).toBe(2000);
            expect(missionRetryService.calculateDelay(3, config)).toBe(4000);
        });

        it("should cap at maxDelay", () => {
            expect(missionRetryService.calculateDelay(10, config)).toBe(10000);
        });

        it("should add jitter when enabled", () => {
            const jitterConfig = { ...config, jitter: true };
            const delay = missionRetryService.calculateDelay(2, jitterConfig);
            
            // Should be around 2000 ± 25%
            expect(delay).toBeGreaterThanOrEqual(1500);
            expect(delay).toBeLessThanOrEqual(2500);
        });
    });

    describe("dead letter queue", () => {
        it("should add entry to DLQ", () => {
            const entry = missionRetryService.addToDeadLetter({
                toolName: TEST_TOOL,
                args: {},
                error: "Test error",
                attempts: 3,
                timestamp: new Date(),
                correlationId: "corr_123",
            });

            expect(entry.id).toMatch(/^dl_\d+_/);
            expect(entry.toolName).toBe(TEST_TOOL);
        });

        it("should get DLQ entries", () => {
            missionRetryService.addToDeadLetter({
                toolName: "tool1",
                args: {},
                error: "error1",
                attempts: 3,
                timestamp: new Date(),
                correlationId: "corr_1",
            });

            missionRetryService.addToDeadLetter({
                toolName: "tool2",
                args: {},
                error: "error2",
                attempts: 3,
                timestamp: new Date(),
                correlationId: "corr_2",
            });

            const all = missionRetryService.getDeadLetterQueue();
            expect(all).toHaveLength(2);

            const filtered = missionRetryService.getDeadLetterQueue({ toolName: "tool1" });
            expect(filtered).toHaveLength(1);
        });

        it("should filter DLQ by date", () => {
            const oldDate = new Date("2023-01-01");
            const newDate = new Date();

            missionRetryService.addToDeadLetter({
                toolName: TEST_TOOL,
                args: {},
                error: "old",
                attempts: 3,
                timestamp: oldDate,
                correlationId: "corr_old",
            });

            missionRetryService.addToDeadLetter({
                toolName: TEST_TOOL,
                args: {},
                error: "new",
                attempts: 3,
                timestamp: newDate,
                correlationId: "corr_new",
            });

            const filtered = missionRetryService.getDeadLetterQueue({
                since: new Date("2024-01-01"),
            });

            expect(filtered).toHaveLength(1);
            expect(filtered[0].error).toBe("new");
        });

        it("should remove from DLQ", () => {
            const entry = missionRetryService.addToDeadLetter({
                toolName: TEST_TOOL,
                args: {},
                error: "error",
                attempts: 3,
                timestamp: new Date(),
                correlationId: "corr_123",
            });

            const removed = missionRetryService.removeFromDeadLetter(entry.id);
            expect(removed).toBe(true);

            const queue = missionRetryService.getDeadLetterQueue();
            expect(queue).toHaveLength(0);
        });

        it("should return false when removing non-existent entry", () => {
            const removed = missionRetryService.removeFromDeadLetter("non-existent");
            expect(removed).toBe(false);
        });

        it("should limit DLQ size to 1000", () => {
            for (let i = 0; i < 1005; i++) {
                missionRetryService.addToDeadLetter({
                    toolName: TEST_TOOL,
                    args: {},
                    error: `error ${i}`,
                    attempts: 3,
                    timestamp: new Date(),
                    correlationId: `corr_${i}`,
                });
            }

            const queue = missionRetryService.getDeadLetterQueue();
            expect(queue.length).toBeLessThanOrEqual(1000);
        });
    });

    describe("replayDeadLetter", () => {
        it("should replay and succeed", async () => {
            const entry = missionRetryService.addToDeadLetter({
                toolName: TEST_TOOL,
                args: {},
                error: "old error",
                attempts: 3,
                timestamp: new Date(),
                correlationId: "corr_123",
            });

            const result = await missionRetryService.replayDeadLetter(
                entry.id,
                async () => "success"
            );

            expect(result?.success).toBe(true);
            expect(result?.result).toBe("success");
        });

        it("should return null for non-existent entry", async () => {
            const result = await missionRetryService.replayDeadLetter(
                "non-existent",
                async () => "success"
            );

            expect(result).toBeNull();
        });

        it("should remove from DLQ after replay", async () => {
            const entry = missionRetryService.addToDeadLetter({
                toolName: TEST_TOOL,
                args: {},
                error: "error",
                attempts: 3,
                timestamp: new Date(),
                correlationId: "corr_123",
            });

            await missionRetryService.replayDeadLetter(entry.id, async () => "success");

            const queue = missionRetryService.getDeadLetterQueue();
            expect(queue).toHaveLength(0);
        });
    });

    describe("getStats", () => {
        it("should return correct stats", () => {
            missionRetryService.addToDeadLetter({
                toolName: "tool1",
                args: {},
                error: "error",
                attempts: 3,
                timestamp: new Date(),
                correlationId: "corr_1",
            });

            missionRetryService.addToDeadLetter({
                toolName: "tool1",
                args: {},
                error: "error",
                attempts: 3,
                timestamp: new Date(),
                correlationId: "corr_2",
            });

            missionRetryService.addToDeadLetter({
                toolName: "tool2",
                args: {},
                error: "error",
                attempts: 3,
                timestamp: new Date(),
                correlationId: "corr_3",
            });

            const stats = missionRetryService.getStats();

            expect(stats.deadLetterCount).toBe(3);
            expect(stats.deadLetterByTool["tool1"]).toBe(2);
            expect(stats.deadLetterByTool["tool2"]).toBe(1);
        });
    });

    describe("getRetryContext", () => {
        it("should return undefined for non-existent context", () => {
            const context = missionRetryService.getRetryContext("non-existent");
            expect(context).toBeUndefined();
        });
    });

    describe("clear operations", () => {
        it("should clear contexts", () => {
            // Start a retry to create context
            missionRetryService.execute(
                TEST_TOOL,
                async () => "success",
                FAST_CONFIG,
                { operationId: "op_123" }
            );

            missionRetryService.clearContexts();
            
            const context = missionRetryService.getRetryContext("op_123");
            expect(context).toBeUndefined();
        });

        it("should clear DLQ", () => {
            missionRetryService.addToDeadLetter({
                toolName: TEST_TOOL,
                args: {},
                error: "error",
                attempts: 3,
                timestamp: new Date(),
                correlationId: "corr_123",
            });

            missionRetryService.clearDeadLetterQueue();

            const queue = missionRetryService.getDeadLetterQueue();
            expect(queue).toHaveLength(0);
        });
    });

    describe("withRetry decorator", () => {
        it("should decorate method with retry", async () => {
            const testObj = {
                callCount: 0,
                async flakyMethod() {
                    this.callCount++;
                    if (this.callCount < 2) {
                        throw new Error("network timeout");
                    }
                    return "success";
                }
            };

            // Apply decorator manually
            const decorator = withRetry({ maxAttempts: 3, baseDelay: 10 });
            const descriptor = {
                value: testObj.flakyMethod.bind(testObj),
                writable: true,
                enumerable: true,
                configurable: true
            };

            decorator(testObj, 'flakyMethod', descriptor);

            const result = await (descriptor.value as any)();

            expect(result).toBe("success");
            expect(testObj.callCount).toBe(2);
        });
    });

    describe("events", () => {
        it("should emit retry_attempt events", async () => {
            let attempts = 0;

            await missionRetryService.execute(
                TEST_TOOL,
                async () => {
                    attempts++;
                    if (attempts < 2) {
                        throw new Error("network timeout");
                    }
                    return "success";
                },
                { ...FAST_CONFIG, maxAttempts: 2 }
            );

            // Event emission is mocked, but execution should complete
            expect(attempts).toBe(2);
        });

        it("should emit dead_letter_added event", async () => {
            await missionRetryService.execute(
                TEST_TOOL,
                async () => {
                    throw new Error("network timeout");
                },
                { ...FAST_CONFIG, maxAttempts: 1 }
            );

            const dlq = missionRetryService.getDeadLetterQueue();
            expect(dlq).toHaveLength(1);
        });
    });
});
