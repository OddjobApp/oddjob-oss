export type SourceReviewOutcome = "relevant" | "partially_relevant" | "irrelevant";

export const SOURCE_REVIEW_SCORES: Record<SourceReviewOutcome, number> = {
  relevant: 1,
  partially_relevant: 0.5,
  irrelevant: 0,
};

export interface ConfidenceReview {
  originalConfidence: number;
  outcomeScore: number;
}

/**
 * Shrinks a source's empirical review score toward the current retrieval score.
 * Five pseudo-observations prevent one review from causing a large confidence jump.
 */
export function calibrateSourceConfidence(originalConfidence: number, reviews: ConfidenceReview[]) {
  const boundedOriginal = Math.max(0, Math.min(1, originalConfidence));
  if (reviews.length === 0) {
    return { calibratedConfidence: boundedOriginal, sampleSize: 0, meanOutcome: null, meanAbsoluteError: null };
  }

  const meanOutcome = reviews.reduce((sum, review) => sum + review.outcomeScore, 0) / reviews.length;
  const evidenceWeight = reviews.length / (reviews.length + 5);
  const calibratedConfidence = boundedOriginal * (1 - evidenceWeight) + meanOutcome * evidenceWeight;
  const meanAbsoluteError = reviews.reduce(
    (sum, review) => sum + Math.abs(review.originalConfidence - review.outcomeScore),
    0,
  ) / reviews.length;

  return {
    calibratedConfidence: Math.max(0, Math.min(1, calibratedConfidence)),
    sampleSize: reviews.length,
    meanOutcome,
    meanAbsoluteError,
  };
}
