import { pgTable, serial, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { orgs, users } from "../auth.js";
import { missionTemplates } from "./templates.js";

/**
 * A proposed revision to a mission_templates row, produced by the post-task
 * review pipeline (templateRevisionService.proposeRevisionFromRun) after a
 * mission_run completes. Pending until a human approves or rejects.
 *
 * On approval, the proposed config replaces the template's config, the
 * version is bumped, and any other pending proposals for the same template
 * are marked 'superseded' so reviewers don't approve stale diffs.
 */
export const templateProposals = pgTable("template_proposals", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }).notNull(),
    sourceTemplateId: integer("source_template_id").references(() => missionTemplates.id, { onDelete: "cascade" }).notNull(),
    sourceMissionRunId: integer("source_mission_run_id"), // nullable: future non-run sources could propose
    sourceJobId: integer("source_job_id"), // optional lineage to the agent that ran the mission

    // The proposed new config. Stored as the FULL config (not a delta) so
    // approval is a single overwrite â€” simpler than reconciling deltas.
    proposedConfig: jsonb("proposed_config").$type<Record<string, unknown>>().notNull(),

    // Short human-readable summary of what changed (LLM-generated).
    diffSummary: text("diff_summary").notNull(),
    // Why the change is being proposed (LLM rationale grounded in the run).
    rationale: text("rationale").notNull(),

    // 'pending' | 'approved' | 'rejected' | 'superseded'
    status: text("status").notNull().default("pending"),
    reviewedBy: text("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at"),
    reviewerComments: text("reviewer_comments"),

    // Bumped version on approval, so reviewers see what version this would create.
    proposedVersion: text("proposed_version"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
    index("template_proposals_org_status_idx").on(t.organizationId, t.status),
    index("template_proposals_template_idx").on(t.sourceTemplateId),
    index("template_proposals_run_idx").on(t.sourceMissionRunId),
]);

export const insertTemplateProposalSchema = createInsertSchema(templateProposals);
export const selectTemplateProposalSchema = createSelectSchema(templateProposals);

export type TemplateProposal = typeof templateProposals.$inferSelect;
export type InsertTemplateProposal = typeof templateProposals.$inferInsert;


