/**
 * Behavioral Intelligence Engine — Core Module Index
 *
 * Exports all core services for the Behavioral Intelligence Engine.
 */

export { expressionEngine, evaluate, validate } from "./expression-engine.js";
export { decayEngine, computeDecay, computeRecency, computeFrequency, DECAY_PRESETS } from "./decay-engine.js";
export type { DecayType, DecayConfig } from "./decay-engine.js";
export type { EvalContext, ExpressionResult } from "./expression-engine.js";
