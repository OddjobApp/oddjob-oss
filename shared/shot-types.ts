import { z } from "zod";
import type { CameraRig, LensProfile } from "./camera-library.js";

/**
 * 1. Shot Scale / Distance (Field of View).
 */
export const SHOT_SCALES = [
  "extreme_long_shot",   // ELS / EWS: Landscape dominates, characters are tiny specks
  "long_shot",           // LS / WS: Full human figure visible with ample environment
  "full_shot",           // FS: Head to toe tightly framed with immediate ground
  "medium_long_shot",    // MLS / MWS / Cowboy: Mid-thigh up
  "medium_shot",         // MS: Waist up, natural dialogue posture
  "medium_close_up",     // MCU: Chest / sternum up, emotional speech
  "close_up",            // CU: Collarbone / chin to crown, facial expressions
  "choker_shot",         // Choker: Just above eyebrows to below mouth, intense confrontation
  "extreme_close_up",    // ECU: Single feature (eyes, mouth, trigger, hands)
  "macro_detail",        // Macro: Textures, micro-mechanics, droplets, iris
] as const;

export type ShotScale = typeof SHOT_SCALES[number];

export interface ShotScaleInfo {
  id: ShotScale;
  name: string;
  abbreviation: string;
  framingAnchor: string;
  coverageRatio: string;
  narrativePurpose: string;
}

export const SHOT_SCALE_INFO: Record<ShotScale, ShotScaleInfo> = {
  extreme_long_shot: {
    id: "extreme_long_shot",
    name: "Extreme Long Shot",
    abbreviation: "ELS",
    framingAnchor: "Horizon / Vistas",
    coverageRatio: "< 5% human subject",
    narrativePurpose: "World-building, isolation, overwhelming scale of environment.",
  },
  long_shot: {
    id: "long_shot",
    name: "Long Shot",
    abbreviation: "LS",
    framingAnchor: "Full environment + characters",
    coverageRatio: "15-25% human subject",
    narrativePurpose: "Establishing spatial relationships, entrances, geography.",
  },
  full_shot: {
    id: "full_shot",
    name: "Full Shot",
    abbreviation: "FS",
    framingAnchor: "Head to toe",
    coverageRatio: "75-90% human subject",
    narrativePurpose: "Full body costume, physical action, stance, athletic motion.",
  },
  medium_long_shot: {
    id: "medium_long_shot",
    name: "Medium Long Shot (Cowboy)",
    abbreviation: "MLS",
    framingAnchor: "Mid-thigh to head",
    coverageRatio: "Mid-thigh to crown",
    narrativePurpose: "Hand-to-waist holster action, swagger, confident confrontations.",
  },
  medium_shot: {
    id: "medium_shot",
    name: "Medium Shot",
    abbreviation: "MS",
    framingAnchor: "Waist up",
    coverageRatio: "Waist to crown",
    narrativePurpose: "Standard dialogue coverage, body language, social interactions.",
  },
  medium_close_up: {
    id: "medium_close_up",
    name: "Medium Close-Up",
    abbreviation: "MCU",
    framingAnchor: "Chest / sternum to head",
    coverageRatio: "Chest to crown",
    narrativePurpose: "Primary dialogue workhorse, intimacy without claustrophobia.",
  },
  close_up: {
    id: "close_up",
    name: "Close-Up",
    abbreviation: "CU",
    framingAnchor: "Collarbone to crown",
    coverageRatio: "Face dominates frame",
    narrativePurpose: "Subtle micro-expressions, vulnerability, emotional turning points.",
  },
  choker_shot: {
    id: "choker_shot",
    name: "Choker Shot",
    abbreviation: "CHOKER",
    framingAnchor: "Eyebrows to chin",
    coverageRatio: "Tight cropped face",
    narrativePurpose: "Intense psychological claustrophobia, interrogation, suffocating pressure.",
  },
  extreme_close_up: {
    id: "extreme_close_up",
    name: "Extreme Close-Up",
    abbreviation: "ECU",
    framingAnchor: "Single feature (eyes / lips / hands)",
    coverageRatio: "Feature fills 100% of frame",
    narrativePurpose: "Visceral tension, realization, sweating brow, trembling fingers.",
  },
  macro_detail: {
    id: "macro_detail",
    name: "Macro Detail",
    abbreviation: "MACRO",
    framingAnchor: "Microscopic surface",
    coverageRatio: "Microscopic object",
    narrativePurpose: "Forensics, tactile detail, mechanism click, bullet chambering.",
  },
};

/**
 * 2. Camera Angles & Vertical Perspectives.
 */
export const CAMERA_ANGLES = [
  "birds_eye_overhead", // 90 degrees overhead looking down
  "high_angle",          // Looking down at subject (diminishes power, creates vulnerability)
  "eye_level",           // Neutral human perspective (objective, empathetic)
  "low_angle",           // Looking up at subject (enhances power, authority, heroism)
  "worms_eye_ground",    // From the floor/ground looking almost straight up
  "dutch_angle_canted",  // Tilted off-axis (instability, disorientation, tension)
] as const;

export type CameraAngle = typeof CAMERA_ANGLES[number];

export interface CameraAngleInfo {
  id: CameraAngle;
  name: string;
  degreesPitch: number;
  psychologicalEffect: string;
}

export const CAMERA_ANGLE_INFO: Record<CameraAngle, CameraAngleInfo> = {
  birds_eye_overhead: {
    id: "birds_eye_overhead",
    name: "Bird's-Eye View (God's Eye)",
    degreesPitch: -90,
    psychologicalEffect: "Detached omniscience, fate, geometric urban labyrinth, insignificance.",
  },
  high_angle: {
    id: "high_angle",
    name: "High-Angle Shot",
    degreesPitch: -35,
    psychologicalEffect: "Vulnerability, weakness, being cornered, surveilled, or trapped.",
  },
  eye_level: {
    id: "eye_level",
    name: "Eye-Level (Neutral)",
    degreesPitch: 0,
    psychologicalEffect: "Empathetic parity, natural human connection, objective observer.",
  },
  low_angle: {
    id: "low_angle",
    name: "Low-Angle Shot",
    degreesPitch: 30,
    psychologicalEffect: "Empowerment, authority, heroism, towering menace, intimidation.",
  },
  worms_eye_ground: {
    id: "worms_eye_ground",
    name: "Worm's-Eye Ground Shot",
    degreesPitch: 65,
    psychologicalEffect: "Monumental titan scale, footstep impact, colossal perspective.",
  },
  dutch_angle_canted: {
    id: "dutch_angle_canted",
    name: "Dutch Angle (Canted)",
    degreesPitch: 0,
    psychologicalEffect: "Psychological unease, cognitive dissonance, impending catastrophe, madness.",
  },
};

/**
 * 3. Subject Staging & Relational Framing.
 */
export const SUBJECT_STAGINGS = [
  "single_clean",       // Single character isolated in frame
  "single_dirty",       // Single character with out-of-focus foreground element
  "two_shot_dialogue",  // Two characters framed together
  "three_shot_dynamic", // Three characters in frame balancing power dynamic
  "group_ensemble",     // 4+ characters interacting
  "ots_clean",          // Over-the-shoulder without touching foreground character
  "ots_dirty",          // Over-the-shoulder with foreground silhouette/shoulder
  "pov_subjective",     // Direct first-person POV
  "reaction_reverse",   // Cut to face responding to previous action
  "insert_cut_in",      // Close detail of an object essential to the plot
  "cutaway_context",    // Peripheral scene detail to establish atmosphere or cut pacing
  "master_coverage",    // Unbroken spatial view capturing full scene action
] as const;

export type SubjectStaging = typeof SUBJECT_STAGINGS[number];

/**
 * 4. Depth of Field & Optical Focus Techniques.
 */
export const FOCUS_TECHNIQUES = [
  "deep_focus",          // Everything from 1 foot to infinity in sharp focus
  "shallow_focus",       // Razor-thin depth of field, creamy bokeh
  "rack_focus_shift",    // Focus shifts mid-shot from foreground to background
  "split_diopter",       // Two planes simultaneously sharp with blurred seam
] as const;

export type FocusTechnique = typeof FOCUS_TECHNIQUES[number];

/**
 * Complete Shot Type Definition Schema.
 */
export const shotTypeDefinitionSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  scale: z.enum(SHOT_SCALES),
  angle: z.enum(CAMERA_ANGLES).default("eye_level"),
  staging: z.enum(SUBJECT_STAGINGS).default("single_clean"),
  focus: z.enum(FOCUS_TECHNIQUES).default("shallow_focus"),
  recommendedFocalLength: z.string().trim().default("35mm"),
  recommendedRig: z.enum([
    "tripod_static",
    "dolly_track",
    "steadicam_smooth",
    "handheld_organic",
    "handheld_visceral",
    "crane_jib",
    "cable_cam",
    "fpv_drone",
  ]).default("tripod_static"),
  description: z.string().trim(),
  psychologicalImpact: z.string().trim(),
  avoidExclusions: z.array(z.string().trim()).default([]),
});

export type ShotTypeDefinition = z.infer<typeof shotTypeDefinitionSchema>;

/**
 * Standard Industry Shot Types Catalog.
 */
export const SHOT_TYPES_CATALOG: Record<string, ShotTypeDefinition> = {
  hero_low_angle_mcu: {
    id: "hero_low_angle_mcu",
    name: "Heroic Low-Angle MCU",
    scale: "medium_close_up",
    angle: "low_angle",
    staging: "single_clean",
    focus: "shallow_focus",
    recommendedFocalLength: "35mm",
    recommendedRig: "dolly_track",
    description: "Slight low-angle medium close-up elevating the hero's jawline and confidence.",
    psychologicalImpact: "Commands authority and resilience against looming conflict.",
    avoidExclusions: ["no double chins", "no cartoonish distortion", "no overhead lights blowing out forehead"],
  },
  intimate_dirty_ots: {
    id: "intimate_dirty_ots",
    name: "Dirty Over-The-Shoulder Dialogue",
    scale: "medium_close_up",
    angle: "eye_level",
    staging: "ots_dirty",
    focus: "shallow_focus",
    recommendedFocalLength: "50mm",
    recommendedRig: "handheld_organic",
    description: "Framed past the soft dark silhouette of a conversational partner onto the speaking subject.",
    psychologicalImpact: "Intense conversational immersion, emotional connection and vulnerability.",
    avoidExclusions: ["no distracting foreground motion", "no flat staging", "no mirror symmetry"],
  },
  neo_noir_dutch_choker: {
    id: "neo_noir_dutch_choker",
    name: "Neo-Noir Dutch Choker",
    scale: "choker_shot",
    angle: "dutch_angle_canted",
    staging: "single_clean",
    focus: "shallow_focus",
    recommendedFocalLength: "85mm",
    recommendedRig: "handheld_organic",
    description: "Tilted, razor-tight framing on eyes and sweating brow under harsh directional lighting.",
    psychologicalImpact: "Impending psychological breakdown, acute moral panic, or imminent peril.",
    avoidExclusions: ["no balanced horizon", "no soft flat fill", "no smiling"],
  },
  surveillance_gods_eye: {
    id: "surveillance_gods_eye",
    name: "Overhead God's-Eye View",
    scale: "extreme_long_shot",
    angle: "birds_eye_overhead",
    staging: "master_coverage",
    focus: "deep_focus",
    recommendedFocalLength: "24mm",
    recommendedRig: "crane_jib",
    description: "Perpendicular top-down angle revealing maze-like ground architecture and isolated subject movement.",
    psychologicalImpact: "Cold detachment, predestination, surveillance tracking, insignificance.",
    avoidExclusions: ["no camera tilt", "no perspective horizon", "no shaky movement"],
  },
  confrontation_profile_two_shot: {
    id: "confrontation_profile_two_shot",
    name: "Tense Profile Two-Shot",
    scale: "medium_shot",
    angle: "eye_level",
    staging: "two_shot_dialogue",
    focus: "deep_focus",
    recommendedFocalLength: "35mm",
    recommendedRig: "tripod_static",
    description: "Two opposing characters framed in profile facing each other across the frame in static tension.",
    psychologicalImpact: "Direct standoff, balanced power struggle, unyielding opposition.",
    avoidExclusions: ["no camera wandering", "no soft focus on either face", "no casual postures"],
  },
  visceral_macro_insert: {
    id: "visceral_macro_insert",
    name: "Tactile Macro Insert",
    scale: "macro_detail",
    angle: "eye_level",
    staging: "insert_cut_in",
    focus: "shallow_focus",
    recommendedFocalLength: "100mm",
    recommendedRig: "tripod_static",
    description: "Ultra-close focus on a crucial physical device, trigger mechanism, keycode pad, or iris pulse.",
    psychologicalImpact: "Heightens sensory focus, marks a decisive plot pivot point.",
    avoidExclusions: ["no blurry focal point", "no digital artifacts", "no hands blocking subject"],
  },
  epic_cowboy_tracking: {
    id: "epic_cowboy_tracking",
    name: "Epic Cowboy Tracking Shot",
    scale: "medium_long_shot",
    angle: "low_angle",
    staging: "single_clean",
    focus: "deep_focus",
    recommendedFocalLength: "28mm",
    recommendedRig: "steadicam_smooth",
    description: "Mid-thigh tracking shot following a walking character with weapon, coat, or tool in motion.",
    psychologicalImpact: "Steely determination, forward momentum, readiness for imminent battle.",
    avoidExclusions: ["no stumbling camera", "no high angle", "no comical exaggeration"],
  },
  visceral_combat_handheld_pov: {
    id: "visceral_combat_handheld_pov",
    name: "Visceral Combat POV",
    scale: "medium_shot",
    angle: "eye_level",
    staging: "pov_subjective",
    focus: "deep_focus",
    recommendedFocalLength: "24mm",
    recommendedRig: "handheld_visceral",
    description: "First-person perspective tracking hand movements, weapon handling, or sprint evasion.",
    psychologicalImpact: "Pure adrenaline, claustrophobic sensory shock, immediate audience immersion.",
    avoidExclusions: ["no calm tripod", "no distant perspectives", "no unnatural motion smoothing"],
  },
};

/**
 * Compiles a shot type directive into deterministic prompt syntax.
 */
export function compileShotTypePrompt(
  shotType: ShotTypeDefinition | string,
  overrides?: {
    subjectName?: string;
    action?: string;
  }
): {
  promptDirective: string;
  negativeDirectives: string[];
} {
  const def = typeof shotType === "string"
    ? SHOT_TYPES_CATALOG[shotType] ?? SHOT_TYPES_CATALOG.hero_low_angle_mcu
    : shotType;

  const scale = SHOT_SCALE_INFO[def.scale];
  const angle = CAMERA_ANGLE_INFO[def.angle];

  const subjectClause = overrides?.subjectName
    ? `focused on ${overrides.subjectName}`
    : "";
  const actionClause = overrides?.action
    ? `as ${overrides.action}`
    : "";

  const clauses = [
    `${scale.name} (${scale.abbreviation})`,
    `${angle.name}`,
    def.staging.replace(/_/g, " "),
    def.focus.replace(/_/g, " "),
    subjectClause,
    actionClause,
    `shot on ${def.recommendedFocalLength} lens`,
    def.description,
  ].filter(Boolean);

  return {
    promptDirective: clauses.join(", ") + ".",
    negativeDirectives: def.avoidExclusions,
  };
}

/**
 * Heuristic recommender that recommends optimal shot types based on script context.
 */
export function recommendShotType(options: {
  characterCount: number;
  isDialogue: boolean;
  isAction: boolean;
  isClimactic: boolean;
  mood?: string;
}): ShotTypeDefinition[] {
  const recommendations: ShotTypeDefinition[] = [];

  if (options.isClimactic) {
    recommendations.push(SHOT_TYPES_CATALOG.neo_noir_dutch_choker);
    recommendations.push(SHOT_TYPES_CATALOG.hero_low_angle_mcu);
  }

  if (options.characterCount >= 2 && options.isDialogue) {
    recommendations.push(SHOT_TYPES_CATALOG.intimate_dirty_ots);
    recommendations.push(SHOT_TYPES_CATALOG.confrontation_profile_two_shot);
  }

  if (options.isAction) {
    recommendations.push(SHOT_TYPES_CATALOG.epic_cowboy_tracking);
    recommendations.push(SHOT_TYPES_CATALOG.visceral_combat_handheld_pov);
  }

  if (recommendations.length === 0) {
    recommendations.push(SHOT_TYPES_CATALOG.hero_low_angle_mcu);
    recommendations.push(SHOT_TYPES_CATALOG.surveillance_gods_eye);
  }

  return recommendations;
}

/**
 * Resolves a shot type from the catalog by its ID, slug, or matching name.
 */
export function findShotTypeByNameOrId(identifier: string): ShotTypeDefinition | undefined {
  const cleanId = identifier.trim().toLowerCase().replace(/[-\s]/g, "_");
  if (SHOT_TYPES_CATALOG[cleanId]) return SHOT_TYPES_CATALOG[cleanId];
  return Object.values(SHOT_TYPES_CATALOG).find(
    (st) => st.id.toLowerCase() === cleanId || st.name.toLowerCase() === identifier.trim().toLowerCase() || st.name.toLowerCase().includes(identifier.trim().toLowerCase())
  );
}
