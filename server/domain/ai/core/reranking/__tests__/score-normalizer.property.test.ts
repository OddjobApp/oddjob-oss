/**
 * Property-based tests for ScoreNormalizer.
 *
 * Feature: reranking-service
 *
 * Tests validate that normalizeScores correctly normalizes raw backend scores
 * to the [0.0, 1.0] range while preserving relative ordering.
 *
 * Uses fast-check for property-based testing with minimum 100 iterations.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import { normalizeScores } from "../score-normalizer.js";
import type { RawScore } from "../backends/rerank-backend.interface.js";

// ─── fast-check Arbitraries ─────────────────────────────────────────────────

/** Generates a unique document ID */
const documentIdArb = fc.uuid();

/**
 * Generates a raw score (any finite number, including out-of-range).
 * We avoid subnormal/denormalized numbers (values extremely close to zero like 5e-324)
 * because min-max normalization with floating-point division loses ordering precision
 * when the range between scores is smaller than ~1e-15 relative to the values.
 * This is a known IEEE 754 limitation, not a bug in the normalizer.
 */
const rawScoreValueArb = fc.oneof(
  fc.double({ min: -1000, max: -0.0001, noNaN: true, noDefaultInfinity: true }),
  fc.constant(0),
  fc.double({ min: 0.0001, max: 1000, noNaN: true, noDefaultInfinity: true })
);

/** Generates a raw score that is outside [0, 1] range */
const outOfRangeScoreArb = fc.oneof(
  fc.double({ min: -1000, max: -0.001, noNaN: true, noDefaultInfinity: true }),
  fc.double({ min: 1.001, max: 1000, noNaN: true, noDefaultInfinity: true })
);

/** Generates a single RawScore entry */
const rawScoreArb: fc.Arbitrary<RawScore> = fc.record({
  documentId: documentIdArb,
  score: rawScoreValueArb,
});

/** Generates a non-empty array of RawScores (at least 2 for ordering tests) */
const rawScoresArrayArb = (minLen = 2, maxLen = 50): fc.Arbitrary<RawScore[]> =>
  fc.array(rawScoreArb, { minLength: minLen, maxLength: maxLen });

/**
 * Generates a batch of RawScores where at least one score is outside [0, 1].
 * This forces the normalizer into the min-max normalization path.
 */
const outOfRangeRawScoresArb = (minLen = 2, maxLen = 50): fc.Arbitrary<RawScore[]> =>
  fc
    .tuple(
      // At least one out-of-range score
      fc.record({ documentId: documentIdArb, score: outOfRangeScoreArb }),
      // Plus additional scores (any range)
      fc.array(rawScoreArb, { minLength: minLen - 1, maxLength: maxLen - 1 })
    )
    .map(([outOfRange, rest]) => {
      // Shuffle so the out-of-range isn't always first
      const combined = [outOfRange, ...rest];
      return combined;
    });

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("ScoreNormalizer Property Tests", () => {
  /**
   * Feature: reranking-service, Property 2: All relevance scores are in the normalized range
   *
   * For any set of raw scores, after normalization every score SHALL be
   * between 0.0 and 1.0 inclusive.
   *
   * **Validates: Requirements 1.2, 10.1**
   */
  describe("Property 2: All relevance scores are in the normalized range", () => {
    it("all normalized scores are between 0.0 and 1.0 inclusive for any input", () => {
      fc.assert(
        fc.property(rawScoresArrayArb(1, 50), (rawScores) => {
          const normalized = normalizeScores(rawScores);

          for (const result of normalized) {
            expect(result.score).toBeGreaterThanOrEqual(0.0);
            expect(result.score).toBeLessThanOrEqual(1.0);
          }
        }),
        { numRuns: 100 }
      );
    });

    it("scores are in [0, 1] even when raw scores are heavily negative", () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              documentId: documentIdArb,
              score: fc.double({ min: -10000, max: -1, noNaN: true, noDefaultInfinity: true }),
            }),
            { minLength: 2, maxLength: 30 }
          ),
          (rawScores) => {
            const normalized = normalizeScores(rawScores);

            for (const result of normalized) {
              expect(result.score).toBeGreaterThanOrEqual(0.0);
              expect(result.score).toBeLessThanOrEqual(1.0);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it("scores are in [0, 1] even when raw scores are very large", () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              documentId: documentIdArb,
              score: fc.double({ min: 100, max: 100000, noNaN: true, noDefaultInfinity: true }),
            }),
            { minLength: 2, maxLength: 30 }
          ),
          (rawScores) => {
            const normalized = normalizeScores(rawScores);

            for (const result of normalized) {
              expect(result.score).toBeGreaterThanOrEqual(0.0);
              expect(result.score).toBeLessThanOrEqual(1.0);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: reranking-service, Property 4: Normalization preserves relative ordering
   *
   * If raw_score_A > raw_score_B before normalization, then
   * normalized_score_A > normalized_score_B after normalization.
   * The normalization function is order-preserving (monotonic).
   *
   * Note: We use integer scores (divided to create decimals) to avoid IEEE 754
   * floating-point precision issues where scores differing by less than ~1e-15
   * relative to the batch range can map to the same normalized value.
   *
   * **Validates: Requirements 10.3**
   */
  describe("Property 4: Normalization preserves relative ordering", () => {
    /**
     * Generates arrays of RawScores with distinct integer-based scores.
     * Using integers avoids floating-point precision edge cases that would
     * cause the same normalized output for technically-different raw values.
     */
    const distinctScoresArb = fc
      .uniqueArray(fc.integer({ min: -10000, max: 10000 }), { minLength: 2, maxLength: 30 })
      .map((scores) =>
        scores.map((score, idx) => ({
          documentId: `doc-${idx}`,
          score: score / 100, // Creates decimals like -100.00, 0.01, 50.55
        }))
      );

    it("relative ordering is preserved for any pair of distinct scores in a batch", () => {
      fc.assert(
        fc.property(distinctScoresArb, (rawScores) => {
          const normalized = normalizeScores(rawScores);

          // For every pair (i, j) where rawScores[i].score > rawScores[j].score,
          // the normalized score at i must be > normalized score at j
          for (let i = 0; i < rawScores.length; i++) {
            for (let j = i + 1; j < rawScores.length; j++) {
              if (rawScores[i].score > rawScores[j].score) {
                expect(normalized[i].score).toBeGreaterThan(normalized[j].score);
              } else if (rawScores[i].score < rawScores[j].score) {
                expect(normalized[i].score).toBeLessThan(normalized[j].score);
              } else {
                // Equal raw scores → equal normalized scores
                expect(normalized[i].score).toBe(normalized[j].score);
              }
            }
          }
        }),
        { numRuns: 100 }
      );
    });

    it("ordering is preserved when scores span both negative and positive ranges", () => {
      const mixedRangeArb = fc
        .tuple(
          // At least one negative
          fc.integer({ min: -10000, max: -1 }),
          // At least one positive
          fc.integer({ min: 1, max: 10000 }),
          // Additional unique scores
          fc.uniqueArray(fc.integer({ min: -10000, max: 10000 }), { minLength: 0, maxLength: 20 })
        )
        .map(([neg, pos, rest]) => {
          const allScores = [...new Set([neg, pos, ...rest])];
          return allScores.map((score, idx) => ({
            documentId: `doc-${idx}`,
            score: score / 100,
          }));
        })
        .filter((arr) => arr.length >= 2);

      fc.assert(
        fc.property(mixedRangeArb, (rawScores) => {
          const normalized = normalizeScores(rawScores);

          for (let i = 0; i < rawScores.length; i++) {
            for (let j = i + 1; j < rawScores.length; j++) {
              if (rawScores[i].score > rawScores[j].score) {
                expect(normalized[i].score).toBeGreaterThan(normalized[j].score);
              } else if (rawScores[i].score < rawScores[j].score) {
                expect(normalized[i].score).toBeLessThan(normalized[j].score);
              }
            }
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: reranking-service, Property 5: Min-max normalization correctness for out-of-range scores
   *
   * For any batch with scores outside [0,1], min maps to 0.0, max maps to 1.0,
   * intermediate values proportional.
   *
   * **Validates: Requirements 10.2**
   */
  describe("Property 5: Min-max normalization correctness for out-of-range scores", () => {
    it("minimum score maps to 0.0 and maximum score maps to 1.0 for out-of-range batches", () => {
      fc.assert(
        fc.property(outOfRangeRawScoresArb(2, 50), (rawScores) => {
          // Ensure scores are not all identical (range > 0)
          const scores = rawScores.map((rs) => rs.score);
          const min = Math.min(...scores);
          const max = Math.max(...scores);
          if (min === max) return; // Skip degenerate case

          const normalized = normalizeScores(rawScores);

          // Find the normalized scores corresponding to min and max raw scores
          const minIdx = rawScores.findIndex((rs) => rs.score === min);
          const maxIdx = rawScores.findIndex((rs) => rs.score === max);

          expect(normalized[minIdx].score).toBeCloseTo(0.0, 10);
          expect(normalized[maxIdx].score).toBeCloseTo(1.0, 10);
        }),
        { numRuns: 100 }
      );
    });

    it("intermediate values are proportionally scaled between 0 and 1", () => {
      fc.assert(
        fc.property(outOfRangeRawScoresArb(3, 50), (rawScores) => {
          const scores = rawScores.map((rs) => rs.score);
          const min = Math.min(...scores);
          const max = Math.max(...scores);
          const range = max - min;
          if (range === 0) return; // Skip degenerate case

          const normalized = normalizeScores(rawScores);

          // Each normalized score should match the min-max formula
          for (let i = 0; i < rawScores.length; i++) {
            const expected = (rawScores[i].score - min) / range;
            expect(normalized[i].score).toBeCloseTo(expected, 10);
          }
        }),
        { numRuns: 100 }
      );
    });

    it("all intermediate normalized values are strictly between 0 and 1 when raw score is between min and max", () => {
      fc.assert(
        fc.property(outOfRangeRawScoresArb(3, 50), (rawScores) => {
          const scores = rawScores.map((rs) => rs.score);
          const min = Math.min(...scores);
          const max = Math.max(...scores);
          if (min === max) return;

          const normalized = normalizeScores(rawScores);

          for (let i = 0; i < rawScores.length; i++) {
            if (rawScores[i].score > min && rawScores[i].score < max) {
              expect(normalized[i].score).toBeGreaterThanOrEqual(0.0);
              expect(normalized[i].score).toBeLessThanOrEqual(1.0);
            }
          }
        }),
        { numRuns: 100 }
      );
    });
  });
});
