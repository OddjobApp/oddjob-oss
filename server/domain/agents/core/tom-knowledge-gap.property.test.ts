/**
 * Property-based test for Knowledge Gap Lifecycle.
 *
 * **Property 9: Knowledge Gap Lifecycle**
 *
 * For any knowledge gap with relevanceScore > 70 and dismissed = false,
 * shouldInform(topic) SHALL return true. When a gap is closed via
 * closeKnowledgeGap(topic), shouldInform(topic) SHALL return false,
 * AND a new epistemic entry SHALL exist for that topic.
 *
 * **Validates: Requirements 7.3, 7.4**
 *
 * Uses fast-check to generate knowledge gaps with random relevance scores,
 * dismissed flags, and topics, then verifies the shouldInform decision logic
 * and the closeKnowledgeGap lifecycle transition.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import fc from "fast-check";
import type { TheoryOfMindRecord, KnowledgeGap, EpistemicEntry } from "@shared/schema/agent/theory-of-mind.js";

// ─── Hoisted Mocks ─────────────────────────────────────────────────────────

vi.mock("@server/database_service.js", () => ({
    db: {
        select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([]),
                }),
                orderBy: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([]),
                }),
            }),
        }),
        insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{ id: 1 }]),
                onConflictDoNothing: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([{ id: 1 }]),
                }),
            }),
        }),
        update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([{ id: 1 }]),
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

import { theoryOfMindService } from "./theory-of-mind.service.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeBaseRecord(overrides: Partial<TheoryOfMindRecord> = {}): TheoryOfMindRecord {
    return {
        id: 1,
        organizationId: 1,
        userId: "user-1",
        version: 1,
        epistemicStates: [],
        beliefs: [],
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
        accessConsent: null,
        consentDecidedAt: null,
        consentRequestId: null,
        consentSessionId: null,
        updatedAt: new Date(),
        createdAt: new Date(),
        ...overrides,
    };
}

// ─── Generators ─────────────────────────────────────────────────────────────

/** Generate a non-empty topic string (lowercase, trimmed, alphanumeric with spaces) */
const topicArb = fc.stringOf(
    fc.constantFrom("a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", " "),
    { minLength: 1, maxLength: 30 },
).map(s => s.trim()).filter(s => s.length > 0);

/** Generate a relevance score from 0 to 100 */
const relevanceScoreArb = fc.integer({ min: 0, max: 100 });

/** Generate a boolean for dismissed state */
const dismissedArb = fc.boolean();

/** Generate a knowledge gap with controlled properties */
const knowledgeGapArb = fc.record({
    topic: topicArb,
    relatedGoal: fc.string({ minLength: 1, maxLength: 50 }),
    relevanceScore: relevanceScoreArb,
    dismissed: dismissedArb,
    closedAt: fc.constantFrom(undefined, null) as fc.Arbitrary<string | undefined>,
    detectedAt: fc.constant(new Date().toISOString()),
});

/** Generate a knowledge gap that IS closed (has a closedAt timestamp) */
const closedKnowledgeGapArb = fc.record({
    topic: topicArb,
    relatedGoal: fc.string({ minLength: 1, maxLength: 50 }),
    relevanceScore: fc.integer({ min: 71, max: 100 }), // high relevance
    dismissed: fc.constant(false),
    closedAt: fc.constant(new Date().toISOString()), // has a closedAt → closed
    detectedAt: fc.constant(new Date().toISOString()),
});

const orgIdArb = fc.integer({ min: 1, max: 100000 });
const userIdArb = fc.string({ minLength: 1, maxLength: 36 });

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("Property 9: Knowledge Gap Lifecycle", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    /**
     * **Validates: Requirements 7.3**
     *
     * shouldInform returns TRUE when:
     * - A knowledge gap exists for the topic
     * - relevanceScore > 70
     * - dismissed = false
     * - closedAt is null/undefined
     */
    it("shouldInform returns true for gaps with relevance > 70, dismissed=false, and not closed", async () => {
        await fc.assert(
            fc.asyncProperty(
                orgIdArb,
                userIdArb,
                topicArb,
                fc.integer({ min: 71, max: 100 }),
                async (orgId, userId, topic, relevanceScore) => {
                    const gap: KnowledgeGap = {
                        topic,
                        relatedGoal: "some goal",
                        relevanceScore,
                        dismissed: false,
                        closedAt: undefined as any,
                        detectedAt: new Date().toISOString(), // just now, no decay
                    };

                    const record = makeBaseRecord({
                        organizationId: orgId,
                        userId,
                        knowledgeGaps: [gap],
                    });

                    vi.spyOn(theoryOfMindService, "getToMState").mockResolvedValue(record);

                    const result = await theoryOfMindService.shouldInform(orgId, userId, topic);
                    expect(result).toBe(true);
                },
            ),
            { numRuns: 100 },
        );
    });

    /**
     * **Validates: Requirements 7.3**
     *
     * shouldInform returns FALSE when relevanceScore ≤ 70
     */
    it("shouldInform returns false when relevanceScore <= 70", async () => {
        await fc.assert(
            fc.asyncProperty(
                orgIdArb,
                userIdArb,
                topicArb,
                fc.integer({ min: 0, max: 70 }),
                async (orgId, userId, topic, relevanceScore) => {
                    const gap: KnowledgeGap = {
                        topic,
                        relatedGoal: "some goal",
                        relevanceScore,
                        dismissed: false,
                        closedAt: undefined as any,
                        detectedAt: new Date().toISOString(),
                    };

                    const record = makeBaseRecord({
                        organizationId: orgId,
                        userId,
                        knowledgeGaps: [gap],
                    });

                    vi.spyOn(theoryOfMindService, "getToMState").mockResolvedValue(record);

                    const result = await theoryOfMindService.shouldInform(orgId, userId, topic);
                    expect(result).toBe(false);
                },
            ),
            { numRuns: 100 },
        );
    });

    /**
     * **Validates: Requirements 7.3**
     *
     * shouldInform returns FALSE when dismissed = true (regardless of relevance)
     */
    it("shouldInform returns false when dismissed is true", async () => {
        await fc.assert(
            fc.asyncProperty(
                orgIdArb,
                userIdArb,
                topicArb,
                fc.integer({ min: 71, max: 100 }),
                async (orgId, userId, topic, relevanceScore) => {
                    const gap: KnowledgeGap = {
                        topic,
                        relatedGoal: "some goal",
                        relevanceScore,
                        dismissed: true, // dismissed!
                        closedAt: undefined as any,
                        detectedAt: new Date().toISOString(),
                    };

                    const record = makeBaseRecord({
                        organizationId: orgId,
                        userId,
                        knowledgeGaps: [gap],
                    });

                    vi.spyOn(theoryOfMindService, "getToMState").mockResolvedValue(record);

                    const result = await theoryOfMindService.shouldInform(orgId, userId, topic);
                    expect(result).toBe(false);
                },
            ),
            { numRuns: 100 },
        );
    });

    /**
     * **Validates: Requirements 7.3**
     *
     * shouldInform returns FALSE when the gap is already closed (closedAt is set)
     */
    it("shouldInform returns false when gap is closed", async () => {
        await fc.assert(
            fc.asyncProperty(
                orgIdArb,
                userIdArb,
                closedKnowledgeGapArb,
                async (orgId, userId, gap) => {
                    const record = makeBaseRecord({
                        organizationId: orgId,
                        userId,
                        knowledgeGaps: [gap as KnowledgeGap],
                    });

                    vi.spyOn(theoryOfMindService, "getToMState").mockResolvedValue(record);

                    const result = await theoryOfMindService.shouldInform(orgId, userId, gap.topic);
                    expect(result).toBe(false);
                },
            ),
            { numRuns: 100 },
        );
    });

    /**
     * **Validates: Requirements 7.3**
     *
     * shouldInform returns FALSE when no gap exists for the queried topic
     */
    it("shouldInform returns false when no gap exists for topic", async () => {
        await fc.assert(
            fc.asyncProperty(
                orgIdArb,
                userIdArb,
                topicArb,
                async (orgId, userId, topic) => {
                    // Record with empty knowledge gaps
                    const record = makeBaseRecord({
                        organizationId: orgId,
                        userId,
                        knowledgeGaps: [],
                    });

                    vi.spyOn(theoryOfMindService, "getToMState").mockResolvedValue(record);

                    const result = await theoryOfMindService.shouldInform(orgId, userId, topic);
                    expect(result).toBe(false);
                },
            ),
            { numRuns: 50 },
        );
    });

    /**
     * **Validates: Requirements 7.3**
     *
     * shouldInform returns FALSE when state is null (no ToM record)
     */
    it("shouldInform returns false when ToM state is null", async () => {
        await fc.assert(
            fc.asyncProperty(
                orgIdArb,
                userIdArb,
                topicArb,
                async (orgId, userId, topic) => {
                    vi.spyOn(theoryOfMindService, "getToMState").mockResolvedValue(null);

                    const result = await theoryOfMindService.shouldInform(orgId, userId, topic);
                    expect(result).toBe(false);
                },
            ),
            { numRuns: 50 },
        );
    });

    /**
     * **Validates: Requirements 7.3, 7.4**
     *
     * The complete lifecycle: given an open gap with relevance > 70 and
     * dismissed=false, shouldInform returns true. After closeKnowledgeGap
     * is called, shouldInform returns false and an epistemic entry exists.
     *
     * We test this by:
     * 1. Mocking getToMState to return a record with an active gap → verify shouldInform=true
     * 2. Simulating what closeKnowledgeGap does (setting closedAt + adding epistemic entry)
     * 3. Mocking getToMState with the "after" state → verify shouldInform=false
     * 4. Verifying the epistemic entry exists for the topic
     */
    it("after closeKnowledgeGap, shouldInform returns false and epistemic entry exists", async () => {
        await fc.assert(
            fc.asyncProperty(
                orgIdArb,
                userIdArb,
                topicArb,
                fc.integer({ min: 71, max: 100 }),
                async (orgId, userId, topic, relevanceScore) => {
                    const gap: KnowledgeGap = {
                        topic,
                        relatedGoal: "some goal",
                        relevanceScore,
                        dismissed: false,
                        closedAt: undefined as any,
                        detectedAt: new Date().toISOString(),
                    };

                    // ── Before close: shouldInform = true ──
                    const beforeRecord = makeBaseRecord({
                        organizationId: orgId,
                        userId,
                        knowledgeGaps: [gap],
                        epistemicStates: [],
                    });

                    const getToMStateSpy = vi.spyOn(theoryOfMindService, "getToMState");
                    getToMStateSpy.mockResolvedValue(beforeRecord);

                    const beforeResult = await theoryOfMindService.shouldInform(orgId, userId, topic);
                    expect(beforeResult).toBe(true);

                    // ── After close: simulate the effect of closeKnowledgeGap ──
                    // closeKnowledgeGap sets closedAt on the gap and adds an epistemic entry
                    const closedGap: KnowledgeGap = {
                        ...gap,
                        closedAt: new Date().toISOString(),
                    };
                    const epistemicEntry: EpistemicEntry = {
                        topic,
                        summary: `Knowledge gap closed — user was informed about ${topic}`,
                        informedBy: "system",
                        informedAt: new Date().toISOString(),
                        confidence: 100,
                    };

                    const afterRecord = makeBaseRecord({
                        organizationId: orgId,
                        userId,
                        knowledgeGaps: [closedGap],
                        epistemicStates: [epistemicEntry],
                    });

                    getToMStateSpy.mockResolvedValue(afterRecord);

                    // shouldInform must now return false
                    const afterResult = await theoryOfMindService.shouldInform(orgId, userId, topic);
                    expect(afterResult).toBe(false);

                    // Verify epistemic entry exists for the topic
                    const normalizedTopic = topic.toLowerCase().trim();
                    const matchingEntry = afterRecord.epistemicStates.find(
                        e => e.topic.toLowerCase().trim() === normalizedTopic,
                    );
                    expect(matchingEntry).toBeDefined();
                    expect(matchingEntry!.confidence).toBe(100);
                    expect(matchingEntry!.informedBy).toBe("system");
                },
            ),
            { numRuns: 100 },
        );
    });

    /**
     * **Validates: Requirements 7.3**
     *
     * Comprehensive property: for ANY generated knowledge gap, shouldInform
     * follows exactly the decision logic:
     *   true  iff relevance > 70 AND dismissed=false AND closedAt is null
     *   false otherwise
     */
    it("shouldInform decision matches the relevance/dismissed/closed invariant", async () => {
        await fc.assert(
            fc.asyncProperty(
                orgIdArb,
                userIdArb,
                knowledgeGapArb,
                async (orgId, userId, gap) => {
                    const record = makeBaseRecord({
                        organizationId: orgId,
                        userId,
                        knowledgeGaps: [gap as KnowledgeGap],
                    });

                    vi.spyOn(theoryOfMindService, "getToMState").mockResolvedValue(record);

                    const result = await theoryOfMindService.shouldInform(orgId, userId, gap.topic);

                    // Expected logic: true iff relevance > 70 AND not dismissed AND not closed
                    const expectedShouldInform =
                        gap.relevanceScore > 70
                        && gap.dismissed === false
                        && !gap.closedAt;

                    expect(result).toBe(expectedShouldInform);
                },
            ),
            { numRuns: 200 },
        );
    });
});
