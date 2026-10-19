import { z } from "zod";

/**
 * Location Category & Environment Types.
 */
export const LOCATION_CATEGORIES = [
  "interior_urban",
  "interior_industrial",
  "interior_high_tech",
  "interior_domestic",
  "exterior_urban",
  "exterior_wilderness",
  "exterior_dystopian",
  "subterranean_bunker",
  "orbital_facility",
  "vehicle_interior",
] as const;

export type LocationCategory = typeof LOCATION_CATEGORIES[number];

/**
 * Sub-Zone within a master location set (e.g. "Zone A: Entrance Blast Door").
 */
export const locationZoneSchema = z.object({
  zoneId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  landmarks: z.array(z.string().trim()).default([]),
  vantagePoints: z.array(z.string().trim()).default([]),
});

export type LocationZone = z.infer<typeof locationZoneSchema>;

/**
 * Atmospheric & Weather State on a location.
 */
export const atmosphericPresetSchema = z.object({
  timeOfDay: z.string().trim().default("night"),
  weather: z.string().trim().default("clear"),
  lightingMood: z.string().trim().min(1),
  volumetrics: z.string().trim().default("none"),
  surfaceCondition: z.string().trim().default("dry"), // e.g. "rain-slicked with reflective puddles"
});

export type AtmosphericPreset = z.infer<typeof atmosphericPresetSchema>;

/**
 * Master Architectural Materials & Surface Specs.
 */
export const architecturalMaterialsSchema = z.object({
  groundSurface: z.string().trim().min(1),
  wallSurfaces: z.string().trim().min(1),
  ceilingStructure: z.string().trim().default(""),
  ceilingHeightMeters: z.number().positive().default(3.5),
  dominantColorway: z.string().trim().min(1),
});

export type ArchitecturalMaterials = z.infer<typeof architecturalMaterialsSchema>;

/**
 * Media Assets anchoring the location.
 */
export const locationMediaAssetsSchema = z.object({
  masterPlateUrl: z.string().trim().optional(),
  depthMapUrl: z.string().trim().optional(),
  panorama360Url: z.string().trim().optional(),
  lightingGridUrl: z.string().trim().optional(),
});

export type LocationMediaAssets = z.infer<typeof locationMediaAssetsSchema>;

/**
 * Complete Location Definition Schema.
 */
export const locationDefinitionSchema = z.object({
  locationId: z.string().trim().min(1),
  version: z.string().trim().default("1.0.0"),
  name: z.string().trim().min(1),
  category: z.enum(LOCATION_CATEGORIES),
  architecturalStyle: z.string().trim().min(1),
  materials: architecturalMaterialsSchema,
  zones: z.record(locationZoneSchema).optional().default({}),
  atmosphericPresets: z.record(atmosphericPresetSchema).optional().default({}),
  mediaAssets: locationMediaAssetsSchema.optional(),
  prohibitedElements: z.array(z.string().trim()).optional().default([]),
});

export type LocationDefinition = z.infer<typeof locationDefinitionSchema>;

/**
 * Curated Production Locations Catalog.
 */
export const LOCATION_CATALOG: Record<string, LocationDefinition> = {
  loc_subterranean_market: {
    locationId: "loc_subterranean_market",
    version: "1.0.0",
    name: "Kowloon-Style Subterranean Bazaar",
    category: "subterranean_bunker",
    architecturalStyle: "Dense retro-futuristic subterranean market built within abandoned concrete flood channels",
    materials: {
      groundSurface: "wet cracked hydraulic concrete with dark stagnant reflective puddles and recessed iron storm grates",
      wallSurfaces: "raw board-formed concrete plastered with peeling bilingual hazard signage, corroded copper water pipes, and bundles of zip-tied black fiber-optic cables",
      ceilingStructure: "low overhead steel I-beams, ventilation ducts sweating condensation, hanging exposed neon transformer boxes",
      ceilingHeightMeters: 3.2,
      dominantColorway: "charcoal slate, oxidized copper green, vibrant electric cyan and halogen amber",
    },
    zones: {
      zone_alleyway: {
        zoneId: "zone_alleyway",
        name: "Narrow Conduit Alley",
        description: "Tight 1.5-meter wide walkway flanked by food stalls with hanging canvas awnings",
        landmarks: ["flickering cyan noodle shop sign", "overhead steam exhaust vent", "industrial steel dumpster"],
        vantagePoints: ["low-angle looking up at hanging cable lattice", "high-angle down alley corridor"],
      },
      zone_vendor_counter: {
        zoneId: "zone_vendor_counter",
        name: "Black-Market Tech Stall",
        description: "Open-front vendor counter lined with glowing cathode-ray monitors and disassembled circuit boards",
        landmarks: ["acrylic component display case", "warm tungsten task lamp", "high-stool service counter"],
        vantagePoints: ["over-counter MCU toward customer", "reverse-angle toward vendor interior"],
      },
    },
    atmosphericPresets: {
      midnight_downpour: {
        timeOfDay: "midnight",
        weather: "damp underground condensation with periodic pipe leaks",
        lightingMood: "high-contrast shadows broken by practical neon glows and warm halogen stalls",
        volumetrics: "thin blue particulate vapor and rising hot steam from ventilation grates",
        surfaceCondition: "slick mirror-like puddles reflecting neon tubes",
      },
    },
    prohibitedElements: ["sunlight", "blue sky", "modern clean glass skyscrapers", "trees or grass", "clean pristine dry ground"],
  },

  loc_brutalist_interrogation_room: {
    locationId: "loc_brutalist_interrogation_room",
    version: "1.0.0",
    name: "Sub-Level Ministry Interrogation Cell",
    category: "subterranean_bunker",
    architecturalStyle: "Austere monolithic brutalist detention bunker with zero decorative relief",
    materials: {
      groundSurface: "poured matte battleship-grey concrete with circular central floor drain",
      wallSurfaces: "seamless thick poured concrete with heavy formwork wood-grain texture and acoustic perforated dampening panels",
      ceilingStructure: "single recessed acoustic coffer with central flush fluorescent luminaire",
      ceilingHeightMeters: 2.8,
      dominantColorway: "monochrome industrial grey, cold surgical white, steel silver",
    },
    zones: {
      center_table: {
        zoneId: "center_table",
        name: "Central Metal Table",
        description: "Bolted-down brushed steel examination table with two matching steel stools",
        landmarks: ["bolted stainless table", "single hanging light fixture", "floor-anchored handcuff rings"],
        vantagePoints: ["eye-level profile across table", "overhead bird's-eye looking straight down at tabletop"],
      },
      observation_mirror: {
        zoneId: "observation_mirror",
        name: "Two-Way Observation Glass",
        description: "Large 2.5-meter dark mirror wall with subtle reflection",
        landmarks: ["two-way reflective mirror", "perimeter baseboard recessed speaker grille"],
        vantagePoints: ["dirty-OTS framing subject against the black mirror glass"],
      },
    },
    atmosphericPresets: {
      cold_fluorescent: {
        timeOfDay: "artificially timeless",
        weather: "climate-controlled dry air",
        lightingMood: "harsh cold 5000K single overhead source with deep hard cast shadows beneath eye sockets",
        volumetrics: "airborne dust motes suspended in sharp overhead light beam",
        surfaceCondition: "dry, sterile, unpolished matte",
      },
    },
    prohibitedElements: ["windows", "daylight", "decorations", "paintings", "comfortable upholstered furniture", "warm colors"],
  },

  loc_cobblestone_bakery: {
    locationId: "loc_cobblestone_bakery",
    version: "1.0.0",
    name: "Sunny Cobblestone Hearth Bakery",
    category: "interior_domestic",
    architecturalStyle: "Charming European rustic artisan bakery with exposed timber beams and whitewashed brick",
    materials: {
      groundSurface: "smooth antique terracotta tiles with subtle dusting of white flour",
      wallSurfaces: "whitewashed brick, exposed natural oak shelving holding ceramic jars, copper pans, and braided wheat stalks",
      ceilingStructure: "high ceiling with dark hand-hewn oak rafters and hanging dried herbs and lavender bundles",
      ceilingHeightMeters: 3.8,
      dominantColorway: "warm honey amber, creamy flour white, natural cedar, terracotta orange",
    },
    zones: {
      zone_hearth_oven: {
        zoneId: "zone_hearth_oven",
        name: "Wood-Fired Brick Hearth Oven",
        description: "Massive arched brick hearth oven with glowing orange embers and cast-iron door",
        landmarks: ["arched brick oven with glowing embers", "long ash wood baker's peel resting against brick wall"],
        vantagePoints: ["low-angle looking up into the oven glow", "three-quarter profile as baker slides in bread"],
      },
      zone_work_table: {
        zoneId: "zone_work_table",
        name: "Sunlit Flour-Dusted Kneading Table",
        description: "Heavy solid oak baker's bench centered directly beneath a large multi-paned arched window",
        landmarks: ["flour dusting sifter", "olive-wood cutting board", "ceramic sourdough crock with linen cover"],
        vantagePoints: ["eye-level MCU framing baker over the table", "overhead bird's-eye of golden dough being scored"],
      },
    },
    atmosphericPresets: {
      golden_morning_sunshine: {
        timeOfDay: "early morning golden sunrise",
        weather: "crisp dewy spring morning with clear sunny skies",
        lightingMood: "warm luminous golden sunlight slanting diagonally across work surfaces and wooden floor",
        volumetrics: "sunlit_dust_motes dancing gently through morning sunbeams",
        surfaceCondition: "dry warm terracotta tile with flour dusting",
      },
    },
    prohibitedElements: ["neon signs", "fluorescent strip lights", "modern electronic appliances", "concrete walls", "plastic containers", "dark rainy shadows"],
  },
};

/**
 * Compiles a deterministic Location prompt block for image and video synthesis.
 */
export function compileLocationPrompt(
  location: LocationDefinition,
  options?: {
    zoneKey?: string;
    atmosphericPresetKey?: string;
  }
): {
  promptBlock: string;
  materialsClause: string;
  lightingClause: string;
  prohibitedExclusions: string[];
} {
  const zone = options?.zoneKey ? location.zones[options.zoneKey] : undefined;
  const atmosphere = options?.atmosphericPresetKey
    ? location.atmosphericPresets[options.atmosphericPresetKey]
    : Object.values(location.atmosphericPresets)[0];

  const m = location.materials;

  const materialsClause = `Architecture: ${location.architecturalStyle}. Ground: ${m.groundSurface}. Walls: ${m.wallSurfaces}. Dominant palette: ${m.dominantColorway}.`;

  const zoneClause = zone
    ? `Specific zone: ${zone.name}, ${zone.description}. Landmarks present: ${zone.landmarks.join(", ")}.`
    : "";

  const lightingClause = atmosphere
    ? `Setting atmosphere: ${atmosphere.timeOfDay}, ${atmosphere.weather}. Atmosphere and lighting: ${atmosphere.lightingMood}. Volumetrics: ${atmosphere.volumetrics}. Ground physics: ${atmosphere.surfaceCondition}.`
    : "";

  const promptBlock = [
    `Location setting: ${location.name}.`,
    materialsClause,
    zoneClause,
    lightingClause,
    "Architectural realism, correct physical scale, consistent spatial geometry.",
  ].filter(Boolean).join(" ");

  return {
    promptBlock,
    materialsClause,
    lightingClause,
    prohibitedExclusions: location.prohibitedElements,
  };
}

/**
 * Resolves a location from the catalog by its ID, slug, or matching name.
 */
export function findLocationByNameOrId(identifier: string): LocationDefinition | undefined {
  const cleanId = identifier.trim().toLowerCase().replace(/[-\s]/g, "_");
  if (LOCATION_CATALOG[cleanId]) return LOCATION_CATALOG[cleanId];
  return Object.values(LOCATION_CATALOG).find(
    (loc) => loc.locationId.toLowerCase() === cleanId || loc.name.toLowerCase() === identifier.trim().toLowerCase() || loc.name.toLowerCase().includes(identifier.trim().toLowerCase())
  );
}
