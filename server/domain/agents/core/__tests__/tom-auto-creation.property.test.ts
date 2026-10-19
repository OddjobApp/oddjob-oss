/**
 * Property-based test for Auto-Creation on First Interaction.
 *
 * **Property 15: Auto-Creation on First Interaction**
 *
 * For any (orgId, userId) without existing record, the first write creates a
 * record with OCEAN at 0.5, cognitive zeros, empty arrays, version=1.
 *
 * **Validates: Requirements 1.2, 12.2**
 *
 * Uses fast-check to generate random orgId/userId pairs and verifies that
 * the auto-created record has the expected default values.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import fc from "fast-check";

// ─── Hoisted Mocks ─────────────────────────────────────────────────────────

// Track what gets inserted
let capturedInsertValues: any = null;

const mockReturning = vi.fn().mockImplementation(() => {
    // Return the inserted values as if DB created them
    if (capturedInsertValues) {
        return Promise.resolve([{
            id: 1,
            ...capturedInsertValues,
            createdAt: new Date(),
            updatedAt: new Date(),
        }]);
    }
    return Promise.resolve([]);
});

const mockOnConflictDoNothing = vi.fn().mockReturnValue({
    returning: mockReturning,
});

const mockValues = vi.fn().mockImplementation((values: any) => {
    capturedInsertValues = values;
    return {
        onConflictDoNothing: mockOnConflictDoNothing,
        returning: mockReturning,
    };
});

const mockInsert = vi.fn().mockReturnValue({
    values: mockValues,
});

// SELECT returns empty (no existing record)
const mockLimit = vi.fn().mockResolvedValue([]);
const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

// UPDATE mock for the OCC write that follows readOrCreate
const mockUpdateReturning = vi.fn().mockResolvedValue([{ id: 1 }]);
const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockUpdateReturning });
const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });

vi.mock("@server/database_service.js", () => ({
    db: {
        select: () => ({
            from: () => ({
                where: () => ({
                    limit: () => Promise.resolve([]),  // No existing record
                }),
            }),
        }),
        insert: (table: any) => ({
            values: (values: any) => {
                capturedInsertValues = values;
                return {
                    onConflictDoNothing: () => ({
                        returning: () => Promise.resolve([{
                            id: 1,
                            ...values,
                            createdAt: new Date(),
                            updatedAt: new Date(),
                        }]),
                    }),
                    returning: () => Promise.resolve([{
                        id: 1,
                        ...values,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    }]),
                };
            },
        }),
        update: () => ({
            set: () => ({
                where: () => ({
                    returning: () => Promise.resolve([{ id: 1 }]),
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
    sql: Object.assign(vi.fn(), { raw: vi.fn() }),
    asc: vi.fn(),
}));

vi.mock("@shared/schema/agent/tom-archived-entries.js", () => ({
    tomArchivedEntries: {},
}));

vi.mock("../user-representation.service.js", () => ({
    userRepresentationService: {
        getRepresentation: vi.fn().mockResolvedValue(null),
    },
}));

// ─── Import under test ──────────────────────────────────────────────────────

import { theoryOfMindService } from "../theory-of-mind.service.js";

// ─── Generators ─────────────────────────────────────────────────────────────

/** Generate arbitrary orgId (positive integer) */
const orgIdArb = fc.integer({ min: 1, max: 999999 });

/** Generate arbitrary userId (non-empty string, like UUIDs or identifiers) */
const userIdArb = fc.stringOf(
    fc.constantFrom(
        "a", "b", "c", "d", "e", "f", "0", "1", "2", "3",
        "4", "5", "6", "7", "8", "9", "-",
    ),
    { minLength: 1, maxLength: 36 },
);

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("Property 15: Auto-Creation on First Interaction", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        capturedInsertValues = null;
    });

    /**
     * **Validates: Requirements 1.2, 12.2**
     *
     * For any (orgId, userId) pair where no record exists, the first write
     * triggers auto-creation via readOrCreate. The inserted record must have:
     * - version = 1
     * - OCEAN scores all at 0.5
     * - confidence = 0, observationCount = 0
     * - cognitive state: frustration=0, confusion=0, urgency=0, explorationVsGoal=50, assessedAt=null
     * - Empty arrays for: epistemicStates, beliefs, expectations, knowledgeGaps
     * - intentModel: all defaults (empty strings, zero confidence, false diverges, empty arrays)
     */
    it("first write creates record with correct default values for any orgId/userId", async () => {
        await fc.assert(
            fc.asyncProperty(
                orgIdArb,
                userIdArb,
                async (orgId, userId) => {
                    capturedInsertValues = null;

                    // Trigger a write which internally calls readOrCreate
                    // recordEpistemicEntry will attempt to create a record if none exists
                    await theoryOfMindService.recordEpistemicEntry(orgId, userId, {
                        topic: "test-topic",
                        summary: "test summary",
                        informedBy: "agent-1",
                        informedAt: new Date().toISOString(),
                    });

                    // Verify the captured insert values match expected defaults
                    expect(capturedInsertValues).not.toBeNull();
                    expect(capturedInsertValues.organizationId).toBe(orgId);
                    expect(capturedInsertValues.userId).toBe(userId);

                    // version = 1
                    expect(capturedInsertValues.version).toBe(1);

                    // OCEAN scores all at 0.5, confidence = 0, observationCount = 0
                    const ocean = capturedInsertValues.oceanProfile;
                    expect(ocean.openness).toBe(0.5);
                    expect(ocean.conscientiousness).toBe(0.5);
                    expect(ocean.extraversion).toBe(0.5);
                    expect(ocean.agreeableness).toBe(0.5);
                    expect(ocean.neuroticism).toBe(0.5);
                    expect(ocean.confidence).toBe(0);
                    expect(ocean.observationCount).toBe(0);
                    expect(ocean.lastCalibratedAt).toBeNull();

                    // Cognitive state: all zeros, explorationVsGoal=50, assessedAt=null
                    const cognitive = capturedInsertValues.cognitiveState;
                    expect(cognitive.frustration).toBe(0);
                    expect(cognitive.confusion).toBe(0);
                    expect(cognitive.urgency).toBe(0);
                    expect(cognitive.explorationVsGoal).toBe(50);
                    expect(cognitive.assessedAt).toBeNull();

                    // Empty arrays
                    expect(capturedInsertValues.epistemicStates).toEqual([]);
                    expect(capturedInsertValues.beliefs).toEqual([]);
                    expect(capturedInsertValues.expectations).toEqual([]);
                    expect(capturedInsertValues.knowledgeGaps).toEqual([]);

                    // Intent model defaults
                    const intent = capturedInsertValues.intentModel;
                    expect(intent.literalIntent).toBe("");
                    expect(intent.inferredIntent).toBe("");
                    expect(intent.inferredConfidence).toBe(0);
                    expect(intent.diverges).toBe(false);
                    expect(intent.sessionSignals).toEqual([]);
                    expect(intent.sessionId).toBe("");
                    expect(intent.updatedAt).toBeNull();
                },
            ),
            { numRuns: 100 },
        );
    });

    /**
     * **Validates: Requirements 1.2, 12.2**
     *
     * The OCEAN profile neutral baseline is universal: regardless of orgId/userId
     * combination, all five OCEAN dimensions start at exactly 0.5 (neutral),
     * representing no prior knowledge of the user's personality.
     */
    it("OCEAN profile always starts at neutral 0.5 baseline for all dimensions", async () => {
        await fc.assert(
            fc.asyncProperty(
                orgIdArb,
                userIdArb,
                async (orgId, userId) => {
                    capturedInsertValues = null;

                    await theoryOfMindService.recordEpistemicEntry(orgId, userId, {
                        topic: "any-topic",
                        summary: "any summary",
                        informedBy: "any-agent",
                        informedAt: new Date().toISOString(),
                    });

                    expect(capturedInsertValues).not.toBeNull();

                    const ocean = capturedInsertValues.oceanProfile;

                    // Each dimension is exactly 0.5 (neutral)
                    const dimensions = [
                        ocean.openness,
                        ocean.conscientiousness,
                        ocean.extraversion,
                        ocean.agreeableness,
                        ocean.neuroticism,
                    ];

                    for (const dim of dimensions) {
                        expect(dim).toBe(0.5);
                    }

                    // No prior observations
                    expect(ocean.confidence).toBe(0);
                    expect(ocean.observationCount).toBe(0);
                },
            ),
            { numRuns: 100 },
        );
    });

    /**
     * **Validates: Requirements 1.2, 12.2**
     *
     * The auto-created record's version must always be 1 (first version),
     * regardless of the orgId/userId combination used. This is the foundation
     * for the OCC (optimistic concurrency control) pattern.
     */
    it("auto-created record always has version = 1", async () => {
        await fc.assert(
            fc.asyncProperty(
                orgIdArb,
                userIdArb,
                async (orgId, userId) => {
                    capturedInsertValues = null;

                    await theoryOfMindService.recordEpistemicEntry(orgId, userId, {
                        topic: "version-check",
                        summary: "checking version",
                        informedBy: "test",
                        informedAt: new Date().toISOString(),
                    });

                    expect(capturedInsertValues).not.toBeNull();
                    expect(capturedInsertValues.version).toBe(1);
                },
            ),
            { numRuns: 100 },
        );
    });
});
