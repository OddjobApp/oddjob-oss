
import { pgTable, serial, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users, orgs } from '../auth.js';

// ============================================================================
// PLATFORM IDENTITIES (Slack/Teams to Oddjob User Mapping)
// ============================================================================

export const userPlatformIdentities = pgTable("user_platform_identities", {
  id: serial("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" }),
  
  platform: text("platform").notNull(), // 'slack', 'teams'
  platformUserId: text("platform_user_id").notNull(), // e.g. 'U12345'
  platformUsername: text("platform_username"),
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  platformUserIdx: uniqueIndex("platform_user_idx").on(table.platform, table.platformUserId, table.organizationId),
}));


