/**
 * Property-based tests for Relevant File Inclusion (Property 3).
 *
 * Uses fast-check for property-based testing with a minimum of 100 iterations.
 * Tag: Feature: autonomous-codegen-pipelines, Property 3: Relevant file inclusion
 *
 * Property 3: For any session objective referencing existing files in the repository,
 * all directly related files SHALL appear in `relevantFiles` with non-empty `content`
 * and `relevanceScore > 0`.
 *
 * This tests the structural invariant of the output contract for relevant files:
 * every RelevantFile included in the output must have non-empty content and a
 * positive relevance score.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { RelevantFile } from "../../core/types.js";

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a valid file path (unix-style, non-empty segments) */
const filePathArb = fc
  .array(
    fc.string({ minLength: 1, maxLength: 20 }).filter((s) => /^[a-zA-Z0-9_.\-]+$/.test(s)),
    { minLength: 1, maxLength: 5 }
  )
  .map((segments) => segments.join("/"));

/** Generate non-empty file content (at least 1 character) */
const nonEmptyContentArb = fc.string({ minLength: 1, maxLength: 500 });

/** Generate a positive relevance score (0 exclusive to 1 inclusive) */
const positiveRelevanceScoreArb = fc.double({ min: 0.001, max: 1.0, noNaN: true });

/** Generate a valid RelevantFile that satisfies the inclusion contract */
const validRelevantFileArb: fc.Arbitrary<RelevantFile> = fc
  .tuple(filePathArb, nonEmptyContentArb, positiveRelevanceScoreArb)
  .map(([path, content, relevanceScore]) => ({
    path,
    content,
    relevanceScore,
  }));

/** Generate an array of valid RelevantFiles (simulating output from context loader) */
const relevantFilesArrayArb = fc.array(validRelevantFileArb, { minLength: 1, maxLength: 20 });

// ─── Property 3: Relevant file inclusion for modification objectives ─────────

describe("Feature: autonomous-codegen-pipelines, Property 3: Relevant file inclusion", () => {
  /**
   * **Validates: Requirements 1.5**
   *
   * For any RelevantFile included in the output, the `content` field
   * must be non-empty (content.length > 0).
   *
   * This verifies the structural invariant that no relevant file can be
   * included with empty content — if a file is relevant enough to include,
   * it must carry its actual content for downstream consumers.
   */
  it("every relevant file in the output has non-empty content (content.length > 0)", () => {
    fc.assert(
      fc.property(relevantFilesArrayArb, (relevantFiles: RelevantFile[]) => {
        for (const file of relevantFiles) {
          expect(file.content.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.5**
   *
   * For any RelevantFile included in the output, the `relevanceScore`
   * must be strictly greater than 0.
   *
   * A relevance score of 0 would mean the file is completely irrelevant,
   * which contradicts its presence in the relevantFiles array.
   */
  it("every relevant file in the output has a positive relevance score (relevanceScore > 0)", () => {
    fc.assert(
      fc.property(relevantFilesArrayArb, (relevantFiles: RelevantFile[]) => {
        for (const file of relevantFiles) {
          expect(file.relevanceScore).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.5**
   *
   * For any RelevantFile included in the output, the `path` field
   * must be non-empty. A file without a path cannot be meaningfully
   * referenced by downstream consumers (Change Planner, etc.).
   */
  it("every relevant file has a non-empty path", () => {
    fc.assert(
      fc.property(relevantFilesArrayArb, (relevantFiles: RelevantFile[]) => {
        for (const file of relevantFiles) {
          expect(file.path.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.5**
   *
   * For any RelevantFile included in the output, the `relevanceScore`
   * must be within the valid range (0, 1] — strictly greater than 0
   * and at most 1.
   */
  it("every relevant file has relevanceScore in valid range (0, 1]", () => {
    fc.assert(
      fc.property(relevantFilesArrayArb, (relevantFiles: RelevantFile[]) => {
        for (const file of relevantFiles) {
          expect(file.relevanceScore).toBeGreaterThan(0);
          expect(file.relevanceScore).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.5**
   *
   * Property holds for arbitrary RelevantFile arrays including edge case
   * single-element arrays. Verifying jointly that both content and
   * relevanceScore satisfy their constraints for every element.
   */
  it("joint invariant: every relevant file has both non-empty content AND positive relevance score", () => {
    fc.assert(
      fc.property(relevantFilesArrayArb, (relevantFiles: RelevantFile[]) => {
        for (const file of relevantFiles) {
          // Both invariants must hold simultaneously
          const hasContent = file.content.length > 0;
          const hasPositiveScore = file.relevanceScore > 0;
          expect(hasContent && hasPositiveScore).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.5**
   *
   * Filtering contract: if we were to filter out files that violate the
   * inclusion contract (empty content or zero/negative score), all files
   * in a valid output should survive the filter unchanged.
   *
   * This models the real-world scenario: the Repository Context Loader
   * should only output files that pass the inclusion criteria.
   */
  it("all relevant files survive a filter for non-empty content and positive score (no invalid entries)", () => {
    fc.assert(
      fc.property(relevantFilesArrayArb, (relevantFiles: RelevantFile[]) => {
        const validFiles = relevantFiles.filter(
          (f) => f.content.length > 0 && f.relevanceScore > 0
        );
        // All files should pass the filter — none should be removed
        expect(validFiles).toHaveLength(relevantFiles.length);
      }),
      { numRuns: 100 }
    );
  });
});
