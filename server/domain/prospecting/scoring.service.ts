import { db } from "@server/database_service.js";
import { prospectLeads, prospectProfiles, scoringEvents } from "@shared/schema/index.js";
import { eq, and, gte, desc } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { BANTScoringTemplates } from "./bant-scoring-template.js";
import {
    decayVector,
    DEFAULT_HALF_LIFE_MS,
    type DecayedScoreVector,
    type ScoreContribution,
} from "./score-vector.js";
import { toLegacyVector, describeScoreVector, PROSPECT_SCORE_SCHEMA, dimensionByCode } from "@shared/contracts/score-vector.js";

import { parseAndValidateEventTimestamp } from "./timestamp-validator.js";

const logger = createLogger("ScoringService");

/**
 * Contributions older than this carry under ~2% of their original weight, so
 * the history query is bounded rather than scanning a whole session.
 */
const CONTRIBUTION_WINDOW_MS = DEFAULT_HALF_LIFE_MS * 6;
const CONTRIBUTION_LIMIT = 500;

// Letter -> dimension key for the schema this subject is scored under.
// Prospect scoring is BANT, so S is Budget, not Symptom.
const SCORING_SCHEMA = PROSPECT_SCORE_SCHEMA;

export class ScoringService {
    /**
     * Rebuild the decayed S.C.O.R.E. vector for a profile from its contribution
     * history.
     *
     * Decays contributions stored in `scoring_events` against `now`.
     * `scoring_events.createdAt` records when the visitor's client event occurred
     * (falling back to server processing time if unsupplied), ensuring that BullMQ
     * worker queue processing delays do not distort time decay calculations.
     */
    async computeDecayedVector(profileId: number, now: Date = new Date(), executor: any = db): Promise<DecayedScoreVector> {
        const since = new Date(now.getTime() - CONTRIBUTION_WINDOW_MS);

        const rows = await executor
            .select({ actionConfig: scoringEvents.actionConfig, createdAt: scoringEvents.createdAt })
            .from(scoringEvents)
            .where(and(
                eq(scoringEvents.prospectId, profileId),
                eq(scoringEvents.eventType, "rule_match"),
                gte(scoringEvents.createdAt, since),
            ))
            .orderBy(desc(scoringEvents.createdAt))
            .limit(CONTRIBUTION_LIMIT);

        const contributions: ScoreContribution[] = [];
        for (const row of rows) {
            const cfg = (row.actionConfig ?? {}) as { vector?: string; increment?: number };
            const dimension = cfg.vector ? dimensionByCode(SCORING_SCHEMA, cfg.vector)?.key : undefined;
            if (!dimension || typeof cfg.increment !== "number") continue;
            contributions.push({ dimension, weight: cfg.increment, at: row.createdAt });
        }

        return decayVector(contributions, now, { schema: SCORING_SCHEMA });
    }

    /**
     * Evaluates an incoming event against BANT templates and updates the lead score.
     */
    async evaluateEvent(
        profileId: number,
        organizationId: number,
        activity: string,
        payload: any,
        themes: string[] = [],
        eventTimestamp?: Date | string | number,
    ) {
        try {
            const applicableRules = BANTScoringTemplates.filter(template => {
                const config = template.config;

                // Match activity
                if (config.activity !== activity) return false;

                // Match theme context if provided
                if (config.page && !themes.includes(config.page === "pricing" ? "Pricing & Tiers" : config.page)) {
                    // Simple heuristic mapping for now
                    return false;
                }

                // Match evaluation criteria (regex/keyword)
                if (config.evaluationConfig) {
                    const { method, criteria } = config.evaluationConfig;
                    const contentToMatch = (payload?.url || payload?.value || "").toString();

                    if (method === "keyword" || method === "regex") {
                        const regex = new RegExp(criteria, "i");
                        if (!regex.test(contentToMatch)) return false;
                    }
                }

                return true;
            });

            if (applicableRules.length === 0) return null;

            const [lead] = await db.select().from(prospectLeads).where(eq(prospectLeads.profileId, profileId)).limit(1);
            if (!lead) return null;

            const rawTimestamp = eventTimestamp
                ?? payload?.timestamp
                ?? payload?.eventTimestamp
                ?? payload?.clientTimestamp
                ?? payload?.occurredAt;
            const validatedTimestamp = parseAndValidateEventTimestamp(rawTimestamp);

            // Record each match as a timestamped contribution. scoring_events is
            // the contribution log the decayed vector is derived from, so the
            // score is recomputed from evidence rather than mutated in place.
            const now = new Date();
            for (const rule of applicableRules) {
                const vector = rule.config.vector as "S" | "C" | "O" | "R" | "E";
                const weight = rule.config.weight || 1.0;
                const modifier = rule.config.activityModifier || 1.0;

                await db.insert(scoringEvents).values({
                    sessionId: payload?.sessionId || 'unknown',
                    eventType: 'rule_match',
                    prospectId: profileId,
                    actionType: 'scoring_increment',
                    actionConfig: {
                        ruleName: rule.name,
                        vector,
                        increment: weight * modifier
                    },
                    location: payload?.url || 'unknown',
                    createdAt: validatedTimestamp,
                });
            }

            // Recompute from the decayed contribution history. The previous
            // implementation added to the stored vector and never subtracted, so
            // scores only rose and long sessions crossed any threshold on
            // duration alone.
            const decayed = await this.computeDecayedVector(profileId, now);
            const legacyVector = toLegacyVector(decayed.values, SCORING_SCHEMA);

            await db.update(prospectLeads).set({
                bantScore: legacyVector as any,
                updatedAt: now
            }).where(eq(prospectLeads.id, lead.id));

            return legacyVector;
        } catch (error) {
            logger.error("Failed to evaluate scoring for event", error);
            return null;
        }
    }

    /**
     * Determines if an intervention should be triggered based on current scores,
     * and — when it should — generates the concierge copy with the property's
     * persona agent (AI Co-pilot) instead of a static string. Runs in the
     * background prospecting worker, so the LLM latency never touches the visitor.
     */
    async shouldIntervene(profileId: number, propertySettings: any) {
        const [lead] = await db.select().from(prospectLeads).where(eq(prospectLeads.profileId, profileId)).limit(1);
        if (!lead) return null;

        if (lead.status === "converted") return null;

        // Evaluate against the live decayed vector, not the stored snapshot: a
        // lead whose signal has faded since the last event must stop qualifying.
        const vector = await this.computeDecayedVector(profileId);
        const score = toLegacyVector(vector.values, SCORING_SCHEMA);
        const totalScore = vector.pressure;

        const threshold = propertySettings?.interventionThreshold || 5;

        // Gate on NET PRESSURE, shrunk by evidence — not on the raw sum. The
        // old sum grew monotonically, so a long session qualified on duration
        // alone; shrinking by confidence also stops a single click qualifying.
        //
        // No suppression term here. Prospect scoring is BANT, where every
        // dimension is a buying signal — `O` is Need (contact sales / demo
        // request), the STRONGEST reason to engage. Suppressing on it would
        // silence exactly the visitors most worth talking to. Suppression
        // belongs to the behavioral schema, where `O` is Outcome and a
        // succeeding visitor genuinely should be left alone; that sense is
        // declared per-schema and applied by computePressure.
        const effectivePressure = vector.pressure * vector.confidence;
        if (effectivePressure < threshold) return null;

        // Dedup: only (re)generate once per window so a browsing high-intent lead
        // doesn't trigger an LLM call on every event. The already-cached intervention
        // (keyed by property+uid, same TTL) keeps being served by the poll endpoint.
        try {
            const { redis } = await import("@domain/core/infrastructure/redis/redis-client.js");
            const genKey = `prospect_intervention_gen:${profileId}`;
            if (await redis.get(genKey)) return null;
            await redis.set(genKey, "1", "EX", 300);
        } catch { /* Redis down — proceed (may regenerate); non-fatal */ }

        return await this.generateIntervention(profileId, propertySettings, score, totalScore);
    }

    /** Static fallback used when the persona agent / LLM is unavailable. */
    private fallbackIntervention(profileId: number) {
        return {
            type: "INTENT_STABILIZED",
            state: "O",
            confidence: 0.9,
            suggestion: {
                id: `concierge-${profileId}-${Date.now()}`,
                strategy: "AI Concierge",
                user_text: "I notice you're exploring our capabilities in depth. Would you like a guided tour or a demo for your team?",
                user_cta: "Talk to Specialist",
                agent_prompt: "Visitor has shown high intent. Guide them through the relevant features and suggest an intro call.",
                effect_type: "popup",
            },
        };
    }

    /**
     * Generate the intervention copy via the property's persona agent (AI Co-pilot).
     * Falls back to a static concierge message if persona/LLM resolution fails.
     */
    private async generateIntervention(profileId: number, property: any, score: any, totalScore: number) {
        try {
            const persona = await this.resolvePersona(property);
            const [profile] = await db.select().from(prospectProfiles).where(eq(prospectProfiles.id, profileId)).limit(1);
            const themes = (profile?.attributedThemes as string[]) || [];

            const prompt = `${persona}\n\n` +
                `A website visitor on "${property?.name || 'our site'}" is showing high buying intent. ` +
                // Labels come from the shared contract. They previously read
                // "Status/Challenge/Outcome/Risk/Engagement" while the scoring
                // rules encoded Symptom/Cause/Outcome/Resource/Effect, so the
                // model was told these numbers meant something they did not.
                `S.C.O.R.E. signals (0-10 each) — ${describeScoreVector(score)} (net pressure ${totalScore}). ` +
                `Topics engaged: ${themes.length ? themes.join(', ') : 'general browsing'}.\n\n` +
                `Write ONE concise, non-pushy, in-the-moment concierge offer to help them right now. ` +
                `Respond as strict JSON only: ` +
                `{ "user_text": string (<=240 chars, friendly first person), "user_cta": string (<=24 chars button label), ` +
                `"agent_prompt": string (instruction for the live agent on how to help this specific visitor), "strategy": string (short label) }`;

            const { systemAiService } = await import("@domain/ai/core/system-ai.service.js");
            const ai = await systemAiService.generateJson(prompt, 'concierge');

            if (ai && typeof ai.user_text === 'string' && ai.user_text.trim() && typeof ai.user_cta === 'string' && ai.user_cta.trim()) {
                return {
                    type: "INTENT_STABILIZED",
                    state: "O",
                    confidence: 0.9,
                    suggestion: {
                        id: `concierge-${profileId}-${Date.now()}`,
                        strategy: typeof ai.strategy === 'string' && ai.strategy.trim() ? ai.strategy : "AI Concierge",
                        user_text: String(ai.user_text).slice(0, 280),
                        user_cta: String(ai.user_cta).slice(0, 32),
                        agent_prompt: String(ai.agent_prompt || persona),
                        effect_type: "popup",
                    },
                };
            }
            logger.warn(`[Prospecting] Persona agent returned no usable copy for profile ${profileId}; using fallback`);
            return this.fallbackIntervention(profileId);
        } catch (err: any) {
            logger.warn(`[Prospecting] Intervention generation failed for profile ${profileId}: ${err.message}`);
            return this.fallbackIntervention(profileId);
        }
    }

    /**
     * Resolve the property's persona into prompt context: an explicit override
     * wins, else the configured persona agent's system prompt, else a default.
     */
    private async resolvePersona(property: any): Promise<string> {
        if (property?.personaPromptOverride && String(property.personaPromptOverride).trim()) {
            return String(property.personaPromptOverride);
        }
        const ref = property?.personaAgentId;
        if (ref) {
            try {
                const { jobs } = await import("@shared/schema/index.js");
                const [job] = /^\d+$/.test(String(ref))
                    ? await db.select().from(jobs).where(eq(jobs.id, Number(ref))).limit(1)
                    : await db.select().from(jobs).where(and(eq(jobs.name, String(ref)), eq(jobs.organizationId, property.organizationId))).limit(1);
                const systemPrompt = (job?.config as any)?.systemPrompt;
                if (systemPrompt && String(systemPrompt).trim()) return String(systemPrompt);
            } catch { /* best-effort */ }
            return `You are "${ref}", an AI sales concierge for this website.`;
        }
        return "You are a helpful, concise AI sales concierge for this website.";
    }
}

export const scoringService = new ScoringService();


