/**
 * Behavioral Intelligence Engine — Environmental Context
 *
 * Enriches scoring events with environmental dimensions:
 * - Geographic (lat, lng, country, region, city)
 * - Altitude (meters above sea level, elevation band)
 * - Temperature/Weather (°C, condition, humidity)
 * - Connectivity (dBm, connection type, bandwidth)
 *
 * Data sources: SDK device sensors, weather APIs, IP geolocation, CRM fields.
 * Cached per geographic grid cell (0.1° ≈ 11km) with 30-min TTL.
 */
import { createLogger } from "@server/utils/logger.js";
import { getRedisClient } from "@domain/core/infrastructure/redis/redis-client.js";

const logger = createLogger("BIEnvironmental");

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EnvironmentalContext {
  // Geographic
  latitude?: number;
  longitude?: number;
  country?: string;
  region?: string;
  city?: string;
  timezone?: string;

  // Altitude
  altitude_m?: number;
  elevation_band?: "sea_level" | "lowland" | "highland" | "mountain" | "extreme";

  // Weather
  temperature_c?: number;
  temperature_f?: number;
  feels_like_c?: number;
  weather_condition?: "clear" | "cloudy" | "rain" | "snow" | "extreme";
  humidity_percent?: number;

  // Connectivity
  signal_dbm?: number;
  signal_band?: "excellent" | "good" | "fair" | "poor" | "no_signal";
  connection_type?: "5g" | "4g" | "3g" | "wifi" | "ethernet" | "offline";
  downlink_mbps?: number;
  rtt_ms?: number;
}

export interface EnvironmentalMultipliers {
  weather: number;
  signal: number;
  altitude: number;
  time_part: number;
  combined: number;
}

// ─── Classification ──────────────────────────────────────────────────────────

function classifyElevation(altitudeM: number): EnvironmentalContext["elevation_band"] {
  if (altitudeM < 100) return "sea_level";
  if (altitudeM < 500) return "lowland";
  if (altitudeM < 1500) return "highland";
  if (altitudeM < 3000) return "mountain";
  return "extreme";
}

function classifySignal(dbm: number): EnvironmentalContext["signal_band"] {
  if (dbm > -65) return "excellent";
  if (dbm > -75) return "good";
  if (dbm > -85) return "fair";
  if (dbm > -100) return "poor";
  return "no_signal";
}

// ─── Multiplier Computation ──────────────────────────────────────────────────

/**
 * Compute environmental weight multipliers for scoring.
 */
function computeMultipliers(ctx: EnvironmentalContext): EnvironmentalMultipliers {
  let weather = 1.0;
  let signal = 1.0;
  let altitude = 1.0;
  let time_part = 1.0; // Set externally by time-parting service

  // Weather multiplier
  if (ctx.weather_condition) {
    switch (ctx.weather_condition) {
      case "extreme": weather = 1.3; break; // Extreme weather = higher urgency
      case "snow": weather = 1.2; break;
      case "rain": weather = 1.1; break;
      case "cloudy": weather = 1.0; break;
      case "clear": weather = 1.0; break;
    }
  }
  if (ctx.temperature_c !== undefined) {
    if (ctx.temperature_c < -10 || ctx.temperature_c > 40) weather *= 1.3; // Extreme temp
    else if (ctx.temperature_c < 0 || ctx.temperature_c > 35) weather *= 1.1;
  }

  // Signal multiplier
  if (ctx.signal_dbm !== undefined) {
    const band = classifySignal(ctx.signal_dbm);
    switch (band) {
      case "excellent": signal = 1.0; break;
      case "good": signal = 1.0; break;
      case "fair": signal = 1.1; break; // Slight boost — user persisting through mediocre signal
      case "poor": signal = 1.5; break; // High intent — persisting through bad signal
      case "no_signal": signal = 0.5; break; // Likely queued/stale event
    }
  }

  // Altitude multiplier
  if (ctx.altitude_m !== undefined) {
    const band = classifyElevation(ctx.altitude_m);
    switch (band) {
      case "sea_level": altitude = 1.0; break;
      case "lowland": altitude = 1.0; break;
      case "highland": altitude = 0.9; break;
      case "mountain": altitude = 0.8; break;
      case "extreme": altitude = 0.6; break;
    }
  }

  const combined = Math.round(weather * signal * altitude * time_part * 1000) / 1000;

  return { weather, signal, altitude, time_part, combined };
}

/**
 * Enrich an event's environmental context from available data.
 * Fills in missing fields from cached data or defaults.
 */
function enrichContext(raw: Partial<EnvironmentalContext>): EnvironmentalContext {
  const ctx: EnvironmentalContext = { ...raw };

  // Classify altitude if raw value provided
  if (ctx.altitude_m !== undefined && !ctx.elevation_band) {
    ctx.elevation_band = classifyElevation(ctx.altitude_m);
  }

  // Classify signal if raw dBm provided
  if (ctx.signal_dbm !== undefined && !ctx.signal_band) {
    ctx.signal_band = classifySignal(ctx.signal_dbm);
  }

  // Convert temperature
  if (ctx.temperature_c !== undefined && ctx.temperature_f === undefined) {
    ctx.temperature_f = Math.round((ctx.temperature_c * 9 / 5 + 32) * 10) / 10;
  }

  return ctx;
}

// ─── Weather Cache (Grid Cell) ───────────────────────────────────────────────

const WEATHER_CACHE_TTL = 1800; // 30 minutes
const GRID_RESOLUTION = 0.1; // ~11km cells

function gridCellKey(lat: number, lng: number): string {
  const gridLat = Math.round(lat / GRID_RESOLUTION) * GRID_RESOLUTION;
  const gridLng = Math.round(lng / GRID_RESOLUTION) * GRID_RESOLUTION;
  return `bi:weather:${gridLat.toFixed(1)}:${gridLng.toFixed(1)}`;
}

async function getCachedWeather(lat: number, lng: number): Promise<{ temperature_c: number; weather_condition: string } | null> {
  try {
    const client = getRedisClient();
    const key = gridCellKey(lat, lng);
    const cached = await client.get(key);
    return cached ? JSON.parse(cached) : null;
  } catch { return null; }
}

async function cacheWeather(lat: number, lng: number, data: { temperature_c: number; weather_condition: string }): Promise<void> {
  try {
    const client = getRedisClient();
    const key = gridCellKey(lat, lng);
    await client.set(key, JSON.stringify(data), "EX", WEATHER_CACHE_TTL);
  } catch { /* non-critical */ }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export const biEnvironmentalContext = {
  enrichContext,
  computeMultipliers,
  classifyElevation,
  classifySignal,
  getCachedWeather,
  cacheWeather,
  gridCellKey,
};
