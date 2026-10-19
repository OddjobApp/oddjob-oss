import { serial, text, jsonb, pgTable, integer, index } from "drizzle-orm/pg-core";
import { orgs } from "./auth.js";

export const failurePatterns = pgTable("failure_patterns", {
  id: serial("id").primaryKey(),
  // Nullable only to accommodate rows written before this column existed; every
  // writer must resolve a real organization and refuse otherwise. A NULL here
  // means "unattributed", never "all tenants" — org-scoped reads must exclude it.
  organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }),
  harnessId: text("harness_id").notNull(),
  harnessVersion: text("harness_version").notNull(),
  patternSignature: jsonb("pattern_signature").notNull(), // JSON object describing the recurring failure
  // `integer`, NOT `serial`. These were declared serial — integer + NOT NULL +
  // DEFAULT nextval(...) — so any insert that omitted them received the next
  // sequence value, a row counter that reads as a plausible score.
  clusterSize: integer("cluster_size").notNull(),
  representativeTraces: jsonb("representative_traces").$type<string[]>(), // List of traceIds
  // Nullable: NULL means "not yet scored", which is honest. Writing a
  // placeholder 0 would present an unscored pattern as a scored one.
  actionabilityScore: integer("actionability_score"),
}, (table) => [
  index("failure_patterns_org_harness_idx").on(table.organizationId, table.harnessId, table.harnessVersion),
]);

export type FailurePattern = typeof failurePatterns.$inferSelect;
