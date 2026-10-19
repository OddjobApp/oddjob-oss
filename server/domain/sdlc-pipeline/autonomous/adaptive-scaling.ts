/**
 * Telemetry-Driven Adaptive Resource Scaling (Extension 5 — orchestrator)
 *
 * Emitted by the planning phase: when it detects an extensive multi-file
 * refactor (or an oversized context / high dependency fan-out) it scales up the
 * context token budget and file-count ceiling, and routes lower-tier analytical
 * work to cheaper inference models to fund the scale-up.
 *
 * Pure, deterministic — produces the AdaptiveScaling telemetry block that the
 * orchestrator can act on. No side effects.
 */

import type { AdaptiveScaling, ModelTierRoute } from "../core/types.js";

// Gemini-first model tiers.
const MODELS = {
  premium: "gemini-1.5-pro",
  standard: "gemini-1.5-flash",
  economy: "gemini-1.5-flash-8b",
} as const;

// Rough per-1M-token blended cost used only for a directional cost-delta estimate.
const PREMIUM_USD_PER_MTOK = 5;

export interface AdaptiveScalingInput {
  operationCount: number;
  observedTokenCount: number;
  maxFileCount: number;        // original configured ceiling
  contextTokenBudget: number;  // original configured budget
  dependencyFanout?: number;   // e.g. blast-radius dependants pulled
}

function roundUpTo(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

/**
 * Decide whether to scale, and by how much. When no trigger fires the returned
 * block reports `triggered: false` with `scaled === original` and no routing.
 */
export function planAdaptiveScaling(input: AdaptiveScalingInput): AdaptiveScaling {
  const { operationCount, observedTokenCount, maxFileCount, contextTokenBudget } = input;
  const dependencyFanout = input.dependencyFanout ?? 0;

  const multiFileRefactor = operationCount > Math.max(1, Math.floor(0.6 * maxFileCount));
  const largeContext = observedTokenCount > 0.8 * contextTokenBudget;
  const highFanout = dependencyFanout > 2 * maxFileCount;

  const original = { contextTokenBudget, maxFileCount };

  let trigger: AdaptiveScaling["trigger"] = "none";
  if (multiFileRefactor) trigger = "multi_file_refactor";
  else if (largeContext) trigger = "large_context";
  else if (highFanout) trigger = "high_dependency_fanout";

  if (trigger === "none") {
    return {
      triggered: false,
      trigger: "none",
      detectedFileCount: operationCount,
      original,
      scaled: { ...original },
      modelTierRouting: [],
      downshiftedPhases: [],
      estimatedCostDeltaUsd: 0,
    };
  }

  const scaledMaxFileCount = Math.max(maxFileCount, Math.ceil(operationCount * 1.5));
  const scaledContextTokenBudget = Math.max(
    contextTokenBudget,
    roundUpTo(Math.ceil(observedTokenCount * 1.3), 50_000)
  );
  const scaled = {
    contextTokenBudget: scaledContextTokenBudget,
    maxFileCount: scaledMaxFileCount,
  };

  // Reserve the premium model for the phases that decide correctness; downshift
  // bulk analytical passes (context summarization) to the economy tier.
  const modelTierRouting: ModelTierRoute[] = [
    { phase: "change_plan", task: "architect_draft", model: MODELS.premium, tier: "premium" },
    { phase: "change_plan", task: "security_audit", model: MODELS.standard, tier: "standard" },
    { phase: "apply_edits", task: "verification", model: MODELS.standard, tier: "standard" },
    { phase: "context_load", task: "summarization", model: MODELS.economy, tier: "economy" },
  ];
  const downshiftedPhases = ["context_load"];

  // Directional estimate: cost of the extra premium token budget headroom.
  const estimatedCostDeltaUsd =
    ((scaledContextTokenBudget - contextTokenBudget) / 1_000_000) * PREMIUM_USD_PER_MTOK;

  return {
    triggered: true,
    trigger,
    detectedFileCount: operationCount,
    original,
    scaled,
    modelTierRouting,
    downshiftedPhases,
    estimatedCostDeltaUsd: Number(estimatedCostDeltaUsd.toFixed(4)),
  };
}
