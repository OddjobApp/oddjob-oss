import { and, eq } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { eventPrimitives, signalFeeds } from "@shared/schema/index.js";

/**
 * Persistence for webhook/stream ingress (api/event-ingress.routes.ts), kept
 * out of the route so the handler stays a thin controller. Every lookup is
 * scoped to the caller's organization: a feed in another org is not found.
 */
export const eventIngressService = {
    async findFeedForOrg(feedId: number, organizationId: number) {
        const [feed] = await db.select().from(signalFeeds)
            .where(and(eq(signalFeeds.id, feedId), eq(signalFeeds.organizationId, organizationId)))
            .limit(1);
        return feed ?? null;
    },

    async insertEvent(values: typeof eventPrimitives.$inferInsert) {
        const [inserted] = await db.insert(eventPrimitives).values(values).returning();
        return inserted;
    },

    async markFeedDelivered(feedId: number) {
        await db.update(signalFeeds).set({
            lastPollAt: new Date(),
            lastSuccessAt: new Date(),
            consecutiveFailures: 0,
            status: "active",
            updatedAt: new Date(),
        } as any).where(eq(signalFeeds.id, feedId));
    },
};
