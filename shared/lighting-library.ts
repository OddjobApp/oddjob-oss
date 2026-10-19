import { z } from "zod";

/**
 * Lighting Contrast Ratios.
 */
export const CONTRAST_RATIOS = [
  "1:1_flat_commercial",
  "2:1_soft_naturalistic",
  "4:1_dramatic_cinematic",
  "8:1_chiaroscuro_noir",
  "16:1_silhouette_hard",
] as const;

export type ContrastRatio = typeof CONTRAST_RATIOS[number];

/**
 * Volumetric Atmosphere Types.
 */
export const VOLUMETRIC_TYPES = [
  "none_crystal_clear",
  "subtle_particulate_haze",
  "theatrical_mineral_fog",
  "heavy_steam_condensation",
  "sunlit_dust_motes",
  "acrid_combat_smoke",
] as const;

export type VolumetricType = typeof VOLUMETRIC_TYPES[number];

/**
 * Key Light Specifications.
 */
export const keyLightSpecSchema = z.object({
  horizontalAngleDeg: z.number().min(-180).max(180).default(45), // 0 = straight on, 90 = full side profile
  verticalElevationDeg: z.number().min(-90).max(90).default(30),  // 0 = eye level, 45 = overhead high key
  quality: z.enum(["hard_directional", "soft_diffused", "specular_harsh"]).default("soft_diffused"),
  colorTempKelvin: z.number().int().min(1500).max(12000).default(4500),
  intensityLumensApprox: z.string().default("standard key"),
});

export type KeyLightSpec = z.infer<typeof keyLightSpecSchema>;

/**
 * Fill & Ambient Specifications.
 */
export const fillLightSpecSchema = z.object({
  ratio: z.enum(CONTRAST_RATIOS).default("4:1_dramatic_cinematic"),
  fillMethod: z.string().trim().default("soft white bounce board"),
  colorTempKelvin: z.number().int().default(5600),
});

export type FillLightSpec = z.infer<typeof fillLightSpecSchema>;

/**
 * Rim / Kicker / Hair Light Specifications.
 */
export const rimLightSpecSchema = z.object({
  enabled: z.boolean().default(true),
  placement: z.string().trim().default("behind subject high camera left"),
  colorTone: z.string().trim().default("cool cyan rim highlight"),
  edgeSeparationIntensity: z.enum(["subtle", "prominent", "intense_streak"]).default("prominent"),
});

export type RimLightSpec = z.infer<typeof rimLightSpecSchema>;

/**
 * Complete Lighting Rig Definition Schema.
 */
export const lightingRigDefinitionSchema = z.object({
  rigId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  genreArchetype: z.string().trim(),
  contrastRatio: z.enum(CONTRAST_RATIOS),
  keyLight: keyLightSpecSchema,
  fillLight: fillLightSpecSchema,
  rimLight: rimLightSpecSchema,
  practicals: z.array(z.string().trim()).default([]), // In-scene light sources (monitors, neon, lamps)
  volumetrics: z.enum(VOLUMETRIC_TYPES).default("subtle_particulate_haze"),
  psychologicalImpact: z.string().trim(),
  avoidExclusions: z.array(z.string().trim()).default([]),
});

export type LightingRigDefinition = z.infer<typeof lightingRigDefinitionSchema>;

/**
 * Curated Lighting Rigs Catalog.
 */
export const LIGHTING_CATALOG: Record<string, LightingRigDefinition> = {
  noir_chiaroscuro_cross: {
    rigId: "noir_chiaroscuro_cross",
    name: "Classic Neo-Noir Chiaroscuro",
    genreArchetype: "Crime / Thriller / Mystery",
    contrastRatio: "8:1_chiaroscuro_noir",
    keyLight: {
      horizontalAngleDeg: 75,
      verticalElevationDeg: 25,
      quality: "hard_directional",
      colorTempKelvin: 3200,
      intensityLumensApprox: "hard Venetian blind slit or slash light",
    },
    fillLight: {
      ratio: "8:1_chiaroscuro_noir",
      fillMethod: "minimal negative fill with deep velvet shadows",
      colorTempKelvin: 4000,
    },
    rimLight: {
      enabled: true,
      placement: "hard kicker opposite camera right",
      colorTone: "crisp white silver rim separating jawline",
      edgeSeparationIntensity: "prominent",
    },
    practicals: ["flickering neon beer sign through rain-streaked window", "dim incandescent brass desk lamp"],
    volumetrics: "theatrical_mineral_fog",
    psychologicalImpact: "Moral ambiguity, impending danger, secrets hidden in pitch blackness.",
    avoidExclusions: ["no flat even lighting", "no bright commercial fill", "no pastel tones"],
  },

  cyberpunk_bicolor_neon: {
    rigId: "cyberpunk_bicolor_neon",
    name: "Cyberpunk Dual-Complementary (Teal & Amber)",
    genreArchetype: "Sci-Fi / Dystopian",
    contrastRatio: "4:1_dramatic_cinematic",
    keyLight: {
      horizontalAngleDeg: 45,
      verticalElevationDeg: 30,
      quality: "soft_diffused",
      colorTempKelvin: 7500, // Electric cyan/teal
      intensityLumensApprox: "overhead neon canopy bounce",
    },
    fillLight: {
      ratio: "4:1_dramatic_cinematic",
      fillMethod: "deep electric magenta-pink ambient fill",
      colorTempKelvin: 3000,
    },
    rimLight: {
      enabled: true,
      placement: "high camera-left sodium street spill",
      colorTone: "warm golden sodium vapor amber",
      edgeSeparationIntensity: "prominent",
    },
    practicals: ["glowing CRT monitors", "exposed vertical neon glass tubes", "wet reflective asphalt"],
    volumetrics: "heavy_steam_condensation",
    psychologicalImpact: "Technological alienation, sensory overload, electric urban isolation.",
    avoidExclusions: ["no natural daylight", "no white neutral office lighting", "no flat desaturation"],
  },

  golden_hour_natural: {
    rigId: "golden_hour_natural",
    name: "Low-Sun Golden Hour Naturalism",
    genreArchetype: "Drama / Western / Emotional Climax",
    contrastRatio: "2:1_soft_naturalistic",
    keyLight: {
      horizontalAngleDeg: 80,
      verticalElevationDeg: 12,
      quality: "soft_diffused",
      colorTempKelvin: 2800, // Warm sunset gold
      intensityLumensApprox: "raking low-angle sunlight cutting horizontally",
    },
    fillLight: {
      ratio: "2:1_soft_naturalistic",
      fillMethod: "skylight bounce from open atmosphere",
      colorTempKelvin: 6500,
    },
    rimLight: {
      enabled: true,
      placement: "full backlight silhouette edge",
      colorTone: "radiant warm golden hair light with gentle lens halation",
      edgeSeparationIntensity: "intense_streak",
    },
    practicals: [],
    volumetrics: "sunlit_dust_motes",
    psychologicalImpact: "Nostalgia, redemption, fragile beauty, passing of an era.",
    avoidExclusions: ["no harsh artificial shadows", "no fluorescent green tints", "no cold clinical lighting"],
  },
};

/**
 * Compiles a deterministic lighting directive clause for image/video prompts.
 */
export function compileLightingPrompt(
  rig: LightingRigDefinition | string,
  overrides?: {
    additionalPracticals?: string[];
  }
): {
  promptClause: string;
  avoidExclusions: string[];
} {
  const r = typeof rig === "string"
    ? LIGHTING_CATALOG[rig] ?? LIGHTING_CATALOG.noir_chiaroscuro_cross
    : rig;

  const keyDesc = `Key light: ${r.keyLight.horizontalAngleDeg}° horizontal angle at ${r.keyLight.colorTempKelvin}K, ${r.keyLight.quality} illumination (${r.keyLight.intensityLumensApprox})`;
  const fillDesc = `Fill: ${r.contrastRatio.replace(/_/g, " ")} with ${r.fillLight.fillMethod}`;
  const rimDesc = r.rimLight.enabled
    ? `Rim light: ${r.rimLight.placement} (${r.rimLight.colorTone})`
    : "";

  const practicalsList = [...r.practicals, ...(overrides?.additionalPracticals ?? [])];
  const practicalsDesc = practicalsList.length
    ? `Practical light sources: ${practicalsList.join(", ")}`
    : "";

  const volumetricsDesc = r.volumetrics !== "none_crystal_clear"
    ? `Volumetrics: ${r.volumetrics.replace(/_/g, " ")}`
    : "";

  const clauses = [
    `Cinematic lighting setup (${r.name})`,
    keyDesc,
    fillDesc,
    rimDesc,
    practicalsDesc,
    volumetricsDesc,
    r.psychologicalImpact,
    "Clean optical lighting physics, rich dynamic range, no overexposed clipping",
  ].filter(Boolean);

  return {
    promptClause: clauses.join(". ") + ".",
    avoidExclusions: r.avoidExclusions,
  };
}

/**
 * Resolves a lighting rig from the catalog by its ID, slug, or matching name.
 */
export function findLightingPresetByNameOrId(identifier: string): LightingRigDefinition | undefined {
  const cleanId = identifier.trim().toLowerCase().replace(/[-\s]/g, "_");
  if (LIGHTING_CATALOG[cleanId]) return LIGHTING_CATALOG[cleanId];
  return Object.values(LIGHTING_CATALOG).find(
    (l) => l.rigId.toLowerCase() === cleanId || l.name.toLowerCase() === identifier.trim().toLowerCase() || l.name.toLowerCase().includes(identifier.trim().toLowerCase())
  );
}
