/**
 * Property Test: Belief Misalignment Detection (Property 2)
 *
 * Feature: theory-of-mind, Property 2: Belief Misalignment Detection
 *
 * For any set of recorded beliefs and a ground-truth mapping, getMisalignedBeliefs()
 * SHALL return exactly those beliefs whose propositions contradict their corresponding
 * ground truth, each annotated with alignment: 'misaligned' and a non-empty groundTruth
 * field. Beliefs with no contradicting ground truth SHALL have alignment 'aligned' or
 * 'unverified'.
 *
 * **Validates: Requirements 3.2, 3.4**
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";
import type {
    TheoryOfMindRecord,
    Belief,
    CognitiveState,
    IntentModel,
    OceanProfile,
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
        getRepresentation: vi.fn().mockResolvedValue(null),
    },
}));

import { theoryOfMindService } from "./theory-of-mind.service.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeRecord(beliefs: Belief[]): TheoryOfMindRecord {
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

// ─── Arbitraries ────────────────────────────────────────────────────────────

/**
 * Generates a non-empty topic string.
 */
const topicArb: fc.Arbitrary<string> = fc.stringMatching(/^[a-z][a-z0-9\-]{1,20}$/);

/**
 * Generates a non-empty proposition string.
 */
const propositionArb: fc.Arbitrary<string> = fc
    .stringMatching(/^[A-Za-z][A-Za-z0-9 ]{5,40}$/)
    .filter(s => s.trim().length > 0);

/**
 * Generates a non-empty ground truth string (for misaligned beliefs).
 */
const groundTruthArb: fc.Arbitrary<string> = fc
    .stringMatching(/^[A-Za-z][A-Za-z0-9 ]{5,40}$/)
    .filter(s => s.trim().length > 0);

/**
 * Generates a confidence value in [0, 100].
 */
const confidenceArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: 100 });

/**
 * Generates a recent ISO timestamp (within the last minute to avoid decay
 * dropping confidence to zero during the test).
 */
const recentTimestampArb: fc.Arbitrary<string> = fc
    .integer({ min: 0, max: 60_000 })
    .map(offset => new Date(Date.now() - offset).toISOString());

/**
 * Generates a belief with alignment 'misaligned' — must have non-empty groundTruth.
 */
const misalignedBeliefArb: fc.Arbitrary<Belief> = fc
    .tuple(topicArb, propositionArb, confidenceArb, groundTruthArb, recentTimestampArb)
    .map(([topic, proposition, confidence, groundTruth, observedAt]) => ({
        topic,
        proposition,
        confidence,
        alignment: 'misaligned' as const,
        groundTruth,
        sourceEvidence: "user-message",
        observedAt,
        pinned: false,
    }));

/**
 * Generates a belief with alignment 'aligned' — no groundTruth needed.
 */
const alignedBeliefArb: fc.Arbitrary<Belief> = fc
    .tuple(topicArb, propositionArb, confidenceArb, recentTimestampArb)
    .map(([topic, proposition, confidence, observedAt]) => ({
        topic,
        proposition,
        confidence,
        alignment: 'aligned' as const,
        groundTruth: undefined,
        sourceEvidence: "user-message",
        observedAt,
        pinned: false,
    }));

/**
 * Generates a belief with alignment 'unverified' — no groundTruth needed.
 */
const unverifiedBeliefArb: fc.Arbitrary<Belief> = fc
    .tuple(topicArb, propositionArb, confidenceArb, recentTimestampArb)
    .map(([topic, proposition, confidence, observedAt]) => ({
        topic,
        proposition,
        confidence,
        alignment: 'unverified' as const,
        groundTruth: undefined,
        sourceEvidence: "user-message",
        observedAt,
        pinned: false,
    }));

/**
 * Generates a mixed array of beliefs with varying alignment statuses.
 */
const beliefsArrayArb: fc.Arbitrary<Belief[]> = fc.array(
    fc.oneof(
        { weight: 3, arbitrary: misalignedBeliefArb },
        { weight: 3, arbitrary: alignedBeliefArb },
        { weight: 3, arbitrary: unverifiedBeliefArb },
    ),
    { minLength: 0, maxLength: 20 },
);

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("Feature: theory-of-mind, Property 2: Belief Misalignment Detection", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("getMisalignedBeliefs returns exactly those beliefs with alignment === 'misaligned'", async () => {
        await fc.assert(
            fc.asyncProperty(beliefsArrayArb, async (beliefs) => {
                // Mock getToMState to return the generated beliefs
                vi.spyOn(theoryOfMindService, "getToMState").mockResolvedValue(makeRecord(beliefs));

                const result = await theoryOfMindService.getMisalignedBeliefs(1, "user-1");

                // Expected: exactly those beliefs whose alignment is 'misaligned'
                const expectedMisaligned = beliefs.filter(b => b.alignment === 'misaligned');

                // The result count must match
                expect(result.length).toBe(expectedMisaligned.length);

                // Every returned belief must have alignment === 'misaligned'
                for (const belief of result) {
                    expect(belief.alignment).toBe('misaligned');
                }

                // Every misaligned belief from the input must be present in the result
                // (matched by topic + proposition since those are the identifying fields)
                for (const expected of expectedMisaligned) {
                    const found = result.some(
                        r => r.topic === expected.topic && r.proposition === expected.proposition,
                    );
                    expect(found).toBe(true);
                }
            }),
            { numRuns: 100 },
        );
    });

    it("no beliefs with 'aligned' or 'unverified' alignment appear in misaligned results", async () => {
        await fc.assert(
            fc.asyncProperty(beliefsArrayArb, async (beliefs) => {
                vi.spyOn(theoryOfMindService, "getToMState").mockResolvedValue(makeRecord(beliefs));

                const result = await theoryOfMindService.getMisalignedBeliefs(1, "user-1");

                // No belief in the result should have alignment 'aligned' or 'unverified'
                for (const belief of result) {
                    expect(belief.alignment).not.toBe('aligned');
                    expect(belief.alignment).not.toBe('unverified');
                }
            }),
            { numRuns: 100 },
        );
    });

    it("all misaligned beliefs have a non-empty groundTruth field", async () => {
        await fc.assert(
            fc.asyncProperty(beliefsArrayArb, async (beliefs) => {
                vi.spyOn(theoryOfMindService, "getToMState").mockResolvedValue(makeRecord(beliefs));

                const result = await theoryOfMindService.getMisalignedBeliefs(1, "user-1");

                // Every misaligned belief must have non-empty groundTruth
                for (const belief of result) {
                    expect(belief.groundTruth).toBeDefined();
                    expect(typeof belief.groundTruth).toBe('string');
                    expect(belief.groundTruth!.length).toBeGreaterThan(0);
                }
            }),
            { numRuns: 100 },
        );
    });

    it("returns empty array when no beliefs exist", async () => {
        await fc.assert(
            fc.asyncProperty(fc.constant([]), async (beliefs: Belief[]) => {
                vi.spyOn(theoryOfMindService, "getToMState").mockResolvedValue(makeRecord(beliefs));

                const result = await theoryOfMindService.getMisalignedBeliefs(1, "user-1");
                expect(result).toEqual([]);
            }),
            { numRuns: 5 },
        );
    });

    it("returns empty array when all beliefs are aligned or unverified", async () => {
        const nonMisalignedBeliefsArb = fc.array(
            fc.oneof(alignedBeliefArb, unverifiedBeliefArb),
            { minLength: 1, maxLength: 15 },
        );

        await fc.assert(
            fc.asyncProperty(nonMisalignedBeliefsArb, async (beliefs) => {
                vi.spyOn(theoryOfMindService, "getToMState").mockResolvedValue(makeRecord(beliefs));

                const result = await theoryOfMindService.getMisalignedBeliefs(1, "user-1");
                expect(result).toEqual([]);
            }),
            { numRuns: 50 },
        );
    });
});
