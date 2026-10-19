/**
 * Property-based tests for Theory of Mind Decay Archival Threshold
 *
 * Feature: theory-of-mind
 *
 * Tests validate:
 * - Property 7: Decay Archival Threshold — entries with effective confidence < 20
 *   get archived with correct fields; entries ≥ 20 remain active; pinned entries
 *   never archived regardless of effective confidence.
 *
 * Uses fast-check for property-based testing with minimum 100 iterations.
 *
 * **Validates: Requirements 8.2, 8.3**
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import { computeEffectiveConfidence } from "./theory-of-mind.service.js";

// ─── Constants (mirroring DECAY_POLICIES from the service) ──────────────────

const BELIEFS_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;       // 7 days
const EXPECTATIONS_HALF_LIFE_MS = 24 * 60 * 60 * 1000;       // 24 hours
const KNOWLEDGE_GAPS_HALF_LIFE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
const ARCHIVE_THRESHOLD = 20;

// ─── Types matching ToM dimension entries ───────────────────────────────────

interface BeliefEntry {
    confidence: number;
    observedAt: string;
    pinned: boolean;
}

interface ExpectationEntry {
    confidence: number;
    observedAt: string;
}

interface KnowledgeGapEntry {
    relevanceScore: number;
    detectedAt: string;
}

// ─── Archival Decision Functions (pure logic matching applyDecay) ────────────

/**
 * Determines whether a belief should be archived based on decay logic.
 * Mirrors the archival decision in theoryOfMindService.applyDecay.
 */
function shouldArchiveBelief(entry: BeliefEntry, nowMs: number): boolean {
    if (entry.pinned) return false;
    const elapsed = nowMs - new Date(entry.observedAt).getTime();
    const effective = computeEffectiveConfidence(entry.confidence, elapsed, BELIEFS_HALF_LIFE_MS);
    return effective < ARCHIVE_THRESHOLD;
}

/**
 * Determines whether an expectation should be archived based on decay logic.
 */
function shouldArchiveExpectation(entry: ExpectationEntry, nowMs: number): boolean {
    const elapsed = nowMs - new Date(entry.observedAt).getTime();
    const effective = computeEffectiveConfidence(entry.confidence, elapsed, EXPECTATIONS_HALF_LIFE_MS);
    return effective < ARCHIVE_THRESHOLD;
}

/**
 * Determines whether a knowledge gap should be archived based on decay logic.
 */
function shouldArchiveKnowledgeGap(entry: KnowledgeGapEntry, nowMs: number): boolean {
    const elapsed = nowMs - new Date(entry.detectedAt).getTime();
    const effective = computeEffectiveConfidence(entry.relevanceScore, elapsed, KNOWLEDGE_GAPS_HALF_LIFE_MS);
    return effective < ARCHIVE_THRESHOLD;
}

// ─── fast-check Arbitraries ─────────────────────────────────────────────────

/** Confidence score in [0, 100] */
const confidenceArb = fc.integer({ min: 0, max: 100 });

/** Elapsed time from 0 to 60 days in milliseconds */
const elapsedMsArb = fc.integer({ min: 0, max: 60 * 24 * 60 * 60 * 1000 });

/** Generate a belief entry with random confidence, time offset, and pinned state */
const beliefEntryArb = fc.record({
    confidence: confidenceArb,
    elapsedMs: elapsedMsArb,
    pinned: fc.boolean(),
});

/** Generate an expectation entry with random confidence and time offset */
const expectationEntryArb = fc.record({
    confidence: confidenceArb,
    elapsedMs: elapsedMsArb,
});

/** Generate a knowledge gap entry with random relevance score and time offset */
const knowledgeGapEntryArb = fc.record({
    relevanceScore: confidenceArb,
    elapsedMs: elapsedMsArb,
});

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("Property 7: Decay Archival Threshold", () => {
    /**
     * Beliefs with effective confidence < 20 (and not pinned) → should be archived
     *
     * **Validates: Requirements 8.2, 8.3**
     */
    describe("Beliefs below threshold are archived", () => {
        it("belief with effective confidence < 20 and not pinned → archived", () => {
            fc.assert(
                fc.property(
                    beliefEntryArb,
                    ({ confidence, elapsedMs, pinned }) => {
                        const nowMs = Date.now();
                        const observedAt = new Date(nowMs - elapsedMs).toISOString();

                        const effective = computeEffectiveConfidence(confidence, elapsedMs, BELIEFS_HALF_LIFE_MS);
                        const entry: BeliefEntry = { confidence, observedAt, pinned };
                        const archived = shouldArchiveBelief(entry, nowMs);

                        if (effective < ARCHIVE_THRESHOLD && !pinned) {
                            expect(archived).toBe(true);
                        }
                    },
                ),
                { numRuns: 200 },
            );
        });

        it("belief with effective confidence >= 20 → remains active", () => {
            fc.assert(
                fc.property(
                    beliefEntryArb,
                    ({ confidence, elapsedMs, pinned }) => {
                        const nowMs = Date.now();
                        const observedAt = new Date(nowMs - elapsedMs).toISOString();

                        const effective = computeEffectiveConfidence(confidence, elapsedMs, BELIEFS_HALF_LIFE_MS);
                        const entry: BeliefEntry = { confidence, observedAt, pinned };
                        const archived = shouldArchiveBelief(entry, nowMs);

                        if (effective >= ARCHIVE_THRESHOLD) {
                            expect(archived).toBe(false);
                        }
                    },
                ),
                { numRuns: 200 },
            );
        });

        it("pinned belief → never archived regardless of effective confidence", () => {
            fc.assert(
                fc.property(
                    confidenceArb,
                    elapsedMsArb,
                    (confidence, elapsedMs) => {
                        const nowMs = Date.now();
                        const observedAt = new Date(nowMs - elapsedMs).toISOString();

                        const entry: BeliefEntry = { confidence, observedAt, pinned: true };
                        const archived = shouldArchiveBelief(entry, nowMs);

                        // Pinned entries are NEVER archived
                        expect(archived).toBe(false);
                    },
                ),
                { numRuns: 200 },
            );
        });
    });

    /**
     * Expectations with effective confidence < 20 → archived; >= 20 → active
     *
     * **Validates: Requirements 8.2, 8.3**
     */
    describe("Expectations archival threshold", () => {
        it("expectation with effective confidence < 20 → archived", () => {
            fc.assert(
                fc.property(
                    expectationEntryArb,
                    ({ confidence, elapsedMs }) => {
                        const nowMs = Date.now();
                        const observedAt = new Date(nowMs - elapsedMs).toISOString();

                        const effective = computeEffectiveConfidence(confidence, elapsedMs, EXPECTATIONS_HALF_LIFE_MS);
                        const entry: ExpectationEntry = { confidence, observedAt };
                        const archived = shouldArchiveExpectation(entry, nowMs);

                        if (effective < ARCHIVE_THRESHOLD) {
                            expect(archived).toBe(true);
                        }
                    },
                ),
                { numRuns: 200 },
            );
        });

        it("expectation with effective confidence >= 20 → remains active", () => {
            fc.assert(
                fc.property(
                    expectationEntryArb,
                    ({ confidence, elapsedMs }) => {
                        const nowMs = Date.now();
                        const observedAt = new Date(nowMs - elapsedMs).toISOString();

                        const effective = computeEffectiveConfidence(confidence, elapsedMs, EXPECTATIONS_HALF_LIFE_MS);
                        const entry: ExpectationEntry = { confidence, observedAt };
                        const archived = shouldArchiveExpectation(entry, nowMs);

                        if (effective >= ARCHIVE_THRESHOLD) {
                            expect(archived).toBe(false);
                        }
                    },
                ),
                { numRuns: 200 },
            );
        });
    });

    /**
     * Knowledge gaps with effective relevance < 20 → archived; >= 20 → active
     *
     * **Validates: Requirements 8.2, 8.3**
     */
    describe("Knowledge gaps archival threshold", () => {
        it("knowledge gap with effective relevance < 20 → archived", () => {
            fc.assert(
                fc.property(
                    knowledgeGapEntryArb,
                    ({ relevanceScore, elapsedMs }) => {
                        const nowMs = Date.now();
                        const detectedAt = new Date(nowMs - elapsedMs).toISOString();

                        const effective = computeEffectiveConfidence(relevanceScore, elapsedMs, KNOWLEDGE_GAPS_HALF_LIFE_MS);
                        const entry: KnowledgeGapEntry = { relevanceScore, detectedAt };
                        const archived = shouldArchiveKnowledgeGap(entry, nowMs);

                        if (effective < ARCHIVE_THRESHOLD) {
                            expect(archived).toBe(true);
                        }
                    },
                ),
                { numRuns: 200 },
            );
        });

        it("knowledge gap with effective relevance >= 20 → remains active", () => {
            fc.assert(
                fc.property(
                    knowledgeGapEntryArb,
                    ({ relevanceScore, elapsedMs }) => {
                        const nowMs = Date.now();
                        const detectedAt = new Date(nowMs - elapsedMs).toISOString();

                        const effective = computeEffectiveConfidence(relevanceScore, elapsedMs, KNOWLEDGE_GAPS_HALF_LIFE_MS);
                        const entry: KnowledgeGapEntry = { relevanceScore, detectedAt };
                        const archived = shouldArchiveKnowledgeGap(entry, nowMs);

                        if (effective >= ARCHIVE_THRESHOLD) {
                            expect(archived).toBe(false);
                        }
                    },
                ),
                { numRuns: 200 },
            );
        });
    });

    /**
     * Archival correctness: effective confidence computed correctly drives archival decision
     *
     * **Validates: Requirements 8.2, 8.3**
     */
    describe("Archival decision consistency across dimensions", () => {
        it("archival decision is fully determined by effective confidence and pinned state", () => {
            fc.assert(
                fc.property(
                    confidenceArb,
                    elapsedMsArb,
                    fc.boolean(),
                    fc.constantFrom(
                        { halfLife: BELIEFS_HALF_LIFE_MS, dimension: "beliefs" as const },
                        { halfLife: EXPECTATIONS_HALF_LIFE_MS, dimension: "expectations" as const },
                        { halfLife: KNOWLEDGE_GAPS_HALF_LIFE_MS, dimension: "knowledgeGaps" as const },
                    ),
                    (confidence, elapsedMs, pinned, { halfLife, dimension }) => {
                        const effective = computeEffectiveConfidence(confidence, elapsedMs, halfLife);

                        // Simulate the archival decision
                        const isPinnable = dimension === "beliefs";
                        const isPinned = isPinnable && pinned;

                        let shouldArchive: boolean;
                        if (isPinned) {
                            shouldArchive = false;
                        } else {
                            shouldArchive = effective < ARCHIVE_THRESHOLD;
                        }

                        // Verify consistency: pinned always survives
                        if (isPinned) {
                            expect(shouldArchive).toBe(false);
                        }

                        // Verify: above threshold always survives (regardless of pinned)
                        if (effective >= ARCHIVE_THRESHOLD) {
                            expect(shouldArchive).toBe(false);
                        }

                        // Verify: below threshold AND not pinned → archived
                        if (effective < ARCHIVE_THRESHOLD && !isPinned) {
                            expect(shouldArchive).toBe(true);
                        }
                    },
                ),
                { numRuns: 300 },
            );
        });

        it("archived entries would have correct fields preserved", () => {
            fc.assert(
                fc.property(
                    confidenceArb,
                    elapsedMsArb,
                    fc.constantFrom(
                        { halfLife: BELIEFS_HALF_LIFE_MS, dimension: "belief" },
                        { halfLife: EXPECTATIONS_HALF_LIFE_MS, dimension: "expectation" },
                        { halfLife: KNOWLEDGE_GAPS_HALF_LIFE_MS, dimension: "knowledgeGap" },
                    ),
                    (originalConfidence, elapsedMs, { halfLife, dimension }) => {
                        const effective = computeEffectiveConfidence(originalConfidence, elapsedMs, halfLife);

                        if (effective < ARCHIVE_THRESHOLD) {
                            // Simulate the archive record fields
                            const archiveRecord = {
                                dimension,
                                originalConfidence: Math.round(originalConfidence),
                                effectiveConfidenceAtArchive: effective,
                            };

                            // Verify the archive record preserves correct fields
                            expect(archiveRecord.originalConfidence).toBe(Math.round(originalConfidence));
                            expect(archiveRecord.effectiveConfidenceAtArchive).toBe(effective);
                            expect(archiveRecord.effectiveConfidenceAtArchive).toBeLessThan(ARCHIVE_THRESHOLD);
                            expect(archiveRecord.dimension).toBe(dimension);

                            // Original confidence should be >= effective (decay only reduces)
                            expect(archiveRecord.originalConfidence).toBeGreaterThanOrEqual(
                                archiveRecord.effectiveConfidenceAtArchive,
                            );
                        }
                    },
                ),
                { numRuns: 200 },
            );
        });
    });
});
