/**
 * Spatial Gazetteer (shared frontend + backend)
 *
 * Named strategic locations and country centroids used to place a signal that
 * arrived without coordinates.
 *
 * Shared deliberately: the H3 map palette offers these as presets and the
 * ingestion resolver matches text against them. If the two drifted apart, an
 * operator would paint a geofence around a hub that ingestion resolves to a
 * different point.
 */

/** How a position was determined. Governs how much a predicate may trust it. */
export const SPATIAL_SOURCES = [
  "telemetry",
  "gazetteer",
  "geocoder",
  "jurisdiction",
  "none",
] as const;
export type SpatialSource = (typeof SPATIAL_SOURCES)[number];

/**
 * Nominal accuracy radius per source, in metres.
 *
 * These drive the precision gate in the predicate engine. A country centroid is
 * not a position — treating it as one would let an exclusion-zone rule fire on
 * a signal whose real location is unknown.
 */
export const SOURCE_PRECISION_M: Record<SpatialSource, number> = {
  telemetry: 10,
  gazetteer: 5_000,
  geocoder: 1_000,
  jurisdiction: 500_000,
  none: Number.POSITIVE_INFINITY,
};

export interface GazetteerEntry {
  id: string;
  /** Full display name, matching the map palette preset where one exists. */
  name: string;
  shortName: string;
  lat: number;
  lng: number;
  category: string;
  /** Default H3 resolution appropriate to the site's extent. */
  defaultRes: number;
  defaultZoom: number;
  icon: string;
  /**
   * Lowercase phrases that identify this place in free text. Ordered most
   * specific first; matching is longest-phrase-wins to stop "la" matching
   * inside unrelated words.
   */
  aliases: string[];
}

/** Global defense, maritime, logistics and critical-infrastructure hubs. */
export const GAZETTEER: GazetteerEntry[] = [
  {
    id: "pacific_maritime",
    name: "Pacific Maritime Hub (Port of LA / Long Beach)",
    shortName: "Pacific Maritime",
    lat: 33.743,
    lng: -118.267,
    category: "Maritime & Logistics",
    defaultRes: 7,
    defaultZoom: 11,
    icon: "⚓",
    aliases: [
      "port of los angeles",
      "port of long beach",
      "san pedro bay",
      "pacific maritime hub",
      "long beach",
    ],
  },
  {
    id: "northwest_defense",
    name: "Northwest Defense Corridor (Puget Sound / Seattle)",
    shortName: "Northwest Defense",
    lat: 47.606,
    lng: -122.332,
    category: "Defense & Naval",
    defaultRes: 7,
    defaultZoom: 11,
    icon: "🛡️",
    aliases: [
      "northwest defense corridor",
      "puget sound",
      "naval base kitsap",
      "bremerton",
      "seattle",
    ],
  },
  {
    id: "rotterdam_logistics",
    name: "Rotterdam Logistics Precinct (Europort Maritime)",
    shortName: "Rotterdam Hub",
    lat: 51.924,
    lng: 4.477,
    category: "Global Trade",
    defaultRes: 7,
    defaultZoom: 11,
    icon: "🚢",
    aliases: ["port of rotterdam", "europoort", "europort", "rotterdam"],
  },
  {
    id: "malacca_singapore",
    name: "Strait of Malacca / Singapore Straits",
    shortName: "Singapore Chokepoint",
    lat: 1.29,
    lng: 103.851,
    category: "Chokepoint & Maritime",
    defaultRes: 7,
    defaultZoom: 11,
    icon: "🌐",
    aliases: [
      "strait of malacca",
      "malacca strait",
      "singapore strait",
      "port of singapore",
    ],
  },
  {
    id: "frankfurt_power",
    name: "Frankfurt Power & Data Grid Precinct",
    shortName: "Frankfurt Grid",
    lat: 50.11,
    lng: 8.682,
    category: "Energy & Data",
    defaultRes: 8,
    defaultZoom: 13,
    icon: "⚡",
    aliases: ["frankfurt", "de-cix", "frankfurt data centre", "frankfurt data center"],
  },
  {
    id: "hormuz_strait",
    name: "Strait of Hormuz (Gulf Energy Corridor)",
    shortName: "Strait of Hormuz",
    lat: 26.566,
    lng: 56.25,
    category: "Energy Infrastructure",
    defaultRes: 6,
    defaultZoom: 9,
    icon: "🛢️",
    aliases: ["strait of hormuz", "hormuz", "persian gulf", "arabian gulf"],
  },
  {
    id: "tokyo_bay",
    name: "Tokyo Bay Maritime & Autonomous Port",
    shortName: "Tokyo Bay",
    lat: 35.62,
    lng: 139.77,
    category: "Autonomous Port",
    defaultRes: 7,
    defaultZoom: 11,
    icon: "🗼",
    aliases: ["tokyo bay", "port of tokyo", "yokohama", "kawasaki port"],
  },
  {
    id: "washington_defense",
    name: "National Capital Defense Precinct (Washington DC)",
    shortName: "Capital Defense",
    lat: 38.895,
    lng: -77.036,
    category: "Defense & Gov",
    defaultRes: 8,
    defaultZoom: 13,
    icon: "🏛️",
    aliases: ["washington dc", "the pentagon", "pentagon", "capital beltway"],
  },
  {
    id: "suez_canal",
    name: "Suez Canal Transit Corridor",
    shortName: "Suez Canal",
    lat: 30.5234,
    lng: 32.3426,
    category: "Chokepoint & Maritime",
    defaultRes: 6,
    defaultZoom: 9,
    icon: "🚢",
    aliases: ["suez canal", "port said", "great bitter lake", "suez"],
  },
  {
    id: "panama_canal",
    name: "Panama Canal Transit Corridor",
    shortName: "Panama Canal",
    lat: 9.08,
    lng: -79.68,
    category: "Chokepoint & Maritime",
    defaultRes: 6,
    defaultZoom: 9,
    icon: "🚢",
    aliases: ["panama canal", "gatun locks", "colon panama", "balboa panama"],
  },
  {
    id: "taiwan_strait",
    name: "Taiwan Strait Defense Corridor",
    shortName: "Taiwan Strait",
    lat: 24.5,
    lng: 119.5,
    category: "Defense & Naval",
    defaultRes: 6,
    defaultZoom: 9,
    icon: "🛡️",
    aliases: ["taiwan strait", "formosa strait", "kaohsiung"],
  },
  {
    id: "shanghai_port",
    name: "Port of Shanghai / Yangshan Deepwater",
    shortName: "Shanghai Port",
    lat: 30.6167,
    lng: 122.065,
    category: "Maritime & Logistics",
    defaultRes: 7,
    defaultZoom: 11,
    icon: "⚓",
    aliases: ["port of shanghai", "yangshan", "shanghai port"],
  },
];

/**
 * Country centroids for jurisdiction-level placement.
 *
 * Keyed by the ISO codes `event-extraction.service` emits. These are coarse by
 * construction — see SOURCE_PRECISION_M.jurisdiction.
 */
export const COUNTRY_CENTROIDS: Record<string, { lat: number; lng: number }> = {
  US: { lat: 39.83, lng: -98.58 },
  CN: { lat: 35.86, lng: 104.2 },
  GB: { lat: 54.0, lng: -2.0 },
  DE: { lat: 51.17, lng: 10.45 },
  FR: { lat: 46.23, lng: 2.21 },
  JP: { lat: 36.2, lng: 138.25 },
  KR: { lat: 35.91, lng: 127.77 },
  IN: { lat: 20.59, lng: 78.96 },
  BR: { lat: -14.24, lng: -51.93 },
  CA: { lat: 56.13, lng: -106.35 },
  AU: { lat: -25.27, lng: 133.78 },
  RU: { lat: 61.52, lng: 105.32 },
  TW: { lat: 23.7, lng: 120.96 },
  MX: { lat: 23.63, lng: -102.55 },
  SG: { lat: 1.35, lng: 103.82 },
  CH: { lat: 46.82, lng: 8.23 },
  SA: { lat: 23.89, lng: 45.08 },
  IL: { lat: 31.05, lng: 34.85 },
  NL: { lat: 52.13, lng: 5.29 },
  IT: { lat: 41.87, lng: 12.57 },
  ES: { lat: 40.46, lng: -3.75 },
  VN: { lat: 14.06, lng: 108.28 },
  // Supranational blocs resolve to a representative centre; coarse by nature.
  EU: { lat: 50.85, lng: 4.35 },
  NATO: { lat: 50.88, lng: 4.42 },
  ASEAN: { lat: 1.35, lng: 103.82 },
  OPEC: { lat: 48.21, lng: 16.37 },
  G7: { lat: 46.2, lng: 6.14 },
  G20: { lat: 46.2, lng: 6.14 },
  BRICS: { lat: -25.75, lng: 28.19 },
  MERCOSUR: { lat: -34.9, lng: -56.16 },
  AU_UNION: { lat: 9.02, lng: 38.75 },
};

/** Longest alias first, so "port of long beach" wins over "long beach". */
const ALIAS_INDEX: Array<{ alias: string; entry: GazetteerEntry }> = GAZETTEER.flatMap((entry) =>
  entry.aliases.map((alias) => ({ alias: alias.toLowerCase(), entry }))
).sort((a, b) => b.alias.length - a.alias.length);

/**
 * Finds the strategic location named in a block of text.
 *
 * Matches on word boundaries so "suez" does not fire inside another token.
 * Returns null rather than guessing — an unplaced signal is better than a
 * wrongly placed one.
 */
export function matchGazetteer(text: string | null | undefined): GazetteerEntry | null {
  if (!text) return null;
  const haystack = text.toLowerCase();
  for (const { alias, entry } of ALIAS_INDEX) {
    // Escape regex metacharacters in the alias before building the matcher.
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`).test(haystack)) return entry;
  }
  return null;
}

export function countryCentroid(
  jurisdiction: string | null | undefined
): { lat: number; lng: number } | null {
  if (!jurisdiction) return null;
  return COUNTRY_CENTROIDS[jurisdiction.trim().toUpperCase()] ?? null;
}
