/**
 * Property-based test: Context String Token Bound (Property 11)
 *
 * For any TheoryOfMindRecord (no matter how many beliefs, epistemic entries,
 * expectations, or knowledge gaps it contains), getContextString() SHALL produce
 * output bounded to 400 tokens (estimated as character count ÷ 4 ≤ 400).
 * The output SHALL begin with a clearly-marked header section distinct from
 * the user-representation header. When non-empty, never null.
 *
 * **Validates: Requirements 9.1, 9.4, 13.3**
 *
 * Uses fast-check for property-based testing with a minimum of 100 iterations.
 * Tag: Feature: theory-of-mind, Property 11: Context String Token Bound
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import fc from "fast-check";
import type {
    TheoryOfMindRecord,
    Belief,
    KnowledgeGap,
    CognitiveState,
    IntentModel,
    OceanProfile,
    Expectation,
    EpistemicEntry,
} from "@shared/schema/agent/theory-of-mind.js";

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@server/database_service.js", () => ({ db: {} }));
vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => ({
    nodeRedisClient: { get: vi.fn(), setex: vi.fn(), del: vi.fn() },
}));
vi.mock("drizzle-orm", () => ({
    eq: vi.fn(), and: vi.fn(), sql: vi.fn(), asc: vi.fn(),
}));
vi.mock("@shared/schema/agent/theory-of-mind.js", async (importOriginal) => {
    const actual = await importOriginal() as any;
    return { ...actual, theoryOfMind: {} };
});
vi.mock("@shared/schema/agent/tom-archived-entries.js", () => ({ tomArchivedEntries: {} }));
vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));
vi.mock("./user-representation.service.js", () => ({
    userRepresentationService: {
        getRepresentation: vi.fn().mockResolvedValue({ id: 1, preferences: [], goals: [] }),
    },
}));

import { theoryOfMindService } from "./theory-of-mind.service.js";

// ─── fast-check Arbitraries ─────────────────────────────────────────────────

/** Non-empty string for topic/proposition fields */
const topicArb = fc.string({ minLength: 1, maxLength: 50 });

/** Generate a random ISO 8601 timestamp (recent, to avoid excessive decay) */
const recentTimestampArb = fc.date({
    min: new Date(Date.now() - 60_000), // within last minute (avoids decay filtering)
    max: new Date(),
}).map(d => d.toISOString());

/** Generate a misaligned belief (these appear in context string) */
const misalignedBeliefArb: fc.Arbitrary<Belief> = fc.record({
    topic: topicArb,
    proposition: fc.string({ minLength: 1, maxLength: 100 }),
    confidence: fc.integer({ min: 1, max: 100 }),
    alignment: fc.constant("misaligned" as const),
    groundTruth: fc.string({ minLength: 1, maxLength: 100 }),
    sourceEvidence: fc.string({ minLength: 1, maxLength: 30 }),
    observedAt: recentTimestampArb,
    pinned: fc.boolean(),
});

/** Generate a knowledge gap with high relevance (will appear in context) */
const knowledgeGapArb: fc.Arbitrary<KnowledgeGap> = fc.record({
    topic: topicArb,
    relatedGoal: fc.string({ minLength: 1, maxLength: 30 }),
    relevanceScore: fc.integer({ min: 0, max: 100 }),
    dismissed: fc.boolean(),
    detectedAt: recentTimestampArb,
});

/** Generate cognitive state with variable scores */
const cognitiveStateArb: fc.Arbitrary<CognitiveState> = fc.record({
    frustration: fc.integer({ min: 0, max: 100 }),
    confusion: fc.integer({ min: 0, max: 100 }),
    urgency: fc.integer({ min: 0, max: 100 }),
    explorationVsGoal: fc.integer({ min: 0, max: 100 }),
    assessedAt: recentTimestampArb,
});

/** Generate intent model with diverges true/false */
const intentModelArb: fc.Arbitrary<IntentModel> = fc.record({
    literalIntent: fc.string({ minLength: 1, maxLength: 80 }),
    inferredIntent: fc.string({ minLength: 1, maxLength: 80 }),
    inferredConfidence: fc.integer({ min: 0, max: 100 }),
    diverges: fc.boolean(),
    sessionSignals: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 0, maxLength: 5 }),
    sessionId: fc.string({ minLength: 1, maxLength: 20 }),
    updatedAt: recentTimestampArb,
});

/** Generate OCEAN profile with variable confidence */
const oceanProfileArb: fc.Arbitrary<OceanProfile> = fc.record({
    openness: fc.double({ min: 0, max: 1, noNaN: true }),
    conscientiousness: fc.double({ min: 0, max: 1, noNaN: true }),
    extraversion: fc.double({ min: 0, max: 1, noNaN: true }),
    agreeableness: fc.double({ min: 0, max: 1, noNaN: true }),
    neuroticism: fc.double({ min: 0, max: 1, noNaN: true }),
    confidence: fc.integer({ min: 0, max: 100 }),
    observationCount: fc.integer({ min: 0, max: 50 }),
    lastCalibratedAt: fc.option(recentTimestampArb, { nil: null }),
});

/** Generate expectations with 'will-diverge' status */
const expectationArb: fc.Arbitrary<Expectation> = fc.record({
    domain: fc.string({ minLength: 1, maxLength: 30 }),
    description: fc.string({ minLength: 1, maxLength: 100 }),
    confidence: fc.integer({ min: 0, max: 100 }),
    status: fc.constantFrom("active", "met", "unmet", "will-diverge", "unknown") as fc.Arbitrary<Expectation["status"]>,
    divergenceExplanation: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
    triggeringContext: fc.string({ minLength: 1, maxLength: 50 }),
    observedAt: recentTimestampArb,
});

/** Generate epistemic entries */
const epistemicEntryArb: fc.Arbitrary<EpistemicEntry> = fc.record({
    topic: topicArb,
    summary: fc.string({ minLength: 1, maxLength: 80 }),
    informedBy: fc.string({ minLength: 1, maxLength: 20 }),
    informedAt: recentTimestampArb,
    confidence: fc.integer({ min: 1, max: 100 }),
});

/** Generate a maximally-complex TheoryOfMindRecord */
const maxComplexRecordArb: fc.Arbitrary<TheoryOfMindRecord> = fc.record({
    id: fc.integer({ min: 1, max: 1000 }),
    organizationId: fc.integer({ min: 1, max: 100 }),
    userId: fc.string({ minLength: 1, maxLength: 20 }),
    version: fc.integer({ min: 1, max: 100 }),
    epistemicStates: fc.array(epistemicEntryArb, { minLength: 0, maxLength: 10 }),
    beliefs: fc.array(misalignedBeliefArb, { minLength: 0, maxLength: 10 }),
    knowledgeGaps: fc.array(knowledgeGapArb, { minLength: 0, maxLength: 10 }),
    cognitiveState: cognitiveStateArb,
    intentModel: intentModelArb,
    oceanProfile: oceanProfileArb,
    expectations: fc.array(expectationArb, { minLength: 0, maxLength: 10 }),
    updatedAt: fc.constant(new Date()),
    createdAt: fc.constant(new Date()),
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Feature: theory-of-mind, Property 11: Context String Token Bound", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    /**
     * **Validates: Requirements 9.1, 9.4**
     *
     * For any maximally complex ToM record, the context string output
     * must be bounded to 400 tokens (charCount / 4 ≤ 400, i.e. ≤ 1600 chars).
     */
    it("output charCount / 4 ≤ 400 (token bound) for any ToM record", async () => {
        await fc.assert(
            fc.asyncProperty(maxComplexRecordArb, async (record) => {
                vi.spyOn(theoryOfMindService, "getToMState").mockResolvedValue(record);
                const result = await theoryOfMindService.getContextString(
                    record.organizationId,
                    record.userId,
                );
                expect(result.length / 4).toBeLessThanOrEqual(400);
            }),
            { numRuns: 100 },
        );
    });

    /**
     * **Validates: Requirements 9.1**
     *
     * Output character length never exceeds 1600 (the hard char limit
     * equivalent to the 400 token bound).
     */
    it("output char length ≤ 1600 for any ToM record", async () => {
        await fc.assert(
            fc.asyncProperty(maxComplexRecordArb, async (record) => {
                vi.spyOn(theoryOfMindService, "getToMState").mockResolvedValue(record);
                const result = await theoryOfMindService.getContextString(
                    record.organizationId,
                    record.userId,
                );
                expect(result.length).toBeLessThanOrEqual(1600);
            }),
            { numRuns: 100 },
        );
    });

    /**
     * **Validates: Requirements 13.3**
     *
     * When the context string has content, it must start with the distinct
     * ToM header "### THEORY OF MIND" to distinguish it from user-rep context.
     */
    it("if non-empty, starts with '### THEORY OF MIND'", async () => {
        await fc.assert(
            fc.asyncProperty(maxComplexRecordArb, async (record) => {
                vi.spyOn(theoryOfMindService, "getToMState").mockResolvedValue(record);
                const result = await theoryOfMindService.getContextString(
                    record.organizationId,
                    record.userId,
                );
                if (result.length > 0) {
                    expect(result.startsWith("### THEORY OF MIND")).toBe(true);
                }
            }),
            { numRuns: 100 },
        );
    });

    /**
     * **Validates: Requirements 9.1**
     *
     * The result is never null — it's always either an empty string or
     * valid content.
     */
    it("result is never null (either empty string or valid content)", async () => {
        await fc.assert(
            fc.asyncProperty(maxComplexRecordArb, async (record) => {
                vi.spyOn(theoryOfMindService, "getToMState").mockResolvedValue(record);
                const result = await theoryOfMindService.getContextString(
                    record.organizationId,
                    record.userId,
                );
                expect(result).not.toBeNull();
                expect(result).not.toBeUndefined();
                expect(typeof result).toBe("string");
            }),
            { numRuns: 100 },
        );
    });
});
