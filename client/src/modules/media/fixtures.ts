import type { AssemblyView, KeyframeView, PlotPointView, ProductionView, ReferenceView, SceneView, ShotView, TakeView } from "@shared/media-studio";

/** Productions shaped as /api/media-studio answers, for tests. */

const at = "2026-09-13T00:00:00.000Z";

export const keyframe = (overrides: Partial<KeyframeView> = {}): KeyframeView => ({
  id: 41, prompt: "Parapet at dusk", status: "ready", mode: "live", costCents: 4, imageUrl: "/api/media-studio/assets/1",
  isSelected: true, error: null, references: [], createdAt: at, ...overrides,
});

export const reference = (overrides: Partial<ReferenceView> = {}): ReferenceView => ({
  id: 71, kind: "character", name: "Elena", prompt: "A character reference sheet for Elena.", status: "ready", costCents: 4,
  imageUrl: "/api/media-studio/assets/3", error: null, createdAt: at, ...overrides,
});

export const plotPoint = (overrides: Partial<PlotPointView> = {}): PlotPointView => ({
  id: 11, position: 0, title: "She sees the drone", beat: "The drone crests the parapet.", keyframes: [], ...overrides,
});

export const take = (overrides: Partial<TakeView> = {}): TakeView => ({
  id: 51, takeNumber: 1, prompt: "Elena crouches", negativePrompt: null, cameraMotion: null, seed: null, durationSeconds: 5,
  status: "ready_for_review", mode: "live", costCents: 150, videoUrl: null, provider: "fal", request: {}, defectClass: null, notes: null, error: null,
  requestedBy: null, decidedBy: null, createdAt: at, ...overrides,
});

export const shot = (overrides: Partial<ShotView> = {}): ShotView => ({
  id: 31, position: 0, plotPointId: null, prompt: "Elena crouches behind the parapet", negativePrompt: null, cameraMotion: "slow push-in",
  seed: null, durationSeconds: 5, transition: "cut", referenceKeyframeId: null, framing: "medium close-up", lens: "35mm", action: "",
  dialogue: [], takes: [], ...overrides,
});

export const scene = (overrides: Partial<SceneView> = {}): SceneView => ({
  id: 21, position: 0, sceneKey: "SCENE-01", title: "Arrival", synopsis: "Elena reaches the roof.", scribeNodeId: null, station: null,
  location: "Archive rooftop", timeOfDay: "night", mood: "", plotPoints: [], shots: [], assembly: null, ...overrides,
});

export const assembly = (overrides: Partial<AssemblyView> = {}): AssemblyView => ({
  id: 61, status: "ready", reelUrl: "/api/media-studio/assets/9", durationSeconds: 11.25, error: null, current: true, createdAt: at, ...overrides,
});

export const production = (overrides: Partial<ProductionView> = {}): ProductionView => ({
  id: 7, title: "Rooftop chase", aspectRatio: "2.39:1", projectId: null, crewSessionId: 3, updatedAt: at,
  scribeDocumentId: null, scribeDocumentTitle: null, characters: [],
  video: { engine: "fal", label: "fal.ai", configured: true, resolution: "720p", centsPerSecond: 30.34, available: { fal: true, comfyui: false }, workflow: null },
  budgetLimitCents: 2500, spendCents: 4, createdAt: at, style: "", references: [], wardrobe: [], decisions: [],
  scenes: [], ...overrides,
});
