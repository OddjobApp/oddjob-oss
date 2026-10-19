/**
 * Theory of Mind — Dialectic Reconciliation Bridge
 *
 * Wires the dialectic reconciliation output (goals, preferences, style changes)
 * to the ToM service. When reconciliation produces updated communicationStyle
 * data, this module translates style signals into OCEAN trait refinements
 * WITHOUT requiring an additional LLM call.
 *
 * Style-to-OCEAN Mapping:
 * - High verbosity → high openness, high extraversion
 * - Formal tone → high conscientiousness
 * - Direct/terse → low agreeableness, low extraversion
 * - Varied vocabulary → high openness
 *
 * Also enqueues a lightweight extraction job with updated goals context
 * so the ToM async extractor can refine intent models and knowledge gaps.
 *
 * Requirements: 12.6, 13.2
 */

import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ToMDialecticBridge");

// ─── Style → OCEAN Signal Mapping ──────────────────────────────────────────

/**
 * Inferred OCEAN signals from communication style attributes.
 * Each trait value is between 0.0 and 1.0.
 * Only includes traits for which we have evidence.
 */
interface OceanStyleSignals {
    openness?: number;
    conscientiousness?: number;
    extraversion?: number;
    agreeableness?: number;
    neuroticism?: number;
}

/**
 * Translate free-form communicationStyle object into partial OCEAN signals.
 * Uses heuristic mapping — no LLM call required.
 *
 * The communicationStyle object from dialectic reconciliation has free-form keys
 * like: { verbosity: "high", formality: "formal", tone: "friendly", vocabulary: "varied" }
 */
export function mapStyleToOcean(style: Record<string, any>): OceanStyleSignals | null {
    if (!style || typeof style !== 'object' || Object.keys(style).length === 0) {
        return null;
    }

    const signals: OceanStyleSignals = {};
    let hasSignals = false;

    // ── Verbosity → openness + extraversion ──
    const verbosity = normalizeStyleValue(style.verbosity ?? style.verbose ?? style.length_preference);
    if (verbosity !== null) {
        if (verbosity === 'high' || verbosity === 'detailed' || verbosity === 'verbose') {
            signals.openness = 0.75;
            signals.extraversion = 0.7;
            hasSignals = true;
        } else if (verbosity === 'low' || verbosity === 'concise' || verbosity === 'terse' || verbosity === 'minimal') {
            signals.openness = 0.4;
            signals.extraversion = 0.3;
            hasSignals = true;
        }
    }

    // ── Formality → conscientiousness ──
    const formality = normalizeStyleValue(style.formality ?? style.formal ?? style.register);
    if (formality !== null) {
        if (formality === 'formal' || formality === 'high' || formality === 'professional') {
            signals.conscientiousness = 0.8;
            hasSignals = true;
        } else if (formality === 'informal' || formality === 'casual' || formality === 'low') {
            signals.conscientiousness = 0.35;
            hasSignals = true;
        }
    }

    // ── Tone → agreeableness + neuroticism ──
    const tone = normalizeStyleValue(style.tone ?? style.sentiment ?? style.warmth);
    if (tone !== null) {
        if (tone === 'friendly' || tone === 'warm' || tone === 'supportive' || tone === 'collaborative') {
            signals.agreeableness = 0.75;
            signals.neuroticism = 0.3;
            hasSignals = true;
        } else if (tone === 'direct' || tone === 'terse' || tone === 'blunt' || tone === 'assertive') {
            signals.agreeableness = 0.3;
            hasSignals = true;
        } else if (tone === 'anxious' || tone === 'urgent' || tone === 'frustrated') {
            signals.neuroticism = 0.75;
            hasSignals = true;
        }
    }

    // ── Directness → agreeableness + extraversion ──
    const directness = normalizeStyleValue(style.directness ?? style.direct);
    if (directness !== null) {
        if (directness === 'direct' || directness === 'high' || directness === 'blunt') {
            signals.agreeableness = signals.agreeableness ?? 0.3;
            signals.extraversion = signals.extraversion ?? 0.35;
            hasSignals = true;
        } else if (directness === 'indirect' || directness === 'low' || directness === 'diplomatic') {
            signals.agreeableness = signals.agreeableness ?? 0.7;
            hasSignals = true;
        }
    }

    // ── Vocabulary complexity → openness ──
    const vocabulary = normalizeStyleValue(style.vocabulary ?? style.vocab_complexity ?? style.complexity);
    if (vocabulary !== null) {
        if (vocabulary === 'varied' || vocabulary === 'complex' || vocabulary === 'rich' || vocabulary === 'high') {
            signals.openness = Math.max(signals.openness ?? 0, 0.8);
            hasSignals = true;
        } else if (vocabulary === 'simple' || vocabulary === 'basic' || vocabulary === 'low') {
            signals.openness = signals.openness ?? 0.35;
            hasSignals = true;
        }
    }

    return hasSignals ? signals : null;
}

/**
 * Normalize a style value to a lowercase string for comparison.
 * Handles booleans, numbers (as high/low), and string values.
 */
function normalizeStyleValue(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value === 'boolean') return value ? 'high' : 'low';
    if (typeof value === 'number') {
        if (value >= 0.7) return 'high';
        if (value <= 0.3) return 'low';
        return null; // Neutral, no strong signal
    }
    if (typeof value === 'string') return value.toLowerCase().trim();
    return null;
}

// ─── Bridge Entry Point ─────────────────────────────────────────────────────

export interface DialecticReconciliationOutput {
    organizationId: number;
    userId: string;
    goals?: Array<{ goal: string; confidence: number; evidence?: string }>;
    preferences?: Array<{ area: string; value: string; confidence: number; evidence?: string }>;
    communicationStyle?: Record<string, any>;
    previousCommunicationStyle?: Record<string, any>;
}

/**
 * Called after dialectic reconciliation produces updated user representation.
 * Translates style changes into OCEAN refinement signals and optionally
 * enqueues a ToM extraction job with updated goals context.
 *
 * Fail-open: any error is caught and logged without propagating.
 */
export async function onDialecticReconciliation(output: DialecticReconciliationOutput): Promise<void> {
    const { organizationId, userId, communicationStyle, goals } = output;

    try {
        // ── 1. Style → OCEAN signal refinement (no LLM call) ──
        if (communicationStyle && Object.keys(communicationStyle).length > 0) {
            const oceanSignals = mapStyleToOcean(communicationStyle);

            if (oceanSignals) {
                // Dynamically import to avoid circular dependencies and keep fail-open
                const { updateOceanProfile } = await import("./tom-async-extractor.js");
                const { occWrite } = await import("./theory-of-mind.service.js");

                await occWrite(organizationId, userId, (current) => {
                    const updatedOcean = updateOceanProfile(current.oceanProfile, oceanSignals as any);
                    return { oceanProfile: updatedOcean };
                });

                logger.debug(
                    `[ToMDialecticBridge] OCEAN updated from style signals for org=${organizationId} user=${userId}: ${JSON.stringify(oceanSignals)}`,
                );
            }
        }

        // ── 2. Enqueue extraction with goals context (if goals changed) ──
        if (goals && goals.length > 0) {
            const { enqueueExtractionJob } = await import("./tom-async-extractor.js");

            // Build a synthetic "conversation" context reflecting the reconciliation output
            // so the async extractor can refine intent models and knowledge gaps.
            const goalsContext = goals
                .filter(g => g.confidence >= 60)
                .slice(0, 5)
                .map(g => g.goal)
                .join("; ");

            if (goalsContext) {
                await enqueueExtractionJob({
                    organizationId,
                    userId,
                    userMessage: `[System: dialectic reconciliation updated user goals: ${goalsContext}]`,
                    conversationTail: [{
                        role: "system",
                        content: `User goals have been updated via dialectic reconciliation. Current goals: ${goalsContext}`,
                    }],
                    sessionId: `dialectic-${Date.now()}`,
                });

                logger.debug(
                    `[ToMDialecticBridge] Enqueued extraction job with updated goals for org=${organizationId} user=${userId}`,
                );
            }
        }
    } catch (err: any) {
        // Fail-open: log and continue — reconciliation should never fail due to ToM
        logger.warn(`[ToMDialecticBridge] Signal emission failed for org=${organizationId} user=${userId}: ${err.message}`);
    }
}
