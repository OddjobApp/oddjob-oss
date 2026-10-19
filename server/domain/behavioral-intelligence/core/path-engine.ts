/**
 * Behavioral Intelligence Engine — Path Engine
 *
 * Discovers and matches high-conversion event sequences (paths).
 * A path is an ordered sequence of events that correlates with a desired outcome.
 *
 * Features:
 * - Fuzzy sequence matching with gap tolerance
 * - Proportional path bonus (partial match = partial bonus)
 * - Anti-path detection (sequences that predict negative outcomes)
 * - Manual + auto-discovered paths
 */
import { createLogger } from "@server/utils/logger.js";
import { biScoreState } from "../infrastructure/score-state.js";

const logger = createLogger("BIPathEngine");

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PathPattern {
  id: string;
  model_id: string;
  name: string;
  event_sequence: Array<{ event_type: string; optional?: boolean }>;
  lift_multiplier: number;    // How much to boost scores when on this path
  confidence: number;         // Statistical confidence (0-1)
  sample_size: number;        // How many entities produced this pattern
  is_anti_path: boolean;      // True = negative outcome predictor
  source: "discovered" | "manual";
  status: "active" | "degraded" | "archived";
}

export interface PathMatch {
  path_id: string;
  path_name: string;
  steps_completed: number;
  total_steps: number;
  completion_ratio: number;
  bonus: number;              // lift_multiplier × completion_ratio
  is_anti_path: boolean;
}

// ─── Path Matching ───────────────────────────────────────────────────────────

const MAX_GAP_TOLERANCE = 2; // Allow up to 2 non-matching events between path steps

/**
 * Match an entity's event window against registered path patterns.
 * Returns all matching paths with their completion ratios and bonuses.
 */
function matchPaths(
  entityWindow: Array<{ event_type: string; timestamp: string }>,
  patterns: PathPattern[]
): PathMatch[] {
  const matches: PathMatch[] = [];
  const windowTypes = entityWindow.map(e => e.event_type);

  for (const pattern of patterns) {
    if (pattern.status !== "active") continue;

    const result = fuzzySequenceMatch(windowTypes, pattern.event_sequence);
    if (result.stepsMatched > 0) {
      const totalSteps = pattern.event_sequence.filter(s => !s.optional).length;
      const completionRatio = result.stepsMatched / totalSteps;

      matches.push({
        path_id: pattern.id,
        path_name: pattern.name,
        steps_completed: result.stepsMatched,
        total_steps: totalSteps,
        completion_ratio: Math.round(completionRatio * 1000) / 1000,
        bonus: Math.round(pattern.lift_multiplier * completionRatio * 1000) / 1000,
        is_anti_path: pattern.is_anti_path,
      });
    }
  }

  // Sort by completion ratio (most complete paths first)
  return matches.sort((a, b) => b.completion_ratio - a.completion_ratio);
}

/**
 * Fuzzy sequence matching with gap tolerance.
 * Finds how many steps of the pattern appear in order within the window,
 * allowing up to MAX_GAP_TOLERANCE non-matching events between steps.
 */
function fuzzySequenceMatch(
  windowTypes: string[],
  sequence: PathPattern["event_sequence"]
): { stepsMatched: number; gapsUsed: number } {
  let seqIdx = 0;
  let gapsUsed = 0;
  let consecutiveGaps = 0;

  for (let winIdx = 0; winIdx < windowTypes.length && seqIdx < sequence.length; winIdx++) {
    const currentStep = sequence[seqIdx];

    if (windowTypes[winIdx] === currentStep.event_type) {
      // Match found
      seqIdx++;
      consecutiveGaps = 0;
    } else if (currentStep.optional) {
      // Skip optional step
      seqIdx++;
      // Don't advance winIdx — try matching next step at same position
      winIdx--;
    } else {
      // Gap
      consecutiveGaps++;
      if (consecutiveGaps > MAX_GAP_TOLERANCE) {
        // Too many consecutive gaps — stop matching
        break;
      }
      gapsUsed++;
    }
  }

  // Count remaining optional steps as matched
  while (seqIdx < sequence.length && sequence[seqIdx].optional) {
    seqIdx++;
  }

  return { stepsMatched: seqIdx, gapsUsed };
}

/**
 * Get path matches for an entity from their event window.
 */
async function getEntityPathMatches(
  orgId: number,
  entityType: string,
  entityId: string,
  patterns: PathPattern[]
): Promise<PathMatch[]> {
  const window = await biScoreState.getWindow(orgId, entityType, entityId);
  if (window.length === 0) return [];
  return matchPaths(window, patterns);
}

/**
 * Calculate the net path bonus for an entity.
 * Positive paths add bonus, anti-paths subtract.
 */
function calculateNetPathBonus(matches: PathMatch[]): number {
  let bonus = 0;
  for (const match of matches) {
    if (match.is_anti_path) {
      bonus -= match.bonus;
    } else {
      bonus += match.bonus;
    }
  }
  return Math.round(bonus * 1000) / 1000;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export const biPathEngine = {
  matchPaths,
  fuzzySequenceMatch,
  getEntityPathMatches,
  calculateNetPathBonus,
};
