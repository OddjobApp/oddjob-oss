import { z } from "zod";

/**
 * Character Demographics Schema.
 */
export const characterDemographicsSchema = z.object({
  apparent_age: z.number().int().min(0).max(150),
  gender_presentation: z.string().trim().min(1),
  ethnicity: z.string().trim().min(1),
  height_cm: z.number().positive(),
  body_build: z.string().trim().min(1),
});

export type CharacterDemographics = z.infer<typeof characterDemographicsSchema>;

/**
 * Invariant Phenotype Schema.
 * Explicit anatomical and geometric descriptors that must remain invariant across all shots.
 */
export const invariantPhenotypeSchema = z.object({
  face_structure: z.string().trim().min(1),
  eyes: z.string().trim().min(1),
  hair: z.string().trim().min(1),
  skin: z.string().trim().min(1),
  symmetry_safeguards: z.string().trim().min(1),
});

export type InvariantPhenotype = z.infer<typeof invariantPhenotypeSchema>;

/**
 * Wardrobe State Schema.
 * Specific modular outfit definitions swapped on top of the invariant phenotype.
 */
export const wardrobeStateSchema = z.object({
  outerwear: z.string().trim().default(""),
  base_layer: z.string().trim().default(""),
  bottoms: z.string().trim().default(""),
  footwear: z.string().trim().default(""),
  prohibited_elements: z.array(z.string().trim()).default([]),
});

export type WardrobeState = z.infer<typeof wardrobeStateSchema>;

/**
 * Voice Profile Schema.
 */
export const voiceProfileSchema = z.object({
  provider: z.enum(["elevenlabs", "cartesia", "playht", "openai"]).default("elevenlabs"),
  voice_id: z.string().trim().min(1),
  stability: z.number().min(0).max(1).default(0.65),
  similarity_boost: z.number().min(0).max(1).default(0.85),
});

export type VoiceProfile = z.infer<typeof voiceProfileSchema>;

/**
 * Multimodal Media Assets Schema.
 */
export const mediaAssetsSchema = z.object({
  master_turnaround_url: z.string().trim().optional(),
  portrait_url: z.string().trim().optional(),
  expression_matrix_url: z.string().trim().optional(),
  lora_checkpoint: z.string().trim().optional(),
  ip_adapter_embedding: z.string().trim().optional(),
  voice_profile: voiceProfileSchema.optional(),
});

export type MediaAssets = z.infer<typeof mediaAssetsSchema>;

/**
 * Crop Bounding Box Schema.
 */
export const turnaroundCropSchema = z.object({
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  w: z.number().positive(),
  h: z.number().positive(),
});

export type TurnaroundCrop = z.infer<typeof turnaroundCropSchema>;

/**
 * Canvas Dimensions Schema.
 */
export const canvasDimensionsSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
});

export type CanvasDimensions = z.infer<typeof canvasDimensionsSchema>;

/**
 * Standard Turnaround Angles and Crops.
 */
export const STANDARD_CROP_KEYS = [
  "front_full",
  "three_quarter_left",
  "profile_left",
  "three_quarter_right",
  "rear_full",
  "headshot_neutral",
] as const;

export type StandardCropKey = typeof STANDARD_CROP_KEYS[number];

/**
 * Turnaround Coordinates Schema.
 */
export const turnaroundCoordinatesSchema = z.object({
  canvas_dimensions: canvasDimensionsSchema,
  crops: z.record(turnaroundCropSchema),
});

export type TurnaroundCoordinates = z.infer<typeof turnaroundCoordinatesSchema>;

/**
 * Complete Character Definition File Schema (character.json).
 */
export const characterDefinitionSchema = z.object({
  character_id: z.string().trim().min(1),
  version: z.string().trim().default("1.0.0"),
  name: z.string().trim().min(1),
  demographics: characterDemographicsSchema,
  invariant_phenotype: invariantPhenotypeSchema,
  wardrobe_states: z.record(wardrobeStateSchema),
  media_assets: mediaAssetsSchema.default({}),
  turnaround_coordinates: turnaroundCoordinatesSchema,
  // 512-dimensional facial recognition vector (InsightFace / ArcFace) for QA verification
  face_embedding: z.array(z.number()).length(512).optional(),
});

export type CharacterDefinition = z.infer<typeof characterDefinitionSchema>;

/**
 * Parse an untrusted object or JSON into a valid CharacterDefinition.
 */
export function parseCharacterDefinition(input: unknown): CharacterDefinition {
  return characterDefinitionSchema.parse(input);
}

/**
 * Safe parse helper returning result object.
 */
export function safeParseCharacterDefinition(input: unknown) {
  return characterDefinitionSchema.safeParse(input);
}

/**
 * Canonical Wholesome Character: Barnaby Vance (Artisan Baker)
 */
export const BARNABY_VANCE: CharacterDefinition = {
  character_id: "char_barnaby_vance_01",
  version: "1.0.0",
  name: "Barnaby Vance",
  demographics: {
    apparent_age: 28,
    gender_presentation: "male",
    ethnicity: "Caucasian with warm European heritage",
    height_cm: 180,
    body_build: "lean, broad-shouldered artisan build",
  },
  invariant_phenotype: {
    face_structure: "gentle friendly jawline, soft dimpled smile, kind laugh lines around eyes",
    eyes: "warm expressive hazel eyes with golden flecks",
    hair: "soft wavy chestnut brown hair, slightly tousled with rolled-up bangs",
    skin: "warm ivory with dusting of light summer freckles across nose and cheeks",
    symmetry_safeguards: "natural symmetric friendly features, warm approachable smile",
  },
  wardrobe_states: {
    bakers_hearth: {
      outerwear: "hand-stitched heavy tan canvas apron with front pocket holding wooden tasting spoon",
      base_layer: "relaxed olive-green linen artisan shirt with rolled cuffs showing forearms dusted in white flour",
      bottoms: "tailored dark-slate cotton work trousers dusted with flour at knees",
      footwear: "well-worn honey-brown leather cobbler boots",
      prohibited_elements: ["modern graphics", "zippers", "logos", "synthetic plastic materials", "tactical gear"],
    },
  },
  media_assets: {
    master_turnaround_url: "/assets/characters/barnaby_turnaround.jpg",
    portrait_url: "/assets/characters/barnaby_portrait.jpg",
    lora_checkpoint: "s3://agent-assets/models/loras/barnaby_vance_flux_v1.safetensors",
    ip_adapter_embedding: "s3://agent-assets/embeddings/barnaby_insightface.bin",
    voice_profile: {
      provider: "elevenlabs",
      voice_id: "barnaby_vance_artisan_warm_v1",
      stability: 0.65,
      similarity_boost: 0.85,
    },
  },
  turnaround_coordinates: {
    canvas_dimensions: { width: 3840, height: 2160 },
    crops: {
      front_full: { x: 120, y: 180, w: 750, h: 1850 },
      three_quarter_left: { x: 920, y: 180, w: 750, h: 1850 },
      profile_left: { x: 1720, y: 180, w: 650, h: 1850 },
      rear_full: { x: 2380, y: 180, w: 700, h: 1850 },
      headshot_neutral: { x: 3120, y: 180, w: 640, h: 900 },
    },
  },
  face_embedding: new Array(512).fill(0.052),
};

/**
 * Canonical Canine Companion: Pip the Pup (Golden Retriever)
 */
export const PIP_THE_PUP: CharacterDefinition = {
  character_id: "char_pip_pup_01",
  version: "1.0.0",
  name: "Pip the Pup",
  demographics: {
    apparent_age: 1,
    gender_presentation: "male pup",
    ethnicity: "Golden Retriever canine companion",
    height_cm: 45,
    body_build: "fluffy, playful puppy build with soft paws",
  },
  invariant_phenotype: {
    face_structure: "soft floppy golden ears, wet black button nose with dusting of white flour",
    eyes: "deep warm soulful dark brown puppy eyes",
    hair: "fluffy honey-gold puppy fur with soft cream chest tuft",
    skin: "healthy black paw pads, clean pink tongue",
    symmetry_safeguards: "symmetric floppy golden ears, happy open expression",
  },
  wardrobe_states: {
    bakery_companion: {
      outerwear: "",
      base_layer: "natural golden fur with charming dusting of white baking flour on snout and paws",
      bottoms: "",
      footwear: "",
      prohibited_elements: ["leash", "collar", "modern dog clothing", "harness"],
    },
  },
  media_assets: {
    master_turnaround_url: "/assets/characters/pip_turnaround.jpg",
    portrait_url: "/assets/characters/pip_portrait.jpg",
    ip_adapter_embedding: "s3://agent-assets/embeddings/pip_insightface.bin",
    voice_profile: {
      provider: "elevenlabs",
      voice_id: "pip_playful_bark_v1",
      stability: 0.8,
      similarity_boost: 0.9,
    },
  },
  turnaround_coordinates: {
    canvas_dimensions: { width: 3840, height: 2160 },
    crops: {
      front_full: { x: 100, y: 400, w: 780, h: 1400 },
      profile_left: { x: 920, y: 400, w: 1250, h: 1400 },
      three_quarter_right: { x: 2200, y: 400, w: 850, h: 1400 },
      headshot_neutral: { x: 3080, y: 400, w: 700, h: 1400 },
    },
  },
  face_embedding: new Array(512).fill(0.048),
};

