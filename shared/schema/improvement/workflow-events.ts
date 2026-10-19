import { index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { orgs } from "../auth.js";

/** What happened to a case at a step. */
export type WorkflowEventType =
    | "entered"
    | "started"
    | "completed"
    | "handed_off"
    | "reopened"
    | "approved"
    | "rejected"
    | "cancelled";

/**
 * Where the event came from.
 *
 * `attestation` is kept distinct from every machine source because §8.6
 * requires human-entered records to stay distinguishable from observed ones —
 * a person's recollection of how long a step took is evidence of a different
 * kind from a timestamp, and a report that blends them is not reproducible.
 */
export type WorkflowEventSource = "oddjob" | "connector" | "upload" | "attestation";

export type WorkflowActorType = "user" | "agent" | "system";

/**
 * The canonical workflow event (§8.2).
 *
 * Oddjob analyses only what it is explicitly given: its own missions and
 * pipelines, records from configured connectors, uploaded files with a declared
 * column mapping, and labelled human attestations. It does not observe
 * desktops, inboxes or meetings, and nothing here can represent one.
 *
 * `actorIdHash` rather than an actor id: §14 defaults workflow analysis to
 * hashed identifiers, because aggregate timing analysis rarely needs to name a
 * person and naming one turns an operations report into personnel analytics.
 */
export const workflowEvents = pgTable(
    "workflow_events",
    {
        id: serial("id").primaryKey(),
        organizationId: integer("organization_id")
            .notNull()
            .references(() => orgs.id, { onDelete: "cascade" }),
        projectId: integer("project_id"),
        /** Stable identifier for the workflow being measured. */
        workflowKey: text("workflow_key").notNull(),
        /** The unit of work travelling through the workflow. */
        caseId: text("case_id").notNull(),
        /** Source-supplied event identifier, used for idempotent import. */
        eventId: text("event_id").notNull(),
        eventType: text("event_type").$type<WorkflowEventType>().notNull(),
        stepKey: text("step_key").notNull(),
        actorType: text("actor_type").$type<WorkflowActorType>(),
        actorIdHash: text("actor_id_hash"),
        occurredAt: timestamp("occurred_at").notNull(),
        sourceType: text("source_type").$type<WorkflowEventSource>().notNull(),
        /** Route, file, connector or attestation reference. */
        sourceReference: text("source_reference").notNull(),
        attributes: jsonb("attributes").$type<Record<string, unknown>>().default({}).notNull(),
        ingestedAt: timestamp("ingested_at").defaultNow().notNull(),
    },
    (table) => [
        // Re-importing the same file must not double-count a case.
        uniqueIndex("workflow_events_org_workflow_event_unique").on(
            table.organizationId,
            table.workflowKey,
            table.eventId,
        ),
        index("workflow_events_org_workflow_case_idx").on(
            table.organizationId,
            table.workflowKey,
            table.caseId,
            table.occurredAt,
        ),
        index("workflow_events_org_workflow_time_idx").on(
            table.organizationId,
            table.workflowKey,
            table.occurredAt,
        ),
    ],
);

export type WorkflowEvent = typeof workflowEvents.$inferSelect;
export type InsertWorkflowEvent = typeof workflowEvents.$inferInsert;
