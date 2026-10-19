import { z } from "zod";

/**
 * Prop Classification & Categories.
 */
export const PROP_CLASSIFICATIONS = [
  "hero_interactive",   // Key story item handled directly by characters (keys, drives, weapons)
  "tactical_gear",      // Body-worn gear (holsters, com-links, tactical vests, watches)
  "technology_device",  // Laptops, communicators, biological scanners, decryption decks
  "document_artifact",  // Physical maps, manifests, sealed dossiers, photographs
  "set_dressing",       // Distinctive thematic background items (antique globe, centrifuge)
  "vehicle",            // Cars, spacecraft, rovers, gunboats
] as const;

export type PropClassification = typeof PROP_CLASSIFICATIONS[number];

/**
 * Physical Dimensions & Materials.
 */
export const propPhysicalSpecsSchema = z.object({
  dimensionsCm: z.object({
    length: z.number().positive(),
    width: z.number().positive(),
    height: z.number().positive(),
  }),
  weightGrams: z.number().positive().optional(),
  primaryMaterials: z.string().trim().min(1),
  finishAndTexture: z.string().trim().min(1),
  colorway: z.string().trim().min(1),
});

export type PropPhysicalSpecs = z.infer<typeof propPhysicalSpecsSchema>;

/**
 * Handling Affordances & Ergonomics.
 */
export const handlingAffordanceSchema = z.object({
  gripStyle: z.string().trim().min(1), // e.g. "two-handed low ready", "right-hand palm grip between thumb and index"
  actuationMechanism: z.string().trim().default("none"), // e.g. "recessed spring-loaded slide button on top spine"
  carryMethod: z.string().trim().default("handheld"), // e.g. "concealed inner jacket pocket", "tactical chest holster"
});

export type HandlingAffordance = z.infer<typeof handlingAffordanceSchema>;

/**
 * Prop Media Assets for Visual Anchoring.
 */
export const propMediaAssetsSchema = z.object({
  turnaroundPlateUrl: z.string().trim().optional(),
  isolatedAlphaPngUrl: z.string().trim().optional(),
  loraCheckpoint: z.string().trim().optional(),
  scaleReferenceUrl: z.string().trim().optional(),
});

export type PropMediaAssets = z.infer<typeof propMediaAssetsSchema>;

/**
 * Complete Prop Definition Schema.
 */
export const propDefinitionSchema = z.object({
  propId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  classification: z.enum(PROP_CLASSIFICATIONS),
  physicalSpecs: propPhysicalSpecsSchema,
  handling: handlingAffordanceSchema,
  wearStateDescriptions: z.record(z.string().trim()).optional().default({
    pristine: "Brand new, unmarred finish with zero scratches or edge wear",
    field_weathered: "Visible edge abrasions, light grease smudges, subtle micro-scratches on casing",
    battle_damaged: "Deep gouges on casing, scorched corner, cracked display glass with legible readout",
  }),
  mediaAssets: propMediaAssetsSchema.optional(),
  prohibitedElements: z.array(z.string().trim()).optional().default([]),
});

export type PropDefinition = z.infer<typeof propDefinitionSchema>;

/**
 * Curated Hero Props Catalog.
 */
export const PROP_CATALOG: Record<string, PropDefinition> = {
  prop_quantum_core_drive: {
    propId: "prop_quantum_core_drive",
    name: "Cipher Core Cryptographic Drive",
    classification: "hero_interactive",
    physicalSpecs: {
      dimensionsCm: { length: 9.0, width: 3.5, height: 1.2 },
      weightGrams: 140,
      primaryMaterials: "milled matte obsidian anodized tungsten-titanium alloy casing",
      finishAndTexture: "bead-blasted non-reflective tactile matte with recessed ribbed knurling on side rails",
      colorway: "graphite charcoal black with subtle unpolished titanium beveled chamfers",
    },
    handling: {
      gripStyle: "held firmly between thumb and three fingers, thumb resting along top slider rail",
      actuationMechanism: "thumb-actuated spring-loaded latch revealing gold optical interface pins",
      carryMethod: "fitted into an interior magnetic jacket seam slot",
    },
    wearStateDescriptions: {
      field_weathered: "brass substrate showing through worn corners, minor micro-abrasions along insertion rail",
    },
    prohibitedElements: [
      "cheap plastic",
      "bright primary colors",
      "glowing sci-fi laser lights",
      "USB-A connector",
      "commercial logos or branding",
    ],
  },

  prop_covert_sidearm: {
    propId: "prop_covert_sidearm",
    name: "Sub-Sonic Tactical Pistol with Integrated Suppressor",
    classification: "tactical_gear",
    physicalSpecs: {
      dimensionsCm: { length: 22.0, width: 3.2, height: 14.5 },
      weightGrams: 820,
      primaryMaterials: "matte black polymer frame with monolithic matte nitrided steel slide and flush cylindrical suppressor",
      finishAndTexture: "heavy anti-slip stippled grip panels, anti-glare flat black Cerakote finish",
      colorway: "monochrome dead matte black with zero white rollmarks",
    },
    handling: {
      gripStyle: "two-handed modern thumbs-forward tactical stance or single-hand low-ready compressed carry",
      actuationMechanism: "index finger indexed straight along the frame outside trigger guard until firing",
      carryMethod: "fitted low-profile Kydex appendix waistband holster",
    },
    wearStateDescriptions: {
      field_weathered: "holster wear smoothing down the front edge of the slide, faint brass residue near ejection port",
    },
    prohibitedElements: ["chrome accents", "bright laser sights", "extended drum magazine", "finger on trigger when not firing"],
  },

  prop_golden_honey_brioche: {
    propId: "prop_golden_honey_brioche",
    name: "Artisan Braided Golden Honey Brioche",
    classification: "hero_interactive",
    physicalSpecs: {
      dimensionsCm: { length: 32.0, width: 14.0, height: 10.5 },
      weightGrams: 650,
      primaryMaterials: "warm artisan baked bread with wildflower honey egg wash and toasted sesame seed topping",
      finishAndTexture: "glossy golden-brown caramelized crust with soft pillowy crumb and gentle steam rising",
      colorway: "deep rich amber gold, warm buttery yellow, toasted sesame white",
    },
    handling: {
      gripStyle: "gently supported from beneath with clean hands or presented on an olive-wood board",
      actuationMechanism: "gently breaking the warm crust by hand to reveal steaming soft braided interior",
      carryMethod: "carried on a rustic wooden baker's peel or woven willow bread basket with linen cloth",
    },
    wearStateDescriptions: {
      fresh_from_hearth: "steaming gently, glossy caramelized honey glaze shimmering in warm sunlight, aroma of butter and honey",
    },
    prohibitedElements: ["plastic packaging", "sliced sandwich loaf look", "burned black crust", "commercial stickers"],
  },
};

/**
 * Compiles a deterministic Prop prompt clause.
 */
export function compilePropPrompt(
  prop: PropDefinition,
  options?: {
    wearState?: string;
    actionContext?: string;
  }
): {
  promptClause: string;
  prohibitedExclusions: string[];
} {
  const p = prop.physicalSpecs;
  const wear = options?.wearState
    ? prop.wearStateDescriptions[options.wearState] ?? Object.values(prop.wearStateDescriptions)[0]
    : Object.values(prop.wearStateDescriptions)[0];

  const action = options?.actionContext
    ? `Handling: ${options.actionContext}.`
    : `Grip: ${prop.handling.gripStyle}. Mechanism: ${prop.handling.actuationMechanism}.`;

  const promptClause = [
    `Prop: ${prop.name}.`,
    `Physical build: ${p.dimensionsCm.length}x${p.dimensionsCm.width}x${p.dimensionsCm.height}cm.`,
    `Materials: ${p.primaryMaterials}, ${p.finishAndTexture}.`,
    `Color: ${p.colorway}.`,
    `Condition: ${wear}.`,
    action,
    "Photorealistic product rendering, correct physics and material density.",
  ].filter(Boolean).join(" ");

  return {
    promptClause,
    prohibitedExclusions: prop.prohibitedElements,
  };
}

/**
 * Resolves a prop from the catalog by its ID, slug, or matching name.
 */
export function findPropByNameOrId(identifier: string): PropDefinition | undefined {
  const cleanId = identifier.trim().toLowerCase().replace(/[-\s]/g, "_");
  if (PROP_CATALOG[cleanId]) return PROP_CATALOG[cleanId];
  return Object.values(PROP_CATALOG).find(
    (p) => p.propId.toLowerCase() === cleanId || p.name.toLowerCase() === identifier.trim().toLowerCase() || p.name.toLowerCase().includes(identifier.trim().toLowerCase())
  );
}
