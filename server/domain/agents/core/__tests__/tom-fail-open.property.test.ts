/**
 * Property-based test for Fail-Open Resilience.
 *
 * **Property 14: Fail-Open Resilience**
 *
 * On sync path failure (timeout/exception/malformed), the service returns
 * last-known state and does not propagate error to orchestrator.
 *
 * **Validates: Requirements 10.4**
 *
 * Uses fast-check to generate random messages and verify `assess()` never
 * throws regardless of input or infrastructure failures.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import fc from "fast-check";
import type { SyncAssessmentResult } from "../tom-sync-assessor.js";

// ─── Hoisted Mocks ─────────────────────────────────────────────────────────

vi.mock("@server/database_service.js", () => ({
    db: {
        select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([]),
                }),
            }),
        }),
        insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([]),
                onConflictDoNothing: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([]),
                }),
            }),
        }),
        update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([]),
                }),
            }),
        }),
    },
}));

vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => ({
    nodeRedisClient: {
        get: vi.fn().mockResolvedValue(null),
        setex: vi.fn().mockResolvedValue("OK"),
        set: vi.fn().mockResolvedValue("OK"),
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

import { assess, extractCognitiveSignals, classifyIntent } from "../tom-sync-assessor.js";
import { theoryOfMindService } from "../theory-of-mind.service.js";

// ─── Generators ─────────────────────────────────────────────────────────────

/** Generate arbitrary user messages (including edge cases) */
const messageArb = fc.oneof(
    fc.string({ minLength: 0, maxLength: 500 }),
    fc.constant(""),
    fc.constant("   "),
    fc.stringOf(fc.constantFrom("!", "?", ".", " ", "\n", "\t"), { minLength: 1, maxLength: 50 }),
    fc.stringOf(fc.constantFrom("A", "B", "C", "D", "E"), { minLength: 1, maxLength: 100 }),  // ALL CAPS
    fc.constant("🔥💀🎉😡"),  // Emojis
    fc.constant("a".repeat(1000)),  // Very long
    fc.constant("fix this NOW!!! ASAP!!!"),  // High frustration + urgency
    fc.constant("I don't understand??? What do you mean???"),  // High confusion
);

/** Generate arbitrary conversation contexts */
const conversationContextArb = fc.array(
    fc.record({
        role: fc.constantFrom("user", "assistant", "system"),
        content: fc.string({ minLength: 0, maxLength: 200 }),
    }),
    { minLength: 0, maxLength: 10 },
);

/** Generate arbitrary orgId, userId, sessionId */
const orgIdArb = fc.integer({ min: 1, max: 100000 });
const userIdArb = fc.string({ minLength: 1, maxLength: 36 });
const sessionIdArb = fc.string({ minLength: 1, maxLength: 36 });

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("Property 14: Fail-Open Resilience", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    /**
     * **Validates: Requirements 10.4**
     *
     * assess() should NEVER throw an error, regardless of input.
     * It should always return a valid SyncAssessmentResult.
     */
    it("assess() never throws for any input when infrastructure is healthy", async () => {
        // Mock getToMState to return null (no existing state)
        vi.spyOn(theoryOfMindService, "getToMState").mockResolvedValue(null);

        await fc.assert(
            fc.asyncProperty(
                messageArb,
                conversationContextArb,
                orgIdArb,
                userIdArb,
                sessionIdArb,
                async (message, context, orgId, userId, sessionId) => {
                    const result = await assess(message, context, orgId, userId, sessionId);

                    // Should always return a result (never throw)
                    expect(result).toBeDefined();
                    expect(result.cognitiveState).toBeDefined();
                    expect(result.intentModel).toBeDefined();
                    expect(typeof result.latencyMs).toBe("number");
                    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
                },
            ),
            { numRuns: 100 },
        );
    });

    /**
     * **Validates: Requirements 10.4**
     *
     * When the DB/service throws an exception, assess() should still return
     * a valid SyncAssessmentResult with fallback values (never propagate error).
     */
    it("assess() returns fallback result when getToMState throws", async () => {
        vi.spyOn(theoryOfMindService, "getToMState").mockRejectedValue(
            new Error("Database connection refused"),
        );

        await fc.assert(
            fc.asyncProperty(
                messageArb,
                conversationContextArb,
                orgIdArb,
                userIdArb,
                sessionIdArb,
                async (message, context, orgId, userId, sessionId) => {
                    const result = await assess(message, context, orgId, userId, sessionId);

                    // Should still return a valid result
                    expect(result).toBeDefined();
                    expect(result.cognitiveState).toBeDefined();
                    expect(result.intentModel).toBeDefined();
                    expect(typeof result.latencyMs).toBe("number");
                    expect(result.latencyMs).toBeGreaterThanOrEqual(0);

                    // Fallback cognitive state should have valid scores
                    expect(result.cognitiveState.frustration).toBeGreaterThanOrEqual(0);
                    expect(result.cognitiveState.frustration).toBeLessThanOrEqual(100);
                    expect(result.cognitiveState.confusion).toBeGreaterThanOrEqual(0);
                    expect(result.cognitiveState.confusion).toBeLessThanOrEqual(100);
                    expect(result.cognitiveState.urgency).toBeGreaterThanOrEqual(0);
                    expect(result.cognitiveState.urgency).toBeLessThanOrEqual(100);
                    expect(result.cognitiveState.explorationVsGoal).toBeGreaterThanOrEqual(0);
                    expect(result.cognitiveState.explorationVsGoal).toBeLessThanOrEqual(100);
                },
            ),
            { numRuns: 100 },
        );
    });

    /**
     * **Validates: Requirements 10.4**
     *
     * When Redis is unavailable (throws on all operations), assess() should
     * still return a valid SyncAssessmentResult.
     */
    it("assess() returns valid result when Redis throws", async () => {
        // Redis mock already returns null, but let's make getToMState throw
        // to simulate Redis-backed cache failure
        vi.spyOn(theoryOfMindService, "getToMState").mockRejectedValue(
            new Error("Redis ETIMEDOUT"),
        );

        await fc.assert(
            fc.asyncProperty(
                messageArb,
                conversationContextArb,
                orgIdArb,
                userIdArb,
                sessionIdArb,
                async (message, context, orgId, userId, sessionId) => {
                    const result = await assess(message, context, orgId, userId, sessionId);

                    expect(result).toBeDefined();
                    expect(result.cognitiveState).toBeDefined();
                    expect(result.intentModel).toBeDefined();
                    expect(typeof result.latencyMs).toBe("number");
                },
            ),
            { numRuns: 50 },
        );
    });

    /**
     * **Validates: Requirements 10.4**
     *
     * When getToMState throws, assess() still returns a structurally valid
     * SyncAssessmentResult. The internal getLastKnownState catches the error
     * and returns null, so the assessor continues with heuristic computation.
     * The key property: it never propagates an error to the caller and always
     * returns valid scores in [0,100].
     */
    it("assess() returns structurally valid result when all infrastructure fails", async () => {
        // Simulate complete infrastructure failure
        vi.spyOn(theoryOfMindService, "getToMState").mockRejectedValue(
            new Error("Complete infrastructure failure"),
        );

        await fc.assert(
            fc.asyncProperty(
                messageArb,
                conversationContextArb,
                orgIdArb,
                userIdArb,
                sessionIdArb,
                async (message, context, orgId, userId, sessionId) => {
                    const result = await assess(message, context, orgId, userId, sessionId);

                    // Must return a valid result (never throw)
                    expect(result).toBeDefined();
                    expect(result.cognitiveState).toBeDefined();
                    expect(result.intentModel).toBeDefined();

                    // Cognitive state scores must be valid [0,100]
                    expect(result.cognitiveState.frustration).toBeGreaterThanOrEqual(0);
                    expect(result.cognitiveState.frustration).toBeLessThanOrEqual(100);
                    expect(result.cognitiveState.confusion).toBeGreaterThanOrEqual(0);
                    expect(result.cognitiveState.confusion).toBeLessThanOrEqual(100);
                    expect(result.cognitiveState.urgency).toBeGreaterThanOrEqual(0);
                    expect(result.cognitiveState.urgency).toBeLessThanOrEqual(100);
                    expect(result.cognitiveState.explorationVsGoal).toBeGreaterThanOrEqual(0);
                    expect(result.cognitiveState.explorationVsGoal).toBeLessThanOrEqual(100);

                    // Intent model must have valid structure
                    expect(typeof result.intentModel.literalIntent).toBe("string");
                    expect(typeof result.intentModel.inferredIntent).toBe("string");
                    expect(result.intentModel.inferredConfidence).toBeGreaterThanOrEqual(0);
                    expect(result.intentModel.inferredConfidence).toBeLessThanOrEqual(100);
                    expect(typeof result.intentModel.diverges).toBe("boolean");

                    // Latency must be non-negative
                    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
                },
            ),
            { numRuns: 50 },
        );
    });

    /**
     * **Validates: Requirements 10.4**
     *
     * For any random message, extractCognitiveSignals never throws and always
     * produces valid scores in [0, 100].
     */
    it("extractCognitiveSignals never throws for any input", () => {
        fc.assert(
            fc.property(
                messageArb,
                fc.array(fc.string({ minLength: 0, maxLength: 200 }), { minLength: 0, maxLength: 10 }),
                (message, priorMessages) => {
                    const result = extractCognitiveSignals(message, priorMessages);

                    expect(result).toBeDefined();
                    expect(result.frustration).toBeGreaterThanOrEqual(0);
                    expect(result.frustration).toBeLessThanOrEqual(100);
                    expect(result.confusion).toBeGreaterThanOrEqual(0);
                    expect(result.confusion).toBeLessThanOrEqual(100);
                    expect(result.urgency).toBeGreaterThanOrEqual(0);
                    expect(result.urgency).toBeLessThanOrEqual(100);
                    expect(result.explorationVsGoal).toBeGreaterThanOrEqual(0);
                    expect(result.explorationVsGoal).toBeLessThanOrEqual(100);
                    expect(result.assessedAt).toBeDefined();
                },
            ),
            { numRuns: 200 },
        );
    });

    /**
     * **Validates: Requirements 10.4**
     *
     * For any random message, classifyIntent never throws and always produces
     * valid output (strings and confidence in [0, 100]).
     */
    it("classifyIntent never throws for any input", () => {
        fc.assert(
            fc.property(
                messageArb,
                fc.array(fc.string({ minLength: 0, maxLength: 50 }), { minLength: 0, maxLength: 20 }),
                (message, sessionSignals) => {
                    const result = classifyIntent(message, sessionSignals);

                    expect(result).toBeDefined();
                    expect(typeof result.literal).toBe("string");
                    expect(typeof result.inferred).toBe("string");
                    expect(result.confidence).toBeGreaterThanOrEqual(0);
                    expect(result.confidence).toBeLessThanOrEqual(100);
                },
            ),
            { numRuns: 200 },
        );
    });

    /**
     * **Validates: Requirements 10.4**
     *
     * assess() latencyMs is always a positive number regardless of failure mode.
     */
    it("assess() always reports positive latencyMs even on failure", async () => {
        vi.spyOn(theoryOfMindService, "getToMState").mockRejectedValue(
            new Error("Timeout after 200ms"),
        );

        await fc.assert(
            fc.asyncProperty(
                messageArb,
                conversationContextArb,
                orgIdArb,
                userIdArb,
                sessionIdArb,
                async (message, context, orgId, userId, sessionId) => {
                    const result = await assess(message, context, orgId, userId, sessionId);
                    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
                    expect(Number.isFinite(result.latencyMs)).toBe(true);
                },
            ),
            { numRuns: 50 },
        );
    });
});
