/**
 * Behavioral Intelligence Engine — RFG Engine
 *
 * Computes Recency, Frequency, and Geographic weight modifiers.
 * These are meta-dimensions that multiply base scores:
 *
 *   effective_score = base_score × recency_weight × frequency_weight × geo_weight
 *
 * - Recency: How fresh is this entity's engagement? (exponential decay from last activity)
 * - Frequency: How dense is their activity? (events in window / expected baseline)
 * - Geographic: Where are they? (region → multiplier from configurable weight table)
 */
import { createLogger } from "@server/utils/logger.js";
import { computeRecency, computeFrequency } from "./decay-engine.js";
import { biScoreState } from "../infrastructure/score-state.js";

const logger = createLogger("BIRFGEngine");

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GeoWeightTable {
  regions: Record<string, number>; // e.g., { "US": 1.0, "UK": 0.9, "APAC": 0.7 }
  elevation_bands?: Record<string, { min_meters?: number; max_meters?: number; multiplier: number }>;
  default_multiplier: number;
}

export interface RFGConfig {
  recency_half_life_days: number; // Default 7
  frequency_window_days: number;  // Default 30
  frequency_baseline: number;     // Expected events per window (default 10)
  geo_weight_table?: GeoWeightTable;
}

export interface RFGResult {
  recency: number;        // 0-1
  frequency: number;      // 0-1
  geo_multiplier: number; // Typically 0.5-1.5
  geo_region?: string;
  combined: number;       // recency × frequency × geo_multiplier
}

// ─── Default Configuration ───────────────────────────────────────────────────

const DEFAULT_CONFIG: RFGConfig = {
  recency_half_life_days: 7,
  frequency_window_days: 30,
  frequency_baseline: 10,
  geo_weight_table: {
    regions: {
      "US": 1.0, "CA": 0.95, "UK": 0.9, "DE": 0.9, "FR": 0.85,
      "AU": 0.85, "JP": 0.8, "SG": 0.8, "IN": 0.7, "BR": 0.7,
    },
    default_multiplier: 0.75,
  },
};

// ─── RFG Computation ─────────────────────────────────────────────────────────

/**
 * Compute RFG scores for an entity.
 */
async function computeRFG(
  orgId: number,
  entityType: string,
  entityId: string,
  config: RFGConfig = DEFAULT_CONFIG,
  geoRegion?: string
): Promise<RFGResult> {
  const now = Math.floor(Date.now() / 1000);

  // 1. Recency — based on last activity timestamp
  const scores = await biScoreState.getScores(orgId, entityType, entityId);
  const lastActivity = scores.length > 0 ? Math.max(...scores.map(s => s.lastUpdate)) : 0;
  const recency = lastActivity > 0 ? computeRecency(lastActivity, now, config.recency_half_life_days) : 0;

  // 2. Frequency — based on event window count
  const window = await biScoreState.getWindow(orgId, entityType, entityId);
  const windowCutoff = now - (config.frequency_window_days * 86400);
  const eventsInWindow = window.filter(e => {
    const ts = new Date(e.timestamp).getTime() / 1000;
    return ts >= windowCutoff;
  }).length;
  const frequency = computeFrequency(eventsInWindow, config.frequency_baseline);

  // 3. Geographic weight
  let geo_multiplier = config.geo_weight_table?.default_multiplier ?? 1.0;
  if (geoRegion && config.geo_weight_table?.regions) {
    geo_multiplier = config.geo_weight_table.regions[geoRegion] ?? config.geo_weight_table.default_multiplier;
  }

  return {
    recency: Math.round(recency * 1000) / 1000,
    frequency: Math.round(frequency * 1000) / 1000,
    geo_multiplier,
    geo_region: geoRegion,
    combined: Math.round(recency * frequency * geo_multiplier * 1000) / 1000,
  };
}

/**
 * Apply RFG modifiers to a set of vector scores.
 * Returns adjusted scores: base × recency × frequency × geo.
 */
function applyRFG(
  baseScores: Record<string, number>,
  rfg: RFGResult
): Record<string, number> {
  const adjusted: Record<string, number> = {};
  for (const [vector, score] of Object.entries(baseScores)) {
    adjusted[vector] = Math.round(score * rfg.combined * 1000) / 1000;
  }
  return adjusted;
}

/**
 * Resolve geographic region from entity environmental context.
 */
function resolveGeoRegion(environmental?: {
  latitude?: number;
  longitude?: number;
  country?: string;
  region?: string;
}): string | undefined {
  if (environmental?.country) return environmental.country;
  if (environmental?.region) return environmental.region;
  // Could do reverse geocoding from lat/lng here
  return undefined;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export const biRFGEngine = {
  computeRFG,
  applyRFG,
  resolveGeoRegion,
  DEFAULT_CONFIG,
};
