import { describe, expect, it } from "vitest";
import { matchesShotFilter, matchesShotSearch, nextMatchingShot, sceneNeedsDecision, shotProgress, shotStatus, stepLabel, takeCounts } from "./status";
import { scene, shot, take } from "./fixtures";

describe("where shots stand", () => {
  const approved = shot({ id: 1, takes: [take({ id: 1, takeNumber: 1, status: "failed" }), take({ id: 2, takeNumber: 2, status: "approved" })] });
  const reviewing = shot({ id: 2, prompt: "Wide on the stairwell", dialogue: [{ speaker: "Elena", line: "Not yet." }], takes: [take({ id: 3, status: "ready_for_review" })] });
  const failing = shot({ id: 3, durationSeconds: 8, takes: [take({ id: 4, takeNumber: 1, status: "rejected" }), take({ id: 5, takeNumber: 2, status: "failed" })] });
  const empty = shot({ id: 4, takes: [] });
  const shots = [approved, reviewing, failing, empty];

  it("says where each shot stands, and counts takes by status", () => {
    expect(shots.map(shotStatus)).toEqual(["approved", "ready_for_review", "failed", "none"]);
    expect(takeCounts(shots)).toMatchObject({ approved: 1, ready_for_review: 1, failed: 2, rejected: 1, rendering: 0 });
    expect(shotProgress([scene({ shots })])).toEqual({ approved: 1, total: 4 });
  });

  it("filters by what needs a decision, and counts a shot as failed only when its latest take failed", () => {
    expect(shots.filter((s) => matchesShotFilter(s, "failed")).map((s) => s.id)).toEqual([3]);
    expect(shots.filter((s) => matchesShotFilter(s, "ready_for_review")).map((s) => s.id)).toEqual([2]);
    expect(shots.filter((s) => matchesShotFilter(s, "unapproved")).map((s) => s.id)).toEqual([2, 3, 4]);
    expect(sceneNeedsDecision(scene({ shots: [approved, empty] }))).toBe(false);
    expect(sceneNeedsDecision(scene({ shots }))).toBe(true);
  });

  it("finds shots by direction, dialogue or length, and steps round the scene to the next match", () => {
    expect(matchesShotSearch(reviewing, "elena STAIRWELL")).toBe(true);
    expect(matchesShotSearch(reviewing, "rooftop")).toBe(false);
    expect(matchesShotSearch(failing, "8s")).toBe(true);
    expect(nextMatchingShot(shots, 1, "unapproved")).toBe(2);
    expect(nextMatchingShot(shots, 3, "unapproved")).toBe(1);
    expect(nextMatchingShot(shots, -1, "ready_for_review")).toBe(1);
    expect(nextMatchingShot([approved], 0, "failed")).toBeNull();
  });
});

describe("stepLabel", () => {
  it("counts the sampler's steps once it has reported them", () => {
    expect(stepLabel({ currentStep: 6, step: 6, totalSteps: 20 })).toBe("Step 6 of 20");
    expect(stepLabel({ step: 3, totalSteps: 20 })).toBe("Step 3 of 20");
  });

  it("says Starting rather than inventing a denominator", () => {
    // A take that has started but whose sampler has not reported carries no total,
    // and "Step 0 of 20" would put a number on screen the server never sent.
    expect(stepLabel({ currentStep: 0, step: 0, totalSteps: 0 })).toBe("Starting");
  });
});
