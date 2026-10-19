/**
 * InterventionAgentService
 *
 * Sits between the ScoringRunner and the event stream.
 * When a threshold is crossed the agent decides whether to fire the
 * intervention, suppress it, or rewrite its message for better relevance.
 *
 * Learning loop
 * ─────────────
 * Each decision is persisted to `interventionMemory`.
 * Every DISTILL_AFTER outcomes `distillPolicies()` runs:
 *   • Summarises patterns from memory into `interventionPolicies`
 *   • Posts suggested threshold / rule changes to `interventionPolicySuggestions`
 *
 * Cold-start safety
 * ─────────────────
 * If no LLM config exists, or the LLM call fails, the agent falls back to
 * a set of conservative built-in rules (never interrupt during typing,
 * minimum gap between same-vector interventions, etc.).
 */

import { db } from "@server/database_service.js";
import { createLogger } from "@server/utils/logger.js";
import { getRedisClient } from "@domain/core/infrastructure/redis/redis-client.js";
import {
    interventionMemory,
    interventionPolicies,
    interventionPolicySuggestions,
    scoringEvents,
} from "@shared/schema/index.js";
import { desc, eq, and, sql } from "drizzle-orm";
import { systemAiService } from "@domain/ai/core/system-ai.service.js";

const logger = createLogger("InterventionAgent");

const DISTILL_AFTER = 50; // outcomes before a new policy distillation
const LAST_FIRE_TTL_MS = 5 * 60 * 1000; // min gap between same-vector fires
const MAX_MEMORY_EXAMPLES = 20; // few-shot examples fed to LLM

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export interface CandidateIntervention {
    thresholdId: number;
    thresholdName: string;
    vector: string;
    score: number;
    /** The configured threshold value — used by built-in priority heuristic */
    thresholdValue?: number;
    sessionId: string;
    userId?: string;
    /** Original triggeredAction from the threshold row */
    action?: {
        type: string;
        config: Record<string, any>;
    };
    /** Current full SCORE state snapshot from Redis */
    vectorState?: Record<string, number>;
    /** URL / page the user is currently on (from event context) */
    location?: string;
}

export interface AgentDecision {
    fire: boolean;
    /** Title to display to user (agent may rewrite) */
    title?: string;
    /** Description / user-facing message (agent may improve) */
    description?: string;
    /** Pre-filled prompt for AgentChatSheet */
    aiPrompt?: string;
    /** Human-readable reason shown in the "Why am I seeing this?" section */
    rationale?: string;
    /** 'critical' | 'high' | 'medium' | 'low' */
    priority?: string;
    /** Confidence 0-1 */
    confidence?: number;
    /** Memory row id to link outcome to */
    memoryId?: number;
}

// ────────────────────────────────────────────────────────────
// Built-in conservative fallback rules
// ────────────────────────────────────────────────────────────

const BUILTIN_RULES = [
    "Never fire an intervention if the user is actively typing (last keystroke < 5 s).",
    "Never fire two interventions for the same SCORE vector within 5 minutes.",
    "Prefer 'medium' priority unless the score is ≥ 2× the threshold value.",
    "Do not fire on first page load — wait until the user has been on the page at least 30 s.",
];

async function builtinDecision(candidate: CandidateIntervention): Promise<AgentDecision> {
    // Same-vector recency gate
    const redis = getRedisClient();
    const recentKey = `iv:recent:${candidate.sessionId}:${candidate.vector}`;
    const recent = await redis.get(recentKey).catch(() => null);
    if (recent) {
        logger.debug(`[Fallback] Suppressing ${candidate.vector} — too recent`);
        return { fire: false, confidence: 0.9 };
    }

    return {
        fire: true,
        title: candidate.thresholdName,
        description: candidate.action?.config?.message || `Your ${candidate.vector}-score reached ${candidate.score.toFixed(1)}.`,
        rationale: "Automated scoring threshold reached.",
        priority: candidate.thresholdValue != null && candidate.score >= candidate.thresholdValue * 2
            ? 'high'
            : 'medium',
        confidence: 0.6,
    };
}

// ────────────────────────────────────────────────────────────
// Service
// ────────────────────────────────────────────────────────────

export const interventionAgentService = {
    /**
     * Evaluate a candidate intervention.
     * Returns an AgentDecision — the caller publishes or suppresses accordingly.
     */
    async evaluate(candidate: CandidateIntervention): Promise<AgentDecision> {
        // ── Load in-context policies ──
        let policies: string[] = BUILTIN_RULES;
        try {
            const dbPolicies = await db
                .select({ rule: interventionPolicies.rule })
                .from(interventionPolicies)
                .where(eq(interventionPolicies.enabled, true))
                .orderBy(desc(interventionPolicies.createdAt))
                .limit(20);
            if (dbPolicies.length > 0) {
                policies = [...BUILTIN_RULES, ...dbPolicies.map(p => p.rule)];
            }
        } catch (e: any) {
            logger.warn("[InterventionAgent] Could not load policies, using built-in rules", e);
        }

        // ── Load few-shot memory examples ──
        let examples: string[] = [];
        try {
            const rows = await db
                .select()
                .from(interventionMemory)
                .where(eq(interventionMemory.sessionId, candidate.sessionId))
                .orderBy(desc(interventionMemory.createdAt))
                .limit(MAX_MEMORY_EXAMPLES);

            examples = rows.map(r =>
                `vector=${r.vector} location=${r.location || '?'} decision=${r.agentDecision} outcome=${r.outcome || 'pending'}`
            );
        } catch { /* memory table may not exist yet */ }

        // ── Build LLM prompt ──
        const prompt = `
You are the Oddjob Intervention Agent. Your job is to decide whether to show a coaching intervention to a user based on their behaviour in the Oddjob platform.

POLICIES (must be respected):
${policies.map((p, i) => `${i + 1}. ${p}`).join('\n')}

RECENT HISTORY for this session (last ${examples.length} interventions):
${examples.length ? examples.join('\n') : 'None yet.'}

CANDIDATE INTERVENTION:
- Threshold: ${candidate.thresholdName}
- Vector: ${candidate.vector} (S=Struggle, C=Clarity, O=Outcome, R=Readiness, E=Engagement)
- Current score: ${candidate.score}
- Full SCORE state: ${JSON.stringify(candidate.vectorState || {})}
- Page / location: ${candidate.location || 'unknown'}
- Default action type: ${candidate.action?.type || 'toast'}
- Default message: ${candidate.action?.config?.message || candidate.action?.config?.title || '(none)'}

Decide:
1. Should this intervention FIRE? (true/false)
2. If yes, write a SHORT, friendly title (max 8 words).
3. Write a description (1-2 sentences, empathetic and actionable).
4. Write an aiPrompt (a detailed prompt to send to the AI assistant when the user clicks "Get help"). Make it specific to the vector and context.
5. Write a rationale (1 sentence for the "Why am I seeing this?" disclosure).
6. Set priority: "critical" | "high" | "medium" | "low".
7. Set confidence (0.0 to 1.0).

Respond with JSON only, no markdown:
{
  "fire": boolean,
  "title": string,
  "description": string,
  "aiPrompt": string,
  "rationale": string,
  "priority": "critical" | "high" | "medium" | "low",
  "confidence": number
}`.trim();

        // ── Call LLM ──
        let decision: AgentDecision;
        try {
            const result = await systemAiService.generateJson(prompt, 'concierge');
            decision = {
                fire: result.fire ?? true,
                title: result.title,
                description: result.description,
                aiPrompt: result.aiPrompt,
                rationale: result.rationale,
                priority: result.priority || 'medium',
                confidence: typeof result.confidence === 'number' ? result.confidence : 0.7,
            };
        } catch (e: any) {
            logger.warn("[InterventionAgent] LLM call failed, using built-in fallback", e);
            decision = await builtinDecision(candidate);
        }

        // ── Apply same-vector recency gate for fires ──
        if (decision.fire) {
            const redis = getRedisClient();
            const recentKey = `iv:recent:${candidate.sessionId}:${candidate.vector}`;
            const recent = await redis.get(recentKey).catch(() => null);
            if (recent) {
                decision.fire = false;
                decision.rationale = "Suppressed — recent same-vector intervention.";
                decision.confidence = 0.95;
            } else {
                await redis.set(recentKey, '1', 'PX', LAST_FIRE_TTL_MS).catch(() => {});
            }
        }

        // ── Persist to memory ──
        try {
            const [inserted] = await db.insert(interventionMemory).values({
                interventionId: `${candidate.thresholdId}-${Date.now()}`,
                thresholdId: candidate.thresholdId,
                sessionId: candidate.sessionId,
                vector: candidate.vector,
                vectorState: candidate.vectorState || {},
                location: candidate.location,
                agentDecision: decision.fire ? 'fire' : 'suppress',
                agentConfidence: decision.confidence,
                // Record the DB-sourced policies that were active during evaluation
                // (excludes built-in rules — those are always present)
                policiesCited: policies.length > BUILTIN_RULES.length
                    ? policies.slice(BUILTIN_RULES.length)
                    : null,
            }).returning({ id: interventionMemory.id });

            decision.memoryId = inserted?.id;
        } catch (e: any) {
            logger.warn("[InterventionAgent] Failed to persist memory", e);
        }

        // ── Trigger distillation if needed ──
        this._maybeDistill().catch(() => {});

        return decision;
    },

    /**
     * Record the user's outcome for a previous intervention memory row.
     */
    async recordOutcome(interventionId: string, outcome: string, timeToActionMs?: number) {
        try {
            await db
                .update(interventionMemory)
                .set({
                    outcome,
                    timeToActionMs,
                    resolvedAt: new Date(),
                })
                .where(eq(interventionMemory.interventionId, interventionId));
        } catch (e: any) {
            logger.warn("[InterventionAgent] Failed to record outcome", e);
        }
    },

    /**
     * Distill recent outcomes into new policies + suggestions.
     * Called automatically every DISTILL_AFTER outcomes.
     */
    async distillPolicies() {
        logger.info("[InterventionAgent] Distilling policies...");

        // Count distillation rounds
        const [roundRow] = await db
            .select({ max: sql<number>`max(${interventionPolicies.distillationRound})` })
            .from(interventionPolicies);
        const nextRound = (roundRow?.max ?? 0) + 1;

        // Fetch last 100 resolved memory rows
        let rows: any[] = [];
        try {
            rows = await db
                .select()
                .from(interventionMemory)
                .where(sql`${interventionMemory.outcome} IS NOT NULL`)
                .orderBy(desc(interventionMemory.createdAt))
                .limit(100);
        } catch { return; }

        if (rows.length < 10) {
            logger.info("[InterventionAgent] Not enough outcomes to distill yet");
            return;
        }

        const summary = rows.map(r =>
            `vector=${r.vector} location=${r.location || '?'} decision=${r.agentDecision} outcome=${r.outcome} timeMs=${r.timeToActionMs ?? '?'}`
        ).join('\n');

        const prompt = `
You are the Oddjob Intervention Agent. Analyse these recent intervention outcomes and extract policy improvements.

OUTCOMES (${rows.length} records):
${summary}

Return JSON with two keys:
{
  "policies": [
    "plain-English rule that should guide future intervention decisions (max 20 words each)"
  ],
  "suggestions": [
    {
      "suggestionType": "threshold_adjust" | "rule_disable" | "cooldown_extend" | "new_policy",
      "rationale": "why this change would improve outcomes",
      "proposedChange": { ... }
    }
  ]
}

Policies should be concise rules about WHEN to fire or suppress interventions.
Limit to max 5 policies and 3 suggestions.`.trim();

        try {
            const result = await systemAiService.generateJson(prompt, 'concierge');

            const policies = Array.isArray(result.policies) ? result.policies : [];
            const suggestions = Array.isArray(result.suggestions) ? result.suggestions : [];

            // Insert new policy rows
            if (policies.length > 0) {
                await db.insert(interventionPolicies).values(
                    policies.map((rule: string) => ({
                        rule,
                        distillationRound: nextRound,
                        weight: 1.0,
                        enabled: true,
                    }))
                );
            }

            // Insert suggestion rows
            if (suggestions.length > 0) {
                await db.insert(interventionPolicySuggestions).values(
                    suggestions.map((s: any) => ({
                        suggestionType: s.suggestionType || 'new_policy',
                        rationale: s.rationale || '',
                        proposedChange: s.proposedChange || {},
                        distillationRound: nextRound,
                        status: 'pending',
                    }))
                );
            }

            logger.info(`[InterventionAgent] Distilled round ${nextRound}: ${policies.length} policies, ${suggestions.length} suggestions`);
        } catch (e) {
            logger.error("[InterventionAgent] Distillation LLM call failed", e);
        }
    },

    /**
     * Checks if we've hit the distillation threshold and fires distill if so.
     * Non-blocking — errors are swallowed.
     */
    async _maybeDistill() {
        try {
            const [row] = await db
                .select({ count: sql<number>`count(*)` })
                .from(interventionMemory)
                .where(sql`${interventionMemory.outcome} IS NOT NULL`);

            const total = Number(row?.count ?? 0);
            if (total > 0 && total % DISTILL_AFTER === 0) {
                await this.distillPolicies();
            }
        } catch { /* ignore */ }
    },
};
