/**
 * Behavioral Intelligence Engine — Decay Engine
 *
 * Implements lazy time-based decay for scoring vectors.
 * Decay is computed on READ, not on write — this avoids expensive
 * eager computation across millions of entities.
 *
 * Supported decay types:
 * - exponential: score × exp(-λ × age_seconds)
 * - linear: score × max(0, 1 - (age_seconds / max_age_seconds))
 * - step: full value until threshold, then drops to 0
 *
 * Correctness Property: decay(score, t1) produces the same result
 * regardless of when it's computed, given the same inputs.
 */

export type DecayType = "exponential" | "linear" | "step" | "none";

export interface DecayConfig {
  type: DecayType;
  /** For exponential: decay constant (higher = faster decay). Default 0.0001 (~7 day half-life) */
  lambda?: number;
  /** For linear: maximum age in seconds before score reaches 0 */
  maxAgeSeconds?: number;
  /** For step: age in seconds after which score drops to 0 */
  stepThresholdSeconds?: number;
  /** Half-life in days (convenience — converted to lambda internally) */
  halfLifeDays?: number;
}

/**
 * Compute the decay-adjusted score given the raw score, last update time, and current time.
 *
 * This is a pure function — deterministic given the same inputs.
 */
export function computeDecay(
  rawScore: number,
  lastUpdateTimestamp: number, // Unix seconds
  currentTimestamp: number,    // Unix seconds
  config: DecayConfig
): number {
  if (config.type === "none" || rawScore === 0) return rawScore;

  const ageSeconds = Math.max(0, currentTimestamp - lastUpdateTimestamp);
  if (ageSeconds === 0) return rawScore;

  switch (config.type) {
    case "exponential": {
      // Convert halfLifeDays to lambda if provided
      let lambda = config.lambda ?? 0.0001;
      if (config.halfLifeDays) {
        lambda = Math.LN2 / (config.halfLifeDays * 86400);
      }
      return rawScore * Math.exp(-lambda * ageSeconds);
    }

    case "linear": {
      const maxAge = config.maxAgeSeconds ?? (30 * 86400); // default 30 days
      const factor = Math.max(0, 1 - (ageSeconds / maxAge));
      return rawScore * factor;
    }

    case "step": {
      const threshold = config.stepThresholdSeconds ?? (7 * 86400); // default 7 days
      return ageSeconds < threshold ? rawScore : 0;
    }

    default:
      return rawScore;
  }
}

/**
 * Compute the recency score (0-1) based on time since last activity.
 * Uses exponential decay with configurable half-life.
 *
 * recency = exp(-ln(2) × days_since_last / half_life_days)
 */
export function computeRecency(
  lastActivityTimestamp: number, // Unix seconds
  currentTimestamp: number,      // Unix seconds
  halfLifeDays = 7
): number {
  const daysSince = (currentTimestamp - lastActivityTimestamp) / 86400;
  if (daysSince <= 0) return 1.0;
  return Math.exp(-Math.LN2 * daysSince / halfLifeDays);
}

/**
 * Compute the frequency score (0-1) based on event count in a window.
 * Normalized against an expected baseline.
 *
 * frequency = min(1, events_in_window / expected_events)
 */
export function computeFrequency(
  eventsInWindow: number,
  expectedEvents: number
): number {
  if (expectedEvents <= 0) return eventsInWindow > 0 ? 1.0 : 0;
  return Math.min(1.0, eventsInWindow / expectedEvents);
}

/**
 * Default decay configurations for common use cases.
 */
export const DECAY_PRESETS: Record<string, DecayConfig> = {
  /** Fast decay — signals lose relevance quickly (e.g., Timeline/urgency) */
  fast: { type: "exponential", halfLifeDays: 3 },
  /** Standard decay — moderate relevance window (e.g., Need, Engagement) */
  standard: { type: "exponential", halfLifeDays: 7 },
  /** Slow decay — signals persist longer (e.g., Budget, Authority) */
  slow: { type: "exponential", halfLifeDays: 30 },
  /** No decay — qualification signals that don't fade (e.g., confirmed budget) */
  none: { type: "none" },
  /** Step decay — full value for 14 days, then drops to 0 */
  step_14d: { type: "step", stepThresholdSeconds: 14 * 86400 },
};

export const decayEngine = { computeDecay, computeRecency, computeFrequency, DECAY_PRESETS };
