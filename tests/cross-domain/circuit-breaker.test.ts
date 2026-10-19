/**
 * Circuit Breaker Unit Tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    createCircuitBreaker,
    withCircuitBreaker,
    resetCircuit,
    getCircuitState,
    CircuitOpenError
} from "@domain/core/infrastructure/circuit-breaker.service.js";

vi.mock("../utils/logger", () => ({
    createLogger: vi.fn(() => ({
        info: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
    })),
}));

describe("CircuitBreaker", () => {
    const BREAKER_NAME = "test-service";

    beforeEach(() => {
        vi.useFakeTimers();
        resetCircuit(BREAKER_NAME);
    });

    it("should allow requests in CLOSED state", async () => {
        const fn = vi.fn().mockResolvedValue("success");
        const result = await withCircuitBreaker(BREAKER_NAME, fn);

        expect(result).toBe("success");
        expect(fn).toHaveBeenCalledTimes(1);
        expect(getCircuitState(BREAKER_NAME)?.state).toBe("CLOSED");
    });

    it("should open circuit after failure threshold reached", async () => {
        const config = {
            name: BREAKER_NAME,
            failureThreshold: 2,
            resetTimeoutMs: 1000,
            halfOpenMaxAttempts: 1
        };
        createCircuitBreaker(config);

        const fn = vi.fn().mockRejectedValue(new Error("Fail"));

        // First failure
        await expect(withCircuitBreaker(BREAKER_NAME, fn)).rejects.toThrow("Fail");
        expect(getCircuitState(BREAKER_NAME)?.state).toBe("CLOSED");

        // Second failure -> OPEN
        await expect(withCircuitBreaker(BREAKER_NAME, fn)).rejects.toThrow("Fail");
        expect(getCircuitState(BREAKER_NAME)?.state).toBe("OPEN");

        // Third call immediately fails without calling fn
        await expect(withCircuitBreaker(BREAKER_NAME, fn)).rejects.toThrow(CircuitOpenError);
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it("should use fallback if specified when OPEN", async () => {
        const config = {
            name: BREAKER_NAME,
            failureThreshold: 1,
            resetTimeoutMs: 1000,
            halfOpenMaxAttempts: 1
        };
        createCircuitBreaker(config);

        const fn = vi.fn().mockRejectedValue(new Error("Fail"));
        const fallback = vi.fn().mockReturnValue("fallback-result");

        // Trigger OPEN
        await expect(withCircuitBreaker(BREAKER_NAME, fn)).rejects.toThrow("Fail");

        // Next call uses fallback
        const result = await withCircuitBreaker(BREAKER_NAME, fn, fallback);
        expect(result).toBe("fallback-result");
        expect(fallback).toHaveBeenCalled();
    });

    it("should transition to HALF_OPEN after timeout", async () => {
        const config = {
            name: BREAKER_NAME,
            failureThreshold: 1,
            resetTimeoutMs: 1000,
            halfOpenMaxAttempts: 1
        };
        createCircuitBreaker(config);

        await expect(withCircuitBreaker(BREAKER_NAME, () => Promise.reject("Fail"))).rejects.toBeDefined();
        expect(getCircuitState(BREAKER_NAME)?.state).toBe("OPEN");

        // Advance time
        vi.advanceTimersByTime(1100);

        // Next call should be HALF_OPEN
        const fn = vi.fn().mockResolvedValue("recovered");
        const result = await withCircuitBreaker(BREAKER_NAME, fn);

        expect(result).toBe("recovered");
        expect(getCircuitState(BREAKER_NAME)?.state).toBe("CLOSED");
    });

    it("should reopen if failure occurs in HALF_OPEN", async () => {
        const config = {
            name: BREAKER_NAME,
            failureThreshold: 1,
            resetTimeoutMs: 1000,
            halfOpenMaxAttempts: 1
        };
        createCircuitBreaker(config);

        await expect(withCircuitBreaker(BREAKER_NAME, () => Promise.reject("Fail"))).rejects.toBeDefined();
        vi.advanceTimersByTime(1100);

        // Triggers HALF_OPEN -> fails -> OPEN
        const fn = vi.fn().mockRejectedValue(new Error("Still failing"));
        await expect(withCircuitBreaker(BREAKER_NAME, fn)).rejects.toThrow("Still failing");

        expect(getCircuitState(BREAKER_NAME)?.state).toBe("OPEN");
    });

    it("should support custom failure predicate", async () => {
        const config = {
            name: BREAKER_NAME,
            failureThreshold: 1,
            resetTimeoutMs: 1000,
            halfOpenMaxAttempts: 1
        };
        createCircuitBreaker(config);

        const isFailure = (res: string) => res === "ERROR_STRING";
        const fn = vi.fn().mockResolvedValue("ERROR_STRING");

        const result = await withCircuitBreaker(BREAKER_NAME, fn, undefined, isFailure);
        expect(result).toBe("ERROR_STRING");
        expect(getCircuitState(BREAKER_NAME)?.state).toBe("OPEN");
    });

    it("shares one registry with the domain/admin re-export path", async () => {
        // These were two separate modules with two separate `circuits` maps.
        // The tool executor registered breakers through the core path while the
        // admin infra-health surface read getAllCircuitStatuses() from the other
        // one, so it could never see them. Same registry now, or the surface is
        // blind again.
        const admin = await import("@domain/admin/core/circuit-breaker.service.js");

        const name = "shared-registry-probe";
        resetCircuit(name);
        createCircuitBreaker({
            name,
            failureThreshold: 1,
            resetTimeoutMs: 1000,
            halfOpenMaxAttempts: 1,
        });

        const fn = vi.fn().mockRejectedValue(new Error("Fail"));
        await expect(withCircuitBreaker(name, fn)).rejects.toThrow("Fail");

        expect(admin.getCircuitState(name)?.state).toBe("OPEN");
        expect(Object.keys(admin.getAllCircuitStatuses())).toContain(name);
    });
});
