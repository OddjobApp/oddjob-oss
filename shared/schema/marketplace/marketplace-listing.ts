/**
 * Marketplace Listings Schema
 *
 * A published bot package is a snapshot of an AgentCard (+ optional mission
 * template and schedule config) that can be cloned ("installed") into any org.
 *
 * Decision: isPublic is user-controlled; platform admins can revoke by setting
 * isPublic = false on any listing (no separate admin flag needed yet).
 */

import { sql } from "drizzle-orm";
import {
    pgTable,
    serial,
    integer,
    varchar,
    text,
    timestamp,
    boolean,
    jsonb,
    index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ============================================================================
// TABLE
// ============================================================================

export const marketplaceListings = pgTable("marketplace_listings", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull(),
    publishedByUserId: varchar("published_by_user_id", { length: 255 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description"),
    category: varchar("category", { length: 60 }),
    tags: jsonb("tags").$type<string[]>().default(sql`'[]'::jsonb`),
    /** Serialized AgentCardCreateInput — used to clone the card on install */
    agentCardSnapshot: jsonb("agent_card_snapshot").notNull(),
    /** Optional serialized mission template */
    missionTemplateSnapshot: jsonb("mission_template_snapshot"),
    /** Optional cron string */
    scheduleSnapshot: varchar("schedule_snapshot", { length: 100 }),
    iconEmoji: varchar("icon_emoji", { length: 8 }),
    isPublic: boolean("is_public").default(true).notNull(),
    installCount: integer("install_count").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
    orgIdx: index("idx_marketplace_listings_org").on(table.organizationId),
    publicIdx: index("idx_marketplace_listings_public").on(table.isPublic, table.installCount),
}));

// ============================================================================
// ZOD SCHEMAS
// ============================================================================

export const insertMarketplaceListingSchema = createInsertSchema(marketplaceListings, {
    name: z.string().min(1, "Name is required").max(120),
    description: z.string().max(1000).optional(),
    category: z.string().max(60).optional(),
    tags: z.array(z.string()).max(10).default([]),
    agentCardSnapshot: z.record(z.unknown()),
    missionTemplateSnapshot: z.record(z.unknown()).optional(),
    scheduleSnapshot: z.string().max(100).optional(),
    iconEmoji: z.string().max(8).optional(),
}).omit({
    id: true,
    installCount: true,
    createdAt: true,
    updatedAt: true,
});

export const publishBotInputSchema = z.object({
    /** The source agent card ID to snapshot */
    agentCardId: z.number().int().positive(),
    name: z.string().min(1).max(120),
    description: z.string().max(1000).optional(),
    category: z.string().max(60).optional(),
    tags: z.array(z.string()).max(10).default([]),
    iconEmoji: z.string().max(8).optional(),
    isPublic: z.boolean().default(true),
});

// ============================================================================
// TYPES
// ============================================================================

export type MarketplaceListingRecord = typeof marketplaceListings.$inferSelect;
export type MarketplaceListingCreateInput = z.infer<typeof insertMarketplaceListingSchema>;
export type PublishBotInput = z.infer<typeof publishBotInputSchema>;
