import { describe, expect, it } from "vitest";
import { calibrateSourceConfidence, SOURCE_REVIEW_SCORES } from "./copilot-observability.service.js";

describe("Copilot source confidence calibration", () => {
  it("preserves original confidence before review evidence exists", () => {
    expect(calibrateSourceConfidence(0.8, [])).toEqual({
      calibratedConfidence: 0.8,
      sampleSize: 0,
      meanOutcome: null,
      meanAbsoluteError: null,
    });
  });

  it("lowers confidence as irrelevant outcomes accumulate", () => {
    const oneReview = calibrateSourceConfidence(0.9, [{ originalConfidence: 0.9, outcomeScore: 0 }]);
    const sixReviews = calibrateSourceConfidence(0.9, Array.from({ length: 6 }, () => ({ originalConfidence: 0.9, outcomeScore: 0 })));
    expect(oneReview.calibratedConfidence).toBeCloseTo(0.75);
    expect(sixReviews.calibratedConfidence).toBeLessThan(oneReview.calibratedConfidence);
    expect(sixReviews.meanAbsoluteError).toBeCloseTo(0.9);
  });

  it("supports partial relevance and clamps invalid external scores", () => {
    expect(SOURCE_REVIEW_SCORES.partially_relevant).toBe(0.5);
    expect(calibrateSourceConfidence(2, []).calibratedConfidence).toBe(1);
    expect(calibrateSourceConfidence(-1, []).calibratedConfidence).toBe(0);
  });
});
