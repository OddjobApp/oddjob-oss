import { db } from "@server/database_service.js";
import { syntheticPersonas, type SyntheticPersonaRecord, type SyntheticPersonaProfile } from "@shared/schema/index.js";
import { eq, and, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { theoryOfMindService } from "./theory-of-mind.service.js";
import { userRepresentationService } from "./user-representation.service.js";
import { userInterestGraphService } from "./user-interest-graph.service.js";
import { oceanAssessmentService } from "./ocean-assessment.service.js";
import { nodeRedisClient as redis } from "@domain/core/infrastructure/redis/redis-client.js";

const logger = createLogger("SyntheticPersona");

const CACHE_TTL_SECONDS = 600; // 10 minutes

export const syntheticPersonaService = {
    /**
     * Synthesize full user context into a Synthetic Persona Record.
     * Upserts into synthetic_personas and caches in Redis.
     */
    async synthesizePersona(organizationId: number, userId: string): Promise<SyntheticPersonaProfile | null> {
        if (!organizationId || !userId) return null;

        try {
            // 1. Fetch multi-dimensional user signals in parallel
            const [tomRecord, userRep, topInterests, recentActivities] = await Promise.all([
                theoryOfMindService.getToMState(organizationId, userId),
                userRepresentationService.getRepresentation(organizationId, userId),
                userInterestGraphService.getTopInterests(organizationId, userId, 5),
                userInterestGraphService.getRecentActivities(organizationId, userId, 5),
            ]);

            const oceanProfile = tomRecord?.oceanProfile ?? {
                openness: 0.5,
                conscientiousness: 0.5,
                extraversion: 0.5,
                agreeableness: 0.5,
                neuroticism: 0.5,
                confidence: 50,
                observationCount: 1,
                lastCalibratedAt: new Date().toISOString(),
            };

            // 2. Generate Steering Directives
            const steering = oceanAssessmentService.generateSteeringDirectives(oceanProfile);

            // 3. Determine Persona Archetype
            let archetype = "Pragmatic Systems Builder";
            if (oceanProfile.openness >= 0.7 && oceanProfile.conscientiousness >= 0.7) {
                archetype = "Systems Architect & Strategic Analyst";
            } else if (oceanProfile.openness >= 0.7) {
                archetype = "Exploration-Oriented Researcher";
            } else if (oceanProfile.conscientiousness >= 0.7) {
                archetype = "Data & Quality Sentinel";
            } else if (oceanProfile.neuroticism <= 0.3 && oceanProfile.extraversion >= 0.6) {
                archetype = "Field Lead & Rapid Incident Commander";
            }

            // 4. Derive Active Focus Vector (Top 3 active topics)
            const activeFocusVector = topInterests.slice(0, 3).map((i) => i.topic);
            if (activeFocusVector.length === 0 && recentActivities.length > 0) {
                activeFocusVector.push(...recentActivities.slice(0, 3).map((a) => a.topic));
            }
            if (activeFocusVector.length === 0) {
                activeFocusVector.push("General Platform Operations");
            }

            // 5. Working Style & Risk Posture
            const workingStyle = oceanProfile.openness >= 0.6 ? "exploratory" : (oceanProfile.conscientiousness >= 0.6 ? "goal_directed" : "hybrid");
            const riskTolerance = oceanProfile.neuroticism <= 0.35 ? "aggressive" : (oceanProfile.neuroticism >= 0.65 ? "conservative" : "balanced");

            const summary = `User operates as a ${archetype} with key focus on ${activeFocusVector.join(", ")}. Preferred working style is ${workingStyle} with ${riskTolerance} risk posture.`;

            const personaProfile: SyntheticPersonaProfile = {
                archetype,
                summary,
                communicationDirectives: steering.communicationDirectives,
                oceanSummary: {
                    ...oceanProfile,
                    guidance: steering.guidanceText,
                },
                activeFocusVector,
                riskTolerance,
                workingStyle,
                lastSynthesizedAt: new Date().toISOString(),
            };

            // 6. Persist to DB.
            //
            // One upsert, not select-then-insert-or-update. A crew round
            // synthesises the persona from several agent turns at once; every
            // one of them read "no row", every one of them inserted, and all
            // but the winner died on the (organization_id, user_id) unique
            // index. The throw was caught and logged upstream, so the symptom
            // was a recurring "Failed to synthesize persona" error against a
            // table that was working perfectly.
            await db
                .insert(syntheticPersonas)
                .values({
                    organizationId,
                    userId,
                    archetype,
                    summary,
                    communicationDirectives: steering.communicationDirectives,
                    oceanSummary: personaProfile.oceanSummary,
                    activeFocusVector,
                    riskTolerance,
                    workingStyle,
                    version: 1,
                    lastSynthesizedAt: new Date(),
                })
                .onConflictDoUpdate({
                    target: [syntheticPersonas.organizationId, syntheticPersonas.userId],
                    set: {
                        archetype,
                        summary,
                        communicationDirectives: steering.communicationDirectives,
                        oceanSummary: personaProfile.oceanSummary,
                        activeFocusVector,
                        riskTolerance,
                        workingStyle,
                        // Incremented in SQL rather than from a value read
                        // earlier, which is what made the version count races
                        // rather than syntheses.
                        version: sql`${syntheticPersonas.version} + 1`,
                        lastSynthesizedAt: new Date(),
                        updatedAt: new Date(),
                    },
                });

            // Cache in Redis
            const cacheKey = `synthetic_persona:${organizationId}:${userId}`;
            await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(personaProfile)).catch(() => {});

            return personaProfile;
        } catch (err: any) {
            logger.error(`Failed to synthesize persona for user ${userId}`, err);
            return null;
        }
    },

    /**
     * Retrieve pre-computed Synthetic Persona or fallback on-demand.
     */
    async getPersona(organizationId: number, userId: string): Promise<SyntheticPersonaProfile | null> {
        if (!organizationId || !userId) return null;
        const cacheKey = `synthetic_persona:${organizationId}:${userId}`;

        try {
            // Check Redis
            const cached = await redis.get(cacheKey);
            if (cached) {
                return JSON.parse(cached) as SyntheticPersonaProfile;
            }

            // DB check
            const [row] = await db
                .select()
                .from(syntheticPersonas)
                .where(
                    and(
                        eq(syntheticPersonas.organizationId, organizationId),
                        eq(syntheticPersonas.userId, userId)
                    )
                )
                .limit(1);

            if (row) {
                const profile: SyntheticPersonaProfile = {
                    archetype: row.archetype,
                    summary: row.summary,
                    communicationDirectives: row.communicationDirectives as string[],
                    oceanSummary: row.oceanSummary as SyntheticPersonaProfile["oceanSummary"],
                    activeFocusVector: row.activeFocusVector as string[],
                    riskTolerance: row.riskTolerance as any,
                    workingStyle: row.workingStyle as any,
                    lastSynthesizedAt: row.lastSynthesizedAt.toISOString(),
                };
                await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(profile)).catch(() => {});
                return profile;
            }

            // Fallback: Synthesize on demand
            return await this.synthesizePersona(organizationId, userId);
        } catch (err: any) {
            logger.error(`Failed to fetch persona for user ${userId}`, err);
            return null;
        }
    },

    /**
     * Generate prompt context snippet formatted for injection into Agent System Prompts.
     */
    async getPromptContextSnippet(organizationId: number, userId: string): Promise<string> {
        const persona = await this.getPersona(organizationId, userId);
        if (!persona) return "";

        return [
            `\n[SYNTHETIC USER PERSONA & STEERING DIRECTIVES]`,
            `User Archetype: ${persona.archetype}`,
            `Active Focus Topics: ${persona.activeFocusVector.join(", ")}`,
            `Risk Tolerance: ${persona.riskTolerance} | Working Style: ${persona.workingStyle}`,
            `Communication Directives for Agents:`,
            ...persona.communicationDirectives.map((d) => ` - ${d}`),
            `[END USER PERSONA]\n`
        ].join("\n");
    }
};
