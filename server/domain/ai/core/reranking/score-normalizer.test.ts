import { describe, it, expect } from "vitest";
import { normalizeScores } from "./score-normalizer.js";
import type { RawScore } from "./backends/rerank-backend.interface.js";

describe("ScoreNormalizer", () => {
  describe("empty input", () => {
    it("returns empty array for empty input", () => {
      const result = normalizeScores([]);
      expect(result).toEqual([]);
    });
  });

  describe("single document", () => {
    it("assigns score 1.0 to a single document", () => {
      const input: RawScore[] = [{ documentId: "doc-1", score: 0.5 }];
      const result = normalizeScores(input);
      expect(result).toEqual([{ documentId: "doc-1", score: 1.0 }]);
    });

    it("assigns score 1.0 regardless of raw score value", () => {
      const input: RawScore[] = [{ documentId: "doc-1", score: -3.7 }];
      const result = normalizeScores(input);
      expect(result).toEqual([{ documentId: "doc-1", score: 1.0 }]);
    });
  });

  describe("pass-through (scores already in [0.0, 1.0])", () => {
    it("passes through scores already in [0, 1] unchanged", () => {
      const input: RawScore[] = [
        { documentId: "a", score: 0.9 },
        { documentId: "b", score: 0.5 },
        { documentId: "c", score: 0.1 },
      ];
      const result = normalizeScores(input);
      expect(result).toEqual([
        { documentId: "a", score: 0.9 },
        { documentId: "b", score: 0.5 },
        { documentId: "c", score: 0.1 },
      ]);
    });

    it("handles boundary values 0.0 and 1.0", () => {
      const input: RawScore[] = [
        { documentId: "a", score: 1.0 },
        { documentId: "b", score: 0.0 },
      ];
      const result = normalizeScores(input);
      expect(result).toEqual([
        { documentId: "a", score: 1.0 },
        { documentId: "b", score: 0.0 },
      ]);
    });
  });

  describe("min-max normalization (out-of-range scores)", () => {
    it("normalizes scores above 1.0", () => {
      const input: RawScore[] = [
        { documentId: "a", score: 5.0 },
        { documentId: "b", score: 3.0 },
        { documentId: "c", score: 1.0 },
      ];
      const result = normalizeScores(input);
      expect(result[0]).toEqual({ documentId: "a", score: 1.0 });
      expect(result[1]).toEqual({ documentId: "b", score: 0.5 });
      expect(result[2]).toEqual({ documentId: "c", score: 0.0 });
    });

    it("normalizes negative scores", () => {
      const input: RawScore[] = [
        { documentId: "a", score: 2.0 },
        { documentId: "b", score: -1.0 },
        { documentId: "c", score: -4.0 },
      ];
      const result = normalizeScores(input);
      // min = -4, max = 2, range = 6
      expect(result[0]).toEqual({ documentId: "a", score: 1.0 }); // (2 - -4)/6 = 1
      expect(result[1]).toEqual({ documentId: "b", score: 0.5 }); // (-1 - -4)/6 = 0.5
      expect(result[2]).toEqual({ documentId: "c", score: 0.0 }); // (-4 - -4)/6 = 0
    });

    it("maps min to 0 and max to 1", () => {
      const input: RawScore[] = [
        { documentId: "a", score: 10.0 },
        { documentId: "b", score: 7.0 },
        { documentId: "c", score: 4.0 },
      ];
      const result = normalizeScores(input);
      expect(result[0].score).toBe(1.0);
      expect(result[2].score).toBe(0.0);
    });

    it("handles all identical out-of-range scores", () => {
      const input: RawScore[] = [
        { documentId: "a", score: 5.0 },
        { documentId: "b", score: 5.0 },
        { documentId: "c", score: 5.0 },
      ];
      const result = normalizeScores(input);
      // All identical → all get 1.0
      expect(result).toEqual([
        { documentId: "a", score: 1.0 },
        { documentId: "b", score: 1.0 },
        { documentId: "c", score: 1.0 },
      ]);
    });
  });

  describe("relative ordering preservation", () => {
    it("preserves relative ordering during normalization", () => {
      const input: RawScore[] = [
        { documentId: "a", score: 8.0 },
        { documentId: "b", score: 3.0 },
        { documentId: "c", score: 6.0 },
        { documentId: "d", score: 1.0 },
      ];
      const result = normalizeScores(input);

      // a > c > b > d in raw scores, same ordering in normalized
      expect(result[0].score).toBeGreaterThan(result[2].score); // a > c
      expect(result[2].score).toBeGreaterThan(result[1].score); // c > b
      expect(result[1].score).toBeGreaterThan(result[3].score); // b > d
    });

    it("preserves ordering when pass-through applies", () => {
      const input: RawScore[] = [
        { documentId: "a", score: 0.9 },
        { documentId: "b", score: 0.2 },
        { documentId: "c", score: 0.7 },
      ];
      const result = normalizeScores(input);
      expect(result[0].score).toBeGreaterThan(result[2].score);
      expect(result[2].score).toBeGreaterThan(result[1].score);
    });
  });

  describe("document ID preservation", () => {
    it("preserves document IDs through normalization", () => {
      const input: RawScore[] = [
        { documentId: "doc-alpha", score: 15.0 },
        { documentId: "doc-beta", score: 5.0 },
        { documentId: "doc-gamma", score: 10.0 },
      ];
      const result = normalizeScores(input);
      expect(result.map((r) => r.documentId)).toEqual([
        "doc-alpha",
        "doc-beta",
        "doc-gamma",
      ]);
    });
  });
});
