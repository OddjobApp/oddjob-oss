/**
 * Property-based tests for LLMBackend.
 *
 * **Property 9: LLM response parsing round-trip**
 * For any valid JSON response containing a rankings array with index/score pairs,
 * the parser SHALL extract per-document scores that match the original JSON values.
 *
 * **Property 11: LLM backend document limit per prompt**
 * For any list of N documents where N exceeds maxDocsPerPrompt, the LLM backend
 * SHALL split documents into groups of at most maxDocsPerPrompt documents per LLM invocation.
 *
 * **Validates: Requirements 5.3, 5.5**
 *
 * Uses fast-check for property-based testing with a minimum of 100 iterations.
 * Tag: Feature: reranking-service, Property 9: LLM response parsing round-trip
 * Tag: Feature: reranking-service, Property 11: LLM backend document limit per prompt
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import { parseRankingResponse, splitIntoGroups } from "../../backends/llm.backend.js";
import type { CandidateDocument } from "../../types.js";

// ─── Generators ───────────────────────────────────────────────────────────────

/**
 * Generate a valid rankings array with unique indices [0..N-1] and scores in [0, 10].
 * The indices are a permutation of 0..N-1 to satisfy the parser's duplicate-index check.
 */
const rankingsArrayArb = (documentCount: number) =>
  fc
    .shuffledSubarray(
      Array.from({ length: documentCount }, (_, i) => i),
      { minLength: documentCount, maxLength: documentCount }
    )
    .chain((indices) =>
      fc
        .array(fc.double({ min: 0, max: 10, noNaN: true }), {
          minLength: documentCount,
          maxLength: documentCount,
        })
        .map((scores) =>
          indices.map((index, i) => ({ index, score: scores[i] }))
        )
    );

/**
 * Generate a document count between 1 and 50 (reasonable for LLM reranking).
 */
const documentCountArb = fc.integer({ min: 1, max: 50 });

/**
 * Generate a CandidateDocument with a unique ID and some content.
 */
const candidateDocumentArb = fc.record({
  id: fc.uuid(),
  content: fc.string({ minLength: 1, maxLength: 200 }),
});

/**
 * Generate a non-empty array of CandidateDocuments.
 */
const candidateDocumentsArb = fc.array(candidateDocumentArb, {
  minLength: 1,
  maxLength: 100,
});

/**
 * Generate a maxDocsPerPrompt value (positive integer, typically 1–50).
 */
const maxDocsPerPromptArb = fc.integer({ min: 1, max: 50 });

// ─── Property Tests ───────────────────────────────────────────────────────────

describe("Feature: reranking-service, Property 9: LLM response parsing round-trip", () => {
  /**
   * **Validates: Requirements 5.3**
   *
   * For any valid JSON response containing a rankings array with index/score pairs,
   * the parser extracts per-document scores that match the original JSON values.
   */
  it("parseRankingResponse extracts scores matching original JSON values for valid input", () => {
    fc.assert(
      fc.property(documentCountArb, (docCount) => {
        return fc.assert(
          fc.property(rankingsArrayArb(docCount), (rankings) => {
            // Construct a valid JSON response
            const jsonResponse = JSON.stringify({ rankings });

            // Parse it
            const result = parseRankingResponse(jsonResponse, docCount);

            // Should successfully parse
            expect(result).not.toBeNull();
            expect(result).toHaveLength(docCount);

            // Verify each extracted score matches the original value
            for (const entry of rankings) {
              const parsed = result!.find(
                (r) => r.documentId === `__index_${entry.index}`
              );
              expect(parsed).toBeDefined();
              expect(parsed!.score).toBe(entry.score);
            }
          }),
          { numRuns: 5 }
        );
      }),
      { numRuns: 25, seed: 42 }
    );
  });

  /**
   * **Validates: Requirements 5.3**
   *
   * Flat approach: generate document count and rankings together.
   */
  it("parseRankingResponse returns correct number of scores for any valid response", () => {
    fc.assert(
      fc.property(
        documentCountArb.chain((n) =>
          rankingsArrayArb(n).map((rankings) => ({ n, rankings }))
        ),
        ({ n, rankings }) => {
          const jsonResponse = JSON.stringify({ rankings });
          const result = parseRankingResponse(jsonResponse, n);

          expect(result).not.toBeNull();
          expect(result).toHaveLength(n);
        }
      ),
      { numRuns: 100, seed: 101 }
    );
  });

  /**
   * **Validates: Requirements 5.3**
   *
   * When wrapped in markdown code fences, parsing still succeeds.
   */
  it("parseRankingResponse handles JSON wrapped in markdown code fences", () => {
    fc.assert(
      fc.property(
        documentCountArb.chain((n) =>
          rankingsArrayArb(n).map((rankings) => ({ n, rankings }))
        ),
        ({ n, rankings }) => {
          const json = JSON.stringify({ rankings });
          const wrappedResponse = "```json\n" + json + "\n```";

          const result = parseRankingResponse(wrappedResponse, n);

          expect(result).not.toBeNull();
          expect(result).toHaveLength(n);

          // Verify scores match
          for (const entry of rankings) {
            const parsed = result!.find(
              (r) => r.documentId === `__index_${entry.index}`
            );
            expect(parsed).toBeDefined();
            expect(parsed!.score).toBe(entry.score);
          }
        }
      ),
      { numRuns: 100, seed: 202 }
    );
  });

  /**
   * **Validates: Requirements 5.3**
   *
   * Scores at boundary values (0 and 10) are correctly parsed.
   */
  it("parseRankingResponse handles boundary score values (0 and 10)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 30 }),
        (docCount) => {
          // Generate rankings where all scores are either 0 or 10
          const rankings = Array.from({ length: docCount }, (_, i) => ({
            index: i,
            score: i % 2 === 0 ? 0 : 10,
          }));

          const jsonResponse = JSON.stringify({ rankings });
          const result = parseRankingResponse(jsonResponse, docCount);

          expect(result).not.toBeNull();
          expect(result).toHaveLength(docCount);

          for (const entry of rankings) {
            const parsed = result!.find(
              (r) => r.documentId === `__index_${entry.index}`
            );
            expect(parsed!.score).toBe(entry.score);
          }
        }
      ),
      { numRuns: 100, seed: 303 }
    );
  });
});

describe("Feature: reranking-service, Property 11: LLM backend document limit per prompt", () => {
  /**
   * **Validates: Requirements 5.5**
   *
   * For any list of N documents and a maxDocsPerPrompt value, splitIntoGroups
   * produces groups where each group has at most maxDocsPerPrompt documents.
   */
  it("splitIntoGroups produces groups of at most maxDocsPerPrompt documents", () => {
    fc.assert(
      fc.property(candidateDocumentsArb, maxDocsPerPromptArb, (docs, maxDocs) => {
        const groups = splitIntoGroups(docs, maxDocs);

        // Every group has at most maxDocs items
        for (const group of groups) {
          expect(group.length).toBeLessThanOrEqual(maxDocs);
          expect(group.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100, seed: 404 }
    );
  });

  /**
   * **Validates: Requirements 5.5**
   *
   * The number of groups is exactly ceil(N / maxDocsPerPrompt).
   */
  it("splitIntoGroups produces exactly ceil(N / max) groups", () => {
    fc.assert(
      fc.property(candidateDocumentsArb, maxDocsPerPromptArb, (docs, maxDocs) => {
        const groups = splitIntoGroups(docs, maxDocs);

        const expectedGroupCount = Math.ceil(docs.length / maxDocs);
        expect(groups.length).toBe(expectedGroupCount);
      }),
      { numRuns: 100, seed: 505 }
    );
  });

  /**
   * **Validates: Requirements 5.5**
   *
   * All documents are preserved across groups (no data loss or duplication).
   */
  it("splitIntoGroups preserves all documents across groups (no loss or duplication)", () => {
    fc.assert(
      fc.property(candidateDocumentsArb, maxDocsPerPromptArb, (docs, maxDocs) => {
        const groups = splitIntoGroups(docs, maxDocs);

        // Flatten groups and compare with original
        const flattened = groups.flat();
        expect(flattened.length).toBe(docs.length);

        // Documents should be in original order
        for (let i = 0; i < docs.length; i++) {
          expect(flattened[i].id).toBe(docs[i].id);
          expect(flattened[i].content).toBe(docs[i].content);
        }
      }),
      { numRuns: 100, seed: 606 }
    );
  });

  /**
   * **Validates: Requirements 5.5**
   *
   * When N <= maxDocsPerPrompt, only a single group is produced containing all documents.
   */
  it("splitIntoGroups produces a single group when N <= maxDocsPerPrompt", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }).chain((n) =>
          fc
            .array(candidateDocumentArb, { minLength: n, maxLength: n })
            .map((docs) => ({ docs, maxDocs: n + fc.sample(fc.integer({ min: 0, max: 30 }), 1)[0] }))
        ),
        ({ docs, maxDocs }) => {
          fc.pre(maxDocs >= docs.length && maxDocs > 0);

          const groups = splitIntoGroups(docs, maxDocs);
          expect(groups.length).toBe(1);
          expect(groups[0].length).toBe(docs.length);
        }
      ),
      { numRuns: 100, seed: 707 }
    );
  });

  /**
   * **Validates: Requirements 5.5**
   *
   * When N exceeds maxDocsPerPrompt, multiple groups are produced
   * and each group (except possibly the last) is exactly maxDocsPerPrompt in size.
   */
  it("splitIntoGroups fills all groups except the last to exactly maxDocsPerPrompt", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 100 }),
        fc.integer({ min: 1, max: 20 }),
        (docCount, maxDocs) => {
          fc.pre(docCount > maxDocs); // Ensure multiple groups

          const docs: CandidateDocument[] = Array.from(
            { length: docCount },
            (_, i) => ({ id: `doc-${i}`, content: `Content ${i}` })
          );

          const groups = splitIntoGroups(docs, maxDocs);

          // All groups except the last must be exactly maxDocs
          for (let i = 0; i < groups.length - 1; i++) {
            expect(groups[i].length).toBe(maxDocs);
          }

          // Last group has the remainder
          const expectedLastGroupSize = docCount % maxDocs || maxDocs;
          expect(groups[groups.length - 1].length).toBe(expectedLastGroupSize);
        }
      ),
      { numRuns: 100, seed: 808 }
    );
  });
});
