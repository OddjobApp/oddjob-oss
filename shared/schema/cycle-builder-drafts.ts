import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { orgs } from "./auth.js";

export const cycleBuilderDrafts = pgTable("cycle_builder_drafts", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  ownerUserId: text("owner_user_id").notNull(),
  sourceType: text("source_type").notNull().default("blank"),
  sourceId: text("source_id"),
  schemaVersion: text("schema_version").notNull(),
  definition: jsonb("definition").notNull(),
  validationState: text("validation_state").notNull().default("unchecked"),
  version: integer("version").notNull().default(1),
  createdCycleId: integer("created_cycle_id"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, table => ({
  orgUpdatedIdx: index("cycle_builder_drafts_org_updated_idx").on(table.organizationId, table.updatedAt),
  ownerUpdatedIdx: index("cycle_builder_drafts_owner_updated_idx").on(table.ownerUserId, table.updatedAt),
}));

export type CycleBuilderDraftRecord = typeof cycleBuilderDrafts.$inferSelect;
