/**
 * Media Studio's view of a film scene: its shots, each shot's takes, and any audio
 * stems laid against them.
 *
 * The studio shows only what it is given. It invents no shots, statuses, spend or
 * render activity; a simulated take says so and has no video.
 */

export const MEDIA_ASPECT_RATIOS = ["16:9", "9:16", "2.39:1", "4:3", "1:1"] as const;
export type MediaAspectRatio = (typeof MEDIA_ASPECT_RATIOS)[number];

export type ShotTakeStatus =
  | "pending_approval"
  | "queued"
  | "rendering"
  | "ready_for_review"
  | "approved"
  | "rejected"
  | "simulated"
  | "failed";

export const TAKE_STATUS_LABEL: Record<ShotTakeStatus, string> = {
  pending_approval: "Waiting for approval",
  queued: "Queued",
  rendering: "Rendering",
  ready_for_review: "Ready for review",
  approved: "Approved",
  rejected: "Rejected",
  simulated: "Simulated",
  failed: "Failed",
};

export type DefectClass =
  | "character_drift"
  | "unnatural_motion"
  | "wrong_framing"
  | "lighting_mismatch"
  | "artifact_glitch";

export type ShotTransition = "cut" | "crossfade" | "dip_to_black";

import type { AssemblyView, TakeWorkflowSnapshot } from "@shared/media-studio";

export interface MediaTakeStreamingState {
  step?: number;
  currentStep?: number;
  totalSteps: number;
  percent?: number;
  etaSeconds?: number;
  etc?: string;
  previewUrl?: string;
  activeNodeId?: string;
  activeNodeLabel?: string;
  activeNodeTitle?: string;
}

export interface MediaShotTake {
  takeId: string;
  takeNumber: number;
  prompt: string;
  negativePrompt?: string;
  cameraMotion?: string;
  seed?: string | number;
  characterAnchorId?: string;
  /** Present only when a video exists for the take. */
  videoUrl?: string;
  thumbnailUrl?: string;
  keyframeUrl?: string;
  status: ShotTakeStatus;
  durationSeconds: number;
  costUsd?: number;
  defectClass?: DefectClass;
  notes?: string;
  workflowSnapshot?: TakeWorkflowSnapshot;
  streaming?: MediaTakeStreamingState;
}

export interface MediaShot {
  shotNumber: number;
  sceneId: string;
  takes: MediaShotTake[];
  /** The take the scene uses. */
  activeTakeIndex: number;
  durationSeconds: number;
  actionDescription?: string;
  storyboardUrl?: string;
  /** The transition into the next shot. */
  transition?: ShotTransition;
  /** Custom transition duration in seconds (defaults to standard 0.75s / 1.0s). */
  transitionDurationSeconds?: number;
  /** Track index: 1 = V1 Primary Magnetic, 2 = V2 Overlay/Cutaway (defaults to 1). */
  track?: number;
  /** Explicit timeline start offset in seconds. If omitted, computed sequentially on V1. */
  startTimeSeconds?: number;
  /** In-point trim offset within the source asset in seconds (default 0). */
  trimInSeconds?: number;
  /** Out-point trim offset within the source asset in seconds (default durationSeconds). */
  trimOutSeconds?: number;
  /** Total duration of the underlying raw generated asset in seconds. */
  sourceDurationSeconds?: number;
  /** Freeze frame extension duration in seconds beyond source asset. */
  holdDurationSeconds?: number;
  /** The primary shot a cutaway hangs off, and how far into it it begins. */
  anchorShotId?: number;
  anchorOffsetSeconds?: number;
  /** The shot's own id, for anchoring; absent on a shot built by hand in a fixture. */
  shotId?: number;
}

export type AudioStemType = "dialogue" | "ambience" | "score" | "sfx";

export interface MediaAudioStem {
  id: string;
  type: AudioStemType;
  title: string;
  audioUrl: string;
  volumeDb: number;
  durationSeconds: number;
  startTimeSeconds: number;
  isMuted?: boolean;
  isSolo?: boolean;
}

/** The timeline fields a shot can be edited into, as the studio saves them. */
export interface MediaShotTimelinePatch {
  durationSeconds?: number;
  track?: number;
  startTimeSeconds?: number | null;
  trimInSeconds?: number | null;
  trimOutSeconds?: number | null;
  holdDurationSeconds?: number | null;
  anchorShotId?: number | null;
  anchorOffsetSeconds?: number | null;
}

export interface MediaStudioPodProps {
  sceneId: string;
  sceneTitle: string;
  aspectRatio?: MediaAspectRatio;
  /** Shots that exist. With none, the studio says the scene is empty. */
  shots?: MediaShot[];
  audioStems?: MediaAudioStem[];
  /** The chat is collapsed and the studio has the room. */
  isFocusMode?: boolean;
  onToggleFocusMode?: () => void;
  onClose?: () => void;
  /** Review actions appear only when something handles them. */
  onApproveTake?: (sceneId: string, shotNumber: number, takeId: string) => void;
  onRerollTake?: (sceneId: string, shotNumber: number, takeId: string, defect: DefectClass, promptDelta?: string) => void;
  onChangeTransition?: (shotNumber: number, transition: ShotTransition, durationSeconds?: number) => void;
  /** Sends the take on screen to the chat. */
  onDiscussTake?: (sceneId: string, shotNumber: number, takeId: string) => void;
  /** Mounts or opens Form Studio for configuring ComfyUI recipe parameters. */
  onOpenFormStudio?: (formDefinition: any) => void;
  /** Updates parameters on the take on screen. */
  onUpdateTakeParams?: (shotNumber: number, takeIndex: number, params: Record<string, any>) => void;
  /** Adds a shot to an empty scene, from its empty state. */
  onAddShot?: () => void;
  /** Opens the storyboard from an empty scene, to make shots from its approved keyframes. */
  onOpenStoryboard?: () => void;
  /** Asks for a take of the shot on screen when it has none. */
  onRequestTake?: (sceneId: string, shotNumber: number) => void;
  /** Puts this shot on screen whenever it changes, e.g. when the configuration rail names it. */
  focusShotNumber?: number;
  /** Changes to put the named shot on screen again, e.g. a status filter pressed twice. */
  focusKey?: number | string;
  /** Director Deck or Pipeline Graph. Without it, the pod starts on Director Deck. */
  viewMode?: "director" | "graph";
  onViewModeChange?: (mode: "director" | "graph") => void;
  /** The shot on screen, by number, whenever it changes. */
  onActiveShotChange?: (shotNumber: number | null) => void;
  /**
   * Saves a timeline edit — a trim, a move onto the overlay track, a held frame.
   * Without it the sequencer still edits, but only until the page is reloaded, so a
   * studio that can save must pass it.
   */
  onPersistShotTimeline?: (shotNumber: number, patch: MediaShotTimelinePatch) => void;
  /**
   * The assembled cut, for the viewer's Reel mode. Without it the viewer shows takes
   * only, which is what an embedded card wants.
   */
  program?: { label: string; assembly: AssemblyView | null };
  /** Whether the sequencer is focused on current scene or master film. */
  timelineScope?: "scene" | "film";
  onTimelineScopeChange?: (scope: "scene" | "film") => void;
  onSelectTakeForShot?: (shotNumber: number, takeIndex: number) => void;
  className?: string;
}

