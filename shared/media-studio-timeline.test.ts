import { describe, expect, it } from "vitest";
import { shotTimelineStarts, type ShotView } from "./media-studio.js";

/**
 * Where each shot sits on the timeline. One function answers this for the screen and for
 * the reel, because two answers is how a cut stops matching the timeline that approved it.
 */

type Timed = Parameters<typeof shotTimelineStarts>[0][number];

const shot = (over: Partial<ShotView> & { id: number }): Timed => ({
  id: over.id,
  durationSeconds: over.durationSeconds ?? 5,
  track: over.track,
  startTimeSeconds: over.startTimeSeconds ?? null,
  trimInSeconds: over.trimInSeconds ?? null,
  trimOutSeconds: over.trimOutSeconds ?? null,
  holdDurationSeconds: over.holdDurationSeconds ?? null,
  anchorShotId: over.anchorShotId ?? null,
  anchorOffsetSeconds: over.anchorOffsetSeconds ?? null,
});

describe("where a shot starts on the timeline", () => {
  it("lays primary shots end to end", () => {
    expect(shotTimelineStarts([
      shot({ id: 1, durationSeconds: 4 }),
      shot({ id: 2, durationSeconds: 6 }),
      shot({ id: 3, durationSeconds: 5 }),
    ])).toEqual([0, 4, 10]);
  });

  it("measures a trimmed shot by what actually plays, plus any held frame", () => {
    // 4s trimmed to 1–3, then held for 1: two seconds of footage and one frozen.
    expect(shotTimelineStarts([
      shot({ id: 1, durationSeconds: 4, trimInSeconds: 1, trimOutSeconds: 3, holdDurationSeconds: 1 }),
      shot({ id: 2, durationSeconds: 5 }),
    ])).toEqual([0, 3]);
  });

  it("hangs a cutaway off its anchor, and moves it when the anchor moves", () => {
    const cutaway = shot({ id: 9, track: 2, durationSeconds: 2, anchorShotId: 2, anchorOffsetSeconds: 1.5 });
    expect(shotTimelineStarts([
      shot({ id: 1, durationSeconds: 4 }),
      shot({ id: 2, durationSeconds: 6 }),
      cutaway,
    ])).toEqual([0, 4, 5.5]);

    // The shot BEFORE the anchor is trimmed by two seconds. The cutaway is still 1.5s
    // into shot 2, which is the whole point: it stays on the moment it was cut to.
    expect(shotTimelineStarts([
      shot({ id: 1, durationSeconds: 4, trimOutSeconds: 2 }),
      shot({ id: 2, durationSeconds: 6 }),
      cutaway,
    ])).toEqual([0, 2, 3.5]);
  });

  it("falls back to the stored second for a cutaway made before anchors existed", () => {
    expect(shotTimelineStarts([
      shot({ id: 1, durationSeconds: 4 }),
      shot({ id: 9, track: 2, durationSeconds: 2, startTimeSeconds: 3 }),
    ])).toEqual([0, 3]);
  });

  it("does not let an overlay take a place in the primary run", () => {
    // The cutaway sits over shot 2; shot 3 still follows shot 2, not the cutaway.
    expect(shotTimelineStarts([
      shot({ id: 1, durationSeconds: 4 }),
      shot({ id: 9, track: 2, durationSeconds: 2, anchorShotId: 1, anchorOffsetSeconds: 0 }),
      shot({ id: 2, durationSeconds: 6 }),
    ])).toEqual([0, 0, 4]);
  });

  it("puts a cutaway whose anchor is gone at the start rather than guessing", () => {
    expect(shotTimelineStarts([
      shot({ id: 1, durationSeconds: 4 }),
      shot({ id: 9, track: 2, durationSeconds: 2, anchorShotId: 404, anchorOffsetSeconds: 2 }),
    ])).toEqual([0, 0]);
  });
});
