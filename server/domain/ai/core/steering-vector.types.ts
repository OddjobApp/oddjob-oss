/**
 * Prompt-Space Behavioral Steering (PSBS) — Type Definitions
 *
 * Translates activation-space steering (v_steered = v_hidden + α·v_steering)
 * into prompt-space steering (prompt = base + α·context_steering).
 *
 * These types define the multi-dimensional behavioral vector that modulates
 * the OODA thinking service's system prompt each cycle.
 */

/** A named behavioral dimension with a weight */
export interface SteeringDimension {
  /** Dimension name, e.g. "compliance", "creativity", "thoroughness", "risk_tolerance" */
  name: string;
  /** Current weight value [0, 1] */
  weight: number;
  /** Where this dimension's value was sourced from */
  source: "ocean" | "golden_path" | "human" | "synthesis" | "default";
  /** ISO timestamp of last update */
  updatedAt: string;
}

/** The full resolved steering vector for a single OODA cycle */
export interface SteeringVector {
  /** Multi-dimensional behavioral weights */
  dimensions: SteeringDimension[];
  /** Global multiplier [0, 1] — controls how strongly steering context is injected.
   *  α → 0: minimal steering (near-vanilla prompt)
   *  α → 1: maximum steering (full Golden Path + all behavioral directives) */
  alpha: number;
  /** Knowledge document ID of the active Golden Path SOP, if any */
  goldenPathId?: number;
  /** Compressed SOP text injected into the system prompt (token-budget gated) */
  goldenPathSnippet?: string;
  /** Knowledge document ID of the relevant Anti-Pattern failed trace, if any */
  antiPatternId?: number;
  /** Compressed Anti-Pattern text injected into the system prompt (negative prior) */
  antiPatternSnippet?: string;
  /** Active human steering nudge text */
  humanNudge?: string;
  /** State entropy at the time this vector was resolved (for telemetry) */
  entropyAtResolution: number;
  /** ISO timestamp when this vector was resolved */
  resolvedAt: string;
}

/** Configuration for how steering vectors are resolved */
export interface SteeringConfig {
  /** Whether to retrieve Golden Path SOPs via RAG */
  enableGoldenPathRetrieval: boolean;
  /** Whether to retrieve Failed Trace Anti-Patterns via RAG */
  enableAntiPatternRetrieval: boolean;
  /** Whether to re-retrieve Golden Paths on each cycle (vs. only cycle 1) */
  enablePerCycleReRetrieval: boolean;
  /** Maximum token budget for Golden Path context injection (chars ≈ tokens×4) */
  maxGoldenPathTokens: number;
  /** Maximum token budget for Anti-Pattern context injection (chars ≈ tokens×4) */
  maxAntiPatternTokens: number;
  /** Default α if not set by human or synthesis feedback */
  alphaDefault: number;
  /** How much α decays per cycle (prevents stale steering lock-in) */
  alphaDecayPerCycle: number;
  /** Cosine distance threshold before triggering re-steering (future use) */
  divergenceThreshold: number;
}

/** Telemetry record for steering decisions (appended to dynamic trace) */
export interface SteeringTraceEntry {
  type: "steering";
  cycle: number;
  alpha: number;
  dimensions: Array<{ name: string; weight: number }>;
  goldenPathId?: number;
  antiPatternId?: number;
  hasHumanNudge: boolean;
  entropy: number;
  timestamp: string;
}

/** Default steering configuration */
export const DEFAULT_STEERING_CONFIG: SteeringConfig = {
  enableGoldenPathRetrieval: true,
  enableAntiPatternRetrieval: true,
  enablePerCycleReRetrieval: false,  // Only re-retrieve when objective changes
  maxGoldenPathTokens: 500,
  maxAntiPatternTokens: 400,
  alphaDefault: 0.6,
  alphaDecayPerCycle: 0.05,
  divergenceThreshold: 0.3,
};
