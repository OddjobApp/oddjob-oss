/**
 * Signal action history.
 *
 * Extracted from signal-actions.routes.ts so the route stops querying the
 * database directly (lint:arch, Deep Module pattern).
 */
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { signalActions, eventPrimitives } from "@shared/schema/index.js";

export const signalActionsService = {
    /** How many actions exist for this signal in this org (pagination total). */
    async countForSignal(orgId: number, signalId: string) {
        const [row] = await db
            .select({ total: count() })
            .from(signalActions)
            .where(and(eq(signalActions.organizationId, orgId), eq(signalActions.signalId, signalId)));
        return row?.total ?? 0;
    },

    /** One page of actions for a signal, newest first. */
    async listForSignal(orgId: number, signalId: string, limit: number, offset: number) {
        return await db
            .select({
                id: signalActions.id,
                type: signalActions.action,
                timestamp: signalActions.createdAt,
                outcome: signalActions.active,
            })
            .from(signalActions)
            .where(and(eq(signalActions.organizationId, orgId), eq(signalActions.signalId, signalId)))
            .orderBy(desc(signalActions.createdAt))
            .limit(limit)
            .offset(offset);
    },
    /** Which of these signal ids actually exist in this org. */
    async filterOwnedSignalIds(orgId: number, signalIds: string[]) {
        const rows = await db
            .select({ id: eventPrimitives.id })
            .from(eventPrimitives)
            .where(and(eq(eventPrimitives.organizationId, orgId), inArray(eventPrimitives.id, signalIds)));
        return rows.map((r) => r.id);
    },

    /**
     * Replaces any live action of the same type on these signals with a new one.
     * Deactivate-then-insert, so a signal only ever has one active action per type.
     */
    async applyBulkAction(orgId: number, params: {
        action: string;
        signalIds: string[];
        performedBy: string | null | undefined;
        snoozedUntil: Date | null;
    }) {
        await db
            .update(signalActions)
            .set({ active: false })
            .where(and(
                eq(signalActions.organizationId, orgId),
                eq(signalActions.action, params.action),
                inArray(signalActions.signalId, params.signalIds),
                eq(signalActions.active, true),
            ));

        return await db
            .insert(signalActions)
            .values(params.signalIds.map((signalId) => ({
                organizationId: orgId,
                signalId,
                action: params.action,
                performedBy: params.performedBy,
                snoozedUntil: params.snoozedUntil,
                active: true,
            })) as any)
            .returning();
    },
};
