/**
 * Automated Identity-Drift Verification Engine.
 *
 * Implements mathematical vector cosine similarity evaluation against 512-dimensional
 * reference face embeddings (InsightFace / ArcFace), gating generated video takes
 * before timeline assembly and identifying 'character_drift' defects.
 */

export interface DriftVerificationResult {
  passed: boolean;
  meanSimilarityScore: number;
  minSimilarityScore: number;
  threshold: number;
  defectClass?: "character_drift";
  action: "ACCEPT" | "REGENERATE_WITH_STRONGER_CONDITIONING";
  mitigations?: {
    recommendedDurationReductionPercent: number;
    recommendedIpAdapterWeightIncrease: number;
    recommendedFirstFrameConditioningWeightIncrease: number;
  };
}

/**
 * Computes cosine similarity between two numeric vectors.
 * Dot product divided by the product of their L2 norms.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dot / denominator;
}

/**
 * Verifies character face consistency across extracted video frame embeddings.
 *
 * @param frameEmbeddings Array of 512D face embeddings extracted from video frames
 * @param referenceFaceEmbedding The character's canonical 512D reference embedding
 * @param similarityThreshold Baseline threshold (default 0.72)
 */
export function verifyCharacterConsistency(
  frameEmbeddings: number[][],
  referenceFaceEmbedding: number[],
  similarityThreshold: number = 0.72
): DriftVerificationResult {
  if (!frameEmbeddings.length) {
    return {
      passed: false,
      meanSimilarityScore: 0,
      minSimilarityScore: 0,
      threshold: similarityThreshold,
      defectClass: "character_drift",
      action: "REGENERATE_WITH_STRONGER_CONDITIONING",
      mitigations: {
        recommendedDurationReductionPercent: 20,
        recommendedIpAdapterWeightIncrease: 0.15,
        recommendedFirstFrameConditioningWeightIncrease: 0.2,
      },
    };
  }

  const frameScores: number[] = frameEmbeddings.map((emb) =>
    cosineSimilarity(referenceFaceEmbedding, emb)
  );

  const sum = frameScores.reduce((acc, score) => acc + score, 0);
  const avg = sum / frameScores.length;
  const min = Math.min(...frameScores);

  const minFloor = similarityThreshold - 0.12;
  const passed = avg >= similarityThreshold && min > minFloor;

  const result: DriftVerificationResult = {
    passed,
    meanSimilarityScore: Number(avg.toFixed(3)),
    minSimilarityScore: Number(min.toFixed(3)),
    threshold: similarityThreshold,
    action: passed ? "ACCEPT" : "REGENERATE_WITH_STRONGER_CONDITIONING",
  };

  if (!passed) {
    result.defectClass = "character_drift";
    result.mitigations = {
      recommendedDurationReductionPercent: 20,
      recommendedIpAdapterWeightIncrease: 0.15,
      recommendedFirstFrameConditioningWeightIncrease: 0.2,
    };
  }

  return result;
}
