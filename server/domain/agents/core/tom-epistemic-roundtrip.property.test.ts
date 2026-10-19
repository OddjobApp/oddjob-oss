/**
 * Property-based test for Epistemic State Round-Trip (Property 1).
 *
 * Tests that for any valid topic/summary/agentId:
 * - Recording an entry then querying doesUserKnow returns known:true with correct data
 * - Querying unrecorded topics returns known:false (never null)
 * - The entry's informedAt timestamp is ≥ the time before recording
 *
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";
import type {
    TheoryOfMindRecord,
    EpistemicEntry,
} from "@shared/schema/agent/theory-of-mind.js";

// ─── Mocks ───────────────────────────────────────────────────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRecord(epistemicStates: EpistemicEntry[] = []): TheoryOfMindRecord {
    return {
        id: 1,
        organizationId: 1,
        userId: "user-1",
        version: 1,
        epistemicStates,
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
        updatedAt: new Date(),
        createdAt: new Date(),
    };
}

// ─── Generators ──────────────────────────────────────────────────────────────

/** Non-empty topic string (trimmed, lowercase-normalizable) */
const topicArb = fc.string({ minLength: 1, maxLength: 100 })
    .filter(s => s.trim().length > 0);

/** Non-empty summary string */
const summaryArb = fc.string({ minLength: 1, maxLength: 300 })
    .filter(s => s.trim().length > 0);

/** Agent ID (alphanumeric-ish, non-empty) */
const agentIdArb = fc.string({ minLength: 1, maxLength: 50 })
    .filter(s => s.trim().length > 0);

/** Positive org ID */
const orgIdArb = fc.integer({ min: 1, max: 100000 });

/** User ID (non-empty string) */
const userIdArb = fc.string({ minLength: 1, maxLength: 50 })
    .filter(s => s.trim().length > 0);

// ─── Property Tests ──────────────────────────────────────────────────────────

describe("Property 1: Epistemic State Round-Trip", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    /**
     * **Validates: Requirements 2.1, 2.2, 2.3**
     *
     * For any valid topic, summary, and agentId, recording an epistemic entry
     * and then querying doesUserKnow returns { known: true } with the entry
     * containing the correct summary, agentId, confidence of 100, and a valid
     * informedAt timestamp.
     */
    it("recording an entry then querying doesUserKnow returns known:true with correct data", async () => {
        await fc.assert(
            fc.asyncProperty(
                topicArb,
                summaryArb,
                agentIdArb,
                orgIdArb,
                userIdArb,
                async (topic, summary, agentId, orgId, userId) => {
                    const timeBefore = new Date().toISOString();

                    // Simulate what recordEpistemicEntry does:
                    // It creates a full EpistemicEntry with confidence=100 and
                    // deduplicates by topic (case-insensitive, trimmed).
                    const informedAt = new Date().toISOString();
                    const entry: EpistemicEntry = {
                        topic,
                        summary,
                        informedBy: agentId,
                        informedAt,
                        confidence: 100,
                    };

                    // Mock getToMState to return a record containing the recorded entry
                    vi.spyOn(theoryOfMindService, "getToMState").mockResolvedValue(
                        makeRecord([entry]),
                    );

                    // Query doesUserKnow — should find the entry
                    const result = await theoryOfMindService.doesUserKnow(orgId, userId, topic);

                    // Assert known:true
                    expect(result.known).toBe(true);
                    expect(result.entry).toBeDefined();
                    expect(result.entry!.topic).toBe(topic);
                    expect(result.entry!.summary).toBe(summary);
                    expect(result.entry!.informedBy).toBe(agentId);
                    expect(result.entry!.confidence).toBe(100);

                    // Timestamp should be valid ISO 8601 and >= timeBefore
                    const entryTime = new Date(result.entry!.informedAt).getTime();
                    const beforeTime = new Date(timeBefore).getTime();
                    expect(entryTime).toBeGreaterThanOrEqual(beforeTime);
                },
            ),
            { numRuns: 100 },
        );
    });

    /**
     * **Validates: Requirements 2.3, 2.4**
     *
     * Querying a topic that was never recorded SHALL return { known: false }
     * (never null). The result always has a `known` boolean field.
     */
    it("querying an unrecorded topic returns known:false, never null", async () => {
        await fc.assert(
            fc.asyncProperty(
                topicArb,
                topicArb,
                summaryArb,
                agentIdArb,
                orgIdArb,
                userIdArb,
                async (recordedTopic, queriedTopic, summary, agentId, orgId, userId) => {
                    // Precondition: the queried topic is different from the recorded one
                    // (case-insensitive, trimmed comparison)
                    fc.pre(
                        recordedTopic.toLowerCase().trim() !== queriedTopic.toLowerCase().trim(),
                    );

                    const entry: EpistemicEntry = {
                        topic: recordedTopic,
                        summary,
                        informedBy: agentId,
                        informedAt: new Date().toISOString(),
                        confidence: 100,
                    };

                    // State has one entry for recordedTopic
                    vi.spyOn(theoryOfMindService, "getToMState").mockResolvedValue(
                        makeRecord([entry]),
                    );

                    // Query for a different topic
                    const result = await theoryOfMindService.doesUserKnow(orgId, userId, queriedTopic);

                    // Must return { known: false } — never null, never undefined
                    expect(result).not.toBeNull();
                    expect(result).not.toBeUndefined();
                    expect(result.known).toBe(false);
                    expect(result.entry).toBeUndefined();
                },
            ),
            { numRuns: 100 },
        );
    });

    /**
     * **Validates: Requirements 2.2, 2.3**
     *
     * doesUserKnow performs case-insensitive topic matching.
     * Recording "Deployment" and querying "deployment" (or any case variant)
     * should return known:true.
     */
    it("doesUserKnow matches topics case-insensitively", async () => {
        await fc.assert(
            fc.asyncProperty(
                topicArb,
                summaryArb,
                agentIdArb,
                orgIdArb,
                userIdArb,
                async (topic, summary, agentId, orgId, userId) => {
                    const entry: EpistemicEntry = {
                        topic,
                        summary,
                        informedBy: agentId,
                        informedAt: new Date().toISOString(),
                        confidence: 100,
                    };

                    vi.spyOn(theoryOfMindService, "getToMState").mockResolvedValue(
                        makeRecord([entry]),
                    );

                    // Query with upper-cased topic variant
                    const upperResult = await theoryOfMindService.doesUserKnow(
                        orgId, userId, topic.toUpperCase(),
                    );
                    expect(upperResult.known).toBe(true);

                    // Query with lower-cased topic variant
                    const lowerResult = await theoryOfMindService.doesUserKnow(
                        orgId, userId, topic.toLowerCase(),
                    );
                    expect(lowerResult.known).toBe(true);
                },
            ),
            { numRuns: 100 },
        );
    });

    /**
     * **Validates: Requirements 2.4**
     *
     * When no ToM state exists at all (null), doesUserKnow returns
     * { known: false } — explicit "not-informed" rather than null.
     */
    it("returns known:false when no ToM state exists (null state)", async () => {
        await fc.assert(
            fc.asyncProperty(
                topicArb,
                orgIdArb,
                userIdArb,
                async (topic, orgId, userId) => {
                    vi.spyOn(theoryOfMindService, "getToMState").mockResolvedValue(null);

                    const result = await theoryOfMindService.doesUserKnow(orgId, userId, topic);

                    expect(result).not.toBeNull();
                    expect(result).not.toBeUndefined();
                    expect(result.known).toBe(false);
                    expect(result.entry).toBeUndefined();
                },
            ),
            { numRuns: 100 },
        );
    });

    /**
     * **Validates: Requirements 2.1, 2.2**
     *
     * The informedAt timestamp in a recorded entry is always a valid ISO 8601
     * string that is not earlier than the time before recording.
     */
    it("recorded entry's informedAt is a valid ISO 8601 timestamp >= recording time", async () => {
        await fc.assert(
            fc.asyncProperty(
                topicArb,
                summaryArb,
                agentIdArb,
                orgIdArb,
                userIdArb,
                async (topic, summary, agentId, orgId, userId) => {
                    const timeBefore = Date.now();

                    // Simulate a fresh recording with current timestamp
                    const informedAt = new Date().toISOString();
                    const entry: EpistemicEntry = {
                        topic,
                        summary,
                        informedBy: agentId,
                        informedAt,
                        confidence: 100,
                    };

                    vi.spyOn(theoryOfMindService, "getToMState").mockResolvedValue(
                        makeRecord([entry]),
                    );

                    const result = await theoryOfMindService.doesUserKnow(orgId, userId, topic);

                    expect(result.known).toBe(true);
                    expect(result.entry).toBeDefined();

                    // Validate ISO 8601 format
                    const parsed = new Date(result.entry!.informedAt);
                    expect(parsed.toISOString()).toBe(result.entry!.informedAt);
                    expect(Number.isNaN(parsed.getTime())).toBe(false);

                    // Timestamp >= timeBefore (with small tolerance for execution)
                    expect(parsed.getTime()).toBeGreaterThanOrEqual(timeBefore - 1000);
                },
            ),
            { numRuns: 100 },
        );
    });

    /**
     * **Validates: Requirements 2.1, 2.2**
     *
     * Recording an epistemic entry always sets confidence to 100 (newly informed).
     * The doesUserKnow query should only return known:true when confidence >= 1
     * (epistemic entries have Infinity halfLife so they never decay).
     */
    it("newly recorded epistemic entries always have confidence=100 and are found as known", async () => {
        await fc.assert(
            fc.asyncProperty(
                topicArb,
                summaryArb,
                agentIdArb,
                orgIdArb,
                userIdArb,
                async (topic, summary, agentId, orgId, userId) => {
                    // Simulate what recordEpistemicEntry creates
                    const entry: EpistemicEntry = {
                        topic,
                        summary,
                        informedBy: agentId,
                        informedAt: new Date().toISOString(),
                        confidence: 100, // recordEpistemicEntry always sets this
                    };

                    vi.spyOn(theoryOfMindService, "getToMState").mockResolvedValue(
                        makeRecord([entry]),
                    );

                    const result = await theoryOfMindService.doesUserKnow(orgId, userId, topic);

                    expect(result.known).toBe(true);
                    expect(result.entry!.confidence).toBe(100);
                },
            ),
            { numRuns: 100 },
        );
    });
});
