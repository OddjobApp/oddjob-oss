import type {
  CharacterDefinition,
  TurnaroundCrop,
} from "./character.js";
import { resolveCameraControlVector } from "./camera-library.js";

export interface CompileVideoPromptOptions {
  character: CharacterDefinition;
  wardrobeKey: string;
  action: string;
  environment: string;
  lighting: string;
  framing?: string;
  lens?: string;
}

/**
 * Strips ambiguous, generic subjective tokens ("pretty", "tough soldier", "nice", etc.)
 * from prompt strings, keeping explicit physical, textile, and geometric descriptors.
 */
const VAGUE_TERMS = /\b(pretty|handsome|very attractive|tough|badass|cool|nice looking|gorgeous|stunning)\b/gi;

function cleanDescriptor(text: string | undefined): string {
  return (text ?? "").replace(VAGUE_TERMS, "").replace(/\s+/g, " ").trim();
}

/**
 * Compiles a deterministic, invariant prompt block combining identity, wardrobe,
 * environment, lighting, and camera optics without text ambiguity.
 */
export function compileCharacterVideoPrompt({
  character,
  wardrobeKey,
  action,
  environment,
  lighting,
  framing = "medium close-up",
  lens = "35mm",
}: CompileVideoPromptOptions): string {
  const p = character.invariant_phenotype;
  const wardrobe =
    character.wardrobe_states[wardrobeKey] ||
    Object.values(character.wardrobe_states)[0] || {
      outerwear: "",
      base_layer: "",
      bottoms: "",
      footwear: "",
      prohibited_elements: [],
    };

  const cleanFraming = cleanDescriptor(framing);
  const cleanAction = cleanDescriptor(action);
  const cleanEnv = cleanDescriptor(environment);
  const cleanLighting = cleanDescriptor(lighting);
  const cleanLens = cleanDescriptor(lens);

  const wearingParts = [wardrobe.outerwear, wardrobe.base_layer]
    .map(cleanDescriptor)
    .filter(Boolean);
  const wearingClause = wearingParts.length
    ? `Wearing ${wearingParts.join(", ")}.`
    : "";

  const promptParts = [
    `Cinematic ${cleanFraming} shot of ${character.name}`,
    cleanDescriptor(p.face_structure),
    cleanDescriptor(p.eyes),
    cleanDescriptor(p.hair),
    cleanDescriptor(p.skin),
  ].filter(Boolean);

  const corePrompt = promptParts.join(", ") + ".";

  const blocks = [
    corePrompt,
    wearingClause,
    cleanAction ? `Action: ${cleanAction}.` : "",
    cleanEnv ? `Setting: ${cleanEnv}.` : "",
    cleanLighting ? `Lighting and atmosphere: ${cleanLighting}.` : "",
    `Clean cinematic lens rendering, ${cleanLens} photography, natural optical depth of field.`,
  ].filter(Boolean);

  return blocks.join(" ");
}

export type FramingCategory =
  | "extreme_close_up"
  | "close_up"
  | "medium_close_up"
  | "medium"
  | "wide"
  | "extreme_wide";

export function categorizeFraming(framingText: string | undefined): FramingCategory {
  const text = (framingText ?? "").toLowerCase();
  if (text.includes("extreme close") || text.includes("macro")) return "extreme_close_up";
  if (text.includes("medium close") || text.includes("mcu")) return "medium_close_up";
  if (text.includes("headshot") || text.includes("close-up") || text.includes("close up")) return "close_up";
  if (text.includes("medium") || text.includes("waist") || text.includes("cowboy")) return "medium";
  if (text.includes("extreme wide") || text.includes("establishing")) return "extreme_wide";
  return "wide";
}

export interface CropResolutionResult {
  cropKey: string;
  sourceCrop: TurnaroundCrop;
  scaledCrop: { x: number; y: number; width: number; height: number };
  targetCanvas: { width: number; height: number };
  aspectRatio: number;
}

/**
 * Resolves optimal crop from the character's turnaround sheet based on camera framing
 * and scales it to the native video model's resolution (e.g. 1280x720 or 1920x1080).
 */
export function resolveFramingCrop(
  character: CharacterDefinition,
  framing: string,
  preferredAngle: "front" | "three_quarter_left" | "profile" | "three_quarter_right" | "rear" = "front",
  targetResolution: { width: number; height: number } = { width: 1280, height: 720 }
): CropResolutionResult {
  const category = categorizeFraming(framing);
  const crops = character.turnaround_coordinates.crops;
  const canvas = character.turnaround_coordinates.canvas_dimensions;

  let selectedKey = "front_full";

  if (category === "extreme_close_up" || category === "close_up" || category === "medium_close_up") {
    if (crops["headshot_neutral"]) {
      selectedKey = "headshot_neutral";
    } else {
      selectedKey = "front_full";
    }
  } else {
    switch (preferredAngle) {
      case "three_quarter_left":
        selectedKey = crops["three_quarter_left"] ? "three_quarter_left" : "front_full";
        break;
      case "profile":
        selectedKey = crops["profile_left"] ? "profile_left" : "front_full";
        break;
      case "three_quarter_right":
        selectedKey = crops["three_quarter_right"] ? "three_quarter_right" : "front_full";
        break;
      case "rear":
        selectedKey = crops["rear_full"] ? "rear_full" : "front_full";
        break;
      case "front":
      default:
        selectedKey = crops["front_full"] ? "front_full" : Object.keys(crops)[0] || "front_full";
        break;
    }
  }

  const sourceCrop: TurnaroundCrop = crops[selectedKey] || {
    x: 0,
    y: 0,
    w: canvas.width,
    h: canvas.height,
  };

  const scaleX = targetResolution.width / canvas.width;
  const scaleY = targetResolution.height / canvas.height;

  const scaledCrop = {
    x: Math.round(sourceCrop.x * scaleX),
    y: Math.round(sourceCrop.y * scaleY),
    width: Math.round(sourceCrop.w * scaleX),
    height: Math.round(sourceCrop.h * scaleY),
  };

  return {
    cropKey: selectedKey,
    sourceCrop,
    scaledCrop,
    targetCanvas: targetResolution,
    aspectRatio: targetResolution.width / targetResolution.height,
  };
}

export interface HostedApiConditionedPayload {
  provider: "runway" | "kling" | "seedance" | "fal";
  prompt: string;
  input_frame_url?: string;
  crop_key: string;
  camera_control: { pan: number; tilt: number; zoom: number };
}

export interface ComfyUiConditionedPayload {
  lora_checkpoint?: string;
  lora_weight: number;
  ip_adapter_embedding?: string;
  ip_adapter_weight: number;
  openpose_height_scale: number;
  prompt: string;
  reference_crop_key: string;
}

/**
 * Builds conditioned payloads for either commercial hosted APIs or self-hosted ComfyUI.
 */
export function buildConditionedPayload(
  character: CharacterDefinition,
  options: {
    wardrobeKey: string;
    action: string;
    environment: string;
    lighting: string;
    framing?: string;
    cameraMotion?: string | { pan?: number; tilt?: number; zoom?: number };
    preferredAngle?: "front" | "three_quarter_left" | "profile" | "three_quarter_right" | "rear";
  }
): {
  hostedApi: HostedApiConditionedPayload;
  comfyUi: ComfyUiConditionedPayload;
} {
  const prompt = compileCharacterVideoPrompt({
    character,
    wardrobeKey: options.wardrobeKey,
    action: options.action,
    environment: options.environment,
    lighting: options.lighting,
    framing: options.framing,
  });

  const cropResolution = resolveFramingCrop(
    character,
    options.framing ?? "medium close-up",
    options.preferredAngle ?? "front"
  );

  const baselineHeightCm = 180;
  const heightRatio = character.demographics.height_cm / baselineHeightCm;

  const resolvedMotion =
    typeof options.cameraMotion === "string"
      ? resolveCameraControlVector(options.cameraMotion)
      : {
          pan: options.cameraMotion?.pan ?? 0,
          tilt: options.cameraMotion?.tilt ?? 0,
          zoom: options.cameraMotion?.zoom ?? 0,
        };

  return {
    hostedApi: {
      provider: "seedance",
      prompt,
      input_frame_url: character.media_assets.master_turnaround_url,
      crop_key: cropResolution.cropKey,
      camera_control: {
        pan: resolvedMotion.pan,
        tilt: resolvedMotion.tilt,
        zoom: resolvedMotion.zoom,
      },
    },
    comfyUi: {
      lora_checkpoint: character.media_assets.lora_checkpoint,
      lora_weight: 0.75,
      ip_adapter_embedding: character.media_assets.ip_adapter_embedding,
      ip_adapter_weight: 0.65,
      openpose_height_scale: Number(heightRatio.toFixed(3)),
      prompt,
      reference_crop_key: cropResolution.cropKey,
    },
  };
}
