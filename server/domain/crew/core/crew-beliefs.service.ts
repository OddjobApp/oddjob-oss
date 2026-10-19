/**
 * Crew Beliefs Service
 *
 * Two related things an agent needs to be more than a stateless voice:
 *
 *  1. BELIEFS — positions it holds, with confidence, that can be revised when
 *     the discussion moves. Distinct from its knowledge graph, which records
 *     what it has learned; a belief is something that could turn out wrong, and
 *     the interesting part is the revision trail.
 *
 *  2. CALIBRATION — whether its model of the OTHER agents is any good. An agent
 *     predicts what the next speaker will argue; once that agent speaks, the
 *     prediction is scored. This is the false-belief test operationalised, and
 *     it is what separates a real theory-of-mind layer from fluent guessing.
 *
 * Both are deliberately cost-neutral. The prediction rides along in the turn the
 * agent was already taking, and scoring uses embedding similarity rather than a
 * model call — so neither adds an LLM round-trip.
 */

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { agentBeliefPredictions, agentBeliefs } from "@shared/schema/index.js";
import { getEmbeddings } from "@domain/knowledge/core/rag-langchain.service.js";
import { createLogger } from "@server/utils/logger.js";
import type { AgentBeliefRecord } from "@shared/schema/agent-beliefs.js";

const logger = createLogger("CrewBeliefsService");

/**
 * Cosine similarity above which a new position is treated as the SAME belief
 * restated (confidence reinforced) rather than a new one. Mirrors the 0.85 the
 * agent knowledge graph already uses for semantic overlap.
 */
const SAME_BELIEF_THRESHOLD = 0.85;

/**
 * Below this, a position on a proposition the agent already holds is treated as
 * a contradiction — the old belief is marked revised rather than reinforced.
 */
const CONTRADICTION_THRESHOLD = 0.45;

export interface StatedPosition {
    agentCardId: number;
    proposition: string;
    confidence: number;
}

export interface BeliefPredictionInput {
    predictorAgentCardId: number;
    subjectAgentCardId: number;
    predictedPosition: string;
}

export interface CalibrationScore {
    agentCardId: number;
    predictions: number;
    scored: number;
    averageAccuracy: number | null;
}

function cosine(a: number[], b: number[]): number {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export class CrewBeliefsService {
    // ── Layer 1: beliefs ─────────────────────────────────────────────────

    /**
     * Records what an agent argued this round, revising an existing belief when
     * the new position contradicts it.
     *
     * Three outcomes per position:
     *   - no prior belief on the subject → recorded fresh
     *   - restating a held belief        → confidence reinforced
     *   - contradicting a held belief    → old marked `revised`, new supersedes
     */
    async recordPositions(params: {
        orgId: number;
        projectId: number | null;
        sessionId: number;
        round: number;
        positions: StatedPosition[];
        turnIdByAgent?: Map<number, number>;
    }): Promise<{ recorded: number; reinforced: number; revised: number }> {
        const { orgId, projectId, sessionId, round, positions, turnIdByAgent } = params;
        const result = { recorded: 0, reinforced: 0, revised: 0 };
        if (positions.length === 0) return result;

        for (const position of positions) {
            try {
                const held = await db
                    .select()
                    .from(agentBeliefs)
                    .where(
                        and(
                            eq(agentBeliefs.agentCardId, position.agentCardId),
                            eq(agentBeliefs.status, "held"),
                        ),
                    )
                    .orderBy(desc(agentBeliefs.id))
                    .limit(20);

                const prior = await this.closestBelief(position.proposition, held);
                const turnId = turnIdByAgent?.get(position.agentCardId);
                const evidence = turnId ? { turnIds: [turnId] } : {};

                // Restating something already held — reinforce rather than duplicate.
                if (prior && prior.similarity >= SAME_BELIEF_THRESHOLD) {
                    await db
                        .update(agentBeliefs)
                        .set({
                            confidence: Math.min(100, prior.belief.confidence + 5),
                            updatedAt: new Date(),
                        })
                        .where(eq(agentBeliefs.id, prior.belief.id));
                    result.reinforced++;
                    continue;
                }

                const [created] = await db
                    .insert(agentBeliefs)
                    .values({
                        organizationId: orgId,
                        projectId,
                        agentCardId: position.agentCardId,
                        proposition: position.proposition,
                        confidence: position.confidence,
                        evidence,
                        sourceSessionId: sessionId,
                        sourceRound: round,
                    })
                    .returning();
                result.recorded++;

                // Same subject, opposing position — the old belief was revised,
                // and the trail records what replaced it.
                if (prior && prior.similarity >= CONTRADICTION_THRESHOLD) {
                    await db
                        .update(agentBeliefs)
                        .set({
                            status: "revised",
                            supersededBy: created.id,
                            revisionReason: `Position changed in round ${round}`,
                            updatedAt: new Date(),
                        })
                        .where(eq(agentBeliefs.id, prior.belief.id));
                    result.revised++;
                }
            } catch (err) {
                logger.warn(
                    `Failed to record position for agent ${position.agentCardId}: ${
                        err instanceof Error ? err.message : String(err)
                    }`,
                );
            }
        }

        if (result.recorded || result.reinforced || result.revised) {
            logger.info(
                `Beliefs — ${result.recorded} new, ${result.reinforced} reinforced, ${result.revised} revised`,
            );
        }
        return result;
    }

    /** Nearest held belief to a proposition, by embedding similarity. */
    private async closestBelief(
        proposition: string,
        candidates: AgentBeliefRecord[],
    ): Promise<{ belief: AgentBeliefRecord; similarity: number } | null> {
        if (candidates.length === 0) return null;

        try {
            const embeddings = getEmbeddings();
            const [target, ...others] = await Promise.all([
                embeddings.embedQuery(proposition),
                ...candidates.map((c) => embeddings.embedQuery(c.proposition)),
            ]);

            let best: { belief: AgentBeliefRecord; similarity: number } | null = null;
            others.forEach((vec, i) => {
                const similarity = cosine(target, vec);
                if (!best || similarity > best.similarity) {
                    best = { belief: candidates[i], similarity };
                }
            });
            return best;
        } catch (err) {
            logger.debug(
                `Belief similarity unavailable: ${err instanceof Error ? err.message : String(err)}`,
            );
            return null;
        }
    }

    /** What an agent currently holds, strongest first — for prompting. */
    async heldBeliefs(agentCardId: number, limit = 5): Promise<AgentBeliefRecord[]> {
        try {
            return await db
                .select()
                .from(agentBeliefs)
                .where(
                    and(eq(agentBeliefs.agentCardId, agentCardId), eq(agentBeliefs.status, "held")),
                )
                .orderBy(desc(agentBeliefs.confidence), desc(agentBeliefs.id))
                .limit(limit);
        } catch {
            return [];
        }
    }

    // ── Layer 3: calibration ─────────────────────────────────────────────

    /** Stores what an agent expects the next speaker to argue. */
    async recordPrediction(params: {
        orgId: number;
        sessionId: number;
        round: number;
        prediction: BeliefPredictionInput;
    }): Promise<void> {
        const { orgId, sessionId, round, prediction } = params;
        try {
            await db.insert(agentBeliefPredictions).values({
                organizationId: orgId,
                sessionId,
                round,
                predictorAgentCardId: prediction.predictorAgentCardId,
                subjectAgentCardId: prediction.subjectAgentCardId,
                predictedPosition: prediction.predictedPosition,
            });
        } catch (err) {
            logger.warn(
                `Failed to record belief prediction: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            );
        }
    }

    /**
     * Scores outstanding predictions for a round against what the subjects
     * actually said.
     *
     * Embedding similarity rather than a model call: objective, cheap, and it
     * keeps the calibration layer from costing more than the discussion.
     */
    async scoreRound(params: {
        sessionId: number;
        round: number;
        turnsByAgent: Map<number, { turnId: number; content: string }>;
    }): Promise<{ scored: number; averageAccuracy: number | null }> {
        const { sessionId, round, turnsByAgent } = params;

        try {
            const pending = await db
                .select()
                .from(agentBeliefPredictions)
                .where(
                    and(
                        eq(agentBeliefPredictions.sessionId, sessionId),
                        eq(agentBeliefPredictions.round, round),
                        isNull(agentBeliefPredictions.accuracyScore),
                    ),
                );

            if (pending.length === 0) return { scored: 0, averageAccuracy: null };

            const embeddings = getEmbeddings();
            const scores: number[] = [];

            for (const prediction of pending) {
                const actual = turnsByAgent.get(prediction.subjectAgentCardId);
                if (!actual) continue; // subject never spoke; leave unscored

                try {
                    const [predVec, actualVec] = await Promise.all([
                        embeddings.embedQuery(prediction.predictedPosition),
                        embeddings.embedQuery(actual.content.slice(0, 2000)),
                    ]);
                    // Cosine runs [-1,1]; negatives are as wrong as zero here.
                    const score = Math.round(Math.max(0, cosine(predVec, actualVec)) * 100);

                    await db
                        .update(agentBeliefPredictions)
                        .set({
                            accuracyScore: score,
                            observedTurnId: actual.turnId,
                            scoredAt: new Date(),
                        })
                        .where(eq(agentBeliefPredictions.id, prediction.id));
                    scores.push(score);
                } catch {
                    // One unscoreable prediction must not abort the rest.
                }
            }

            const averageAccuracy = scores.length
                ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
                : null;

            if (scores.length) {
                logger.info(
                    `Theory-of-mind — scored ${scores.length} prediction(s), average accuracy ${averageAccuracy}`,
                );
            }
            return { scored: scores.length, averageAccuracy };
        } catch (err) {
            logger.warn(
                `Failed to score predictions: ${err instanceof Error ? err.message : String(err)}`,
            );
            return { scored: 0, averageAccuracy: null };
        }
    }

    /** How well each agent has modelled the others over time. */
    async calibration(orgId: number, limit = 20): Promise<CalibrationScore[]> {
        try {
            const rows = await db
                .select({
                    agentCardId: agentBeliefPredictions.predictorAgentCardId,
                    predictions: sql<number>`count(*)::int`,
                    scored: sql<number>`count(${agentBeliefPredictions.accuracyScore})::int`,
                    averageAccuracy: sql<number | null>`round(avg(${agentBeliefPredictions.accuracyScore}))::int`,
                })
                .from(agentBeliefPredictions)
                .where(eq(agentBeliefPredictions.organizationId, orgId))
                .groupBy(agentBeliefPredictions.predictorAgentCardId)
                .limit(limit);

            return rows.map((r) => ({
                agentCardId: r.agentCardId,
                predictions: r.predictions,
                scored: r.scored,
                averageAccuracy: r.averageAccuracy ?? null,
            }));
        } catch {
            return [];
        }
    }
}

export const crewBeliefsService = new CrewBeliefsService();
