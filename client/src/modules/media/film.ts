import type { SceneView } from "@shared/media-studio";
import type { DefectClass, MediaShot, ShotTakeStatus } from "./types";

export interface PromptStep {
  takeId: string;
  takeNumber: number;
  prompt: string;
  status: ShotTakeStatus;
  /** The prompt differs from the take before it. */
  changed: boolean;
  /** Why the take before it was re-shot, when the re-shoot said. */
  after?: { takeNumber: number; defectClass: DefectClass; notes?: string };
}

/** A shot's takes in order, with whether each prompt changed from the last and why. */
export function promptHistory(shot: Pick<MediaShot, "takes">): PromptStep[] {
  const takes = [...shot.takes].sort((a, b) => a.takeNumber - b.takeNumber);
  return takes.map((take, index) => {
    const previous = takes[index - 1];
    return {
      takeId: take.takeId,
      takeNumber: take.takeNumber,
      prompt: take.prompt,
      status: take.status,
      changed: Boolean(previous) && previous.prompt.trim() !== take.prompt.trim(),
      ...(previous?.defectClass
        ? { after: { takeNumber: previous.takeNumber, defectClass: previous.defectClass, ...(previous.notes ? { notes: previous.notes } : {}) } }
        : {}),
    };
  });
}

/**
 * A saved scene's shots and takes, as the Film view draws them. The take a shot uses
 * is its approved take, else its latest.
 */
export function toFilmShots(scene: SceneView): MediaShot[] {
  return scene.shots.map((shot, index) => {
    const approved = shot.takes.findIndex((take) => take.status === "approved");
    return {
      shotNumber: index + 1,
      sceneId: scene.sceneKey,
      durationSeconds: shot.durationSeconds,
      transition: shot.transition,
      transitionDurationSeconds: shot.transitionDurationSeconds ?? undefined,
      track: shot.track,
      startTimeSeconds: shot.startTimeSeconds ?? undefined,
      trimInSeconds: shot.trimInSeconds ?? undefined,
      trimOutSeconds: shot.trimOutSeconds ?? undefined,
      holdDurationSeconds: shot.holdDurationSeconds ?? undefined,
      anchorShotId: shot.anchorShotId ?? undefined,
      anchorOffsetSeconds: shot.anchorOffsetSeconds ?? undefined,
      shotId: shot.id,
      activeTakeIndex: approved >= 0 ? approved : Math.max(0, shot.takes.length - 1),
      takes: shot.takes.map((take) => ({
        takeId: String(take.id),
        takeNumber: take.takeNumber,
        prompt: take.prompt,
        negativePrompt: take.negativePrompt ?? undefined,
        cameraMotion: take.cameraMotion ?? undefined,
        seed: take.seed ?? undefined,
        videoUrl: take.videoUrl ?? undefined,
        status: take.status,
        durationSeconds: take.durationSeconds,
        // Only what a render that was sent cost: not a take's estimate while it waits, nor a simulation's nothing.
        costUsd: take.mode === "live" && take.status !== "pending_approval" && take.costCents > 0 ? take.costCents / 100 : undefined,
        defectClass: take.defectClass ?? undefined,
        notes: take.notes ?? undefined,
        streaming: take.streaming,
      })),
    };
  });
}
