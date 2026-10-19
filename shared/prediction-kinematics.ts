import type { EnvironmentalCoFactors, ForecastHorizon, MultiHorizonPoint } from "./prediction-studio-crew.js";

/**
 * The one trajectory forecast this platform actually computes.
 *
 * It is kinematics, not a learned model: vessel velocity composed with a 3% wind
 * leeway and ocean current advection, an ETA from the remaining distance, and a
 * breach confidence that falls out of that ETA against the horizon asked for.
 * Under-keel clearance adds a shallow-water penalty when depth and draft are
 * both known.
 *
 * Extracted because there were two copies claiming to be different things. The
 * executor computed this; `test_prediction_model` described itself as "a sample
 * inference pass against a registered prediction model or ONNX/Python surrogate"
 * and returned a hardcoded table -- breachRisk 0.84 at 30 minutes, whatever you
 * passed it. An agent reasoning on that constant would have advised on it.
 *
 * Nothing here loads a model. A caller wanting one has to build that first; this
 * function is honest about being a kinematic estimate and is named for it.
 */

/** Frameworks the platform can actually run. */
export const IMPLEMENTED_FRAMEWORKS = ["kinematic_surrogate"] as const;
export type ImplementedFramework = (typeof IMPLEMENTED_FRAMEWORKS)[number];

/**
 * Frameworks the job config offers but nothing implements.
 *
 * Declared so a config naming one can be refused rather than silently given a
 * kinematic answer. `onnx` is the config default, so this was the common case.
 */
export const UNIMPLEMENTED_FRAMEWORKS = ["onnx", "pytorch", "lightgbm", "python_script"] as const;

export function isImplementedFramework(framework: string): framework is ImplementedFramework {
  return (IMPLEMENTED_FRAMEWORKS as readonly string[]).includes(framework);
}

export interface KinematicForecastInput {
  features: Record<string, unknown>;
  horizonSeconds?: number;
  confidenceThreshold?: number;
}

export interface KinematicForecast {
  /** Always "kinematic_surrogate": it is what was computed, not what was asked for. */
  method: ImplementedFramework;
  etaSeconds: number;
  timeToBreachMinutes: number | null;
  effectiveVelocityKnots: number;
  underKeelClearanceM?: number;
  p10: number;
  p50: number;
  p90: number;
  breachConfidence: number;
  breachDetected: boolean;
  multiHorizonPoints: MultiHorizonPoint[];
  environmental: EnvironmentalCoFactors;
  inputFeatures: Record<string, unknown>;
  evaluatedAt: string;
}

const num = (value: unknown, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const optionalNum = (value: unknown): number | undefined => {
  if (value == null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

const HORIZONS: Array<{ horizon: ForecastHorizon; minutes: number }> = [
  { horizon: "15m", minutes: 15 },
  { horizon: "30m", minutes: 30 },
  { horizon: "60m", minutes: 60 },
  { horizon: "120m", minutes: 120 },
];

export function computeKinematicForecast(input: KinematicForecastInput): KinematicForecast {
  const f = input.features ?? {};
  const horizonSeconds = num(input.horizonSeconds, 300);
  const threshold = num(input.confidenceThreshold, 0.75);

  const baseVelocity = num(f.velocity_knots ?? f.speed ?? f.value, 24);
  const baseDistance = num(f.distance_m ?? f.distance, 1200);
  const headingDeg = num(f.heading_deg ?? f.heading, 0);

  const windSpeedKnots = num(f.wind_speed_knots ?? f.windSpeed, 0);
  const windDirDeg = num(f.wind_dir_deg ?? f.windDirection, 0);
  const currentSpeedKnots = num(f.current_speed_knots ?? f.currentSpeed, 0);
  const currentDirDeg = num(f.current_dir_deg ?? f.currentDirection, 0);
  const bathymetryDepthM = optionalNum(f.bathymetry_depth_m);
  const vesselDraftM = optionalNum(f.vessel_draft_m);

  // Vector composition: vessel, 3% wind leeway, full current advection.
  const deg2rad = Math.PI / 180;
  const vx = baseVelocity * Math.sin(headingDeg * deg2rad) + windSpeedKnots * 0.03 * Math.sin(windDirDeg * deg2rad) + currentSpeedKnots * Math.sin(currentDirDeg * deg2rad);
  const vy = baseVelocity * Math.cos(headingDeg * deg2rad) + windSpeedKnots * 0.03 * Math.cos(windDirDeg * deg2rad) + currentSpeedKnots * Math.cos(currentDirDeg * deg2rad);
  const effectiveVelocityKnots = Number(Math.hypot(vx, vy).toFixed(2));

  const underKeelClearanceM =
    bathymetryDepthM != null && vesselDraftM != null ? Number((bathymetryDepthM - vesselDraftM).toFixed(2)) : undefined;
  const shallowWaterPenalty = underKeelClearanceM != null && underKeelClearanceM < 2.0 ? 0.35 : 0.0;

  const effectiveVelocityMs = effectiveVelocityKnots * 0.514444;
  const etaSeconds = effectiveVelocityMs > 0 ? Math.max(10, Math.round(baseDistance / effectiveVelocityMs)) : 9999;
  const timeToBreachMinutes = effectiveVelocityMs > 0 ? Number((etaSeconds / 60).toFixed(1)) : null;

  const baseBreachConfidence =
    etaSeconds <= horizonSeconds
      ? Math.min(0.99, Number((1 - etaSeconds / (horizonSeconds * 1.5) + shallowWaterPenalty).toFixed(3)))
      : Math.min(0.95, Number((0.12 + shallowWaterPenalty).toFixed(3)));

  const p50 = Number(baseBreachConfidence.toFixed(3));
  const p10 = Number(Math.max(0.05, baseBreachConfidence - 0.08).toFixed(3));
  const p90 = Number(Math.min(0.99, baseBreachConfidence + 0.06).toFixed(3));

  const multiHorizonPoints: MultiHorizonPoint[] = HORIZONS.map((h) => {
    const hSec = h.minutes * 60;
    const hRisk =
      etaSeconds <= hSec
        ? Math.min(0.99, Number((1 - etaSeconds / (hSec * 1.4) + shallowWaterPenalty).toFixed(3)))
        : Math.min(0.9, Number((0.08 + (h.minutes / 120) * 0.15 + shallowWaterPenalty).toFixed(3)));
    return {
      horizon: h.horizon,
      horizonMinutes: h.minutes,
      p10: Number(Math.max(0.02, hRisk - 0.09).toFixed(3)),
      p50: Number(hRisk.toFixed(3)),
      p90: Number(Math.min(0.99, hRisk + 0.07).toFixed(3)),
      breachRisk: Number(hRisk.toFixed(3)),
      estimatedClearanceM: underKeelClearanceM,
    } as MultiHorizonPoint;
  });

  return {
    method: "kinematic_surrogate",
    etaSeconds,
    timeToBreachMinutes,
    effectiveVelocityKnots,
    underKeelClearanceM,
    p10,
    p50,
    p90,
    breachConfidence: p50,
    breachDetected: p90 >= threshold,
    multiHorizonPoints,
    environmental: {
      windSpeedKnots,
      windDirectionDeg: windDirDeg,
      currentSpeedKnots,
      currentDirectionDeg: currentDirDeg,
      bathymetryDepthM,
      vesselDraftM,
    } as EnvironmentalCoFactors,
    inputFeatures: f,
    evaluatedAt: new Date().toISOString(),
  };
}
