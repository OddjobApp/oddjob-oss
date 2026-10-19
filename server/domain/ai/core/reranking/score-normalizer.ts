/**
 * Score Normalizer — Ensures consistent [0.0, 1.0] scoring across all backends.
 *
 * All reranking backends produce raw scores in backend-specific ranges.
 * This module normalizes those scores to a consistent [0.0, 1.0] range
 * while preserving relative ordering.
 *
 * Algorithm:
 * 1. Empty array → return empty
 * 2. Single document → assign score 1.0
 * 3. All scores already in [0.0, 1.0] → pass through unchanged
 * 4. Any score outside [0.0, 1.0] → apply min-max normalization
 * 5. Relative ordering is always preserved
 */

import type { RawScore } from "./backends/rerank-backend.interface.js";

/** A normalized score guaranteed to be in [0.0, 1.0]. */
export interface NormalizedScore {
  documentId: string;
  score: number; // Guaranteed [0.0, 1.0]
}

/**
 * Normalize raw backend scores to the [0.0, 1.0] range.
 *
 * - If the input is empty, returns an empty array.
 * - If there is a single document, assigns score 1.0.
 * - If all scores are already within [0.0, 1.0], passes them through unchanged.
 * - If any score falls outside [0.0, 1.0], applies min-max normalization
 *   (minimum → 0.0, maximum → 1.0, intermediate values proportionally scaled).
 *
 * Relative ordering is always preserved.
 */
export function normalizeScores(rawScores: RawScore[]): NormalizedScore[] {
  // Case 1: Empty array
  if (rawScores.length === 0) {
    return [];
  }

  // Case 2: Single document — assign 1.0
  if (rawScores.length === 1) {
    return [{ documentId: rawScores[0].documentId, score: 1.0 }];
  }

  // Determine if any score is outside [0.0, 1.0]
  const needsNormalization = rawScores.some(
    (rs) => rs.score < 0.0 || rs.score > 1.0
  );

  // Case 3: All scores in range — pass through unchanged
  if (!needsNormalization) {
    return rawScores.map((rs) => ({
      documentId: rs.documentId,
      score: rs.score,
    }));
  }

  // Case 4: Apply min-max normalization
  const scores = rawScores.map((rs) => rs.score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min;

  // If all scores are identical (range === 0), assign 1.0 to all
  if (range === 0) {
    return rawScores.map((rs) => ({
      documentId: rs.documentId,
      score: 1.0,
    }));
  }

  return rawScores.map((rs) => ({
    documentId: rs.documentId,
    score: (rs.score - min) / range,
  }));
}
