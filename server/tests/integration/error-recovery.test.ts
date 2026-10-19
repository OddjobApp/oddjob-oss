import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { errorRecoveryService } from "@server/domain/core/error-recovery.service.js";

describe("ErrorRecoveryService", () => {
    beforeEach(() => {
        // Clear dead letter queue and retry timers before each test
        (errorRecoveryService as any).deadLetterQueue.clear();
        (errorRecoveryService as any).retryTimers.forEach((timer: NodeJS.Timeout) => clearTimeout(timer));
        (errorRecoveryService as any).retryTimers.clear();
    });

    afterEach(() => {
        // Cleanup after each test
        (errorRecoveryService as any).deadLetterQueue.clear();
        (errorRecoveryService as any).retryTimers.forEach((timer: NodeJS.Timeout) => clearTimeout(timer));
        (errorRecoveryService as any).retryTimers.clear();
    });

    it("should execute operation with retry on success", async () => {
        let attempts = 0;
        const operation = async () => {
            attempts++;
            if (attempts === 1) {
                throw new Error("First attempt failed");
            }
            return "success";
        };

        const result = await errorRecoveryService.executeWithRetry(operation, {
            maxRetries: 2,
            initialDelayMs: 10,
            maxDelayMs: 100,
            backoffMultiplier: 2,
        });

        expect(result).toBe("success");
        expect(attempts).toBe(2);
    });

    it("should fail after max retries", async () => {
        const operation = async () => {
            throw new Error("Always fails");
        };

        await expect(
            errorRecoveryService.executeWithRetry(operation, {
                maxRetries: 2,
                initialDelayMs: 10,
                maxDelayMs: 100,
                backoffMultiplier: 2,
            })
        ).rejects.toThrow("Always fails");
    });

    it("should add entry to dead letter queue", () => {
        const id = errorRecoveryService.addToDeadLetterQueue(
            "TEST_EVENT",
            { data: "test" },
            "Test error",
            1
        );

        expect(id).toBeDefined();
        expect(id).toMatch(/^dlq_/);

        const entries = errorRecoveryService.getDeadLetterQueueEntries(1);
        expect(entries).toHaveLength(1);
        expect(entries[0].eventType).toBe("TEST_EVENT");
    });

    it("should get dead letter queue entries filtered by organization", () => {
        errorRecoveryService.addToDeadLetterQueue("EVENT_1", {}, "Error 1", 1);
        errorRecoveryService.addToDeadLetterQueue("EVENT_2", {}, "Error 2", 2);
        errorRecoveryService.addToDeadLetterQueue("EVENT_3", {}, "Error 3", 1);

        const org1Entries = errorRecoveryService.getDeadLetterQueueEntries(1);
        const org2Entries = errorRecoveryService.getDeadLetterQueueEntries(2);

        expect(org1Entries).toHaveLength(2);
        expect(org2Entries).toHaveLength(1);
    });

    it("should clear dead letter entry", () => {
        const id = errorRecoveryService.addToDeadLetterQueue("TEST_EVENT", {}, "Test error");
        errorRecoveryService.clearDeadLetterEntry(id);

        const entries = errorRecoveryService.getDeadLetterQueueEntries();
        expect(entries).toHaveLength(0);
    });

    it("should schedule retry with exponential backoff", async () => {
        let attempts = 0;
        const operation = async () => {
            attempts++;
            if (attempts < 3) {
                throw new Error("Not yet");
            }
        };

        errorRecoveryService.scheduleRetry("test-retry", operation, {
            maxRetries: 3,
            initialDelayMs: 10,
            maxDelayMs: 100,
            backoffMultiplier: 2,
        });

        // Wait for retries to complete
        await new Promise(resolve => setTimeout(resolve, 100));

        expect(attempts).toBe(3);
    });

    it("should cancel scheduled retry", () => {
        const operation = async () => {
            throw new Error("Should not execute");
        };

        errorRecoveryService.scheduleRetry("test-cancel", operation);
        errorRecoveryService.cancelRetry("test-cancel");

        const stats = errorRecoveryService.getRetryStats();
        expect(stats.activeRetries).toBe(0);
    });

    it("should get retry statistics", () => {
        errorRecoveryService.addToDeadLetterQueue("EVENT_1", {}, "Error 1");
        errorRecoveryService.addToDeadLetterQueue("EVENT_2", {}, "Error 2");
        errorRecoveryService.addToDeadLetterQueue("EVENT_1", {}, "Error 3");

        const stats = errorRecoveryService.getRetryStats();

        expect(stats.deadLetterQueueSize).toBe(3);
        expect(stats.activeRetries).toBe(0);
        expect(stats.entriesByEventType["EVENT_1"]).toBe(2);
        expect(stats.entriesByEventType["EVENT_2"]).toBe(1);
    });
});
