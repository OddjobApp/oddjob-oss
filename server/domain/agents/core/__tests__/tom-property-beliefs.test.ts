/**
 * Property-based test for Belief Retrieval Ordering.
 *
 * **Property 3: Belief Retrieval Ordering**
 *
 * For any set of beliefs recorded for the same topic at different timestamps,
 * `getUserBeliefs(topic)` SHALL return them sorted by `observedAt` descending
 * (most recent first), and every returned belief SHALL have a valid `alignment` status.
 *
 * **Validates: Requirements 3.1, 3.3**
 *
 * Uses fast-check for property-based testing with Vitest.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import fc from "fast-check";
import type { Belief, TheoryOfMindRecord } from "@shared/schema/agent/theory-of-mind.js";

// ─── Hoisted Mocks ─────────────────────────────────────────────────────────

const mockGetToMState = vi.hoisted(() => vi.fn());

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

import { theoryOfMindService } from "../theory-of-mind.service.js";

// ─── Generators ─────────────────────────────────────────────────────────────

const VALID_ALIGNMENTS = ["aligned", "misaligned", "unverified"] as const;

/** Generate a random ISO 8601 timestamp within a reasonable range */
const isoTimestampArb = fc.date({
    min: new Date("2020-01-01T00:00:00Z"),
    max: new Date("2030-12-31T23:59:59Z"),
}).map(d => d.toISOString());

/** Generate a valid alignment status */
const alignmentArb = fc.constantFrom(...VALID_ALIGNMENTS);

/** Generate a single Belief with a specific topic */
const beliefArb = (topic: string): fc.Arbitrary<Belief> =>
    fc.record({
        topic: fc.constant(topic),
        proposition: fc.string({ minLength: 1, maxLength: 50 }),
        confidence: fc.integer({ min: 0, max: 100 }),
        alignment: alignmentArb,
        groundTruth: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
        sourceEvidence: fc.string({ minLength: 1, maxLength: 80 }),
        observedAt: isoTimestampArb,
        pinned: fc.boolean(),
    });

/** Generate an array of beliefs sharing the same topic but with distinct timestamps */
const beliefsArrayArb = fc.string({ minLength: 1, maxLength: 20 }).chain(topic =>
    fc.array(beliefArb(topic), { minLength: 1, maxLength: 20 }),
);

/** Generate an array of beliefs with varying topics */
const mixedBeliefsArrayArb = fc.array(
    fc.string({ minLength: 1, maxLength: 15 }).chain(topic => beliefArb(topic)),
    { minLength: 1, maxLength: 30 },
);

/**
 * Build a minimal TheoryOfMindRecord with the given beliefs.
 */
function makeToMRecord(beliefs: Belief[]): TheoryOfMindRecord {
    return {
        id: 1,
        organizationId: 1,
        userId: "user-1",
        version: 1,
        epistemicStates: [],
        beliefs,
        expectations: [],
        cognitiveState: {
            frustration: 0,
            confusion: 0,
            urgency: 0,
            explorationVsGoal: 50,
            assessedAt: null,
        },
        intentModel: {
            literalIntent: "",
            inferredIntent: "",
            inferredConfidence: 0,
            diverges: false,
            sessionSignals: [],
            sessionId: "",
            updatedAt: null,
        },
        knowledgeGaps: [],
        oceanProfile: {
            openness: 0.5,
            conscientiousness: 0.5,
            extraversion: 0.5,
            agreeableness: 0.5,
            neuroticism: 0.5,
            confidence: 0,
            observationCount: 0,
            lastCalibratedAt: null,
        },
        updatedAt: new Date(),
        createdAt: new Date(),
    };
}

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("Property 3: Belief Retrieval Ordering", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    /**
     * **Validates: Requirements 3.1, 3.3**
     *
     * For any beliefs with different timestamps sharing the same topic,
     * getUserBeliefs returns them sorted by observedAt descending (most recent first).
     */
    it("returns beliefs sorted by observedAt descending for same-topic beliefs", async () => {
        await fc.assert(
            fc.asyncProperty(beliefsArrayArb, async (beliefs) => {
                // Mock getToMState to return the generated beliefs
                const mockRecord = makeToMRecord(beliefs);
                vi.spyOn(theoryOfMindService, "getToMState").mockResolvedValue(mockRecord);

                const topic = beliefs[0].topic;
                const result = await theoryOfMindService.getUserBeliefs(1, "user-1", topic);

                // Verify sorted by observedAt descending
                for (let i = 0; i < result.length - 1; i++) {
                    const timeA = new Date(result[i].observedAt).getTime();
                    const timeB = new Date(result[i + 1].observedAt).getTime();
                    expect(timeA).toBeGreaterThanOrEqual(timeB);
                }
            }),
            { numRuns: 100 },
        );
    });

    /**
     * **Validates: Requirements 3.1, 3.3**
     *
     * For any set of beliefs (mixed topics), getUserBeliefs without a topic filter
     * returns ALL beliefs sorted by observedAt descending.
     */
    it("returns all beliefs sorted by observedAt descending when no topic filter", async () => {
        await fc.assert(
            fc.asyncProperty(mixedBeliefsArrayArb, async (beliefs) => {
                const mockRecord = makeToMRecord(beliefs);
                vi.spyOn(theoryOfMindService, "getToMState").mockResolvedValue(mockRecord);

                const result = await theoryOfMindService.getUserBeliefs(1, "user-1");

                // Verify sorted by observedAt descending
                for (let i = 0; i < result.length - 1; i++) {
                    const timeA = new Date(result[i].observedAt).getTime();
                    const timeB = new Date(result[i + 1].observedAt).getTime();
                    expect(timeA).toBeGreaterThanOrEqual(timeB);
                }

                // All input beliefs should appear in result
                expect(result.length).toBe(beliefs.length);
            }),
            { numRuns: 100 },
        );
    });

    /**
     * **Validates: Requirements 3.3**
     *
     * Every returned belief has a valid alignment status ('aligned' | 'misaligned' | 'unverified').
     */
    it("every returned belief has a valid alignment status", async () => {
        await fc.assert(
            fc.asyncProperty(mixedBeliefsArrayArb, async (beliefs) => {
                const mockRecord = makeToMRecord(beliefs);
                vi.spyOn(theoryOfMindService, "getToMState").mockResolvedValue(mockRecord);

                const result = await theoryOfMindService.getUserBeliefs(1, "user-1");

                for (const belief of result) {
                    expect(VALID_ALIGNMENTS).toContain(belief.alignment);
                }
            }),
            { numRuns: 100 },
        );
    });

    /**
     * **Validates: Requirements 3.1, 3.3**
     *
     * When beliefs have identical timestamps, the result is still a valid
     * (weakly) descending sequence — no error or inconsistency occurs.
     */
    it("handles beliefs with identical timestamps without error", async () => {
        const fixedTimestamp = "2024-06-15T12:00:00.000Z";
        const duplicateTimestampBeliefs = fc.array(
            fc.record({
                topic: fc.constant("same-topic"),
                proposition: fc.string({ minLength: 1, maxLength: 30 }),
                confidence: fc.integer({ min: 0, max: 100 }),
                alignment: alignmentArb,
                groundTruth: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
                sourceEvidence: fc.string({ minLength: 1, maxLength: 40 }),
                observedAt: fc.constant(fixedTimestamp),
                pinned: fc.boolean(),
            }),
            { minLength: 2, maxLength: 10 },
        );

        await fc.assert(
            fc.asyncProperty(duplicateTimestampBeliefs, async (beliefs) => {
                const mockRecord = makeToMRecord(beliefs);
                vi.spyOn(theoryOfMindService, "getToMState").mockResolvedValue(mockRecord);

                const result = await theoryOfMindService.getUserBeliefs(1, "user-1", "same-topic");

                // All should be returned
                expect(result.length).toBe(beliefs.length);

                // All timestamps should be equal (weakly descending)
                for (let i = 0; i < result.length - 1; i++) {
                    const timeA = new Date(result[i].observedAt).getTime();
                    const timeB = new Date(result[i + 1].observedAt).getTime();
                    expect(timeA).toBeGreaterThanOrEqual(timeB);
                }

                // Valid alignment on all
                for (const belief of result) {
                    expect(VALID_ALIGNMENTS).toContain(belief.alignment);
                }
            }),
            { numRuns: 100 },
        );
    });
});
