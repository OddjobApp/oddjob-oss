import { describe, it, expect } from "vitest";
import { computeJaccardSimilarity } from "../keyword-similarity.js";

describe("computeJaccardSimilarity", () => {
  describe("edge cases", () => {
    it("returns 0 for two empty strings", () => {
      expect(computeJaccardSimilarity("", "")).toBe(0);
    });

    it("returns 0 for empty string and non-empty string", () => {
      expect(computeJaccardSimilarity("", "hello world")).toBe(0);
      expect(computeJaccardSimilarity("hello world", "")).toBe(0);
    });

    it("returns 0 for whitespace-only strings", () => {
      expect(computeJaccardSimilarity("   ", "   ")).toBe(0);
    });

    it("returns 0 when all words are stop words", () => {
      expect(computeJaccardSimilarity("the a is are", "to from in of")).toBe(0);
    });

    it("returns 0 when one text has only stop words", () => {
      expect(computeJaccardSimilarity("the is a", "database migration")).toBe(0);
    });
  });

  describe("identical texts", () => {
    it("returns 1.0 for identical single content word", () => {
      expect(computeJaccardSimilarity("database", "database")).toBe(1.0);
    });

    it("returns 1.0 for identical multi-word texts", () => {
      expect(computeJaccardSimilarity("database migration error", "database migration error")).toBe(1.0);
    });

    it("returns 1.0 for identical texts differing only in case", () => {
      expect(computeJaccardSimilarity("Database Migration", "database migration")).toBe(1.0);
    });

    it("returns 1.0 for identical content words with different stop words", () => {
      expect(computeJaccardSimilarity("the database migration", "a database migration")).toBe(1.0);
    });
  });

  describe("completely disjoint texts", () => {
    it("returns 0 for completely different content words", () => {
      expect(computeJaccardSimilarity("database migration", "payment gateway")).toBe(0);
    });

    it("returns 0 for single different words", () => {
      expect(computeJaccardSimilarity("typescript", "python")).toBe(0);
    });
  });

  describe("partial overlap", () => {
    it("computes correct Jaccard for partial overlap", () => {
      // setA = {database, migration, error}
      // setB = {database, connection, error}
      // intersection = {database, error} = 2
      // union = {database, migration, error, connection} = 4
      // Jaccard = 2/4 = 0.5
      expect(computeJaccardSimilarity("database migration error", "database connection error")).toBe(0.5);
    });

    it("computes correct Jaccard with stop words mixed in", () => {
      // "the database is having a migration error" -> remove stop words (the, is, having, a) -> {database, migration, error}
      // "a database connection error occurred" -> remove stop words (a) -> {database, connection, error, occurred}
      // intersection = {database, error} = 2
      // union = {database, migration, error, connection, occurred} = 5
      // Jaccard = 2/5 = 0.4
      const result = computeJaccardSimilarity(
        "the database is having a migration error",
        "a database connection error occurred"
      );
      expect(result).toBeCloseTo(2 / 5, 10);
    });
  });

  describe("punctuation handling", () => {
    it("strips punctuation before comparing", () => {
      // Both should tokenize to {database, error}
      expect(computeJaccardSimilarity("database: error!", "database, error.")).toBe(1.0);
    });

    it("handles hyphenated words as separate tokens", () => {
      // "cross-repo" splits to {cross, repo}
      // "cross repo" splits to {cross, repo}
      expect(computeJaccardSimilarity("cross-repo propagation", "cross repo propagation")).toBe(1.0);
    });

    it("handles parentheses and brackets", () => {
      expect(computeJaccardSimilarity("error (timeout)", "error timeout")).toBe(1.0);
    });
  });

  describe("case insensitivity", () => {
    it("treats uppercase and lowercase as equal", () => {
      expect(computeJaccardSimilarity("TypeScript", "typescript")).toBe(1.0);
    });

    it("handles mixed case in multi-word texts", () => {
      expect(computeJaccardSimilarity("Database Migration ERROR", "database MIGRATION error")).toBe(1.0);
    });
  });

  describe("single-word texts", () => {
    it("returns 1.0 when both are same single content word", () => {
      expect(computeJaccardSimilarity("typescript", "typescript")).toBe(1.0);
    });

    it("returns 0 when single content words differ", () => {
      expect(computeJaccardSimilarity("typescript", "python")).toBe(0);
    });
  });

  describe("result range", () => {
    it("always returns a value between 0 and 1", () => {
      const pairs = [
        ["hello world", "hello earth"],
        ["typescript react", "typescript angular vue"],
        ["a b c d e", "c d e f g"],
      ];

      for (const [a, b] of pairs) {
        const result = computeJaccardSimilarity(a, b);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(1);
      }
    });
  });
});
