import { serial, text, timestamp, jsonb, pgTable, integer, index } from "drizzle-orm/pg-core";
import { orgs } from "./auth.js";

export const harnessProposals = pgTable("harness_proposals", {
  id: serial("id").primaryKey(),
  // `proposedChange` below is a source diff staged for self-modification, so an
  // unscoped read of this table exposes one tenant's proposed code to another.
  // Nullable only for rows written before this column existed; every writer must
  // resolve a real organization and refuse otherwise, and a NULL here means
  // "unattributed", never "all tenants".
  organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }),
  harnessId: text("harness_id").notNull(),
  parentHarnessVersion: text("parent_harness_version").notNull(),
  proposedChange: jsonb("proposed_change").$type<{ filePath: string; oldContent: string; newContent: string }>().notNull(), // for self-modification.ts tools
  rationale: text("rationale"),
  proposedByAgentId: text("proposed_by_agent_id"),
  validationStatus: text("validation_status").notNull(), // e.g., 'pending', 'accepted', 'rejected'
  validationResults: jsonb("validation_results"), // Link to EvaluationResult IDs of validation runs
  // A human super admin must set these before the proposed diff may be applied to the live codebase
  // (validateProposal and apply-accepted-proposals-executor both refuse to call code_edit without this).
  humanApprovedAt: timestamp("human_approved_at"),
  humanApprovedBy: text("human_approved_by"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
}, (table) => [
  index("harness_proposals_org_harness_idx").on(table.organizationId, table.harnessId),
]);