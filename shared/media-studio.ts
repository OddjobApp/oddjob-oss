/**
 * Media Studio's shared vocabulary: what a production's rows may say, and which
 * files the platform will serve for it.
 *
 * The database checks (migration 0115) list the same values; change both together.
 */

import type { ProjectStyleBible } from "./style-bible.js";

export const MEDIA_ASPECT_RATIOS = ["16:9", "9:16", "2.39:1", "4:3", "1:1"] as const;
export type MediaAspectRatio = (typeof MEDIA_ASPECT_RATIOS)[number];

export const SHOT_TRANSITIONS = ["cut", "crossfade", "dip_to_black"] as const;
export type ShotTransition = (typeof SHOT_TRANSITIONS)[number];

/**
 * A live take waits for approval, is queued and renders, then is reviewed. A take
 * whose render was refused at approval is rejected without ever rendering. A
 * simulated take never has a video.
 */
export const TAKE_STATUSES = ["pending_approval", "queued", "rendering", "ready_for_review", "approved", "rejected", "failed", "simulated"] as const;
export type TakeStatus = (typeof TAKE_STATUSES)[number];

export const KEYFRAME_STATUSES = ["draft", "pending_approval", "rendering", "ready", "approved", "rejected", "failed"] as const;
export type KeyframeStatus = (typeof KEYFRAME_STATUSES)[number];

export const RENDER_MODES = ["live", "simulation"] as const;
export type RenderMode = (typeof RENDER_MODES)[number];

export const DEFECT_CLASSES = ["character_drift", "unnatural_motion", "wrong_framing", "lighting_mismatch", "artifact_glitch"] as const;
export type DefectClass = (typeof DEFECT_CLASSES)[number];

export const MEDIA_ASSET_KINDS = ["image", "video", "reel"] as const;
export type MediaAssetKind = (typeof MEDIA_ASSET_KINDS)[number];

/**
 * The only types the asset route serves, by kind. Anything else, HTML above all,
 * could be served back to a browser as a page on the platform's origin.
 */
export const MEDIA_ASSET_MIME_TYPES: Record<MediaAssetKind, readonly string[]> = {
  image: ["image/png", "image/jpeg", "image/webp"],
  video: ["video/mp4", "video/webm"],
  reel: ["video/mp4"],
};

export const MEDIA_ASSET_EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
};

export const mediaAssetUrl = (assetId: number) => `/api/media-studio/assets/${assetId}`;

/** Resolutions a take is rendered at. */
export const VIDEO_RESOLUTIONS = ["720p", "1080p"] as const;
export type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number];

/** How takes render: Seedance on fal.ai, or a ComfyUI server with an imported workflow (0120). */
export const VIDEO_ENGINES = ["fal", "comfyui"] as const;
export type VideoEngine = (typeof VIDEO_ENGINES)[number];

/** fal.ai's list price for Seedance 2.0, in cents per second of video. */
export const SEEDANCE_CENTS_PER_SECOND: Record<VideoResolution, number> = { "720p": 30.34, "1080p": 68.2 };

/** What a take of this length is expected to cost, rounded up to the cent. */
export const estimateTakeCents = (durationSeconds: number, resolution: VideoResolution) =>
  Math.ceil(durationSeconds * SEEDANCE_CENTS_PER_SECOND[resolution]);

/** Exactly what a take was, or would be, sent to the video model. */
import type { ComfyWorkflow, ComfyWorkflowSummary } from "./comfy-workflow";

export interface TakeRequest {
  prompt?: string;
  endpoint?: string;
  durationSeconds?: number;
  aspectRatio?: string;
  resolution?: VideoResolution;
  generateAudio?: boolean;
  /** The keyframe the take starts from; without one it renders from text alone. */
  referenceKeyframeId?: number | null;
  /** The next plot point's keyframe the take ends on, when asked. */
  endKeyframeId?: number | null;
  /** Character anchors used in this take, for continuity tracking. */
  characterAnchors?: Array<{ name: string; anchorId: string }>;
  /** A director's note added to this take only, e.g. from a re-shoot. */
  note?: string | null;
  /** The engine the take was asked for on; missing on takes from before 0120, which are fal's. */
  engine?: VideoEngine;
  /** ComfyUI: the workflow the take was asked with, kept so a later import cannot change it. Not sent to the browser. */
  workflow?: ComfyWorkflow;
  /** ComfyUI: the workflow's name, as the browser sees it. */
  workflowName?: string;
  /** ComfyUI: the seed every sampler gets. */
  seed?: number;
}

export const DEFECT_LABELS: Record<DefectClass, string> = {
  character_drift: "character drift",
  unnatural_motion: "unnatural motion",
  wrong_framing: "wrong framing",
  lighting_mismatch: "a lighting mismatch",
  artifact_glitch: "a render glitch",
};

// ── What /api/media-studio answers with ─────────────────────────────────────

/** One line the video model speaks. */
export interface DialogueLine {
  speaker: string;
  line: string;
  /** How it is said, e.g. "whispering". */
  delivery?: string;
}

/** A character or location from the production's Scribe manuscript. */
export interface CharacterView {
  id: number;
  kind: "character" | "location";
  name: string;
  description: string;
  aliases: string[];
  /** Whether this character is used in any rendered video takes with a character anchor. */
  inUseInVideo?: boolean;
}

/** Reference images keep a character's face and wardrobe, or a place, the same from frame to frame (0119). */
export const REFERENCE_KINDS = ["character", "location", "theme"] as const;

/** Whether a garment has a plate of its own, and how that render is going. */
export const WARDROBE_PLATE_STATUSES = ["none", "rendering", "ready", "failed"] as const;
export type WardrobePlateStatus = (typeof WARDROBE_PLATE_STATUSES)[number];

/**
 * One garment a character wears, from one scene onward.
 *
 * It holds until another garment for the same character supersedes it, so a
 * costume change is a new entry rather than an edit to an end date.
 */
export interface WardrobeView {
  id: number;
  characterName: string;
  garment: string;
  notes: string;
  /** The scene it starts at; null means from the production's first scene. */
  fromSceneId: number | null;
  fromSceneKey: string | null;
  plateStatus: WardrobePlateStatus;
  plateUrl: string | null;
  costCents: number;
  error: string | null;
}

/**
 * What each character wears in a scene: the latest garment that starts at or
 * before it.
 *
 * Pure, and shared, because the render path and the studio must agree about
 * which coat a scene is shot in. `scenePositions` maps a scene id to its place
 * in the production, which is what "at or before" is measured in; a garment with
 * no starting scene is worn from the beginning.
 */
export function wardrobeForScene(
  wardrobe: Pick<WardrobeView, "characterName" | "garment" | "notes" | "fromSceneId">[],
  scenePositions: Map<number, number>,
  scenePosition: number,
): Array<{ characterName: string; garment: string; notes: string }> {
  const worn = new Map<string, { at: number; entry: { characterName: string; garment: string; notes: string } }>();
  for (const item of wardrobe) {
    // A garment whose starting scene has been deleted falls back to the
    // beginning rather than vanishing: the costume was still worn.
    const at = item.fromSceneId == null ? -1 : scenePositions.get(item.fromSceneId) ?? -1;
    if (at > scenePosition) continue;
    const key = item.characterName.trim().toLowerCase();
    const held = worn.get(key);
    if (held && held.at >= at) continue;
    worn.set(key, { at, entry: { characterName: item.characterName, garment: item.garment, notes: item.notes } });
  }
  return [...worn.values()].map((held) => held.entry);
}

/** What a recorded decision was about. */
export const MEDIA_DECISION_KINDS = ["story", "scene_change", "style_bible"] as const;
export type MediaDecisionKind = (typeof MEDIA_DECISION_KINDS)[number];

/** One decision a production records: what was asked, and what it changed. */
export interface MediaDecisionView {
  id: number;
  kind: MediaDecisionKind;
  proposalId: string;
  sceneKey: string | null;
  /** What the author asked for, in their own words. */
  instruction: string;
  /** What it changed, one line each. */
  summary: string[];
  skipped: string[];
  decidedBy: string | null;
  createdAt: string;
}
export type ReferenceKind = (typeof REFERENCE_KINDS)[number];
export const REFERENCE_STATUSES = ["rendering", "ready", "approved", "rejected", "failed"] as const;
export type ReferenceStatus = (typeof REFERENCE_STATUSES)[number];

export interface ReferenceView {
  id: number;
  kind: ReferenceKind;
  /** The character's or place's name, as the manuscript or a scene gives it. */
  name: string;
  prompt: string;
  status: ReferenceStatus;
  costCents: number;
  imageUrl: string | null;
  error: string | null;
  createdAt: string;
}

/** An image a keyframe was rendered with, in the order it was sent. */
export interface KeyframeReference {
  kind: ReferenceKind | "previous_keyframe";
  /** Whose or what it is, e.g. "Elena", "Archive rooftop", "SCENE-01 plot point 1: Arrival". */
  label: string;
  assetId: number;
}

export interface KeyframeView {
  id: number;
  prompt: string;
  status: KeyframeStatus;
  mode: RenderMode | null;
  costCents: number;
  imageUrl: string | null;
  isSelected: boolean;
  error: string | null;
  /** The reference images it was rendered with, in order. */
  references: KeyframeReference[];
  createdAt: string;
}

export interface PlotPointView {
  id: number;
  position: number;
  title: string;
  beat: string;
  keyframes: KeyframeView[];
}

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

export interface TakeView {
  id: number;
  takeNumber: number;
  prompt: string;
  negativePrompt: string | null;
  cameraMotion: string | null;
  seed: string | null;
  durationSeconds: number;
  status: TakeStatus;
  mode: RenderMode;
  costCents: number;
  videoUrl: string | null;
  provider: string | null;
  request: TakeRequest;
  defectClass: DefectClass | null;
  notes: string | null;
  error: string | null;
  requestedBy: string | null;
  decidedBy: string | null;
  createdAt: string;
  streaming?: MediaTakeStreamingState;
}

export interface ShotView {
  id: number;
  position: number;
  plotPointId: number | null;
  prompt: string;
  negativePrompt: string | null;
  cameraMotion: string | null;
  seed: string | null;
  durationSeconds: number;
  transition: ShotTransition;
  /**
   * The timeline edits (0123). Optional so a caller building a shot by hand — a
   * fixture, a test, a CREW payload — states only what it means to.
   */
  /** How long the transition runs. Null or absent leaves it at that transition's own length. */
  transitionDurationSeconds?: number | null;
  /** 1 = the primary magnetic track, 2 = an overlay cut over it. Absent reads as 1. */
  track?: number;
  /** Where an overlay starts. Null on track 1, which follows the shot before it. */
  startTimeSeconds?: number | null;
  /** In and out points within the take. Null means the whole take. */
  trimInSeconds?: number | null;
  trimOutSeconds?: number | null;
  /** Seconds of frozen last frame after the trimmed span. */
  holdDurationSeconds?: number | null;
  /** The primary shot this cutaway hangs off, and how far into it it begins (0125). */
  anchorShotId?: number | null;
  anchorOffsetSeconds?: number | null;
  referenceKeyframeId: number | null;
  framing: string | null;
  lens: string | null;
  action: string;
  dialogue: DialogueLine[];
  takes: TakeView[];
}

export interface SceneView {
  id: number;
  position: number;
  sceneKey: string;
  title: string;
  synopsis: string;
  /** The manuscript station that tells this scene, and the start of its text. */
  scribeNodeId: number | null;
  /**
   * The station that tells this scene.
   *
   * `changed` is true when the station has been edited since this scene was
   * derived from it. The synopsis is a snapshot taken at derivation and the
   * excerpt is read live, so without this the two simply disagree on screen with
   * nothing to say which is newer.
   */
  station: { title: string; excerpt: string; changed: boolean } | null;
  location: string;
  timeOfDay: string;
  mood: string;
  plotPoints: PlotPointView[];
  shots: ShotView[];
  /** The scene's latest reel, if one was ever asked for. */
  assembly: AssemblyView | null;
}

export interface ProductionSummary {
  id: number;
  title: string;
  aspectRatio: MediaAspectRatio;
  projectId: number | null;
  crewSessionId: number | null;
  updatedAt: string;
}

export interface ProductionView extends ProductionSummary {
  scribeDocumentId: number | null;
  scribeDocumentTitle: string | null;
  /** Characters and locations from the linked manuscript. */
  characters: CharacterView[];
  /** The production's look, added to every keyframe and take prompt. */
  style: string;
  /** Reference images of its characters and locations, oldest first. */
  references: ReferenceView[];
  /** How takes render here: without the engine set up on the platform they are simulations with no video and no charge. */
  video: {
    engine: VideoEngine;
    /** Who renders, in words: "fal.ai" or "ComfyUI". */
    label: string;
    configured: boolean;
    resolution: VideoResolution;
    /** What a second of video is counted at; 0 for a self-hosted ComfyUI with no cost set. */
    centsPerSecond: number;
    /** Which engines this platform has set up. */
    available: Record<VideoEngine, boolean>;
    /** The imported ComfyUI workflow, when there is one, whichever engine is chosen. */
    workflow: ComfyWorkflowSummary | null;
  };
  budgetLimitCents: number;
  /** Cents actually sent to providers: live renders that were submitted. */
  spendCents: number;
  createdAt: string;
  scenes: SceneView[];
  /** What each character wears, and from which scene. */
  wardrobe: WardrobeView[];
  /** How this production came to look the way it does: the last 50 applied decisions, newest first. */
  decisions: MediaDecisionView[];
  /** The parent Project Space's Style Bible, if the production belongs to a project. */
  projectStyleBible?: ProjectStyleBible | null;
}

/** A production as its Project Space lists it: what it holds, what it has spent, and the room it is made in. */
export interface ProjectProduction {
  id: number;
  title: string;
  aspectRatio: MediaAspectRatio;
  updatedAt: string;
  scenes: number;
  shots: number;
  approvedTakes: number;
  reels: number;
  spendCents: number;
  budgetLimitCents: number;
  room: { sessionKey: string; title: string | null } | null;
}

export interface AssetView {
  id: number;
  kind: MediaAssetKind;
  mimeType: string;
  byteSize: number;
  url: string;
}

/** The keyframe a plot point shows: its approved one, else the selected one. */
export function shownKeyframe(plotPoint: Pick<PlotPointView, "keyframes">): KeyframeView | null {
  return plotPoint.keyframes.find((k) => k.status === "approved")
    ?? plotPoint.keyframes.find((k) => k.isSelected)
    ?? null;
}

export const formatCents = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// ── Focus in chat ───────────────────────────────────────────────────────────

export const MEDIA_STUDIO_SELECTION_KINDS = ["scene", "plot_point", "shot", "take", "reel"] as const;
export type MediaStudioSelectionKind = (typeof MEDIA_STUDIO_SELECTION_KINDS)[number];

/**
 * Something picked in Media Studio to talk about in the room. The ids are the ones
 * the Media Studio tools take: a shot's id for a take, a scene's id for a reel.
 */
export interface MediaStudioSelection {
  productionId: number;
  sceneId: number;
  sceneKey: string;
  kind: MediaStudioSelectionKind;
  /** The scene, plot point, shot or take, or the reel's assembly. */
  id: number;
  label: string;
}

export const mediaStudioScopePrefix = (selection: MediaStudioSelection) => `[Media Studio selection: ${JSON.stringify(selection)}]`;

// ── Scene reels ─────────────────────────────────────────────────────────────

export const ASSEMBLY_STATUSES = ["assembling", "ready", "failed"] as const;
export type AssemblyStatus = (typeof ASSEMBLY_STATUSES)[number];

/**
 * Where each shot starts on the timeline, in order, in seconds.
 *
 * A primary (track 1) shot follows the one before it — the magnetic storyline — and its
 * length is what actually plays: the trimmed span plus any freeze-hold. A cutaway hangs
 * off a primary shot and starts a given distance into it, so trimming an earlier shot
 * moves the cutaway with the shot it is connected to instead of leaving it behind.
 *
 * A cutaway with no anchor (one made before 0125) falls back to the absolute start it was
 * stored with, which is still the best answer anyone has for it.
 */
export function shotTimelineStarts(
  shots: ReadonlyArray<Pick<ShotView, "id" | "durationSeconds" | "track" | "startTimeSeconds" | "trimInSeconds" | "trimOutSeconds" | "holdDurationSeconds" | "anchorShotId" | "anchorOffsetSeconds">>,
): number[] {
  const playLength = (shot: (typeof shots)[number]) => {
    const trimIn = shot.trimInSeconds ?? 0;
    const trimmed = shot.trimOutSeconds != null && shot.trimOutSeconds > trimIn
      ? shot.trimOutSeconds - trimIn
      : shot.durationSeconds;
    return Math.max(0, trimmed) + (shot.holdDurationSeconds ?? 0);
  };

  const starts = new Array<number>(shots.length).fill(0);
  const primaryStart = new Map<number, number>();
  let at = 0;
  shots.forEach((shot, index) => {
    if ((shot.track ?? 1) === 2) return;
    starts[index] = at;
    primaryStart.set(shot.id, at);
    at += playLength(shot);
  });

  shots.forEach((shot, index) => {
    if ((shot.track ?? 1) !== 2) return;
    const anchoredAt = shot.anchorShotId != null ? primaryStart.get(shot.anchorShotId) : undefined;
    starts[index] = anchoredAt != null
      ? Math.max(0, anchoredAt + (shot.anchorOffsetSeconds ?? 0))
      : Math.max(0, shot.startTimeSeconds ?? 0);
  });

  return starts;
}

/** One shot of a reel: the take cut in, and the transition into the next shot. */
export interface AssemblyClipRecord {
  shotId: number;
  shotNumber: number;
  takeId: number;
  takeNumber: number;
  assetId: number;
  transition: ShotTransition;
  /** The timeline edits the cut has to honour; absent on a reel cut before they existed. */
  transitionDurationSeconds?: number | null;
  track?: number;
  startTimeSeconds?: number | null;
  trimInSeconds?: number | null;
  trimOutSeconds?: number | null;
  holdDurationSeconds?: number | null;
}

/** What a reel was cut from, recorded when it was asked for. */
export interface AssemblyManifest {
  width?: number;
  height?: number;
  resolution?: VideoResolution;
  /** The finished reel's length, once it is cut. */
  durationSeconds?: number;
  clips?: AssemblyClipRecord[];
}

export interface AssemblyView {
  id: number;
  status: AssemblyStatus;
  reelUrl: string | null;
  durationSeconds: number | null;
  error: string | null;
  /** False once a shot's approved take, the shots' order or a transition has changed since the reel was cut. */
  current: boolean;
  createdAt: string;
}

/** A reel's shots, takes and transitions as one comparable string. The last shot's transition leads nowhere, so it is left out. */
export function reelSignature(clips: Array<{ shotId: number; takeId: number | null; transition: ShotTransition }>): string {
  return clips.map((clip, i) => `${clip.shotId}:${clip.takeId ?? "-"}${i < clips.length - 1 ? `:${clip.transition}` : ""}`).join("|");
}

/** Why a scene cannot be assembled yet, in words, or null when every shot has an approved take with video. */
export function sceneAssemblyProblem(scene: Pick<SceneView, "sceneKey" | "shots">): string | null {
  if (!scene.shots.length) return `${scene.sceneKey} has no shots to assemble.`;
  const shots = (numbers: number[]) =>
    numbers.length === 1 ? `Shot ${numbers[0]} has` : `Shots ${numbers.slice(0, -1).join(", ")} and ${numbers[numbers.length - 1]} have`;
  const unapproved: number[] = [];
  const silent: number[] = [];
  scene.shots.forEach((shot, index) => {
    const approved = shot.takes.find((take) => take.status === "approved");
    if (!approved) unapproved.push(index + 1);
    else if (!approved.videoUrl) silent.push(index + 1);
  });
  if (unapproved.length) return `${shots(unapproved)} no approved take. Approve a take of every shot before assembling ${scene.sceneKey}.`;
  if (silent.length) return `${shots(silent)} an approved take with no video. Approve a rendered take instead.`;
  return null;
}

// ── ComfyUI Modular Workflow Templates & DAG Contracts ──────────────────────

export const COMFY_RENDER_ENGINES = ["seedance", "comfyui"] as const;
export type ComfyRenderEngine = (typeof COMFY_RENDER_ENGINES)[number];

export const WORKFLOW_CATEGORIES = ["cinematic", "previz", "dialogue", "vfx"] as const;
export type WorkflowCategory = (typeof WORKFLOW_CATEGORIES)[number];

export const WORKFLOW_COST_TIERS = ["draft", "standard", "ultra"] as const;
export type WorkflowCostTier = (typeof WORKFLOW_COST_TIERS)[number];

export interface WorkflowNodeParameterMapping {
  promptNodeId: string;
  negativePromptNodeId?: string;
  seedNodeId?: string;
  imageInputNodeId?: string;
  endImageInputNodeId?: string;
  characterEmbeddingNodeId?: string;
  cameraMotionNodeId?: string;
  durationNodeId?: string;
  aspectRatioNodeId?: string;
}

export interface ComfyWorkflowTemplate {
  id: string;
  name: string;
  category: WorkflowCategory;
  description: string;
  costTier: WorkflowCostTier;
  engine: ComfyRenderEngine;
  /** Parameterized ComfyUI API prompt JSON (nodeId -> { class_type, inputs }) */
  graphJson: Record<string, any>;
  parameters: WorkflowNodeParameterMapping;
}

export interface TakeWorkflowSnapshot {
  templateId: string;
  recipeId?: string;
  recipeName?: string;
  compiledAt?: string;
  resolvedGraphJson: Record<string, any>;
  cachedNodes: string[];
  cachedNodeIds?: string[];
  executedNodeIds?: string[];
  nodeHashes?: Record<string, string>;
  totalSteps?: number;
  completedSteps?: number;
  executionTimeMs?: number;
  engine: ComfyRenderEngine;
}

/** Real-time event emitted during ComfyUI diffusion sampling */
export interface MediaStreamFrameEvent {
  takeId: number;
  step: number;
  totalSteps: number;
  nodeId: string;
  nodeLabel: string;
  previewUrl?: string;
  timestamp: string;
}

export const CINEMATIC_HERO_RECIPE: ComfyWorkflowTemplate = {
  id: "recipe_cinematic_hero_v1",
  name: "Cinematic Hero Take (FLUX + Wan2.1 + IP-Adapter)",
  category: "cinematic",
  description: "High-fidelity visual production with character face anchoring and dynamic camera trajectory.",
  costTier: "standard",
  engine: "comfyui",
  parameters: {
    promptNodeId: "node_positive_prompt",
    negativePromptNodeId: "node_negative_prompt",
    seedNodeId: "node_sampler",
    imageInputNodeId: "node_keyframe_loader",
    characterEmbeddingNodeId: "node_ip_adapter",
    cameraMotionNodeId: "node_camera_ctrl",
  },
  graphJson: {
    node_keyframe_loader: { class_type: "LoadImage", inputs: { image: "reference_keyframe.png" } },
    node_ip_adapter: { class_type: "IPAdapterApplyFaceID", inputs: { weight: 0.85, image: ["node_keyframe_loader", 0] } },
    node_camera_ctrl: { class_type: "CameraCtrlPoseInterpolation", inputs: { motion_type: "pan_right", speed: 1.0 } },
    node_positive_prompt: { class_type: "CLIPTextEncode", inputs: { text: "" } },
    node_negative_prompt: { class_type: "CLIPTextEncode", inputs: { text: "blurry, distorted, morphing, low quality" } },
    node_sampler: { class_type: "KSampler", inputs: { steps: 30, cfg: 7.0, sampler_name: "dpmpp_2m", scheduler: "karras", seed: 42 } },
    node_vae_decode: { class_type: "VAEDecode", inputs: { samples: ["node_sampler", 0] } },
    node_video_combine: { class_type: "VHS_VideoCombine", inputs: { images: ["node_vae_decode", 0], frame_rate: 24 } },
  },
};

export const PREVIZ_ANIMATIC_RECIPE: ComfyWorkflowTemplate = {
  id: "recipe_previz_animatic_v1",
  name: "Fast Previz Animatic (Distilled Motion)",
  category: "previz",
  description: "Sub-second low-cost motion preview for shot blocking, camera pacing, and scene timing.",
  costTier: "draft",
  engine: "comfyui",
  parameters: {
    promptNodeId: "node_prompt",
    seedNodeId: "node_sampler",
    imageInputNodeId: "node_image",
  },
  graphJson: {
    node_image: { class_type: "LoadImage", inputs: { image: "" } },
    node_prompt: { class_type: "CLIPTextEncode", inputs: { text: "" } },
    node_sampler: { class_type: "KSampler", inputs: { steps: 12, cfg: 4.0, sampler_name: "euler", scheduler: "normal", seed: 1 } },
    node_video_combine: { class_type: "VHS_VideoCombine", inputs: { frame_rate: 16 } },
  },
};

export const DIALOGUE_PERFORMANCE_RECIPE: ComfyWorkflowTemplate = {
  id: "recipe_dialogue_performance_v1",
  name: "Dialogue Lip-Sync Performance",
  category: "dialogue",
  description: "Synchronizes character facial performance with Scribe dialogue audio stems.",
  costTier: "standard",
  engine: "comfyui",
  parameters: {
    promptNodeId: "node_prompt",
    imageInputNodeId: "node_character_frame",
  },
  graphJson: {
    node_character_frame: { class_type: "LoadImage", inputs: { image: "" } },
    node_audio_loader: { class_type: "LoadAudio", inputs: { audio: "dialogue_stem.wav" } },
    node_prompt: { class_type: "CLIPTextEncode", inputs: { text: "" } },
    node_lip_sync: { class_type: "LivePortraitProcess", inputs: { face_image: ["node_character_frame", 0], audio: ["node_audio_loader", 0] } },
  },
};

export const BUILTIN_WORKFLOW_RECIPES: ComfyWorkflowTemplate[] = [
  CINEMATIC_HERO_RECIPE,
  PREVIZ_ANIMATIC_RECIPE,
  DIALOGUE_PERFORMANCE_RECIPE,
];

/**
 * Canonical Form Studio definition for tuning ComfyUI video generation recipes and DAG parameters.
 * Can be rendered directly by Form Studio, or instantiated as an interactive parameter form in Media Studio.
 */
export const COMFYUI_PARAM_STUDIO_DEFINITION = {
  name: "ComfyUI Video Recipe Tuning",
  description: "Configure conditioning tensors, diffusion sampling hyperparameters, and motion controls for take generation.",
  fields: [
    {
      key: "recipe_id",
      label: "Workflow Recipe",
      type: "select" as const,
      description: "Production DAG architecture template",
      defaultValue: "recipe_cinematic_hero_v1",
      options: [
        { label: "Cinematic Hero (FLUX + Wan2.1 + IP-Adapter)", value: "recipe_cinematic_hero_v1" },
        { label: "Fast Previz Animatic (Distilled Motion)", value: "recipe_previz_animatic_v1" },
        { label: "Dialogue Lip-Sync Performance", value: "recipe_dialogue_performance_v1" },
      ],
      required: true,
    },
    {
      key: "sampling_steps",
      label: "Sampling Steps",
      type: "slider" as const,
      description: "Diffusion denoise iteration steps",
      defaultValue: "30",
      min: 10,
      max: 60,
      unit: "steps",
      required: true,
    },
    {
      key: "cfg_scale",
      label: "CFG Scale (Classifier-Free Guidance)",
      type: "slider" as const,
      description: "Prompt adherence weighting",
      defaultValue: "6.0",
      min: 1.0,
      max: 15.0,
      unit: "scale",
      required: true,
    },
    {
      key: "sampler_name",
      label: "Sampler Algorithm",
      type: "select" as const,
      defaultValue: "euler",
      options: ["euler", "dpmpp_2m", "heun", "uni_pc", "ddim"],
      required: true,
    },
    {
      key: "scheduler",
      label: "Noise Scheduler",
      type: "select" as const,
      defaultValue: "normal",
      options: ["normal", "karras", "exponential", "sgm_uniform", "simple"],
      required: true,
    },
    {
      key: "camera_motion",
      label: "CameraCtrl Motion Trajectory",
      type: "select" as const,
      defaultValue: "Static (Lock Off)",
      options: [
        "Static (Lock Off)",
        "Pan Left",
        "Pan Right",
        "Tilt Up",
        "Tilt Down",
        "Zoom In",
        "Zoom Out",
        "Orbit Clockwise",
      ],
    },
    {
      key: "camera_speed",
      label: "Camera Motion Speed",
      type: "slider" as const,
      defaultValue: "1.0",
      min: 0.2,
      max: 3.0,
      unit: "x",
    },
    {
      key: "ip_adapter_weight",
      label: "Character Face Embedding Weight (IP-Adapter)",
      type: "slider" as const,
      description: "Actor facial identity preservation strength",
      defaultValue: "0.85",
      min: 0.0,
      max: 1.0,
      unit: "weight",
    },
    {
      key: "tiled_vae",
      label: "Enable Tiled VAE Temporal Decoding",
      type: "boolean" as const,
      description: "Reduces VRAM usage on 4K/720p decode passes to prevent CUDA OOM",
      defaultValue: "true",
    },
  ],
  studio: {
    version: 2,
    pages: [
      {
        id: "tuning_page",
        title: "ComfyUI Recipe & Hyperparameters",
        html: "<p>Configure generative video pipeline hyperparameters before initiating take execution.</p>",
      },
    ],
  },
};


