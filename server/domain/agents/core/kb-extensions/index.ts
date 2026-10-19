/**
 * KB Extensions — Barrel Export
 *
 * Utilities and services extending the Knowledge Base Question Engine
 * with rescue tracking, HIL pattern detection, cross-repo propagation,
 * pre-mission briefing, and tech debt surfacing.
 */

export { computeJaccardSimilarity } from "./keyword-similarity.js";
export { STOP_WORDS } from "./stop-words.js";
export { rescueStrategyTrackerService } from "./rescue-strategy-tracker.service.js";
export { hilPatternDetectorService } from "./hil-pattern-detector.service.js";
export type { RescueEvent, ApprovalPattern, BriefingItem, TechDebtCard, TechDebtQuery } from "./types.js";
