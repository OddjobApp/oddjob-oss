/**
 * Signal feed persistence.
 *
 * Extracted from signal-intelligence.routes.ts: route handlers must not touch the
 * database directly (lint:arch, Deep Module pattern). The refactor that introduced
 * that rule removed the `db` import from the route but left these queries behind,
 * so the file stopped compiling — this is where they belong.
 *
 * Every method takes an explicit orgId and filters on it. There is no "optional
 * org" overload on purpose: a feed lookup that falls through to an unscoped query
 * would return other tenants' feeds, and these rows carry credentials.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { signalFeeds } from "@shared/schema/index.js";

export const signalFeedsService = {
    /** All feeds for an org, newest first. Callers must redact credentials before responding. */
    async listForOrg(orgId: number) {
        return await db
            .select()
            .from(signalFeeds)
            .where(eq(signalFeeds.organizationId, orgId))
            .orderBy(desc(signalFeeds.createdAt));
    },

    /** A single feed, or undefined when it does not exist in this org. */
    async getForOrg(id: number, orgId: number) {
        const [feed] = await db
            .select()
            .from(signalFeeds)
            .where(and(eq(signalFeeds.id, id), eq(signalFeeds.organizationId, orgId)))
            .limit(1);
        return feed;
    },

    /** Applies a partial update and returns the new row. Stamps updatedAt. */
    async updateForOrg(id: number, orgId: number, updateData: Record<string, any>) {
        const [updated] = await db
            .update(signalFeeds)
            .set({ ...updateData, updatedAt: new Date() })
            .where(and(eq(signalFeeds.id, id), eq(signalFeeds.organizationId, orgId)))
            .returning();
        return updated;
    },

    /** Soft delete: the feed stops polling but its history and credentials row survive. */
    async disableForOrg(id: number, orgId: number) {
        await db
            .update(signalFeeds)
            .set({ enabled: false, status: "disabled", updatedAt: new Date() })
            .where(and(eq(signalFeeds.id, id), eq(signalFeeds.organizationId, orgId)));
    },
    /** Internal-event feeds only (sourceType "internal_event"), newest first. */
    async listInternalEventFeeds(orgId: number) {
        return await db
            .select()
            .from(signalFeeds)
            .where(and(eq(signalFeeds.organizationId, orgId), eq(signalFeeds.sourceType, "internal_event")))
            .orderBy(desc(signalFeeds.createdAt));
    },

    async createInternalEventFeed(orgId: number, input: {
        name: string;
        sourceType: string;
        eventTriggers: unknown;
        filters?: unknown;
    }) {
        const [feed] = await db
            .insert(signalFeeds)
            .values({
                organizationId: orgId,
                name: input.name,
                sourceType: "internal_event",
                url: `internal://${input.sourceType}`,
                pollingIntervalSeconds: 60,
                enabled: true,
                authCredentials: {
                    internalSourceType: input.sourceType,
                    eventTriggers: input.eventTriggers,
                    filters: input.filters || {},
                },
            } as any)
            .returning();
        return feed;
    },

    /** Hard delete, org-scoped. Returns the removed row, or undefined. */
    async deleteForOrg(id: number, orgId: number) {
        const [deleted] = await db
            .delete(signalFeeds)
            .where(and(eq(signalFeeds.id, id), eq(signalFeeds.organizationId, orgId)))
            .returning();
        return deleted;
    },
};
