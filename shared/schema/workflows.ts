import { sql } from "drizzle-orm";
import {
    pgTable,
    text,
    serial,
    integer,
    timestamp,
    jsonb,
    uuid,
    boolean,
    uniqueIndex,
    index,
} from "drizzle-orm/pg-core";
import { orgs } from "./auth.js";
import { pipelines } from "./pipelines/pipeline-core.js";
import { eventPrimitives } from "./signal-intelligence.js";
import type { WorkflowReleaseManifest } from "../workflow-release.js";

/**
 * WORKFLOW LIFECYCLE
 *
 * A workflow is the product identity a Project Space owns; the pipeline it
 * points at is the editable DRAFT. Publishing stamps an immutable RELEASE (a
 * manifest digest of pipeline + steps + jobs + triggers); a DEPLOYMENT binds
 * one release to an environment and is what the runtime actually runs.
 *
 * `draftPipelineId` is unique — one workflow per pipeline, so the junction in
 * project_resources can point at either without ambiguity.
 */

export const WORKFLOW_STATUSES = ["draft", "archived"] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

export const WORKFLOW_DEPLOYMENT_STATUSES = ["inactive", "active", "paused", "retired"] as const;
export type WorkflowDeploymentStatus = (typeof WORKFLOW_DEPLOYMENT_STATUSES)[number];

export const workflows = pgTable("workflows", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
        .references(() => orgs.id, { onDelete: "cascade" })
        .notNull(),
    title: text("title").notNull(),
    description: text("description"),
    /** The editable draft. Releases snapshot it; this column never repoints. */
    draftPipelineId: integer("draft_pipeline_id")
        .references(() => pipelines.id, { onDelete: "cascade" })
        .notNull(),
    status: text("status").notNull().default("draft"), // One of WORKFLOW_STATUSES
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    archivedAt: timestamp("archived_at"),
}, (t) => [
    uniqueIndex("workflows_draft_pipeline_unique").on(t.draftPipelineId),
    index("workflows_org_status_idx").on(t.organizationId, t.status),
]);

export const workflowReleases = pgTable("workflow_releases", {
    id: serial("id").primaryKey(),
    workflowId: integer("workflow_id")
        .references(() => workflows.id, { onDelete: "cascade" })
        .notNull(),
    releaseNumber: integer("release_number").notNull(),
    manifest: jsonb("manifest").$type<WorkflowReleaseManifest>().notNull(),
    /** sha256 of the canonical manifest; unchanged drafts publish no new row. */
    digest: text("digest").notNull(),
    validation: jsonb("validation").notNull().default(sql`'{}'::jsonb`),
    description: text("description"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
    uniqueIndex("workflow_releases_workflow_number_unique").on(t.workflowId, t.releaseNumber),
    index("workflow_releases_workflow_digest_idx").on(t.workflowId, t.digest),
]);

export const workflowDeployments = pgTable("workflow_deployments", {
    id: serial("id").primaryKey(),
    workflowId: integer("workflow_id")
        .references(() => workflows.id, { onDelete: "cascade" })
        .notNull(),
    /** Restrict on delete: a deployment is the record that a release ran. */
    releaseId: integer("release_id")
        .references(() => workflowReleases.id)
        .notNull(),
    environment: text("environment").notNull().default("production"),
    status: text("status").notNull().default("inactive"), // One of WORKFLOW_DEPLOYMENT_STATUSES
    /** Bumped on every activation so a stale executor can tell it was superseded. */
    activationGeneration: integer("activation_generation").notNull().default(0),
    bindings: jsonb("bindings").notNull().default(sql`'{}'::jsonb`),
    activatedAt: timestamp("activated_at"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
    uniqueIndex("workflow_deployments_workflow_env_unique").on(t.workflowId, t.environment),
]);

/**
 * SIGNAL → WORKFLOW BINDING
 *
 * A signal subscription mirrors a cycle signal subscription's filter shape but
 * delivers into a run of the workflow's active deployment instead of a cycle.
 * The delivery row is the dedupe: one row per (subscription, event primitive),
 * so a redelivered signal — the Kafka consumer and the in-process bridge both
 * deliver — cannot start the same run twice.
 */
export const workflowSignalSubscriptions = pgTable("workflow_signal_subscriptions", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
        .references(() => orgs.id, { onDelete: "cascade" })
        .notNull(),
    workflowId: integer("workflow_id")
        .references(() => workflows.id, { onDelete: "cascade" })
        .notNull(),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    /** SignalFilters — eventTypes/sectors/jurisdictions/entityIds/minimumConfidence/minimumSeverity. */
    filters: jsonb("filters").notNull().default(sql`'{}'::jsonb`),
    environment: text("environment").notNull().default("production"),
    cooldownMinutes: integer("cooldown_minutes").notNull().default(0),
    lastDeliveredAt: timestamp("last_delivered_at"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
    index("workflow_signal_subscriptions_org_idx").on(t.organizationId),
    index("workflow_signal_subscriptions_workflow_idx").on(t.workflowId),
]);

export const workflowSignalDeliveries = pgTable("workflow_signal_deliveries", {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: integer("organization_id").notNull(),
    subscriptionId: integer("subscription_id")
        .references(() => workflowSignalSubscriptions.id, { onDelete: "cascade" })
        .notNull(),
    workflowId: integer("workflow_id").notNull(),
    eventPrimitiveId: uuid("event_primitive_id")
        .references(() => eventPrimitives.id, { onDelete: "cascade" })
        .notNull(),
    releaseId: integer("release_id"),
    deploymentId: integer("deployment_id"),
    pipelineExecutionId: integer("pipeline_execution_id"),
    /** WORKFLOW_SIGNAL_DISPOSITIONS — what the delivery resolved to. */
    disposition: text("disposition").notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    deliveredAt: timestamp("delivered_at").defaultNow().notNull(),
}, (t) => [
    uniqueIndex("workflow_signal_deliveries_subscription_event_unique").on(t.subscriptionId, t.eventPrimitiveId),
    index("workflow_signal_deliveries_workflow_idx").on(t.workflowId, t.deliveredAt),
]);

export type WorkflowSignalSubscription = typeof workflowSignalSubscriptions.$inferSelect;
export type InsertWorkflowSignalSubscription = typeof workflowSignalSubscriptions.$inferInsert;
export type WorkflowSignalDelivery = typeof workflowSignalDeliveries.$inferSelect;
export type InsertWorkflowSignalDelivery = typeof workflowSignalDeliveries.$inferInsert;

export type Workflow = typeof workflows.$inferSelect;
export type InsertWorkflow = typeof workflows.$inferInsert;
export type WorkflowRelease = typeof workflowReleases.$inferSelect;
export type InsertWorkflowRelease = typeof workflowReleases.$inferInsert;
export type WorkflowDeployment = typeof workflowDeployments.$inferSelect;
export type InsertWorkflowDeployment = typeof workflowDeployments.$inferInsert;
