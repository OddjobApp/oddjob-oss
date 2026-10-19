/**
 * Property-based tests for keyword similarity (Jaccard index).
 *
 * Property 5: Cross-Repo Overlap Detection (keyword component)
 *
 * Since fast-check is not available in this project, these tests use manual
 * randomization with 100 random cases per property to achieve property-based
 * testing coverage.
 *
 * **Validates: Requirements 3.6**
 */

import { describe, it, expect } from "vitest";
import { computeJaccardSimilarity } from "../keyword-similarity.js";
import { STOP_WORDS } from "../stop-words.js";

// ─── Random Generators ────────────────────────────────────────────────────────

/** Seeded pseudo-random number generator for reproducibility */
function createRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function randomInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function randomChoice<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

/** Pool of content words (non-stop-words) for generating text */
const CONTENT_WORDS = [
  "database", "migration", "error", "timeout", "connection",
  "typescript", "python", "react", "angular", "deployment",
  "kubernetes", "docker", "redis", "postgres", "authentication",
  "authorization", "payment", "gateway", "api", "endpoint",
  "controller", "service", "repository", "model", "schema",
  "validation", "serialization", "configuration", "middleware",
  "pipeline", "testing", "coverage", "refactoring", "optimization",
  "caching", "indexing", "monitoring", "alerting", "logging",
  "encryption", "certificate", "webhook", "integration", "workflow",
  "scheduling", "queueing", "streaming", "batching", "pagination",
];

/** Pool of stop words to intersperse */
const STOP_WORD_POOL = Array.from(STOP_WORDS).slice(0, 30);

/** Generate a random text composed of content words */
function generateContentText(rng: () => number, wordCount: number): string {
  const words: string[] = [];
  for (let i = 0; i < wordCount; i++) {
    words.push(randomChoice(rng, CONTENT_WORDS));
  }
  return words.join(" ");
}

/** Generate text with a mix of content and stop words */
function generateMixedText(rng: () => number, contentCount: number, stopCount: number): string {
  const words: string[] = [];
  for (let i = 0; i < contentCount; i++) {
    words.push(randomChoice(rng, CONTENT_WORDS));
  }
  for (let i = 0; i < stopCount; i++) {
    // Insert stop words at random positions
    const pos = randomInt(rng, 0, words.length);
    words.splice(pos, 0, randomChoice(rng, STOP_WORD_POOL));
  }
  return words.join(" ");
}

/** Generate a text using only stop words (produces empty token set) */
function generateStopWordOnlyText(rng: () => number, count: number): string {
  const words: string[] = [];
  for (let i = 0; i < count; i++) {
    words.push(randomChoice(rng, STOP_WORD_POOL));
  }
  return words.join(" ");
}

/** Generate a set of unique content words */
function generateUniqueContentWords(rng: () => number, count: number): string[] {
  const available = [...CONTENT_WORDS];
  const result: string[] = [];
  const actualCount = Math.min(count, available.length);
  for (let i = 0; i < actualCount; i++) {
    const idx = randomInt(rng, 0, available.length - 1);
    result.push(available[idx]);
    available.splice(idx, 1);
  }
  return result;
}

// ─── Property Tests ───────────────────────────────────────────────────────────

describe("Keyword Similarity Property Tests", () => {
  /**
   * **Validates: Requirements 3.6**
   *
   * Property 5 (partial): Jaccard similarity is symmetric: sim(a, b) === sim(b, a)
   */
  describe("Symmetry: sim(a, b) === sim(b, a)", () => {
    it("Jaccard similarity is symmetric for random text pairs (100 random cases)", () => {
      const failures: string[] = [];

      for (let i = 0; i < 100; i++) {
        const rng = createRng(i * 7919 + 42);
        const wordCountA = randomInt(rng, 1, 8);
        const wordCountB = randomInt(rng, 1, 8);
        const textA = generateContentText(rng, wordCountA);
        const textB = generateContentText(rng, wordCountB);

        const simAB = computeJaccardSimilarity(textA, textB);
        const simBA = computeJaccardSimilarity(textB, textA);

        if (simAB !== simBA) {
          failures.push(
            `Case ${i}: sim("${textA}", "${textB}") = ${simAB} !== sim("${textB}", "${textA}") = ${simBA}`
          );
        }
      }

      expect(failures).toEqual([]);
    });

    it("symmetry holds with mixed stop words and content words (100 random cases)", () => {
      const failures: string[] = [];

      for (let i = 0; i < 100; i++) {
        const rng = createRng(i * 3571 + 17);
        const contentCountA = randomInt(rng, 1, 6);
        const stopCountA = randomInt(rng, 0, 4);
        const contentCountB = randomInt(rng, 1, 6);
        const stopCountB = randomInt(rng, 0, 4);
        const textA = generateMixedText(rng, contentCountA, stopCountA);
        const textB = generateMixedText(rng, contentCountB, stopCountB);

        const simAB = computeJaccardSimilarity(textA, textB);
        const simBA = computeJaccardSimilarity(textB, textA);

        if (simAB !== simBA) {
          failures.push(
            `Case ${i}: sim("${textA}", "${textB}") = ${simAB} !== sim("${textB}", "${textA}") = ${simBA}`
          );
        }
      }

      expect(failures).toEqual([]);
    });
  });

  /**
   * **Validates: Requirements 3.6**
   *
   * Property 5 (partial): Identical texts produce similarity of 1.0
   */
  describe("Identity: identical texts produce similarity of 1.0", () => {
    it("identical texts with content words always produce 1.0 (100 random cases)", () => {
      const failures: string[] = [];

      for (let i = 0; i < 100; i++) {
        const rng = createRng(i * 6151 + 99);
        const wordCount = randomInt(rng, 1, 10);
        const text = generateContentText(rng, wordCount);

        const sim = computeJaccardSimilarity(text, text);

        if (sim !== 1.0) {
          failures.push(
            `Case ${i}: sim("${text}", "${text}") = ${sim}, expected 1.0`
          );
        }
      }

      expect(failures).toEqual([]);
    });

    it("identical texts with different casing produce 1.0 (100 random cases)", () => {
      const failures: string[] = [];

      for (let i = 0; i < 100; i++) {
        const rng = createRng(i * 4253 + 31);
        const wordCount = randomInt(rng, 1, 8);
        const text = generateContentText(rng, wordCount);
        // Randomly capitalize parts of the text
        const upperText = text
          .split(" ")
          .map((w) => (rng() > 0.5 ? w.toUpperCase() : w))
          .join(" ");

        const sim = computeJaccardSimilarity(text, upperText);

        if (sim !== 1.0) {
          failures.push(
            `Case ${i}: sim("${text}", "${upperText}") = ${sim}, expected 1.0`
          );
        }
      }

      expect(failures).toEqual([]);
    });
  });

  /**
   * **Validates: Requirements 3.6**
   *
   * Property 5 (partial): Completely disjoint texts produce similarity of 0.0
   */
  describe("Disjointness: completely disjoint texts produce similarity of 0.0", () => {
    it("texts with no shared content words produce 0.0 (100 random cases)", () => {
      const failures: string[] = [];

      for (let i = 0; i < 100; i++) {
        const rng = createRng(i * 8831 + 53);
        const countA = randomInt(rng, 1, 5);
        const countB = randomInt(rng, 1, 5);

        // Generate two sets of unique content words with no overlap
        const allWords = generateUniqueContentWords(rng, countA + countB);
        const wordsA = allWords.slice(0, countA);
        const wordsB = allWords.slice(countA, countA + countB);

        const textA = wordsA.join(" ");
        const textB = wordsB.join(" ");

        const sim = computeJaccardSimilarity(textA, textB);

        if (sim !== 0.0) {
          failures.push(
            `Case ${i}: sim("${textA}", "${textB}") = ${sim}, expected 0.0`
          );
        }
      }

      expect(failures).toEqual([]);
    });

    it("texts with only stop-word overlap still produce 0.0 (100 random cases)", () => {
      const failures: string[] = [];

      for (let i = 0; i < 100; i++) {
        const rng = createRng(i * 2909 + 73);
        const countA = randomInt(rng, 1, 4);
        const countB = randomInt(rng, 1, 4);

        // Generate disjoint content word sets
        const allWords = generateUniqueContentWords(rng, countA + countB);
        const wordsA = allWords.slice(0, countA);
        const wordsB = allWords.slice(countA, countA + countB);

        // Add common stop words to both
        const commonStops = randomInt(rng, 1, 3);
        const stopWordsToAdd: string[] = [];
        for (let j = 0; j < commonStops; j++) {
          stopWordsToAdd.push(randomChoice(rng, STOP_WORD_POOL));
        }

        const textA = [...stopWordsToAdd, ...wordsA].join(" ");
        const textB = [...stopWordsToAdd, ...wordsB].join(" ");

        const sim = computeJaccardSimilarity(textA, textB);

        if (sim !== 0.0) {
          failures.push(
            `Case ${i}: sim("${textA}", "${textB}") = ${sim}, expected 0.0 (shared stop words should not affect similarity)`
          );
        }
      }

      expect(failures).toEqual([]);
    });
  });

  /**
   * **Validates: Requirements 3.6**
   *
   * Property 5 (partial): Stop-word removal does not affect matching of content words.
   * Adding or removing stop words from text should not change the similarity score.
   */
  describe("Stop-word invariance: stop words do not affect matching of content words", () => {
    it("adding stop words to texts does not change similarity (100 random cases)", () => {
      const failures: string[] = [];

      for (let i = 0; i < 100; i++) {
        const rng = createRng(i * 5147 + 11);
        const wordCountA = randomInt(rng, 1, 6);
        const wordCountB = randomInt(rng, 1, 6);
        const textA = generateContentText(rng, wordCountA);
        const textB = generateContentText(rng, wordCountB);

        // Compute baseline similarity (content words only)
        const baseSim = computeJaccardSimilarity(textA, textB);

        // Add random stop words to both texts
        const stopsA = randomInt(rng, 1, 5);
        const stopsB = randomInt(rng, 1, 5);
        const enrichedA = generateMixedTextFromBase(rng, textA, stopsA);
        const enrichedB = generateMixedTextFromBase(rng, textB, stopsB);

        const enrichedSim = computeJaccardSimilarity(enrichedA, enrichedB);

        if (Math.abs(baseSim - enrichedSim) > 1e-10) {
          failures.push(
            `Case ${i}: base sim("${textA}", "${textB}") = ${baseSim} !== ` +
            `enriched sim("${enrichedA}", "${enrichedB}") = ${enrichedSim}`
          );
        }
      }

      expect(failures).toEqual([]);
    });

    it("prefixing/suffixing stop words does not change similarity (100 random cases)", () => {
      const failures: string[] = [];

      for (let i = 0; i < 100; i++) {
        const rng = createRng(i * 9311 + 67);
        const wordCountA = randomInt(rng, 1, 6);
        const wordCountB = randomInt(rng, 1, 6);
        const textA = generateContentText(rng, wordCountA);
        const textB = generateContentText(rng, wordCountB);

        // Compute baseline similarity
        const baseSim = computeJaccardSimilarity(textA, textB);

        // Add stop word prefix and suffix
        const prefix = randomChoice(rng, STOP_WORD_POOL);
        const suffix = randomChoice(rng, STOP_WORD_POOL);
        const prefixedA = `${prefix} ${textA} ${suffix}`;
        const prefixedB = `${prefix} ${textB} ${suffix}`;

        const prefixedSim = computeJaccardSimilarity(prefixedA, prefixedB);

        if (Math.abs(baseSim - prefixedSim) > 1e-10) {
          failures.push(
            `Case ${i}: base sim = ${baseSim} !== prefixed sim = ${prefixedSim} ` +
            `(textA="${textA}", prefixedA="${prefixedA}")`
          );
        }
      }

      expect(failures).toEqual([]);
    });
  });
});

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Insert stop words at random positions in existing text */
function generateMixedTextFromBase(rng: () => number, baseText: string, stopCount: number): string {
  const words = baseText.split(" ");
  for (let i = 0; i < stopCount; i++) {
    const pos = randomInt(rng, 0, words.length);
    words.splice(pos, 0, randomChoice(rng, STOP_WORD_POOL));
  }
  return words.join(" ");
}
