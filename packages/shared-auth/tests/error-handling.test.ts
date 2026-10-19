/**
 * errorHandling Tests — Standardized error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    ApplicationError,
    ValidationError,
    NotFoundError,
    ErrorCode,
    ErrorSeverity,
    safeAsync,
    safeSync,
    withRetry
} from "@shared/utils/errorHandling.js";

describe("errorHandling", () => {

    describe("ApplicationError", () => {
        it("creates a standard application error", () => {
            const err = new ApplicationError(
                ErrorCode.INTERNAL_ERROR,
                "Something went wrong",
                ErrorSeverity.HIGH,
                { detail: "extra" }
            );
            expect(err.message).toBe("Something went wrong");
            expect(err.code).toBe(ErrorCode.INTERNAL_ERROR);
            expect(err.severity).toBe(ErrorSeverity.HIGH);
            expect(err.details).toEqual({ detail: "extra" });
            expect(err.timestamp).toBeDefined();
        });

        it("converts to JSON correctly", () => {
            const err = new ApplicationError(ErrorCode.INVALID_INPUT, "Bad input");
            const json = err.toJSON();
            expect(json.code).toBe(ErrorCode.INVALID_INPUT);
            expect(json.message).toBe("Bad input");
            expect(json.timestamp).toBe(err.timestamp);
        });
    });

    describe("NotFoundError", () => {
        it("formats message with resource and identifier", () => {
            const err = new NotFoundError("User", "123");
            expect(err.message).toBe("User with identifier '123' not found");
            expect(err.code).toBe(ErrorCode.NOT_FOUND);
        });

        it("formats message with resource only", () => {
            const err = new NotFoundError("Configuration");
            expect(err.message).toBe("Configuration not found");
        });
    });

    describe("safeAsync", () => {
        it("returns success object for successful promise", async () => {
            const op = async () => "result";
            const result = await safeAsync(op);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data).toBe("result");
            }
        });

        it("returns error object for failing promise", async () => {
            // Silence console.error for this test
            const spy = vi.spyOn(console, 'error').mockImplementation(() => { });

            const op = async () => { throw new Error("fail"); };
            const result = await safeAsync(op);
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error).toBeDefined();
                expect(result.error.message).toBe("fail");
            }

            spy.mockRestore();
        });
    });

    describe("safeSync", () => {
        it("returns success object for successful function", () => {
            const op = () => 42;
            const result = safeSync(op);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data).toBe(42);
            }
        });

        it("returns error object for throwing function", () => {
            const op = () => { throw new ValidationError("invalid"); };
            const result = safeSync(op);
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error.code).toBe(ErrorCode.VALIDATION_FAILED);
            }
        });
    });

    describe("withRetry", () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });
        afterEach(() => {
            vi.useRealTimers();
        });

        it("returns result on first try if successful", async () => {
            const op = vi.fn().mockResolvedValue("done");
            const result = await withRetry(op);
            expect(result).toBe("done");
            expect(op).toHaveBeenCalledTimes(1);
        });

        it("retries multiple times on failure", async () => {
            const op = vi.fn()
                .mockRejectedValueOnce(new Error("try 1"))
                .mockRejectedValueOnce(new Error("try 2"))
                .mockResolvedValue("finally done");

            const promise = withRetry(op, { baseDelay: 10, maxAttempts: 3 });

            // Advance timers for first retry
            await vi.advanceTimersByTimeAsync(10);
            // Advance timers for second retry
            await vi.advanceTimersByTimeAsync(20);

            const result = await promise;
            expect(result).toBe("finally done");
            expect(op).toHaveBeenCalledTimes(3);
        });

        it("throws after max attempts", async () => {
            const op = vi.fn().mockImplementation(() => Promise.reject(new Error("permafail")));

            const promise = withRetry(op, { maxAttempts: 2, baseDelay: 10 });

            // Set up rejection expectation before advancing timers so the rejection is caught
            const rejectionPromise = expect(promise).rejects.toThrow("permafail");
            await vi.runAllTimersAsync();
            await rejectionPromise;
            expect(op).toHaveBeenCalledTimes(2);
        });

        it("respects retryCondition", async () => {
            const op = vi.fn().mockImplementation(() => Promise.reject(new Error("fatal")));
            const condition = (err: any) => err.message !== "fatal";

            const promise = withRetry(op, { retryCondition: condition });

            await expect(promise).rejects.toThrow("fatal");
            expect(op).toHaveBeenCalledTimes(1); // should not retry if condition is false
        });
    });
});
