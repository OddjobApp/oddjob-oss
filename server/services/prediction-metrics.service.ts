import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../database_service.js";
import { predictionOutcomes } from "@shared/schema/prediction/prediction-outcomes.js";

interface AccuracyQuery {
    organizationId?: number | null;
    windowDays: number;
}

export const predictionMetricsService = {
    async getAccuracy({ organizationId, windowDays }: AccuracyQuery) {
        const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
        const conditions = [gte(predictionOutcomes.createdAt, since)];
        if (organizationId) conditions.push(eq(predictionOutcomes.organizationId, organizationId));

        const [stats] = await db.select({
            total: sql<number>`count(*)`,
            correct: sql<number>`count(*) filter (where was_correct)`,
            accuracy: sql<number>`round(100.0 * count(*) filter (where was_correct) / nullif(count(*), 0), 1)`,
        }).from(predictionOutcomes).where(and(...conditions));
        return stats;
    },
};
