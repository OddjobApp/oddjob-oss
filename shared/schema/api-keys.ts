import { pgTable, text, serial, timestamp, integer, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { orgs } from './auth.js';

export const apiKeys = pgTable("api_keys", {
    id: serial("id").primaryKey(),
    name: text("name").notNull(), // e.g. "Mobile App Key", "Partner Portal"
    keyHash: text("key_hash").notNull().unique(), // SHA-256 hash of the actual key
    prefix: text("prefix").notNull(), // First 7 chars for display: "rk_live_..."
    organizationId: integer("organization_id")
        .notNull()
        .references(() => orgs.id, { onDelete: "cascade" }),
    type: text("type").notNull().default("partner"), // 'partner' or 'client'
    lastUsedAt: timestamp("last_used_at"),
    expiresAt: timestamp("expires_at"),
    revoked: boolean("revoked").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    keyHashIdx: index("api_key_hash_idx").on(table.keyHash),
    orgIdIdx: index("api_key_org_idx").on(table.organizationId),
}));

export const insertApiKeySchema = createInsertSchema(apiKeys).omit({
    id: true,
    keyHash: true,
    prefix: true,
    createdAt: true,
});

export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = z.infer<typeof insertApiKeySchema>;



