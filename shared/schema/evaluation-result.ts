import { serial, text, timestamp, jsonb, pgTable, integer, index } from "drizzle-orm/pg-core";
import { orgs } from "./auth.js";

export const evaluationResults = pgTable("evaluation_results", {
  id: serial("id").primaryKey(),
  // Nullable only to accommodate rows written before this column existed; every
  // writer must resolve a real organization and refuse otherwise. A NULL here
  // means "unattributed", never "all tenants" — org-scoped reads must exclude it.
  organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }),
  harnessId: text("harness_id").notNull(),
  harnessVersion: text("harness_version").notNull(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  status: text("status").notNull(), // e.g., 'pass', 'fail', 'partial'
  metrics: jsonb("metrics").$type<Record<string, number>>(), // e.g., { mttr_minutes: 30, vulnerability_count: 5 }
  traceId: text("trace_id"), // Link to execution logs/traces
  failureReason: jsonb("failure_reason").$type<Record<string, any>>(), // Structured failure details
}, (table) => [
  index("evaluation_results_org_harness_idx").on(table.organizationId, table.harnessId, table.harnessVersion),
]);

// Row type for a persisted evaluation result. Imported by the self-improvement
// simulators/harness as `EvaluationResult`.
export type EvaluationResult = typeof evaluationResults.$inferSelect;
