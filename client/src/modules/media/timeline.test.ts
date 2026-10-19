import { describe, expect, it } from "vitest";
import { locateMultiTrackTimelineTime, locateTimelineTime, shotOffsets, totalDuration } from "./timeline";
import type { MediaShot } from "./types";

const shots = [{ durationSeconds: 4 }, { durationSeconds: 5 }, { durationSeconds: 3 }];

describe("a scene's clock", () => {
  it("starts each shot where the one before it ends", () => {
    expect(shotOffsets(shots)).toEqual([0, 4, 9]);
    expect(totalDuration(shots)).toBe(12);
  });

  it("finds the shot playing at a moment, and how far into it", () => {
    expect(locateTimelineTime(shots, 0)).toEqual({ shotIndex: 0, offsetSeconds: 0 });
    expect(locateTimelineTime(shots, 4)).toEqual({ shotIndex: 1, offsetSeconds: 0 });
    expect(locateTimelineTime(shots, 6.5)).toEqual({ shotIndex: 1, offsetSeconds: 2.5 });
    expect(locateTimelineTime(shots, 12)).toEqual({ shotIndex: 2, offsetSeconds: 3 });
  });

  it("keeps a moment inside the scene", () => {
    expect(locateTimelineTime(shots, -1)).toEqual({ shotIndex: 0, offsetSeconds: 0 });
    expect(locateTimelineTime(shots, 99)).toEqual({ shotIndex: 2, offsetSeconds: 3 });
    expect(locateTimelineTime(shots, Number.NaN)).toEqual({ shotIndex: 0, offsetSeconds: 0 });
    expect(locateTimelineTime([], 3)).toBeNull();
  });

  it("locates multi-track shots with overlapping V2 cutaways", () => {
    const multiTrackShots: MediaShot[] = [
      { shotNumber: 1, sceneId: "s1", durationSeconds: 6, track: 1, activeTakeIndex: 0, takes: [] },
      { shotNumber: 2, sceneId: "s1", durationSeconds: 6, track: 1, activeTakeIndex: 0, takes: [] },
      { shotNumber: 3, sceneId: "s1", durationSeconds: 3, track: 2, startTimeSeconds: 2, activeTakeIndex: 0, takes: [] },
    ];

    // At 1s: Only V1 shot 1
    const loc1 = locateMultiTrackTimelineTime(multiTrackShots, 1);
    expect(loc1).toEqual({ v1ShotIndex: 0, v1OffsetSeconds: 1, v2ShotIndex: undefined, v2OffsetSeconds: undefined });

    // At 3s: V1 shot 1 (at 3s) AND V2 cutaway shot 3 (at 1s into its 3s length)
    const loc2 = locateMultiTrackTimelineTime(multiTrackShots, 3);
    expect(loc2).toEqual({ v1ShotIndex: 0, v1OffsetSeconds: 3, v2ShotIndex: 2, v2OffsetSeconds: 1 });

    // At 5.5s: V2 cutaway has ended (2 to 5s), now back to pure V1
    const loc3 = locateMultiTrackTimelineTime(multiTrackShots, 5.5);
    expect(loc3).toEqual({ v1ShotIndex: 0, v1OffsetSeconds: 5.5, v2ShotIndex: undefined, v2OffsetSeconds: undefined });

    // At 8s: V1 shot 2 (at 2s into its 6s length)
    const loc4 = locateMultiTrackTimelineTime(multiTrackShots, 8);
    expect(loc4).toEqual({ v1ShotIndex: 1, v1OffsetSeconds: 2, v2ShotIndex: undefined, v2OffsetSeconds: undefined });
  });
});

