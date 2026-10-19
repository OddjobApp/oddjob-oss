/**
 * Property-based test for Temporal Decay Formula Correctness.
 *
 * **Property 6: Temporal Decay Formula Correctness**
 *
 * For any original confidence value in [0, 100], elapsed time ≥ 0, and half-life > 0,
 * the function `computeEffectiveConfidence(original, elapsed, halfLife)` SHALL return
 * `original × 0.5^(elapsed / halfLife)` within floating-point tolerance of ε = 0.001.
 * When half-life is Infinity, the function SHALL return the original confidence unchanged.
 * Pinned entries SHALL always return their original confidence regardless of elapsed time.
 *
 * **Validates: Requirements 8.1, 8.3, 8.4**
 *
 * Uses fast-check for property-based testing with Vitest.
 */

import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";

// ─── Hoisted Mocks ─────────────────────────────────────────────────────────

vi.mock("@server/database_service.js", () => ({
    db: {
        select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }) }),
        insert: vi.fn(),
        update: vi.fn(),
    },
}));

vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => ({
    nodeRedisClient: {
        get: vi.fn().mockResolvedValue(null),
        setex: vi.fn().mockResolvedValue("OK"),
        del: vi.fn().mockResolvedValue(1),
    },
}));

vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    }),
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
    ...(await importOriginal<typeof import("drizzle-orm")>()),
    eq: (a: any, b: any) => ({ type: "eq", a, b }),
    and: (...args: any[]) => ({ type: "and", args }),
    sql: vi.fn(),
    asc: vi.fn(),
}));

vi.mock("@shared/schema/agent/tom-archived-entries.js", () => ({
    tomArchivedEntries: {},
}));

vi.mock("./user-representation.service.js", () => ({
    userRepresentationService: {
        getRepresentation: vi.fn().mockResolvedValue(null),
    },
}));

// ─── Import under test ──────────────────────────────────────────────────────

import { computeEffectiveConfidence } from "../theory-of-mind.service.js";

// ─── Constants ──────────────────────────────────────────────────────────────

const EPSILON = 0.001;

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("Property 6: Temporal Decay Formula Correctness", () => {
    /**
     * **Validates: Requirements 8.1, 8.4**
     *
     * Main property: for any confidence in [0, 100], elapsedMs >= 0, halfLifeMs > 0:
     * result equals `confidence * Math.pow(0.5, elapsedMs / halfLifeMs)` within ε = 0.001
     */
    it("decay result matches formula: original × 0.5^(elapsed/halfLife) within ε=0.001", () => {
        fc.assert(
            fc.property(
                fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
                fc.double({ min: 0, max: 1e12, noNaN: true, noDefaultInfinity: true }),
                fc.double({ min: 1, max: 1e12, noNaN: true, noDefaultInfinity: true }),
                (original, elapsedMs, halfLifeMs) => {
                    const result = computeEffectiveConfidence(original, elapsedMs, halfLifeMs);
                    const expected = original * Math.pow(0.5, elapsedMs / halfLifeMs);

                    expect(Math.abs(result - expected)).toBeLessThanOrEqual(EPSILON);
                },
            ),
            { numRuns: 200 },
        );
    });

    /**
     * **Validates: Requirements 8.3, 8.4**
     *
     * When halfLifeMs = Infinity, the function returns the original confidence unchanged.
     * This models entries that never decay (e.g., epistemic states) and pinned entries.
     */
    it("returns original unchanged when halfLife is Infinity", () => {
        fc.assert(
            fc.property(
                fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
                fc.double({ min: 0, max: 1e12, noNaN: true, noDefaultInfinity: true }),
                (original, elapsedMs) => {
                    const result = computeEffectiveConfidence(original, elapsedMs, Infinity);
                    expect(result).toBe(original);
                },
            ),
            { numRuns: 200 },
        );
    });

    /**
     * **Validates: Requirements 8.1, 8.4**
     *
     * When elapsedMs = 0, the result equals the original confidence unchanged
     * (no time has passed, so no decay occurs).
     */
    it("returns original unchanged when elapsed time is zero", () => {
        fc.assert(
            fc.property(
                fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
                fc.double({ min: 1, max: 1e12, noNaN: true, noDefaultInfinity: true }),
                (original, halfLifeMs) => {
                    const result = computeEffectiveConfidence(original, 0, halfLifeMs);
                    expect(result).toBe(original);
                },
            ),
            { numRuns: 200 },
        );
    });

    /**
     * **Validates: Requirements 8.1**
     *
     * When elapsed equals halfLife, result equals original / 2 (within ε).
     * This is the definition of half-life: after one half-life period, confidence halves.
     */
    it("result equals original / 2 when elapsed equals halfLife (within ε)", () => {
        fc.assert(
            fc.property(
                fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
                fc.double({ min: 1, max: 1e12, noNaN: true, noDefaultInfinity: true }),
                (original, halfLifeMs) => {
                    const result = computeEffectiveConfidence(original, halfLifeMs, halfLifeMs);
                    const expected = original / 2;

                    expect(Math.abs(result - expected)).toBeLessThanOrEqual(EPSILON);
                },
            ),
            { numRuns: 200 },
        );
    });

    /**
     * **Validates: Requirements 8.1**
     *
     * All decay results are non-negative (confidence never goes negative).
     */
    it("result is always non-negative", () => {
        fc.assert(
            fc.property(
                fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
                fc.double({ min: 0, max: 1e12, noNaN: true, noDefaultInfinity: true }),
                fc.double({ min: 1, max: 1e12, noNaN: true, noDefaultInfinity: true }),
                (original, elapsedMs, halfLifeMs) => {
                    const result = computeEffectiveConfidence(original, elapsedMs, halfLifeMs);
                    expect(result).toBeGreaterThanOrEqual(0);
                },
            ),
            { numRuns: 200 },
        );
    });

    /**
     * **Validates: Requirements 8.1**
     *
     * Decay result is always ≤ original confidence (decay never increases confidence).
     */
    it("result is always ≤ original", () => {
        fc.assert(
            fc.property(
                fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
                fc.double({ min: 0, max: 1e12, noNaN: true, noDefaultInfinity: true }),
                fc.double({ min: 1, max: 1e12, noNaN: true, noDefaultInfinity: true }),
                (original, elapsedMs, halfLifeMs) => {
                    const result = computeEffectiveConfidence(original, elapsedMs, halfLifeMs);
                    expect(result).toBeLessThanOrEqual(original + EPSILON);
                },
            ),
            { numRuns: 200 },
        );
    });

    /**
     * **Validates: Requirements 8.3**
     *
     * Pinned entries (modeled via Infinity halfLife) preserve original confidence
     * regardless of how much time has elapsed.
     */
    it("pinned entries (Infinity halfLife) preserve original confidence regardless of time elapsed", () => {
        fc.assert(
            fc.property(
                fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
                fc.oneof(
                    fc.double({ min: 0, max: 1e6, noNaN: true, noDefaultInfinity: true }),
                    fc.double({ min: 1e6, max: 1e12, noNaN: true, noDefaultInfinity: true }),
                ),
                (original, elapsedMs) => {
                    const result = computeEffectiveConfidence(original, elapsedMs, Infinity);
                    expect(result).toBe(original);
                },
            ),
            { numRuns: 200 },
        );
    });
});
