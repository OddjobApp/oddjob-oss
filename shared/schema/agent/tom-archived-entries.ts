import { pgTable, serial, text, integer, timestamp, jsonb, real, index } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { orgs, users } from "../auth.js";

/**
 * Archived Theory of Mind entries that have decayed below the confidence
 * threshold (20). Moved here by the decay batch rather than deleted, enabling
 * historical analysis and potential reactivation.
 *
 * One row per archived entry, keyed by dimension.
 */
export const tomArchivedEntries = pgTable("tom_archived_entries", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }).notNull(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    dimension: text("dimension").notNull(), // 'belief' | 'expectation' | 'knowledgeGap' | 'cognitive'
    entryData: jsonb("entry_data").$type<Record<string, any>>().notNull(),
    originalConfidence: integer("original_confidence").notNull(),
    effectiveConfidenceAtArchive: real("effective_confidence_at_archive").notNull(),
    archivedAt: timestamp("archived_at").defaultNow().notNull(),
    observedAt: timestamp("observed_at").notNull(),
}, (t) => ({
    orgUserIdx: index("tom_archived_org_user_idx").on(t.organizationId, t.userId),
    dimensionIdx: index("tom_archived_dimension_idx").on(t.organizationId, t.userId, t.dimension),
    archivedAtIdx: index("tom_archived_at_idx").on(t.archivedAt),
}));

export const insertTomArchivedEntrySchema = createInsertSchema(tomArchivedEntries);
export const selectTomArchivedEntrySchema = createSelectSchema(tomArchivedEntries);

export type TomArchivedEntry = typeof tomArchivedEntries.$inferSelect;
export type InsertTomArchivedEntry = typeof tomArchivedEntries.$inferInsert;
