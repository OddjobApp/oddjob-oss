import { z } from "zod";

/**
 * Sensor Formats & Profiles.
 */
export const SENSOR_FORMATS = [
  "large_format_65mm",
  "full_frame_35mm",
  "super_35mm",
  "anamorphic_35mm",
  "vintage_16mm",
] as const;

export type SensorFormat = typeof SENSOR_FORMATS[number];

export interface SensorProfile {
  id: SensorFormat;
  name: string;
  cropFactor: number;
  nativeAspectRatio: string;
  aestheticNotes: string;
}

export const SENSOR_PROFILES: Record<SensorFormat, SensorProfile> = {
  large_format_65mm: {
    id: "large_format_65mm",
    name: "Large Format 65mm (ARRI Alexa 65 / IMAX)",
    cropFactor: 0.5,
    nativeAspectRatio: "2.39:1",
    aestheticNotes: "Massive field of view with zero geometric distortion, hyper-smooth tonality, three-dimensional subject separation.",
  },
  full_frame_35mm: {
    id: "full_frame_35mm",
    name: "Full Frame 35mm (Sony VENICE 2 / ARRI LF / RED V-Raptor)",
    cropFactor: 1.0,
    nativeAspectRatio: "16:9",
    aestheticNotes: "Modern cinema standard. Rich cinematic depth, natural optical rendering, versatile low-light rendering.",
  },
  super_35mm: {
    id: "super_35mm",
    name: "Super 35mm (Classic Hollywood Standard)",
    cropFactor: 1.45,
    nativeAspectRatio: "16:9",
    aestheticNotes: "Historic cinema aesthetic. Controlled depth of field, sharp edge-to-edge optical fidelity.",
  },
  anamorphic_35mm: {
    id: "anamorphic_35mm",
    name: "Anamorphic 2x Squeeze (Panavision C-Series)",
    cropFactor: 1.0,
    nativeAspectRatio: "2.39:1",
    aestheticNotes: "Oval bokeh, signature horizontal blue streak flares, subtle barrel distortion at edges, cinematic widescreen.",
  },
  vintage_16mm: {
    id: "vintage_16mm",
    name: "Vintage 16mm (Bolex / Arriflex 16SR)",
    cropFactor: 2.9,
    nativeAspectRatio: "4:3",
    aestheticNotes: "Organic tactile film grain, soft halation around bright practical lights, warm nostalgic aesthetic.",
  },
};

/**
 * Optical Lens Profiles & Focal Lengths.
 */
export const LENS_CLASSES = [
  "ultra_wide",
  "wide",
  "standard",
  "portrait",
  "telephoto",
  "macro",
  "anamorphic_prime",
] as const;

export type LensClass = typeof LENS_CLASSES[number];

export interface LensProfile {
  focalLengthMm: number;
  displayName: string;
  lensClass: LensClass;
  typicalAperture: string;
  depthOfField: "shallow" | "moderate" | "deep";
  distortionCharacteristic: "barrel" | "neutral" | "pincushion" | "anamorphic_streak";
  psychologicalEffect: string;
}

export const LENS_KIT: Record<string, LensProfile> = {
  "14mm": {
    focalLengthMm: 14,
    displayName: "14mm Ultra-Wide",
    lensClass: "ultra_wide",
    typicalAperture: "f/2.8",
    depthOfField: "deep",
    distortionCharacteristic: "barrel",
    psychologicalEffect: "Exaggerates spatial depth, isolates subject in overwhelming environments, dynamic architectural perspective.",
  },
  "24mm": {
    focalLengthMm: 24,
    displayName: "24mm Wide Master",
    lensClass: "wide",
    typicalAperture: "f/2.0",
    depthOfField: "deep",
    distortionCharacteristic: "neutral",
    psychologicalEffect: "Expansive environmental context, hero shot low angles, dynamic movement towards camera.",
  },
  "35mm": {
    focalLengthMm: 35,
    displayName: "35mm Narrative Standard",
    lensClass: "standard",
    typicalAperture: "f/1.4",
    depthOfField: "moderate",
    distortionCharacteristic: "neutral",
    psychologicalEffect: "Natural cinematic eye. Connects character intimately to their immediate surroundings.",
  },
  "50mm": {
    focalLengthMm: 50,
    displayName: "50mm Human Perspective",
    lensClass: "standard",
    typicalAperture: "f/1.2",
    depthOfField: "shallow",
    distortionCharacteristic: "neutral",
    psychologicalEffect: "Objective realism. Replicates natural human eye perspective with zero foreshortening distortion.",
  },
  "85mm": {
    focalLengthMm: 85,
    displayName: "85mm Portrait Prime",
    lensClass: "portrait",
    typicalAperture: "f/1.4",
    depthOfField: "shallow",
    distortionCharacteristic: "neutral",
    psychologicalEffect: "Flattering facial geometry, compression of background, dreamy bokeh separating subject from chaos.",
  },
  "135mm": {
    focalLengthMm: 135,
    displayName: "135mm Telephoto Compression",
    lensClass: "telephoto",
    typicalAperture: "f/2.0",
    depthOfField: "shallow",
    distortionCharacteristic: "pincushion",
    psychologicalEffect: "Extreme background compression, surveillance voyeurism, claustrophobic intimacy.",
  },
  "40mm_anamorphic": {
    focalLengthMm: 40,
    displayName: "40mm Anamorphic Prime (2x Squeeze)",
    lensClass: "anamorphic_prime",
    typicalAperture: "T/2.3",
    depthOfField: "shallow",
    distortionCharacteristic: "anamorphic_streak",
    psychologicalEffect: "Iconic cinematic widescreen scope, horizontal flare streaks, painterly emotional weight.",
  },
};

/**
 * Framing Scales & Shot Types.
 */
export const FRAMING_TYPES = [
  "extreme_wide_shot",
  "wide_shot",
  "medium_wide_shot",
  "medium_shot",
  "medium_close_up",
  "close_up",
  "extreme_close_up",
  "over_the_shoulder",
  "dutch_angle",
  "point_of_view",
] as const;

export type FramingType = typeof FRAMING_TYPES[number];

export interface FramingDefinition {
  id: FramingType;
  label: string;
  abbreviation: string;
  description: string;
  subjectCoverage: string;
}

export const FRAMING_CATALOG: Record<FramingType, FramingDefinition> = {
  extreme_wide_shot: {
    id: "extreme_wide_shot",
    label: "Extreme Wide Shot",
    abbreviation: "EWS",
    description: "Vast establishing view where the environment dominates and subjects are small figures.",
    subjectCoverage: "5-10% of frame height",
  },
  wide_shot: {
    id: "wide_shot",
    label: "Wide Shot (Full Shot)",
    abbreviation: "WS",
    description: "Subject head-to-toe with clear ground baseline and immediate environmental context.",
    subjectCoverage: "70-90% of frame height",
  },
  medium_wide_shot: {
    id: "medium_wide_shot",
    label: "Medium Wide Shot (Cowboy)",
    abbreviation: "MWS",
    description: "Framed from mid-thigh up, ideal for physical posture, hand movement, and holster/pocket actions.",
    subjectCoverage: "Mid-thigh to head",
  },
  medium_shot: {
    id: "medium_shot",
    label: "Medium Shot",
    abbreviation: "MS",
    description: "Framed from waist up. Balances body language, costume base-layers, and conversational energy.",
    subjectCoverage: "Waist to head",
  },
  medium_close_up: {
    id: "medium_close_up",
    label: "Medium Close-Up",
    abbreviation: "MCU",
    description: "Framed from chest up. The standard dialogue and emotional delivery framing.",
    subjectCoverage: "Chest/sternum to head",
  },
  close_up: {
    id: "close_up",
    label: "Close-Up",
    abbreviation: "CU",
    description: "Tight framing on head and shoulders, emphasizing nuanced micro-expressions and eye line.",
    subjectCoverage: "Collarbone to crown",
  },
  extreme_close_up: {
    id: "extreme_close_up",
    label: "Extreme Close-Up",
    abbreviation: "ECU",
    description: "Magnified focus on a specific feature (eyes, mouth, hands, key object). High psychological tension.",
    subjectCoverage: "Eyes / mouth / single feature",
  },
  over_the_shoulder: {
    id: "over_the_shoulder",
    label: "Over-The-Shoulder",
    abbreviation: "OTS",
    description: "Foreground character shoulder/head out of focus, framing conversational partner in focus.",
    subjectCoverage: "Dirty foreground shoulder + partner MCU",
  },
  dutch_angle: {
    id: "dutch_angle",
    label: "Dutch Angle (Canted Frame)",
    abbreviation: "DUTCH",
    description: "Camera tilted 10-25 degrees off horizontal axis, signaling disorientation, unease, or psychological crisis.",
    subjectCoverage: "Canted horizon diagonal",
  },
  point_of_view: {
    id: "point_of_view",
    label: "Point of View",
    abbreviation: "POV",
    description: "First-person subjective camera showing exactly what a character sees.",
    subjectCoverage: "Subjective eye line",
  },
};

/**
 * Camera Motion Vectors & Rigs.
 */
export const CAMERA_RIGS = [
  "tripod_static",
  "dolly_track",
  "steadicam_smooth",
  "handheld_organic",
  "handheld_visceral",
  "crane_jib",
  "cable_cam",
  "fpv_drone",
] as const;

export type CameraRig = typeof CAMERA_RIGS[number];

export interface CameraMotionPreset {
  id: string;
  name: string;
  rig: CameraRig;
  description: string;
  cameraControlVector: {
    pan: number; // -10 to 10
    tilt: number; // -10 to 10
    zoom: number; // -10 to 10 (negative = pull-out, positive = push-in)
    roll: number; // -10 to 10
  };
  comfyMotionType: string;
  promptPhrase: string;
}

export const CAMERA_MOTION_PRESETS: Record<string, CameraMotionPreset> = {
  static_lock: {
    id: "static_lock",
    name: "Static Lock-Off",
    rig: "tripod_static",
    description: "Rock-solid static composition on heavy tripod. No camera drift or shake.",
    cameraControlVector: { pan: 0, tilt: 0, zoom: 0, roll: 0 },
    comfyMotionType: "static",
    promptPhrase: "Static locked tripod shot, motionless camera",
  },
  slow_push_in: {
    id: "slow_push_in",
    name: "Slow Dramatic Push-In",
    rig: "dolly_track",
    description: "Smooth dolly push toward subject to increase emotional gravity or revelation.",
    cameraControlVector: { pan: 0, tilt: 0, zoom: 2.5, roll: 0 },
    comfyMotionType: "dolly_in",
    promptPhrase: "Slow smooth dolly push-in towards subject",
  },
  slow_pull_out: {
    id: "slow_pull_out",
    name: "Slow Pull-Out Reveal",
    rig: "dolly_track",
    description: "Reverse dolly retreat pulling away from subject to reveal surrounding threat or isolation.",
    cameraControlVector: { pan: 0, tilt: 0, zoom: -2.5, roll: 0 },
    comfyMotionType: "dolly_out",
    promptPhrase: "Slow smooth dolly pull-out revealing environment",
  },
  tracking_lead: {
    id: "tracking_lead",
    name: "Backwards Tracking Lead",
    rig: "steadicam_smooth",
    description: "Steadicam moving backwards ahead of walking subject, keeping subject centered.",
    cameraControlVector: { pan: 0, tilt: 0, zoom: -1.5, roll: 0 },
    comfyMotionType: "track_lead",
    promptPhrase: "Smooth Steadicam tracking backward ahead of walking character",
  },
  lateral_truck_right: {
    id: "lateral_truck_right",
    name: "Lateral Truck Right",
    rig: "dolly_track",
    description: "Smooth horizontal tracking shot parallel to action, tracking subject left-to-right.",
    cameraControlVector: { pan: 3.5, tilt: 0, zoom: 0, roll: 0 },
    comfyMotionType: "truck_right",
    promptPhrase: "Smooth lateral tracking shot moving parallel to action from left to right",
  },
  slow_orbit_left: {
    id: "slow_orbit_left",
    name: "Cinematic Orbit Arc Left",
    rig: "steadicam_smooth",
    description: "Graceful 360 or 90 degree rotational arc orbiting the subject.",
    cameraControlVector: { pan: -4.0, tilt: 0, zoom: 0.5, roll: 0 },
    comfyMotionType: "orbit_left",
    promptPhrase: "Steadicam smooth 360 rotational orbit circling around character",
  },
  crane_pedestal_up: {
    id: "crane_pedestal_up",
    name: "Crane Pedestal Rise",
    rig: "crane_jib",
    description: "Vertical crane rise lifting over subject into high vantage point.",
    cameraControlVector: { pan: 0, tilt: -3.0, zoom: 1.0, roll: 0 },
    comfyMotionType: "pedestal_up",
    promptPhrase: "Majestic crane boom elevating upward from ground to high angle",
  },
  handheld_breathing: {
    id: "handheld_breathing",
    name: "Organic Handheld Breathing",
    rig: "handheld_organic",
    description: "Subtle organic human camera sway, conveying presence and natural documentary authenticity.",
    cameraControlVector: { pan: 0.5, tilt: -0.5, zoom: 0, roll: 0.5 },
    comfyMotionType: "handheld_subtle",
    promptPhrase: "Organic cinematic handheld camerawork, subtle natural breathing sway",
  },
  handheld_urgent: {
    id: "handheld_urgent",
    name: "Visceral Action Handheld",
    rig: "handheld_visceral",
    description: "Energetic, urgent camera movement with micro-jitter matching rapid combat or flight.",
    cameraControlVector: { pan: 2.0, tilt: 1.5, zoom: 1.0, roll: -1.0 },
    comfyMotionType: "handheld_intense",
    promptPhrase: "Visceral documentary handheld camera, kinetic tracking, combat urgency",
  },
  vertigo_zolly: {
    id: "vertigo_zolly",
    name: "Vertigo Dolly Zoom (Zolly)",
    rig: "dolly_track",
    description: "Dolly in while zooming out simultaneously, creating background warping disorientation.",
    cameraControlVector: { pan: 0, tilt: 0, zoom: -5.0, roll: 0 },
    comfyMotionType: "dolly_zoom",
    promptPhrase: "Dramatic Vertigo dolly-zoom effect, background perspectives warping while subject stays constant",
  },
};

/**
 * Complete Camera Setup Schema.
 */
export const cameraSetupSchema = z.object({
  sensorFormat: z.enum(SENSOR_FORMATS).default("full_frame_35mm"),
  lensFocalLength: z.string().trim().default("35mm"),
  framing: z.enum(FRAMING_TYPES).default("medium_close_up"),
  motionPresetId: z.string().trim().default("static_lock"),
  aperture: z.string().trim().default("f/2.0"),
  shutterAngle: z.number().int().default(180), // Standard 180 degree cinema shutter
  iso: z.number().int().default(800),
  colorTempKelvin: z.number().int().default(5600), // Daylight 5600K or Tungsten 3200K
  opticalFilters: z.array(z.string()).default([]), // e.g. "1/8 Black Pro-Mist", "Circular Polarizer"
});

export type CameraSetup = z.infer<typeof cameraSetupSchema>;

/**
 * Compiles a rich camera directive prompt segment suitable for Seedance / FLUX / Wan2.1.
 */
export function compileCameraPrompt(setup: Partial<CameraSetup>): string {
  const sensor = SENSOR_PROFILES[setup.sensorFormat ?? "full_frame_35mm"];
  const lens = LENS_KIT[setup.lensFocalLength ?? "35mm"] ?? {
    displayName: `${setup.lensFocalLength ?? "35mm"} Prime`,
    typicalAperture: setup.aperture ?? "f/2.0",
    distortionCharacteristic: "neutral",
  };
  const framing = FRAMING_CATALOG[setup.framing ?? "medium_close_up"];
  const motion = CAMERA_MOTION_PRESETS[setup.motionPresetId ?? "static_lock"] ?? CAMERA_MOTION_PRESETS.static_lock;

  const filters = (setup.opticalFilters ?? []).length
    ? `with ${setup.opticalFilters?.join(", ")} filtration`
    : "";

  const clauses = [
    `${framing.label} (${framing.abbreviation})`,
    `Shot on ${sensor.name}`,
    `Using ${lens.displayName} at ${setup.aperture ?? lens.typicalAperture}`,
    filters,
    motion.promptPhrase,
    "35mm filmic optical depth of field, pristine cinematic optics",
  ].filter(Boolean);

  return clauses.join(", ") + ".";
}

/**
 * Resolves camera motion name to normalized commercial API control vectors (-10 to +10).
 */
export function resolveCameraControlVector(
  motionNameOrId: string | null | undefined,
  intensityScale: number = 1.0
): { pan: number; tilt: number; zoom: number; roll: number } {
  if (!motionNameOrId) {
    return { pan: 0, tilt: 0, zoom: 0, roll: 0 };
  }

  const normalized = motionNameOrId.toLowerCase().trim().replace(/[- ]+/g, "_");

  // Check direct preset id match
  if (CAMERA_MOTION_PRESETS[normalized]) {
    const vec = CAMERA_MOTION_PRESETS[normalized].cameraControlVector;
    return {
      pan: Number((vec.pan * intensityScale).toFixed(2)),
      tilt: Number((vec.tilt * intensityScale).toFixed(2)),
      zoom: Number((vec.zoom * intensityScale).toFixed(2)),
      roll: Number((vec.roll * intensityScale).toFixed(2)),
    };
  }

  // Heuristic matching against motion text
  const result = { pan: 0, tilt: 0, zoom: 0, roll: 0 };

  if (normalized.includes("push") || normalized.includes("zoom_in") || normalized.includes("dolly_in")) {
    result.zoom = 2.5 * intensityScale;
  } else if (normalized.includes("pull") || normalized.includes("zoom_out") || normalized.includes("dolly_out")) {
    result.zoom = -2.5 * intensityScale;
  }

  if (normalized.includes("pan_right") || normalized.includes("truck_right") || normalized.includes("orbit_right")) {
    result.pan = 3.0 * intensityScale;
  } else if (normalized.includes("pan_left") || normalized.includes("truck_left") || normalized.includes("orbit_left")) {
    result.pan = -3.0 * intensityScale;
  }

  if (normalized.includes("tilt_up") || normalized.includes("pedestal_up") || normalized.includes("crane_up")) {
    result.tilt = -2.5 * intensityScale;
  } else if (normalized.includes("tilt_down") || normalized.includes("pedestal_down") || normalized.includes("crane_down")) {
    result.tilt = 2.5 * intensityScale;
  }

  if (normalized.includes("roll_left") || normalized.includes("dutch_left")) {
    result.roll = -2.0 * intensityScale;
  } else if (normalized.includes("roll_right") || normalized.includes("dutch_right")) {
    result.roll = 2.0 * intensityScale;
  }

  return {
    pan: Number(result.pan.toFixed(2)),
    tilt: Number(result.tilt.toFixed(2)),
    zoom: Number(result.zoom.toFixed(2)),
    roll: Number(result.roll.toFixed(2)),
  };
}

/** Aliases for consistent catalog naming across the cinematic abstraction layer. */
export const LENS_CATALOG = LENS_KIT;
export const CAMERA_MOTION_CATALOG = CAMERA_MOTION_PRESETS;
