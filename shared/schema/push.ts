import { pgTable, serial, text, integer, timestamp, index, primaryKey } from "drizzle-orm/pg-core";
import { z } from "zod";
import { orgs, users } from "./auth.js";

// ============================================================================
// WEB PUSH — browser push subscriptions and a delivery ledger.
//
// A subscription is one browser on one device. `endpoint` is the push service
// URL the browser handed out; it is unique, so re-subscribing the same browser
// updates the row rather than adding a second one.
// ============================================================================

export const pushSubscriptions = pgTable("push_subscriptions", {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "set null" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    failureCount: integer("failure_count").default(0).notNull(),
}, (table) => ({
    userIdx: index("push_subscriptions_user_idx").on(table.userId),
}));

/**
 * A phone app install, reachable through Firebase Cloud Messaging. The FCM
 * registration token is unique per install; a token re-registered by another
 * person (someone else signs in on the phone) moves to them.
 */
export const pushDevices = pgTable("push_devices", {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "set null" }),
    platform: text("platform").notNull(),
    token: text("token").notNull().unique(),
    appVersion: text("app_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    failureCount: integer("failure_count").default(0).notNull(),
}, (table) => ({
    userIdx: index("push_devices_user_idx").on(table.userId),
}));

/**
 * One row per (thing, person) that has been pushed. Inserting the row is how a
 * sender claims the delivery, so two processes sweeping the same approvals send
 * it once.
 */
export const pushDeliveries = pgTable("push_deliveries", {
    source: text("source").notNull(),
    sourceId: text("source_id").notNull(),
    userId: text("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    pk: primaryKey({ columns: [table.source, table.sourceId, table.userId] }),
}));

export const pushSubscriptionInputSchema = z.object({
    endpoint: z.string().url().max(2048),
    keys: z.object({
        p256dh: z.string().min(1).max(512),
        auth: z.string().min(1).max(512),
    }),
});

export const pushDeviceInputSchema = z.object({
    token: z.string().min(20).max(4096),
    platform: z.enum(["android"]),
    appVersion: z.string().max(40).optional(),
});

export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type PushDevice = typeof pushDevices.$inferSelect;
export type PushDeviceInput = z.infer<typeof pushDeviceInputSchema>;
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionInputSchema>;
