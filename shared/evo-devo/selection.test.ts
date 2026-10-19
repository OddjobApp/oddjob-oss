import { describe, expect, it } from "vitest";
import { paretoFront } from "./selection.js";
import type { EvaluatedIndividual } from "./contracts.js";

const candidate = (genomeId: string, overrides: Partial<EvaluatedIndividual["fitness"]> = {}): EvaluatedIndividual => ({
  genomeId, phenotypeHash: `hash:${genomeId}`, eligible: true, ineligibilityReasons: [],
  fitness: { outcome: 0.8, reliability: 0.9, safety: 1, humanExperience: 0.8, costUsd: 1, latencyMs: 1000, sampleSize: 100, ...overrides },
});
const constraints = { minimumSafety: 0.95, minimumReliability: 0.8, minimumSampleSize: 30 };

describe("paretoFront", () => {
  it("retains genuine tradeoffs and removes dominated candidates", () => {
    const front = paretoFront([
      candidate("balanced"),
      candidate("cheap", { outcome: 0.75, costUsd: 0.2 }),
      candidate("dominated", { outcome: 0.7, reliability: 0.85, costUsd: 2, latencyMs: 1500 }),
    ], constraints);
    expect(front.map((item) => item.genomeId)).toEqual(["balanced", "cheap"]);
  });

  it("never selects an unsafe candidate even when its outcome is superior", () => {
    const front = paretoFront([candidate("safe"), candidate("unsafe-star", { outcome: 1, safety: 0.5 })], constraints);
    expect(front.map((item) => item.genomeId)).toEqual(["safe"]);
  });

  it("requires enough evidence before selection", () => {
    expect(paretoFront([candidate("under-tested", { sampleSize: 2 })], constraints)).toEqual([]);
  });
});

