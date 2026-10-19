import { shotTimelineStarts } from "@shared/media-studio";
import type { MediaShot } from "./types";

/**
 * One clock for a scene. The stage plays a take in its own seconds; the timeline
 * shows the whole scene. These convert between the two, so the scrubber, a click
 * on the timeline and a change of shot agree about where playback is.
 *
 * Where a shot SITS is worked out by `shotTimelineStarts` in shared/, the same
 * function the reel is cut with. Two implementations of that — one for the screen and
 * one for ffmpeg — is how a cut stops matching the timeline that approved it.
 */

type Timed = Pick<MediaShot, "durationSeconds"> &
  Partial<Pick<MediaShot, "track" | "startTimeSeconds" | "trimInSeconds" | "trimOutSeconds" | "holdDurationSeconds" | "anchorShotId" | "anchorOffsetSeconds" | "shotId">>;

const length = (shot: Timed) => Math.max(0, shot.durationSeconds);

/** What a clip occupies on the timeline: its trimmed span plus any freeze-hold. */
const played = (shot: Timed) => {
  const trimIn = shot.trimInSeconds ?? 0;
  const trimmed = shot.trimOutSeconds != null && shot.trimOutSeconds > trimIn
    ? shot.trimOutSeconds - trimIn
    : shot.durationSeconds;
  return Math.max(0, trimmed) + (shot.holdDurationSeconds ?? 0);
};

/** The shared resolver's shape. A shot with no id of its own gets a stable stand-in. */
const resolvable = (shots: Timed[]) => shots.map((shot, index) => ({
  id: shot.shotId ?? -(index + 1),
  durationSeconds: shot.durationSeconds,
  track: shot.track,
  startTimeSeconds: shot.startTimeSeconds ?? null,
  trimInSeconds: shot.trimInSeconds ?? null,
  trimOutSeconds: shot.trimOutSeconds ?? null,
  holdDurationSeconds: shot.holdDurationSeconds ?? null,
  anchorShotId: shot.anchorShotId ?? null,
  anchorOffsetSeconds: shot.anchorOffsetSeconds ?? null,
}));

/** Where each shot starts, in seconds from the start of the scene. */
export function shotOffsets(shots: Timed[]): number[] {
  return shotTimelineStarts(resolvable(shots));
}

/** The whole span, primary track and every overlay hung off it. */
export function totalDuration(shots: Timed[]): number {
  if (shots.length === 0) return 0;
  const starts = shotOffsets(shots);
  return shots.reduce((longest, shot, index) => Math.max(longest, starts[index] + played(shot)), 0);
}

/** The shot playing at a moment in the scene, and how far into it (V1 primary track). */
export function locateTimelineTime(shots: Timed[], seconds: number): { shotIndex: number; offsetSeconds: number } | null {
  if (shots.length === 0) return null;
  const clamped = Math.min(Math.max(0, Number.isFinite(seconds) ? seconds : 0), totalDuration(shots));
  const offsets = shotOffsets(shots);
  for (let i = shots.length - 1; i >= 0; i--) {
    if (clamped >= offsets[i] && (length(shots[i]) > 0 || i === 0)) {
      return { shotIndex: i, offsetSeconds: Math.min(clamped - offsets[i], length(shots[i])) };
    }
  }
  return { shotIndex: 0, offsetSeconds: 0 };
}

export interface MultiTrackTimeLocation {
  v1ShotIndex: number;
  v1OffsetSeconds: number;
  v2ShotIndex?: number;
  v2OffsetSeconds?: number;
}

/** Finds active shots on both V1 (primary narrative) and V2 (cutaway overlay) at a given timeline time. */
export function locateMultiTrackTimelineTime(shots: MediaShot[], seconds: number): MultiTrackTimeLocation | null {
  if (shots.length === 0) return null;
  const clamped = Math.min(Math.max(0, Number.isFinite(seconds) ? seconds : 0), totalDuration(shots));
  const offsets = shotOffsets(shots);

  let v1ShotIndex = 0;
  let v1OffsetSeconds = 0;
  let v2ShotIndex: number | undefined;
  let v2OffsetSeconds: number | undefined;

  // Search V1 tracks
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    if ((s.track ?? 1) === 1 && clamped >= offsets[i] && (length(s) > 0 || i === 0)) {
      v1ShotIndex = i;
      v1OffsetSeconds = Math.min(clamped - offsets[i], length(s));
      break;
    }
  }

  // Check if any V2 cutaway is active at this moment
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    if (s.track === 2) {
      const start = Math.max(0, s.startTimeSeconds ?? offsets[i] ?? 0);
      const dur = length(s);
      if (clamped >= start && clamped <= start + dur) {
        v2ShotIndex = i;
        v2OffsetSeconds = clamped - start;
        break;
      }
    }
  }

  return { v1ShotIndex, v1OffsetSeconds, v2ShotIndex, v2OffsetSeconds };
}

