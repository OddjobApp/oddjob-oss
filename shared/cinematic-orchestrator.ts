import { z } from "zod";
import type { CharacterDefinition, TurnaroundCrop } from "./character.js";
import { resolveFramingCrop } from "./character-resolution.js";
import {
  SENSOR_PROFILES,
  LENS_KIT,
  CAMERA_MOTION_PRESETS,
  resolveCameraControlVector,
  type CameraRig,
  type SensorFormat,
} from "./camera-library.js";
import {
  SHOT_TYPES_CATALOG,
  SHOT_SCALE_INFO,
  CAMERA_ANGLE_INFO,
  type ShotTypeDefinition,
} from "./shot-types.js";
import {
  LOCATION_CATALOG,
  compileLocationPrompt,
  type LocationDefinition,
} from "./location-library.js";
import {
  PROP_CATALOG,
  compilePropPrompt,
  type PropDefinition,
} from "./prop-library.js";
import {
  LIGHTING_CATALOG,
  compileLightingPrompt,
  type LightingRigDefinition,
} from "./lighting-library.js";
import type { MediaAspectRatio } from "./media-studio.js";
import { FAL_ASPECT_RATIOS, SEEDANCE_DURATION } from "./media-prompt.js";

export interface CinematicSceneContext {
  productionTitle: string;
  aspectRatio: MediaAspectRatio;
  location: LocationDefinition | string;
  locationZoneKey?: string;
  locationAtmosphereKey?: string;
  lightingRig?: LightingRigDefinition | string;
  characters: CharacterDefinition[];
  props?: Array<PropDefinition | string>;
}

export interface CinematicShotInput {
  shotNumber?: number;
  shotType?: ShotTypeDefinition | string;
  framing?: string;
  lens?: string;
  cameraMotion?: string | { pan?: number; tilt?: number; zoom?: number; roll?: number };
  sensorFormat?: SensorFormat;
  action: string;
  primaryCharacterId?: string;
  primaryWardrobeKey?: string;
  activePropIds?: string[];
  dialogue?: Array<{ speaker: string; line: string; delivery?: string }>;
  durationSeconds: number;
  userPromptAdditions?: string;
  userNegativeAdditions?: string;
  seed?: number;
}

export interface CommercialApiPayload {
  provider: "seedance" | "fal" | "kling" | "runway";
  prompt: string;
  negative_prompt: string;
  aspect_ratio: string;
  duration_seconds: number;
  camera_control: { pan: number; tilt: number; zoom: number; roll: number };
  reference_frame_url?: string;
  reference_crop_box?: { x: number; y: number; width: number; height: number };
}

export interface ComfyUiGraphInputs {
  positive_prompt: string;
  negative_prompt: string;
  lora_checkpoint?: string;
  lora_weight: number;
  ip_adapter_embedding?: string;
  ip_adapter_weight: number;
  openpose_height_scale: number;
  camera_motion_type: string;
  seed: number;
  steps: number;
}

export interface IdentityDriftGuardrailConfig {
  expectedFaceEmbedding?: number[];
  minimumSimilarityThreshold: number;
  monitoredCharacterId?: string;
}

export interface CinematicConditionedPayload {
  compiledPositivePrompt: string;
  compiledNegativePrompt: string;
  commercialApiPayload: CommercialApiPayload;
  comfyUiGraphInputs: ComfyUiGraphInputs;
  identityDriftGuardrails: IdentityDriftGuardrailConfig;
  warnings: string[];
}

const clean = (text: string | undefined | null) => (text ?? "").replace(/\s+/g, " ").trim();

/**
 * Master Cinematic Orchestrator.
 *
 * Synthesizes Characters, Cameras, Shot Types, Locations, Props, and Lighting
 * into a deterministic, conditioned payload for video models and automated QA.
 */
export function orchestrateCinematicShot(
  scene: CinematicSceneContext,
  shot: CinematicShotInput
): CinematicConditionedPayload {
  const warnings: string[] = [];
  const positiveBlocks: string[] = [];
  const negativeItems: Set<string> = new Set();

  // 1. Resolve Location
  const resolvedLocation: LocationDefinition =
    typeof scene.location === "string"
      ? LOCATION_CATALOG[scene.location] ?? {
          locationId: "loc_custom",
          version: "1.0.0",
          name: scene.location,
          category: "exterior_urban",
          architecturalStyle: scene.location,
          materials: {
            groundSurface: "ground",
            wallSurfaces: "walls",
            ceilingHeightMeters: 3.5,
            dominantColorway: "natural cinematic palette",
          },
          zones: {},
          atmosphericPresets: {},
          mediaAssets: {},
          prohibitedElements: [],
        }
      : scene.location;

  const locCompiled = compileLocationPrompt(resolvedLocation, {
    zoneKey: scene.locationZoneKey,
    atmosphericPresetKey: scene.locationAtmosphereKey,
  });

  positiveBlocks.push(locCompiled.promptBlock);
  locCompiled.prohibitedExclusions.forEach((ex) => negativeItems.add(ex));

  // 2. Resolve Lighting Rig
  const resolvedLighting: LightingRigDefinition | undefined = scene.lightingRig
    ? typeof scene.lightingRig === "string"
      ? LIGHTING_CATALOG[scene.lightingRig]
      : scene.lightingRig
    : undefined;

  if (resolvedLighting) {
    const lightingCompiled = compileLightingPrompt(resolvedLighting);
    positiveBlocks.push(lightingCompiled.promptClause);
    lightingCompiled.avoidExclusions.forEach((ex) => negativeItems.add(ex));
  }

  // 3. Resolve Shot Type & Optics
  const resolvedShotType: ShotTypeDefinition | undefined = shot.shotType
    ? typeof shot.shotType === "string"
      ? SHOT_TYPES_CATALOG[shot.shotType]
      : shot.shotType
    : undefined;

  const framingStr = clean(shot.framing) || (resolvedShotType ? SHOT_SCALE_INFO[resolvedShotType.scale].name : "Medium Close-Up");
  const lensStr = clean(shot.lens) || resolvedShotType?.recommendedFocalLength || "35mm";
  const sensor = SENSOR_PROFILES[shot.sensorFormat ?? "full_frame_35mm"];

  const shotLabel = resolvedShotType ? `${resolvedShotType.name} (${framingStr})` : `Framing: ${framingStr}`;
  positiveBlocks.push(`${shotLabel}. Lens: ${lensStr} on ${sensor.name}.`);
  if (resolvedShotType) {
    resolvedShotType.avoidExclusions.forEach((ex) => negativeItems.add(ex));
  }

  // 4. Resolve Character & Invariant Phenotype
  const primaryChar = scene.characters.find(
    (c) => c.character_id === shot.primaryCharacterId || c.name.toLowerCase() === shot.primaryCharacterId?.toLowerCase()
  ) ?? scene.characters[0];

  let characterCropResult: any = null;
  let heightRatio = 1.0;

  if (primaryChar) {
    const p = primaryChar.invariant_phenotype;
    const wardrobeKey = shot.primaryWardrobeKey ?? Object.keys(primaryChar.wardrobe_states)[0] ?? "default";
    const w = primaryChar.wardrobe_states[wardrobeKey];

    const wearingText = w ? `Wearing ${w.outerwear}, ${w.base_layer}.` : "";
    positiveBlocks.push(
      `Subject: ${primaryChar.name}, ${p.face_structure}, ${p.eyes}, ${p.hair}, ${p.skin}. ${wearingText}`
    );

    if (w?.prohibited_elements) {
      w.prohibited_elements.forEach((ex) => negativeItems.add(ex));
    }

    // Resolve Crop for commercial API input
    characterCropResult = resolveFramingCrop(primaryChar, framingStr);
    heightRatio = primaryChar.demographics.height_cm / 180;
  }

  // 5. Resolve Props & Tactical Handling
  const activePropIds = shot.activePropIds ?? [];
  if (activePropIds.length && scene.props) {
    for (const propRef of scene.props) {
      const propDef = typeof propRef === "string" ? PROP_CATALOG[propRef] : propRef;
      if (propDef && activePropIds.includes(propDef.propId)) {
        const propCompiled = compilePropPrompt(propDef);
        positiveBlocks.push(propCompiled.promptClause);
        propCompiled.prohibitedExclusions.forEach((ex) => negativeItems.add(ex));
      }
    }
  }

  // 6. Action & Dialogue
  const actionText = clean(shot.action);
  if (actionText) {
    positiveBlocks.push(`Action: ${actionText}.`);
  }

  if (shot.dialogue && shot.dialogue.length > 0) {
    positiveBlocks.push("Dialogue:");
    for (const line of shot.dialogue) {
      positiveBlocks.push(`${line.speaker}${line.delivery ? ` (${line.delivery})` : ""}: "${line.line}"`);
    }
  }

  if (shot.userPromptAdditions) {
    positiveBlocks.push(clean(shot.userPromptAdditions));
  }

  if (shot.userNegativeAdditions) {
    shot.userNegativeAdditions.split(",").forEach((item) => negativeItems.add(clean(item)));
  }

  // Duration Validation against Seedance constraints
  if (shot.durationSeconds < SEEDANCE_DURATION.min || shot.durationSeconds > SEEDANCE_DURATION.max) {
    warnings.push(`Shot duration (${shot.durationSeconds}s) is outside supported range (${SEEDANCE_DURATION.min}-${SEEDANCE_DURATION.max}s).`);
  }

  // 7. Resolve Camera Motion Vector
  const motionStr = typeof shot.cameraMotion === "string" ? shot.cameraMotion : undefined;
  const cameraControl =
    typeof shot.cameraMotion === "object"
      ? {
          pan: shot.cameraMotion.pan ?? 0,
          tilt: shot.cameraMotion.tilt ?? 0,
          zoom: shot.cameraMotion.zoom ?? 0,
          roll: shot.cameraMotion.roll ?? 0,
        }
      : resolveCameraControlVector(motionStr);

  const motionPreset = motionStr ? CAMERA_MOTION_PRESETS[motionStr] : undefined;
  const comfyMotionType = motionPreset?.comfyMotionType ?? "static";

  const positivePrompt = positiveBlocks.join("\n");
  const negativePrompt = Array.from(negativeItems).filter(Boolean).join(", ");

  const commercialApiPayload: CommercialApiPayload = {
    provider: "seedance",
    prompt: positivePrompt,
    negative_prompt: negativePrompt,
    aspect_ratio: FAL_ASPECT_RATIOS[scene.aspectRatio] ?? "16:9",
    duration_seconds: shot.durationSeconds,
    camera_control: cameraControl,
    reference_frame_url: primaryChar?.media_assets.master_turnaround_url,
    reference_crop_box: characterCropResult?.scaledCrop,
  };

  const comfyUiGraphInputs: ComfyUiGraphInputs = {
    positive_prompt: positivePrompt,
    negative_prompt: negativePrompt,
    lora_checkpoint: primaryChar?.media_assets.lora_checkpoint,
    lora_weight: 0.75,
    ip_adapter_embedding: primaryChar?.media_assets.ip_adapter_embedding,
    ip_adapter_weight: 0.65,
    openpose_height_scale: Number(heightRatio.toFixed(3)),
    camera_motion_type: comfyMotionType,
    seed: shot.seed ?? 42,
    steps: 30,
  };

  const identityDriftGuardrails: IdentityDriftGuardrailConfig = {
    expectedFaceEmbedding: primaryChar?.face_embedding,
    minimumSimilarityThreshold: 0.72,
    monitoredCharacterId: primaryChar?.character_id,
  };

  return {
    compiledPositivePrompt: positivePrompt,
    compiledNegativePrompt: negativePrompt,
    commercialApiPayload,
    comfyUiGraphInputs,
    identityDriftGuardrails,
    warnings,
  };
}
