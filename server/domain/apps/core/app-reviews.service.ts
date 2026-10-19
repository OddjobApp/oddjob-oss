/**
 * Marketplace ratings and reviews.
 *
 * One review per person per listing. Only someone whose organization has the app
 * installed may write one, so a rating means "used it", not "saw the card".
 *
 * Reviews are shown across tenants (the marketplace is shared), so a review is
 * returned with its rating, text and date only: never the reviewer's name, email
 * or organization. The caller's own review is flagged so they can edit it.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { appDeployments, apps, userOrgs } from "@shared/schema/index.js";
import { appReviews, type UpsertAppReview } from "@shared/schema/app-reviews.js";
import { ForbiddenError, NotFoundError } from "@server/utils/errors.js";

export interface ReviewSummary {
    average: number;
    count: number;
}

export interface PublicReview {
    id: number;
    rating: number;
    comment: string | null;
    createdAt: Date;
    updatedAt: Date;
    mine: boolean;
}

export const appReviewsService = {
    /** Average and count per app, for every app that has at least one review. */
    async summaries(appIds?: number[]): Promise<Map<number, ReviewSummary>> {
        if (appIds && appIds.length === 0) return new Map();
        const rows = await db
            .select({
                appId: appReviews.appId,
                average: sql<string>`avg(${appReviews.rating})`,
                count: sql<string>`count(*)`,
            })
            .from(appReviews)
            .where(appIds ? inArray(appReviews.appId, appIds) : undefined)
            .groupBy(appReviews.appId);
        return new Map(rows.map((r) => [
            r.appId,
            { average: Math.round(Number(r.average) * 10) / 10, count: Number(r.count) },
        ]));
    },

    /**
     * Reviews of a marketplace listing. A private app's reviews are visible only to
     * orgs that have it installed; to anyone else it does not exist.
     */
    async list(appId: number, viewerId: string | null, viewerOrgId: number | null, limit = 50): Promise<PublicReview[]> {
        const [app] = await db.select({ isPublic: apps.isPublic }).from(apps).where(eq(apps.id, appId)).limit(1);
        const visible = !!app && (app.isPublic === true
            || (viewerId !== null && await this.canReview(appId, viewerId, viewerOrgId)));
        if (!visible) throw new NotFoundError("App not found");

        const rows = await db
            .select()
            .from(appReviews)
            .where(eq(appReviews.appId, appId))
            .orderBy(desc(appReviews.updatedAt))
            .limit(Math.min(Math.max(limit, 1), 200));
        return rows.map((r) => ({
            id: r.id,
            rating: r.rating,
            comment: r.comment,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
            mine: viewerId !== null && r.userId === viewerId,
        }));
    },

    /**
     * Whether this person may review this app from this org: they belong to the
     * org, and the org has the app installed. Membership is checked here because
     * the request's org context can come from a query parameter.
     */
    async canReview(appId: number, userId: string, organizationId: number | null): Promise<boolean> {
        if (organizationId == null) return false;
        const [member] = await db
            .select({ orgId: userOrgs.orgId })
            .from(userOrgs)
            .where(and(eq(userOrgs.userId, userId), eq(userOrgs.orgId, organizationId)))
            .limit(1);
        if (!member) return false;
        const [installed] = await db
            .select({ id: appDeployments.id })
            .from(appDeployments)
            .where(and(eq(appDeployments.appId, appId), eq(appDeployments.organizationId, organizationId)))
            .limit(1);
        return !!installed;
    },

    async upsert(appId: number, userId: string, organizationId: number | null, input: UpsertAppReview): Promise<PublicReview> {
        const [app] = await db.select({ id: apps.id }).from(apps).where(eq(apps.id, appId)).limit(1);
        if (!app) throw new NotFoundError("App not found");
        if (!(await this.canReview(appId, userId, organizationId))) {
            throw new ForbiddenError("Only members of an organization that has installed this app can review it");
        }

        const comment = input.comment?.trim() ? input.comment.trim() : null;
        const now = new Date();
        const [row] = await db
            .insert(appReviews)
            .values({ appId, userId, organizationId: organizationId!, rating: input.rating, comment })
            .onConflictDoUpdate({
                target: [appReviews.appId, appReviews.userId],
                set: { rating: input.rating, comment, organizationId: organizationId!, updatedAt: now },
            })
            .returning();
        return { id: row.id, rating: row.rating, comment: row.comment, createdAt: row.createdAt, updatedAt: row.updatedAt, mine: true };
    },

    async remove(appId: number, userId: string): Promise<boolean> {
        const deleted = await db
            .delete(appReviews)
            .where(and(eq(appReviews.appId, appId), eq(appReviews.userId, userId)))
            .returning({ id: appReviews.id });
        return deleted.length > 0;
    },
};
