import { sql } from "drizzle-orm";
import {
    pgTable,
    text,
    varchar,
    serial,
    boolean,
    timestamp,
    integer,
    jsonb,
    primaryKey,
    bigint,
    smallint,
    uuid,
    check,
    uniqueIndex,
    decimal,
    index,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { orgs, users } from './auth.js';
import { projects } from './projects.js';
import { missions } from './missions/core.js';
import { knowledgeNodes } from './knowledge/graph.js';

export const HIL_FORM_KINDS = ["template", "request", "response"] as const;
export type HilFormKind = (typeof HIL_FORM_KINDS)[number];

export const HIL_REQUEST_SOURCES = ["step", "cycle", "app", "agent", "behavioral"] as const;
export type HilRequestSource = (typeof HIL_REQUEST_SOURCES)[number];

export const hilForms = pgTable("hil_forms", {
    id: serial("id").primaryKey(),
    name: text("name").notNull().default("HIL Form"),
    description: text("description"),

    // Form Definition (Fields, Types, Validation)
    schema: jsonb("schema").notNull().default({ fields: [] }),
    // Example: { fields: [{ key: "reason", type: "text", label: "Why?", required: true }] }

    // Configuration for Public/External Access
    themeConfig: jsonb("theme_config").default({
        logoUrl: "",
        primaryColor: "#4F46E5",
        companyName: "Oddjob",
    }),

    securityConfig: jsonb("security_config").default({
        requireOtp: false,
        tokenExpirationHours: 48,
    }),

    // Organization context for filtering
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "set null" }),

    // Project context for filtering and unique naming within a project
    projectId: integer("project_id").references(() => projects.id, { onDelete: "set null" }),

    isArchived: boolean("is_archived").default(false),
    isViewed: boolean("is_viewed").default(false),

    // Execution Link (optional if form is a standalone template, but used by hil-service)
    stepExecutionId: integer("step_execution_id"),

    // What the row is: a reusable form definition ("template"), a request for one
    // person's input ("request"), or a stored Form Studio submission ("response").
    // Readers used to infer this from status and naming, and got it wrong both ways.
    kind: text("kind").$type<HilFormKind>().notNull().default("template"),
    // For requests: which part of the platform asked.
    requestSource: text("request_source").$type<HilRequestSource>(),
    // For requests made from a template: the template asked. The template itself is never modified.
    templateFormId: integer("template_form_id"),

    // Instance Data (used when form is an invitation/instance)
    status: text("status").default("pending"), // "pending", "completed"
    config: jsonb("config").default({}),
    data: jsonb("data"), // submitted data
    submittedBy: text("submitted_by").references(() => users.id, { onDelete: "set null" }),
    submittedAt: timestamp("submitted_at"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    // Indexes for common queries
    organizationIdIdx: index("hil_forms_org_idx").on(table.organizationId),
    orgKindIdx: index("hil_forms_org_kind_idx").on(table.organizationId, table.kind),
    createdByIdx: index("hil_forms_created_by_idx").on(table.createdBy),
    kindCheck: check("hil_forms_kind_check", sql`${table.kind} IN ('template', 'request', 'response')`),
    projectNameUnique: uniqueIndex("hil_forms_project_name_unique")
        .on(table.projectId, table.name)
        .where(sql`${table.kind} = 'template' AND ${table.isArchived} = false AND ${table.projectId} IS NOT NULL`),
}));

export const insertHilFormSchema = createInsertSchema(hilForms, {
    schema: z.record(z.any()),
    themeConfig: z.record(z.any()).optional(),
    securityConfig: z.record(z.any()).optional(),
}).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});

export type InsertHilForm = z.infer<typeof insertHilFormSchema>;
export type HilForm = typeof hilForms.$inferSelect;

export const FORM_STUDIO_REVISION_KINDS = ["revision", "release"] as const;
export type FormStudioRevisionKind = (typeof FORM_STUDIO_REVISION_KINDS)[number];

/**
 * Form Studio history and releases.
 *
 * A `revision` is one saved state of a form's draft, numbered by `seq` in edit
 * order; undo and redo move along them, and any one can be restored as a new
 * revision. A `release` is what publishing froze, numbered v1, v2…; responses
 * keep the release they started on, and `fields_projection` is its `{ fields }`
 * for renderers and built apps that predate Form Studio definitions.
 *
 * The draft itself stays on the hil_forms row, so form ids and every reader of
 * `schema.fields` are unchanged.
 */
export const formStudioRevisions = pgTable("form_studio_revisions", {
    id: serial("id").primaryKey(),
    formId: integer("form_id").notNull().references(() => hilForms.id, { onDelete: "cascade" }),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "set null" }),
    kind: text("kind").$type<FormStudioRevisionKind>().notNull(),
    // Revisions: position in the edit history. Releases: null.
    seq: integer("seq"),
    // Releases: v1, v2… Revisions: null.
    releaseNumber: integer("release_number"),
    // The form's concurrency revision when this was written.
    formRevision: integer("form_revision").notNull(),
    name: text("name").notNull(),
    schema: jsonb("schema").notNull(),
    fieldsProjection: jsonb("fields_projection"),
    themeConfig: jsonb("theme_config"),
    securityConfig: jsonb("security_config"),
    summary: text("summary").notNull().default(""),
    // Set when an undo was followed by a new edit: the undone revisions leave the
    // undo chain but stay listed, so saved work is never silently lost.
    discardedAt: timestamp("discarded_at"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    formKindIdx: index("form_studio_revisions_form_kind_idx").on(table.formId, table.kind),
    formSeqIdx: uniqueIndex("form_studio_revisions_form_seq_idx").on(table.formId, table.seq).where(sql`kind = 'revision'`),
    formReleaseIdx: uniqueIndex("form_studio_revisions_form_release_idx").on(table.formId, table.releaseNumber).where(sql`kind = 'release'`),
    kindCheck: check(
        "form_studio_revisions_kind_check",
        sql`(${table.kind} = 'revision' AND ${table.seq} IS NOT NULL AND ${table.releaseNumber} IS NULL) OR (${table.kind} = 'release' AND ${table.releaseNumber} IS NOT NULL AND ${table.seq} IS NULL)`,
    ),
}));

export type FormStudioRevision = typeof formStudioRevisions.$inferSelect;

export const otpCodes = pgTable("otp_codes", {
    id: serial("id").primaryKey(),
    executionId: text("execution_id").notNull(), // Links to the running job/execution
    email: text("email").notNull(), // The recipient
    code: text("code").notNull(), // 6-digit numeric string
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"), // Null = unused
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    // Indexes for common queries
    executionIdIdx: index("otp_codes_execution_idx").on(table.executionId),
    emailIdx: index("otp_codes_email_idx").on(table.email),
    expiresAtIdx: index("otp_codes_expires_idx").on(table.expiresAt),
}));

export const insertOtpCodeSchema = createInsertSchema(otpCodes).omit({
    id: true,
    createdAt: true,
});

export type InsertOtpCode = z.infer<typeof insertOtpCodeSchema>;
export type OtpCode = typeof otpCodes.$inferSelect;

export const approvalRequests = pgTable("approval_requests", {
    id: serial("id").primaryKey(),
    executionId: text("execution_id").notNull(), // Job Execution ID context
    jobId: integer("job_id"), // Link to job definition

    // Tool execution suspension (Proposal-based action pattern)
    toolName: text("tool_name"),
    toolArgs: jsonb("tool_args"),

    // Approver Details
    approverType: text("approver_type").notNull(), // 'internal' | 'external'
    approverId: text("approver_id").references(() => users.id, { onDelete: "set null" }), // Nullable for external
    approverEmail: text("approver_email").notNull(), // Always present (for notification and matching)

    // Status
    status: text("status").notNull().default("pending"), // 'pending' | 'approved' | 'rejected'
    decisionAt: timestamp("decision_at"),
    comments: text("comments"), // Optional reason
    modifiedOutput: jsonb("modified_output"), // Edit & Approve: The modified payload
    selectionList: jsonb("selection_list"),    // Multi-select HI: List of selected item IDs or objects


    // Organization context for filtering
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "set null" }),

    // Security
    token: text("token").notNull(), // Unique token for this specific request (for external links)

    // Mission Link (for auto-approval matching)
    // Evolution & Snooze (Phase 4 Step 5)
    isEvolutionary: boolean("is_evolutionary").default(false),
    snoozedUntil: timestamp("snoozed_until"),
    missionId: integer("mission_id").references(() => missions.id, { onDelete: "cascade" }),

    // Knowledge Graph Link (for decision pattern learning)
    knowledgeNodeId: integer("knowledge_node_id").references(() => knowledgeNodes.id, { onDelete: "set null" }),

    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    executionIdx: index("approval_requests_execution_idx").on(table.executionId),
    approverEmailIdx: index("approval_requests_email_idx").on(table.approverEmail),
    approverIdIdx: index("approval_requests_user_idx").on(table.approverId),
    tokenIdx: uniqueIndex("approval_requests_token_idx").on(table.token),
    organizationIdIdx: index("approval_requests_org_idx").on(table.organizationId),
    missionIdIdx: index("approval_requests_mission_idx").on(table.missionId),
    knowledgeNodeIdx: index("idx_approvals_knowledge").on(table.knowledgeNodeId),
    orgStatusIdx: index("idx_approval_requests_org_status").on(table.organizationId, table.status),
    orgCreatedIdx: index("idx_approval_requests_org_created").on(table.organizationId, table.createdAt.desc()),
}));

export const insertApprovalRequestSchema = createInsertSchema(approvalRequests).omit({
    id: true,
    createdAt: true,
});

export type InsertApprovalRequest = z.infer<typeof insertApprovalRequestSchema>;
export type ApprovalRequest = typeof approvalRequests.$inferSelect;



