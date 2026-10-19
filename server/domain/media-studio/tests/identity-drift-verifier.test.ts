import { describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  verifyCharacterConsistency,
} from "../core/identity-drift-verifier.js";

describe("Automated Identity-Drift Verifier", () => {
  it("computes exact cosine similarity between identical vectors", () => {
    const vec = [0.5, 0.5, 0.5, 0.5];
    expect(cosineSimilarity(vec, vec)).toBeCloseTo(1.0, 5);
  });

  it("computes 0 similarity for orthogonal vectors", () => {
    const vecA = [1, 0];
    const vecB = [0, 1];
    expect(cosineSimilarity(vecA, vecB)).toBe(0);
  });

  it("computes -1 for opposite vectors", () => {
    const vecA = [1, 0];
    const vecB = [-1, 0];
    expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(-1.0, 5);
  });

  it("passes video when all frames meet the 0.72 similarity threshold", () => {
    const reference = new Array(512).fill(0.1);
    // Slight noise around reference (high similarity)
    const frame1 = reference.map((x) => x + 0.005);
    const frame2 = reference.map((x) => x - 0.002);
    const frame3 = reference.map((x) => x + 0.001);

    const result = verifyCharacterConsistency([frame1, frame2, frame3], reference, 0.72);

    expect(result.passed).toBe(true);
    expect(result.action).toBe("ACCEPT");
    expect(result.meanSimilarityScore).toBeGreaterThanOrEqual(0.72);
    expect(result.defectClass).toBeUndefined();
  });

  it("fails and flags character_drift when identity drift occurs (e.g. fast camera swing)", () => {
    const reference = new Array(512).fill(0.1);
    // Warped or drifting face embeddings
    const frame1 = reference.map((x) => x * 0.9);
    const driftedFrame = new Array(512).fill(0).map((_, i) => (i % 2 === 0 ? 0.1 : -0.1));

    const result = verifyCharacterConsistency([frame1, driftedFrame], reference, 0.72);

    expect(result.passed).toBe(false);
    expect(result.action).toBe("REGENERATE_WITH_STRONGER_CONDITIONING");
    expect(result.defectClass).toBe("character_drift");
    expect(result.mitigations).toBeDefined();
    expect(result.mitigations?.recommendedDurationReductionPercent).toBe(20);
    expect(result.mitigations?.recommendedIpAdapterWeightIncrease).toBe(0.15);
  });

  it("handles empty frame arrays gracefully by failing with defectClass character_drift", () => {
    const reference = new Array(512).fill(0.1);
    const result = verifyCharacterConsistency([], reference, 0.72);

    expect(result.passed).toBe(false);
    expect(result.defectClass).toBe("character_drift");
    expect(result.action).toBe("REGENERATE_WITH_STRONGER_CONDITIONING");
  });
});
