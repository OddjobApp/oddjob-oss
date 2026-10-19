/**
 * Theory of Mind — Synchronous Assessor
 *
 * Lightweight, real-time cognitive state & intent assessment that runs on
 * every user message in the perceive phase. Target: ≤200ms p95.
 *
 * NO LLM calls on this path — only regex heuristics + keyword extraction.
 * Falls back to last-known state on any error within the 200ms budget.
 *
 * Requirements: 5.1, 5.2, 6.1, 6.2, 6.3, 10.1, 10.4
 */

import { createLogger } from "@server/utils/logger.js";
import { nodeRedisClient as redis } from "@domain/core/infrastructure/redis/redis-client.js";
import { theoryOfMindService } from "./theory-of-mind.service.js";
import type { CognitiveState, IntentModel } from "@shared/schema/agent/theory-of-mind.js";

const logger = createLogger("ToMSyncAssessor");

const SYNC_BUDGET_MS = 200;

// ─── Cognitive Signal Heuristics ────────────────────────────────────────────

/**
 * Frustration indicators:
 * - High caps ratio (> 30% of alphabetic chars uppercase)
 * - Excessive punctuation clusters (!!! or ???)
 * - Negative sentiment keywords
 * - Short repeated messages (user re-stating the same thing)
 */
const NEGATIVE_SENTIMENT_KEYWORDS = [
    "frustrated", "annoying", "annoyed", "broken", "useless", "terrible",
    "horrible", "hate", "stupid", "ridiculous", "unacceptable", "wtf",
    "wrong", "bug", "doesn't work", "not working", "still broken",
    "same issue", "again", "seriously", "come on",
];

/**
 * Confusion indicators:
 * - Question clusters (multiple ? in a message)
 * - Explicit confusion phrases
 * - Self-contradictions (hedging language)
 */
const CONFUSION_PHRASES = [
    "i don't understand", "i'm confused", "what do you mean",
    "makes no sense", "how is that", "that doesn't make sense",
    "i thought", "wait", "but you said", "contradicts",
    "i'm lost", "unclear", "huh", "what?",
];

/**
 * Urgency indicators:
 * - Time-pressure keywords
 * - Short imperative messages
 * - Fast response cadence (handled externally via priorMessages timing)
 */
const URGENCY_KEYWORDS = [
    "asap", "urgent", "deadline", "immediately", "right now",
    "hurry", "quickly", "time-sensitive", "critical", "emergency",
    "need this now", "can't wait", "running out of time", "today",
    "before end of day", "eod", "priority", "blocking", "blocker",
];

// ─── Signal Extraction ──────────────────────────────────────────────────────

/**
 * Extract cognitive signals from a message using lightweight heuristics.
 * Returns a CognitiveState with dimensional scores in [0, 100].
 */
export function extractCognitiveSignals(
    message: string,
    priorMessages: string[],
): CognitiveState {
    const msg = message.trim();
    const msgLower = msg.toLowerCase();

    // ── Frustration ──────────────────────────────────────────────────────
    let frustration = 0;

    // Caps ratio: proportion of uppercase alphabetic chars
    const alphaChars = msg.replace(/[^a-zA-Z]/g, "");
    if (alphaChars.length > 3) {
        const capsRatio = alphaChars.replace(/[^A-Z]/g, "").length / alphaChars.length;
        if (capsRatio > 0.5) frustration += 40;
        else if (capsRatio > 0.3) frustration += 25;
    }

    // Excessive punctuation: !!! or ???
    const excessivePunctuation = (msg.match(/[!]{2,}|[?]{2,}/g) || []).length;
    frustration += Math.min(excessivePunctuation * 15, 30);

    // Negative sentiment keywords
    const negativeSentimentCount = NEGATIVE_SENTIMENT_KEYWORDS.filter(
        kw => msgLower.includes(kw),
    ).length;
    frustration += Math.min(negativeSentimentCount * 15, 40);

    // Short repeated messages (re-stating — check prior messages)
    if (priorMessages.length >= 2) {
        const recentPrior = priorMessages.slice(-3).map(m => m.toLowerCase().trim());
        const similarity = recentPrior.filter(p =>
            p.length > 5 && (msgLower.includes(p) || p.includes(msgLower)),
        ).length;
        frustration += similarity * 10;
    }

    frustration = clamp(frustration, 0, 100);

    // ── Confusion ────────────────────────────────────────────────────────
    let confusion = 0;

    // Question clusters: multiple question marks
    const questionMarkCount = (msg.match(/\?/g) || []).length;
    if (questionMarkCount >= 3) confusion += 35;
    else if (questionMarkCount >= 2) confusion += 20;

    // Confusion phrases
    const confusionPhraseCount = CONFUSION_PHRASES.filter(
        phrase => msgLower.includes(phrase),
    ).length;
    confusion += Math.min(confusionPhraseCount * 20, 50);

    // Hedging language as mild confusion signal
    const hedging = /\b(maybe|perhaps|not sure|i think|i guess)\b/i;
    if (hedging.test(msg)) confusion += 10;

    confusion = clamp(confusion, 0, 100);

    // ── Urgency ──────────────────────────────────────────────────────────
    let urgency = 0;

    // Time-pressure keywords
    const urgencyKeywordCount = URGENCY_KEYWORDS.filter(
        kw => msgLower.includes(kw),
    ).length;
    urgency += Math.min(urgencyKeywordCount * 20, 60);

    // Short imperative messages (< 30 chars, no question mark) — slight urgency signal
    if (msg.length < 30 && !msg.includes("?") && msg.length > 3) {
        urgency += 10;
    }

    // Fast cadence indicator: many prior messages = user sending rapidly
    if (priorMessages.length >= 4) {
        urgency += 15;
    }

    urgency = clamp(urgency, 0, 100);

    // ── Exploration vs. Goal-Directed ────────────────────────────────────
    // 0 = pure exploration, 100 = pure goal-directed
    let explorationVsGoal = 50; // neutral baseline

    // Exploration signals: long messages, many questions, tentative language
    const isLongMessage = msg.length > 300;
    const hasMultipleQuestions = questionMarkCount >= 2;
    const tentative = /\b(what if|could we|wondering|explore|brainstorm|ideas?|options?)\b/i;

    if (isLongMessage) explorationVsGoal -= 15;
    if (hasMultipleQuestions) explorationVsGoal -= 10;
    if (tentative.test(msg)) explorationVsGoal -= 20;

    // Goal-directed signals: short direct messages, imperative verbs, specifics
    const imperative = /^(do|run|create|delete|fix|update|send|deploy|build|make|show|get|set|add|remove|move)\b/i;
    const isShortDirect = msg.length < 80 && !msg.includes("?");

    if (imperative.test(msg)) explorationVsGoal += 20;
    if (isShortDirect && msg.length > 3) explorationVsGoal += 15;
    if (urgency > 30) explorationVsGoal += 10; // urgent messages are goal-directed

    explorationVsGoal = clamp(explorationVsGoal, 0, 100);

    return {
        frustration,
        confusion,
        urgency,
        explorationVsGoal,
        assessedAt: new Date().toISOString(),
    };
}

// ─── Intent Classification ──────────────────────────────────────────────────

/**
 * Lightweight intent classification using keyword extraction.
 *
 * For now, uses keyword analysis rather than embedding similarity
 * (no pre-computed archetype vectors yet). The literal intent is a summary
 * of what was asked; inferred intent uses session history to detect patterns.
 */
export function classifyIntent(
    message: string,
    sessionSignals: string[],
): { literal: string; inferred: string; confidence: number } {
    const msg = message.trim();
    const msgLower = msg.toLowerCase();

    // ── Extract literal intent ───────────────────────────────────────────
    // Summarize the message's surface request
    const literal = extractLiteralIntent(msg);

    // ── Infer underlying intent from session context ─────────────────────
    const { inferred, confidence } = inferIntent(msgLower, literal, sessionSignals);

    return { literal, inferred, confidence };
}

/**
 * Extract the surface-level intent from a message.
 * Uses first sentence or truncated message as literal request summary.
 */
function extractLiteralIntent(message: string): string {
    // Take first sentence or first 100 chars
    const firstSentence = message.split(/[.!?\n]/)[0]?.trim() ?? "";
    if (firstSentence.length > 100) {
        return firstSentence.slice(0, 97) + "...";
    }
    return firstSentence || message.slice(0, 100).trim();
}

/**
 * Infer underlying intent by analyzing session signals and message patterns.
 * Returns the inferred intent and confidence level.
 */
function inferIntent(
    msgLower: string,
    literal: string,
    sessionSignals: string[],
): { inferred: string; confidence: number } {
    // Intent archetype patterns (keyword-based until we have embeddings)
    const archetypes: Array<{ pattern: RegExp; intent: string; weight: number }> = [
        { pattern: /\b(help|how do i|how to|can you show|teach|explain)\b/, intent: "seeking-guidance", weight: 70 },
        { pattern: /\b(fix|broken|error|bug|issue|problem|wrong|fail)\b/, intent: "troubleshooting", weight: 75 },
        { pattern: /\b(create|build|make|set up|configure|deploy|implement)\b/, intent: "building-something", weight: 70 },
        { pattern: /\b(find|search|look for|where|locate|show me)\b/, intent: "information-retrieval", weight: 65 },
        { pattern: /\b(change|update|modify|edit|adjust|refactor)\b/, intent: "modification", weight: 65 },
        { pattern: /\b(delete|remove|cancel|undo|revert|rollback)\b/, intent: "destructive-action", weight: 70 },
        { pattern: /\b(why|reason|because|explain|understand)\b/, intent: "understanding-causality", weight: 60 },
        { pattern: /\b(compare|difference|vs|better|which|choose)\b/, intent: "decision-support", weight: 65 },
        { pattern: /\b(status|progress|check|monitor|is it done)\b/, intent: "status-checking", weight: 70 },
        { pattern: /\b(schedule|plan|timeline|when|estimate|roadmap)\b/, intent: "planning", weight: 60 },
    ];

    // Find matching archetypes
    const matches = archetypes.filter(a => a.pattern.test(msgLower));

    if (matches.length === 0) {
        return { inferred: literal, confidence: 30 };
    }

    // Use the highest-weight match as primary inferred intent
    const bestMatch = matches.sort((a, b) => b.weight - a.weight)[0];

    // Boost confidence if session signals align with the same intent pattern
    let confidence = bestMatch.weight;
    const recentSignals = sessionSignals.slice(-5);
    const alignedSignals = recentSignals.filter(s => s === bestMatch.intent).length;
    confidence += alignedSignals * 5; // Repeated patterns increase confidence

    confidence = clamp(confidence, 0, 100);

    return { inferred: bestMatch.intent, confidence };
}

// ─── Main Assess Method ─────────────────────────────────────────────────────

export interface SyncAssessmentResult {
    cognitiveState: CognitiveState;
    intentModel: IntentModel;
    latencyMs: number;
}

/**
 * Orchestrates the full synchronous assessment path:
 * 1. Extract cognitive signals (heuristic)
 * 2. Classify intent (keyword-based)
 * 3. Write to DB with OCC
 * 4. Invalidate cache
 * 5. Return result with latencyMs
 *
 * Enforces ≤200ms budget: on timeout or error, returns last-known state from cache.
 */
export async function assess(
    message: string,
    conversationContext: Array<{ role: string; content: string }>,
    orgId: number,
    userId: string,
    sessionId: string,
): Promise<SyncAssessmentResult> {
    const startTime = Date.now();

    try {
        // Get last-known state for fallback and session signal continuity
        const lastKnown = await getLastKnownState(orgId, userId);

        // Abort early if we've already consumed most of our budget just reading cache
        if (Date.now() - startTime > SYNC_BUDGET_MS * 0.8) {
            return buildFallbackResult(lastKnown, startTime);
        }

        // Step 1: Extract cognitive signals
        const priorMessages = conversationContext
            .filter(m => m.role === "user")
            .map(m => m.content)
            .slice(-5);

        const cognitiveState = extractCognitiveSignals(message, priorMessages);

        // Step 2: Classify intent
        const currentSessionSignals = lastKnown?.intentModel?.sessionId === sessionId
            ? [...(lastKnown.intentModel.sessionSignals ?? [])]
            : [];

        const { literal, inferred, confidence } = classifyIntent(message, currentSessionSignals);

        // Append new signal to session (monotonically growing within session)
        const newSignal = inferred !== literal ? inferred : literal;
        const updatedSignals = [...currentSessionSignals, newSignal];

        // Compute divergence flag: true iff inferred differs from literal AND confidence > 70
        const diverges = inferred !== literal && confidence > 70;

        const intentModel: IntentModel = {
            literalIntent: literal,
            inferredIntent: inferred,
            inferredConfidence: confidence,
            diverges,
            sessionSignals: updatedSignals,
            sessionId,
            updatedAt: new Date().toISOString(),
        };

        // Step 3: Write to DB (with budget check)
        if (Date.now() - startTime < SYNC_BUDGET_MS * 0.7) {
            try {
                await writeCognitiveAndIntent(orgId, userId, cognitiveState, intentModel);
            } catch (writeErr: any) {
                // Write failure is non-fatal — we still return the computed result
                logger.warn(`[ToM Sync] DB write failed, continuing with computed result: ${writeErr.message}`);
            }
        } else {
            // Budget tight — skip write, it'll be caught next cycle
            logger.debug(`[ToM Sync] Skipping DB write to stay within budget (${Date.now() - startTime}ms elapsed)`);
        }

        const latencyMs = Date.now() - startTime;
        return { cognitiveState, intentModel, latencyMs };
    } catch (err: any) {
        logger.warn(`[ToM Sync] Assessment failed, falling back to last-known state: ${err.message}`);
        const lastKnown = await getLastKnownStateSafe(orgId, userId);
        return buildFallbackResult(lastKnown, startTime);
    }
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

interface LastKnownState {
    cognitiveState: CognitiveState;
    intentModel: IntentModel;
}

const DEFAULT_COGNITIVE: CognitiveState = {
    frustration: 0,
    confusion: 0,
    urgency: 0,
    explorationVsGoal: 50,
    assessedAt: null,
};

const DEFAULT_INTENT: IntentModel = {
    literalIntent: "",
    inferredIntent: "",
    inferredConfidence: 0,
    diverges: false,
    sessionSignals: [],
    sessionId: "",
    updatedAt: null,
};

/**
 * Get last-known cognitive/intent state from cache or DB.
 */
async function getLastKnownState(orgId: number, userId: string): Promise<LastKnownState | null> {
    try {
        const state = await theoryOfMindService.getToMState(orgId, userId);
        if (!state) return null;
        return {
            cognitiveState: state.cognitiveState,
            intentModel: state.intentModel,
        };
    } catch {
        return null;
    }
}

/**
 * Safe version of getLastKnownState that never throws.
 */
async function getLastKnownStateSafe(orgId: number, userId: string): Promise<LastKnownState | null> {
    try {
        return await getLastKnownState(orgId, userId);
    } catch {
        return null;
    }
}

/**
 * Build a fallback result from last-known state when assessment fails or times out.
 */
function buildFallbackResult(lastKnown: LastKnownState | null, startTime: number): SyncAssessmentResult {
    return {
        cognitiveState: lastKnown?.cognitiveState ?? DEFAULT_COGNITIVE,
        intentModel: lastKnown?.intentModel ?? DEFAULT_INTENT,
        latencyMs: Date.now() - startTime,
    };
}

/**
 * Write cognitive state and intent model to DB using the ToM service's OCC pattern.
 * Imports the service's internal occWrite via the public mutation approach.
 */
async function writeCognitiveAndIntent(
    orgId: number,
    userId: string,
    cognitiveState: CognitiveState,
    intentModel: IntentModel,
): Promise<void> {
    // Use the existing theoryOfMindService infrastructure for OCC writes.
    // We call the service's internal methods via a combined write approach.
    // The service exposes occWrite indirectly through its update methods,
    // so we use a direct DB approach here that mirrors the OCC pattern.
    const { db } = await import("@server/database_service.js");
    const { theoryOfMind } = await import("@shared/schema/agent/theory-of-mind.js");
    const { eq, and, sql } = await import("drizzle-orm");

    // Read current version
    const [current] = await db.select({ version: theoryOfMind.version })
        .from(theoryOfMind)
        .where(and(
            eq(theoryOfMind.organizationId, orgId),
            eq(theoryOfMind.userId, userId),
        ))
        .limit(1);

    if (!current) {
        // No record exists — the main service will auto-create on first deeper write.
        // For sync path, just skip the write — the computed result is still returned.
        return;
    }

    // Conditional update with OCC
    const result = await db.update(theoryOfMind)
        .set({
            cognitiveState,
            intentModel,
            updatedAt: new Date(),
            version: sql`${theoryOfMind.version} + 1`,
        })
        .where(and(
            eq(theoryOfMind.organizationId, orgId),
            eq(theoryOfMind.userId, userId),
            eq(theoryOfMind.version, current.version),
        ))
        .returning({ id: theoryOfMind.id });

    if (result.length > 0) {
        // Invalidate cache on successful write
        try {
            await redis.del(`tom:${orgId}:${userId}`);
        } catch (e: any) {
            logger.warn(`[ToM Sync] Cache invalidation failed: ${e.message}`);
        }
    }
    // On OCC conflict, we don't retry in the sync path — staying within budget
    // takes priority. The next message will get the latest state anyway.
}

/**
 * Clamp a number to [min, max].
 */
function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

// ─── Public API ─────────────────────────────────────────────────────────────

export const tomSyncAssessor = {
    assess,
    extractCognitiveSignals,
    classifyIntent,
};
