import { sql } from "drizzle-orm";
import { pgTable, serial, text, integer, smallint, timestamp, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { z } from "zod";
import { orgs, users } from "./auth.js";
import { apps } from "./apps.js";

// ============================================================================
// APP REVIEWS — one rating per person per marketplace listing.
//
// A review hangs off the listing (`apps.id`), not off an org's deployment of it,
// so every installing org's opinion lands on the same card. Only a member of an
// org that has the app installed may write one; that rule is enforced in
// app-reviews.service.ts, not here.
// ============================================================================

export const appReviews = pgTable("app_reviews", {
    id: serial("id").primaryKey(),
    appId: integer("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
    // The reviewer's org when they wrote it: the install that entitled them.
    organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    rating: smallint("rating").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    appUserUnq: uniqueIndex("app_reviews_app_user_unq").on(table.appId, table.userId),
    appIdx: index("app_reviews_app_idx").on(table.appId),
    ratingCheck: check("app_reviews_rating_check", sql`${table.rating} BETWEEN 1 AND 5`),
}));

export const upsertAppReviewSchema = z.object({
    rating: z.number().int().min(1).max(5),
    comment: z.string().trim().max(2000).optional().nullable(),
});

export type AppReview = typeof appReviews.$inferSelect;
export type UpsertAppReview = z.infer<typeof upsertAppReviewSchema>;
