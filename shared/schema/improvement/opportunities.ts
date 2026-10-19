import {
    index,
    integer,
    jsonb,
    pgTable,
    serial,
    text,
    timestamp,
    uniqueIndex,
} from "drizzle-orm/pg-core";
import { orgs } from "../auth.js";

/** Which improvement workflow an opportunity belongs to. */
export type ImprovementKind = "capability_gap" | "policy_candidate" | "workflow_candidate";

/**
 * Lifecycle states. Ordering here is documentation, not permission — the legal
 * transitions and who may perform them live in the lifecycle module, because a
 * status column cannot enforce that only a human may approve.
 */
export type ImprovementStatus =
    | "observed"
    | "investigating"
    | "proposed"
    | "approved"
    | "experimenting"
    | "evaluating"
    | "promoted"
    | "revised"
    | "rejected"
    | "archived";

/** Where a factual observation came from. */
export type ImprovementObservationSource =
    | "mission_event"
    | "tool_failure"
    | "approval"
    | "workflow_event"
    | "incident"
    | "dataset_record"
    | "document"
    | "human_attestation";

/** Whether a record was created by a person, an agent, or a service. */
export type ImprovementActorType = "user" | "agent" | "service";

export const improvementOpportunities = pgTable(
    "improvement_opportunities",
    {
        id: serial("id").primaryKey(),
        organizationId: integer("organization_id")
            .notNull()
            .references(() => orgs.id, { onDelete: "cascade" }),
        projectId: integer("project_id"),
        kind: text("kind").$type<ImprovementKind>().notNull(),
        title: text("title").notNull(),
        status: text("status").$type<ImprovementStatus>().default("observed").notNull(),
        sourceWindowStart: timestamp("source_window_start"),
        sourceWindowEnd: timestamp("source_window_end"),
        createdByType: text("created_by_type").$type<ImprovementActorType>().notNull(),
        createdById: text("created_by_id").notNull(),
        /**
         * Confidence in the DESCRIPTION being accurate — not the probability the
         * improvement will succeed. Conflating those is how a well-described
         * problem becomes a promising solution.
         *
         * Integer 0-100, deliberately not `numeric`: Drizzle surfaces
         * `numeric`/`decimal` as a STRING, which has repeatedly produced silent
         * comparison bugs here, and the existing `capability_proposals.confidence`
         * is already an integer 0-100.
         */
        confidence: integer("confidence").default(0).notNull(),
        /** Explicit, reviewable assumptions. */
        assumptions: jsonb("assumptions").$type<string[]>().default([]).notNull(),
        /** Missing sources and inference limits. */
        limitations: jsonb("limitations").$type<string[]>().default([]).notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at").defaultNow().notNull(),
    },
    (table) => [
        index("improvement_opportunities_org_status_idx").on(table.organizationId, table.status),
        index("improvement_opportunities_org_kind_idx").on(table.organizationId, table.kind),
        index("improvement_opportunities_project_idx").on(table.organizationId, table.projectId),
    ],
);

/**
 * Every factual input, immutable once written.
 *
 * There is no `updatedAt` on purpose. An observation is a record that something
 * was seen; correcting it means writing a new observation, not editing history
 * under a claim that was already cited.
 */
export const improvementObservations = pgTable(
    "improvement_observations",
    {
        id: serial("id").primaryKey(),
        organizationId: integer("organization_id")
            .notNull()
            .references(() => orgs.id, { onDelete: "cascade" }),
        opportunityId: integer("opportunity_id")
            .notNull()
            .references(() => improvementOpportunities.id, { onDelete: "cascade" }),
        sourceType: text("source_type").$type<ImprovementObservationSource>().notNull(),
        /** Stable reference to the originating record. */
        sourceId: text("source_id").notNull(),
        /** When the source event happened. */
        observedAt: timestamp("observed_at").notNull(),
        /** When Oddjob recorded it. Distinct from observedAt, always. */
        ingestedAt: timestamp("ingested_at").defaultNow().notNull(),
        /** Typed, minimally transformed facts. Never a causal claim. */
        facts: jsonb("facts").$type<Record<string, unknown>>().default({}).notNull(),
        /** Deduplication and tamper evidence. */
        contentHash: text("content_hash").notNull(),
        /** Route, table, connector, file, or document reference. */
        provenance: jsonb("provenance").$type<Record<string, unknown>>().default({}).notNull(),
    },
    (table) => [
        uniqueIndex("improvement_observations_opportunity_hash_unique").on(
            table.opportunityId,
            table.contentHash,
        ),
        index("improvement_observations_org_source_idx").on(
            table.organizationId,
            table.sourceType,
            table.sourceId,
        ),
        index("improvement_observations_opportunity_idx").on(table.opportunityId),
    ],
);

export const improvementHypotheses = pgTable(
    "improvement_hypotheses",
    {
        id: serial("id").primaryKey(),
        organizationId: integer("organization_id")
            .notNull()
            .references(() => orgs.id, { onDelete: "cascade" }),
        opportunityId: integer("opportunity_id")
            .notNull()
            .references(() => improvementOpportunities.id, { onDelete: "cascade" }),
        /** A falsifiable claim. */
        statement: text("statement").notNull(),
        /** Proposed explanation — explicitly a hypothesis, never a finding. */
        mechanism: text("mechanism"),
        supportingObservationIds: jsonb("supporting_observation_ids")
            .$type<number[]>()
            .default([])
            .notNull(),
        /**
         * Evidence AGAINST. Stored with the same weight as supporting evidence
         * so a hypothesis cannot be surfaced without its counter-evidence.
         */
        contradictingObservationIds: jsonb("contradicting_observation_ids")
            .$type<number[]>()
            .default([])
            .notNull(),
        /** Competing explanations or interventions. */
        alternatives: jsonb("alternatives").$type<string[]>().default([]).notNull(),
        /** Missing facts required for confidence. */
        unknowns: jsonb("unknowns").$type<string[]>().default([]).notNull(),
        authorType: text("author_type").$type<ImprovementActorType>().notNull(),
        authorId: text("author_id").notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [
        index("improvement_hypotheses_opportunity_idx").on(table.opportunityId),
        index("improvement_hypotheses_org_idx").on(table.organizationId),
    ],
);

export type ImprovementOpportunity = typeof improvementOpportunities.$inferSelect;
export type InsertImprovementOpportunity = typeof improvementOpportunities.$inferInsert;
export type ImprovementObservation = typeof improvementObservations.$inferSelect;
export type InsertImprovementObservation = typeof improvementObservations.$inferInsert;
export type ImprovementHypothesis = typeof improvementHypotheses.$inferSelect;
export type InsertImprovementHypothesis = typeof improvementHypotheses.$inferInsert;
