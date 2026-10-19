/**
 * Context Injection — Barrel Export
 */

export { contextInjectionService } from "./context-injection.service.js";
export { extractReferences } from "./reference-extractor.js";
export { scoreSymbols } from "./relevance-scorer.js";
export { formatContext, countTokens, DEFAULT_TOKEN_BUDGET, TYPE_MINIMUM_RESERVE } from "./context-formatter.js";
export type { FormatOptions, FormatResult } from "./context-formatter.js";
export { telemetryCorrelationService } from "./telemetry-correlation.service.js";
export type { CorrelationResult, UtilizationRecord } from "./telemetry-correlation.service.js";
export type {
    InjectionResult,
    InjectionOptions,
    ExtractedReferences,
    ScoredSymbol,
    ContextInjectionTelemetry,
} from "./types.js";
