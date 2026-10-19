import { z } from "zod";

/**
 * Default Scoring Rule Templates for BANT signals.
 * To be seeded into the `scoring_rule_templates` table.
 */

export const BANTScoringTemplates = [
    {
        name: "Pricing Page View (Budget Signal)",
        description: "Increments Budget (S) when a prospect dwells on the pricing page for > 5 seconds.",
        icon: "dollar-sign",
        isSystem: true,
        config: {
            ruleType: "prospecting",
            page: "pricing",
            activity: "dwell",
            activityModifier: 1.5,
            vector: "S", // S = Budget in S.C.O.R.E
            weight: 2.0,
            evaluationConfig: {
                method: "keyword", // For dynamic URL checking
                criteria: "pricing|plans|upgrade"
            }
        }
    },
    {
        name: "ROI Calculator Usage (Timeline Signal)",
        description: "Increments Timeline (R) when a user interacts with the ROI calculator.",
        icon: "calculator",
        isSystem: true,
        config: {
            ruleType: "prospecting",
            elementType: "calculator_input",
            activity: "click",
            activityModifier: 2.0,
            vector: "R", // R = Resources/Timeline
            weight: 3.0,
        }
    },
    {
        name: "Enterprise Docs Search (Authority Signal)",
        description: "Increments Authority (C) when a user searches for enterprise SSO, compliance, etc.",
        icon: "shield",
        isSystem: true,
        config: {
            ruleType: "prospecting",
            activity: "search",
            vector: "C", // C = Capacity/Authority
            weight: 2.5,
            evaluationConfig: {
                method: "regex",
                criteria: "(?i)(sso|saml|soc2|compliance|enterprise|deployment)"
            }
        }
    },
    {
        name: "Contact Sales / Demo Request (Need Signal)",
        description: "High Need (O) and Timeline (R) signal when initiating sales contact.",
        icon: "phone",
        isSystem: true,
        config: {
            ruleType: "prospecting",
            activity: "click",
            vector: "O", // O = Need/Outcome
            weight: 5.0,
            evaluationConfig: {
                method: "regex",
                criteria: "(?i)(demo|sales|contact)"
            }
        }
    }
];

/**
 * Calculate Temporal Decay for BANT scores.
 * @param score The original numerical score (e.g., 5.0).
 * @param lastUpdated The Date string or Date object when the score was last incremented.
 * @returns The decayed score, bounded logically.
 */
export function applyTemporalDecay(score: number, lastUpdated: Date | string | null): number {
    if (!lastUpdated || score <= 0) return score;

    const last = typeof lastUpdated === 'string' ? new Date(lastUpdated) : lastUpdated;
    const now = new Date();
    const hoursSinceUpdate = (now.getTime() - last.getTime()) / (1000 * 60 * 60);

    // Boost: If updated in the last 24 hours, retain 100% or even boost.
    if (hoursSinceUpdate < 24) {
        return score; // Could technically apply a multiplier here based on config.
    }

    // Decay: 14 days = ~336 hours. 
    // Decay curve: Reduce by 5% every 24 hours after the first 24h.
    const daysSinceUpdate = Math.floor(hoursSinceUpdate / 24);

    // Y = score * (1 - decayRate)^days
    let newScore = score * Math.pow(0.95, daysSinceUpdate - 1);

    // Floor at 0.1 so we don't completely forget, but it becomes negligible.
    return Math.max(0.1, parseFloat(newScore.toFixed(2)));
}


