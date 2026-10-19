import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { orgs } from "../auth.js";
import { improvementOpportunities } from "./opportunities.js";

/** What a change set may act on. */
export type ChangeTargetType = "cycle_blueprint" | "cycle_schedule" | "pipeline_step" | "forge_app";

export type ChangeOperationKind =
    | "add_mission" | "update_mission" | "disable_mission" | "remove_mission"
    | "update_recurrence" | "update_timezone" | "update_limits"
    | "add_step" | "update_step" | "reorder_step" | "disable_step" | "remove_step"
    | "create_schedule" | "update_schedule"
    | "edit_forge_file" | "request_forge_enhancement" | "create_release_candidate"
    | "restore_version";

/**
 * One typed mutation.
 *
 * Natural language is supporting context, never the contract. `reason` explains
 * to a human; `kind` and `payload` are what executes, and only they are hashed
 * into the approval.
 */
export interface ChangeOperation {
    kind: ChangeOperationKind;
    /** Path or identifier within the target this operation touches. */
    path?: string;
    payload: Record<string, unknown>;
}

export type ChangeSetStatus =
    | "draft"
    | "validated"
    | "approved"
    | "applying"
    | "applied"
    | "verified"
    | "rolled_back"
    | "failed";

/**
 * An immutable, typed mutation proposal.
 *
 * Approval binds to `contentHash`, not to the row. Any edit to the operations,
 * the target, or the expected version recomputes the hash and returns the set
 * to `draft` — carrying consent forward onto different operations is the exact
 * failure §9.7 exists to prevent.
 *
 * `approvalRequestId` points at the authoritative approval record. The record
 * is the authority; a timestamp inside a payload is not, and the verifier
 * refuses to treat one as such.
 */
export const improvementChangeSets = pgTable(
    "improvement_change_sets",
    {
        id: serial("id").primaryKey(),
        organizationId: integer("organization_id")
            .notNull()
            .references(() => orgs.id, { onDelete: "cascade" }),
        projectId: integer("project_id"),
        opportunityId: integer("opportunity_id")
            .references(() => improvementOpportunities.id, { onDelete: "set null" }),

        targetType: text("target_type").$type<ChangeTargetType>().notNull(),
        targetId: text("target_id").notNull(),
        /** The target version this was authored against. Stale = refuse. */
        expectedVersion: text("expected_version").notNull(),

        reason: text("reason").notNull(),
        evidenceIds: jsonb("evidence_ids").$type<number[]>().default([]).notNull(),
        operations: jsonb("operations").$type<ChangeOperation[]>().default([]).notNull(),

        validationPlan: jsonb("validation_plan").$type<Record<string, unknown>>().default({}).notNull(),
        rolloutPlan: jsonb("rollout_plan").$type<Record<string, unknown>>().default({}).notNull(),
        rollbackPlan: jsonb("rollback_plan").$type<Record<string, unknown>>().default({}).notNull(),

        status: text("status").$type<ChangeSetStatus>().default("draft").notNull(),
        /** Deterministic hash of everything that executes. Approval binds here. */
        contentHash: text("content_hash").notNull(),

        /** The authoritative approval record, resolved at apply time. */
        approvalRequestId: integer("approval_request_id"),
        /** The hash that was approved. A mismatch with contentHash voids it. */
        approvedContentHash: text("approved_content_hash"),
        approvedBy: text("approved_by"),
        approvedAt: timestamp("approved_at"),
        /** Approval expiry; past this, the approval no longer authorizes. */
        approvalExpiresAt: timestamp("approval_expires_at"),
        /** Set when a human chose a named remediation instead of the original. */
        selectedRemediation: text("selected_remediation"),

        appliedAt: timestamp("applied_at"),
        verifiedAt: timestamp("verified_at"),
        rolledBackAt: timestamp("rolled_back_at"),
        failureReason: text("failure_reason"),

        createdBy: text("created_by").notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at").defaultNow().notNull(),
    },
    (table) => [
        index("improvement_change_sets_org_status_idx").on(table.organizationId, table.status),
        index("improvement_change_sets_target_idx").on(table.organizationId, table.targetType, table.targetId),
        index("improvement_change_sets_hash_idx").on(table.contentHash),
    ],
);

export type ImprovementChangeSet = typeof improvementChangeSets.$inferSelect;
export type InsertImprovementChangeSet = typeof improvementChangeSets.$inferInsert;
