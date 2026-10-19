/**
 * Property-based tests for Theory of Mind Knowledge Gap Query Ordering
 *
 * Feature: theory-of-mind
 *
 * Property tested:
 * - Property 10: Knowledge Gap Query Ordering — getKnowledgeGaps returns gaps
 *   sorted by relevanceScore descending, filtered to active goals, excluding
 *   closed gaps.
 *
 * **Validates: Requirements 7.1, 7.2**
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";
import type { TheoryOfMindRecord, KnowledgeGap, IntentModel } from "@shared/schema/agent/theory-of-mind.js";

// ─── Mock setup ─────────────────────────────────────────────────────────────

// We need to mock db, redis, logger, and user-representation before importing the service

vi.mock("@server/database_service.js", () => ({
    db: {
        select: vi.fn(() => ({
            from: vi.fn(() => ({
                where: vi.fn(() => ({
                    limit: vi.fn(async () => []),
                })),
            })),
        })),
    },
}));

vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => ({
    nodeRedisClient: {
        get: vi.fn(async () => null),
        set: vi.fn(async () => "OK"),
        setex: vi.fn(async () => "OK"),
        del: vi.fn(async () => 1),
    },
}));

vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    }),
}));

vi.mock("./user-representation.service.js", () => ({
    userRepresentationService: {
        getRepresentation: vi.fn(async () => null),
    },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
    const actual = await importOriginal() as Record<string, unknown>;
    return {
        ...actual,
        and: vi.fn((...args: any[]) => args),
        eq: vi.fn((a: any, b: any) => ({ field: a, value: b })),
        sql: actual.sql,
        asc: actual.asc,
    };
});

vi.mock("@shared/schema/agent/tom-archived-entries.js", () => ({
    tomArchivedEntries: {},
}));

// Import AFTER mocks
import { theoryOfMindService } from "./theory-of-mind.service.js";

// ─── fast-check Arbitraries ─────────────────────────────────────────────────

/** Generate a topic string (non-empty alphanumeric with spaces) */
const topicArb = fc.stringOf(
    fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz ".split("")),
    { minLength: 1, maxLength: 30 },
).filter((s) => s.trim().length > 0);

/** Generate a relatedGoal string (non-empty) */
const relatedGoalArb = fc.stringOf(
    fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz ".split("")),
    { minLength: 1, maxLength: 30 },
).filter((s) => s.trim().length > 0);

/** Generate a relevance score in [0, 100] */
const relevanceScoreArb = fc.integer({ min: 0, max: 100 });

/** Generate a detectedAt ISO string (recent past so decay is minimal for ordering tests) */
const detectedAtArb = fc.date({
    min: new Date(Date.now() - 1000), // within last second — minimal decay
    max: new Date(),
}).map((d) => d.toISOString());

/** Generate a single KnowledgeGap */
const knowledgeGapArb = (goalHint?: string): fc.Arbitrary<KnowledgeGap> =>
    fc.record({
        topic: topicArb,
        relatedGoal: goalHint ? fc.constant(goalHint) : relatedGoalArb,
        relevanceScore: relevanceScoreArb,
        dismissed: fc.boolean(),
        closedAt: fc.oneof(
            fc.constant(undefined),
            fc.date({ min: new Date("2024-01-01"), max: new Date("2025-01-01") }).map((d) => d.toISOString()),
        ),
        detectedAt: detectedAtArb,
    }) as fc.Arbitrary<KnowledgeGap>;

/** Generate an array of knowledge gaps, some matching a goal and some not */
const knowledgeGapsWithGoalArb = (goal: string) =>
    fc.tuple(
        // Gaps matching the goal
        fc.array(knowledgeGapArb(goal), { minLength: 0, maxLength: 5 }),
        // Gaps NOT matching the goal (use a clearly different relatedGoal)
        fc.array(knowledgeGapArb("zzz_unrelated_goal_xyz"), { minLength: 0, maxLength: 5 }),
    ).map(([matching, nonMatching]) => [...matching, ...nonMatching]);

/** Generate a mock TheoryOfMindRecord with specific knowledgeGaps and intentModel */
function buildMockRecord(
    knowledgeGaps: KnowledgeGap[],
    inferredIntent: string,
): TheoryOfMindRecord {
    return {
        id: 1,
        organizationId: 1,
        userId: "test-user",
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
            inferredIntent,
            inferredConfidence: 80,
            diverges: false,
            sessionSignals: [],
            sessionId: "session-1",
            updatedAt: null,
        },
        knowledgeGaps,
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

describe("Feature: theory-of-mind, Property 10: Knowledge Gap Query Ordering", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    /**
     * Property 10: Knowledge Gap Query Ordering
     *
     * For any set of knowledge gaps, getKnowledgeGaps() SHALL return gaps
     * sorted by relevanceScore descending (each element's score >= next).
     *
     * **Validates: Requirements 7.1, 7.2**
     */
    it("returns gaps sorted by relevanceScore descending regardless of input order", async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.array(knowledgeGapArb(), { minLength: 0, maxLength: 10 }),
                async (gaps) => {
                    // Ensure all gaps are non-closed for this ordering test
                    const openGaps = gaps.map((g) => ({ ...g, closedAt: undefined }));

                    const mockRecord = buildMockRecord(openGaps, "");
                    vi.spyOn(theoryOfMindService, "getToMState").mockResolvedValue(mockRecord);

                    const result = await theoryOfMindService.getKnowledgeGaps(1, "test-user");

                    // Assert sorted descending by relevanceScore
                    for (let i = 0; i < result.length - 1; i++) {
                        expect(result[i].relevanceScore).toBeGreaterThanOrEqual(result[i + 1].relevanceScore);
                    }
                },
            ),
            { numRuns: 100 },
        );
    });

    /**
     * Property 10: Knowledge Gap Query Ordering
     *
     * Closed gaps (closedAt is set) are NOT in the returned array.
     *
     * **Validates: Requirements 7.1, 7.2**
     */
    it("excludes closed gaps from the result", async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.array(knowledgeGapArb(), { minLength: 1, maxLength: 10 }),
                async (gaps) => {
                    const mockRecord = buildMockRecord(gaps, "");
                    vi.spyOn(theoryOfMindService, "getToMState").mockResolvedValue(mockRecord);

                    const result = await theoryOfMindService.getKnowledgeGaps(1, "test-user");

                    // No returned gap should have closedAt set
                    for (const gap of result) {
                        expect(gap.closedAt).toBeUndefined();
                    }
                },
            ),
            { numRuns: 100 },
        );
    });

    /**
     * Property 10: Knowledge Gap Query Ordering
     *
     * All returned gaps have non-null topics and valid relevance scores (0-100).
     *
     * **Validates: Requirements 7.1, 7.2**
     */
    it("all returned gaps have non-null topics and valid relevance scores", async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.array(knowledgeGapArb(), { minLength: 0, maxLength: 10 }),
                async (gaps) => {
                    // Ensure all gaps are open for this test
                    const openGaps = gaps.map((g) => ({ ...g, closedAt: undefined }));
                    const mockRecord = buildMockRecord(openGaps, "");
                    vi.spyOn(theoryOfMindService, "getToMState").mockResolvedValue(mockRecord);

                    const result = await theoryOfMindService.getKnowledgeGaps(1, "test-user");

                    for (const gap of result) {
                        expect(gap.topic).toBeDefined();
                        expect(gap.topic.length).toBeGreaterThan(0);
                        expect(gap.relevanceScore).toBeGreaterThanOrEqual(0);
                        expect(gap.relevanceScore).toBeLessThanOrEqual(100);
                    }
                },
            ),
            { numRuns: 100 },
        );
    });

    /**
     * Property 10: Knowledge Gap Query Ordering
     *
     * When an active goal (inferredIntent) is set, getKnowledgeGaps prefers
     * gaps whose relatedGoal matches the active goal. If matching gaps exist,
     * only those are returned.
     *
     * **Validates: Requirements 7.1, 7.2**
     */
    it("filters to gaps matching active goal when active goal is set and matches exist", async () => {
        await fc.assert(
            fc.asyncProperty(
                relatedGoalArb,
                async (activeGoal) => {
                    // Build gaps: some matching the goal, some clearly unrelated
                    const matchingGap: KnowledgeGap = {
                        topic: "matching-topic",
                        relatedGoal: activeGoal,
                        relevanceScore: 80,
                        dismissed: false,
                        closedAt: undefined,
                        detectedAt: new Date().toISOString(),
                    };
                    const unrelatedGap: KnowledgeGap = {
                        topic: "unrelated-topic",
                        relatedGoal: "zzz_completely_different_unrelated_xyz",
                        relevanceScore: 90,
                        dismissed: false,
                        closedAt: undefined,
                        detectedAt: new Date().toISOString(),
                    };

                    const mockRecord = buildMockRecord([matchingGap, unrelatedGap], activeGoal);
                    vi.spyOn(theoryOfMindService, "getToMState").mockResolvedValue(mockRecord);

                    const result = await theoryOfMindService.getKnowledgeGaps(1, "test-user");

                    // The active goal filtering should prefer matching gaps
                    // Since matching gaps exist, the unrelated one should be excluded
                    for (const gap of result) {
                        const goalLower = activeGoal.toLowerCase();
                        const gapGoalLower = gap.relatedGoal.toLowerCase();
                        expect(
                            gapGoalLower.includes(goalLower) || goalLower.includes(gapGoalLower),
                        ).toBe(true);
                    }
                },
            ),
            { numRuns: 100 },
        );
    });

    /**
     * Property 10: Knowledge Gap Query Ordering
     *
     * When no active goal (inferredIntent is empty), all non-closed gaps are
     * returned sorted by relevanceScore descending.
     *
     * **Validates: Requirements 7.1, 7.2**
     */
    it("returns all non-closed gaps sorted descending when no active goal is set", async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.array(knowledgeGapArb(), { minLength: 1, maxLength: 10 }),
                async (gaps) => {
                    // Ensure all gaps are open
                    const openGaps = gaps.map((g) => ({ ...g, closedAt: undefined }));
                    const mockRecord = buildMockRecord(openGaps, ""); // empty inferredIntent

                    vi.spyOn(theoryOfMindService, "getToMState").mockResolvedValue(mockRecord);

                    const result = await theoryOfMindService.getKnowledgeGaps(1, "test-user");

                    // All open gaps should be present (no filtering by goal)
                    expect(result.length).toBe(openGaps.length);

                    // And sorted descending
                    for (let i = 0; i < result.length - 1; i++) {
                        expect(result[i].relevanceScore).toBeGreaterThanOrEqual(result[i + 1].relevanceScore);
                    }
                },
            ),
            { numRuns: 100 },
        );
    });
});
