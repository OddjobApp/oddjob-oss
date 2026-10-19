/**
 * Model Routing Intelligence — Barrel Export
 */

export { modelRoutingService } from "./model-routing.service.js";
export { classifyTool, getDefaultTier } from "./tool-classifier.js";
export type {
    ModelTier,
    ToolTypeClassification,
    RoutingDecision,
    RoutingContext,
    OrgRoutingConfig,
    ComplexitySignals,
    ValidationResult,
    RoutingCostEvent,
    SavingsSummary,
    StrictnessLevel,
} from "./types.js";
export { DEFAULT_ROUTING_CONFIG } from "./types.js";
