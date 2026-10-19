import { db } from "@server/database_service.js";
import { userInterests, userProjectActivities, type UserInterest, type UserProjectActivityRecord } from "@shared/schema/index.js";
import { eq, and, desc, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { nodeRedisClient as redis } from "@domain/core/infrastructure/redis/redis-client.js";

const logger = createLogger("UserInterestGraph");

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const CACHE_TTL_SECONDS = 300;

export function computeDecayedWeight(weight: number, lastReinforcedAt: Date | string): number {
    const elapsed = Date.now() - new Date(lastReinforcedAt).getTime();
    if (elapsed <= 0) return weight;
    return weight * Math.pow(0.5, elapsed / FOURTEEN_DAYS_MS);
}

export const userInterestGraphService = {
    /**
     * Record or reinforce a user interest topic.
     * Upserts the topic and updates weight and lastReinforcedAt.
     */
    async reinforceInterest(
        organizationId: number,
        userId: string,
        topic: string,
        category: string = "general",
        incrementWeight: number = 10.0,
        evidenceSnippet?: string
    ): Promise<UserInterest | null> {
        if (!organizationId || !userId || !topic) return null;
        const normalizedTopic = topic.trim().toLowerCase();

        try {
            const [existing] = await db
                .select()
                .from(userInterests)
                .where(
                    and(
                        eq(userInterests.organizationId, organizationId),
                        eq(userInterests.userId, userId),
                        eq(userInterests.topic, normalizedTopic)
                    )
                )
                .limit(1);

            const now = new Date();
            let record: UserInterest;

            if (existing) {
                const currentDecayed = computeDecayedWeight(existing.weight, existing.lastReinforcedAt);
                const newWeight = Math.min(100.0, currentDecayed + incrementWeight);
                const updatedEvidence = evidenceSnippet
                    ? Array.from(new Set([...(existing.evidence || []), evidenceSnippet])).slice(-10)
                    : (existing.evidence || []);

                const [updated] = await db
                    .update(userInterests)
                    .set({
                        weight: newWeight,
                        decayScore: newWeight,
                        category: category !== "general" ? category : existing.category,
                        evidence: updatedEvidence,
                        lastReinforcedAt: now,
                        updatedAt: now,
                    })
                    .where(eq(userInterests.id, existing.id))
                    .returning();

                record = updated;
            } else {
                const evidenceList = evidenceSnippet ? [evidenceSnippet] : [];
                const [inserted] = await db
                    .insert(userInterests)
                    .values({
                        organizationId,
                        userId,
                        topic: normalizedTopic,
                        category,
                        weight: Math.min(100.0, 50.0 + incrementWeight),
                        decayScore: Math.min(100.0, 50.0 + incrementWeight),
                        evidence: evidenceList,
                        lastReinforcedAt: now,
                    })
                    .returning();

                record = inserted;
            }

            // Invalidate cache
            await redis.del(`user_interests:${organizationId}:${userId}`).catch(() => {});
            return record;
        } catch (err: any) {
            logger.error(`Failed to reinforce interest topic "${topic}" for user ${userId}`, err);
            return null;
        }
    },

    /**
     * Log user activity associated with a project space.
     */
    async logProjectActivity(
        organizationId: number,
        userId: string,
        actionType: string,
        topic: string,
        details?: string,
        projectId?: number
    ): Promise<UserProjectActivityRecord | null> {
        if (!organizationId || !userId || !actionType) return null;
        try {
            const [inserted] = await db
                .insert(userProjectActivities)
                .values({
                    organizationId,
                    userId,
                    projectId: projectId ?? null,
                    actionType,
                    topic: topic.trim().toLowerCase(),
                    details: details ?? null,
                })
                .returning();

            // Reinforce the associated topic interest
            await this.reinforceInterest(organizationId, userId, topic, "project_work", 15.0, details);
            return inserted;
        } catch (err: any) {
            logger.error(`Failed to log project activity for user ${userId}`, err);
            return null;
        }
    },

    /**
     * Get top active interests with 14-day recency decay applied.
     */
    async getTopInterests(
        organizationId: number,
        userId: string,
        limit: number = 10
    ): Promise<Array<UserInterest & { effectiveWeight: number }>> {
        if (!organizationId || !userId) return [];
        const cacheKey = `user_interests:${organizationId}:${userId}`;

        try {
            const rows = await db
                .select()
                .from(userInterests)
                .where(
                    and(
                        eq(userInterests.organizationId, organizationId),
                        eq(userInterests.userId, userId)
                    )
                );

            const withDecay = rows.map((r) => {
                const effectiveWeight = computeDecayedWeight(r.weight, r.lastReinforcedAt);
                return {
                    ...r,
                    effectiveWeight: Math.round(effectiveWeight * 10) / 10,
                };
            });

            withDecay.sort((a, b) => b.effectiveWeight - a.effectiveWeight);
            return withDecay.slice(0, limit);
        } catch (err: any) {
            logger.error(`Failed to fetch top interests for user ${userId}`, err);
            return [];
        }
    },

    /**
     * Get recent project activities.
     */
    async getRecentActivities(
        organizationId: number,
        userId: string,
        limit: number = 10
    ): Promise<UserProjectActivityRecord[]> {
        if (!organizationId || !userId) return [];
        try {
            return await db
                .select()
                .from(userProjectActivities)
                .where(
                    and(
                        eq(userProjectActivities.organizationId, organizationId),
                        eq(userProjectActivities.userId, userId)
                    )
                )
                .orderBy(desc(userProjectActivities.createdAt))
                .limit(limit);
        } catch (err: any) {
            logger.error(`Failed to fetch recent activities for user ${userId}`, err);
            return [];
        }
    }
};
