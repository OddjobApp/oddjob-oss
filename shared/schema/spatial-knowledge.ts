/**
 * Spatial Concept Evidence
 *
 * The join that makes divergence queryable: one row per observation that was
 * promoted into the knowledge vocabulary, recording WHY it was promoted rather
 * than only that it was.
 *
 * `knowledge_topic_concepts` is a bare (topic, concept) primary key. It can say
 * a place has a concept, but not when, from which observation, under which
 * rule, or how strongly — so nothing can decay, nothing can be retracted, and
 * nothing is auditable. A continuously running collector against that table
 * produces a monotonically growing set of assertions that only ever accumulate.
 *
 * This table is the provenance layer underneath it. Concept strength for a
 * place becomes a time-decayed aggregate over evidence rather than a count of
 * links, and every assertion can be traced back to the primitive that caused it
 * and the rule that judged it worth keeping.
 *
 * `severity`, `confidence`, `h3Index` and the resolution are deliberately
 * stored here rather than turned into concepts. They vary per observation; as
 * concept names they would shatter the vocabulary into one term per reading.
 */

import { pgTable, serial, integer, text, real, timestamp, uuid, index, uniqueIndex } from "drizzle-orm/pg-core";
import { orgs } from "./auth.js";
import { knowledgeConcepts, knowledgeTopics } from "./knowledge-base.js";

export const spatialConceptEvidence = pgTable(
    "spatial_concept_evidence",
    {
        id: serial("id").primaryKey(),
        organizationId: integer("organization_id")
            .notNull()
            .references(() => orgs.id, { onDelete: "cascade" }),

        /**
         * Project Space scope, mirroring the concept's own. NULL means org-wide.
         * Carried here as well as on the concept because a place is org-wide
         * today while concepts are project-scoped — see the open decision in the
         * bridge spec.
         */
        projectId: integer("project_id"),

        conceptId: integer("concept_id")
            .notNull()
            .references(() => knowledgeConcepts.id, { onDelete: "cascade" }),
        topicId: integer("topic_id")
            .notNull()
            .references(() => knowledgeTopics.id, { onDelete: "cascade" }),

        /**
         * The observation that caused this. No FK: event_primitives is subject to
         * retention pruning, and losing the primitive must not delete the memory
         * that we once learned something from it.
         */
        eventPrimitiveId: uuid("event_primitive_id").notNull(),

        /** The stored region this evidence was attributed to, when there was one. */
        regionId: integer("region_id"),

        /** Which rule promoted it, and what the engine scored it at. */
        ruleId: text("rule_id"),
        maufScore: real("mauf_score"),

        /** Per-observation measurements. Never promoted to concepts. */
        severity: text("severity"),
        confidence: real("confidence"),
        h3Index: text("h3_index"),
        h3Resolution: integer("h3_resolution"),

        /** When the world was observed, not when we wrote the row. Drives decay. */
        observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (t) => ({
        /**
         * Replay safety. The promotion consumer reads from an async stream, so
         * the same primitive can legitimately arrive twice; a redelivery must
         * update the row rather than inflate the evidence behind a concept.
         */
        replayUnique: uniqueIndex("spatial_concept_evidence_concept_event_unq").on(
            t.conceptId,
            t.eventPrimitiveId,
        ),
        /** The read path: everything known about a place, within a scope. */
        scopeIdx: index("idx_spatial_concept_evidence_scope").on(
            t.organizationId,
            t.projectId,
            t.topicId,
        ),
        /** Answering "what happened in this cell" without scanning. */
        cellIdx: index("idx_spatial_concept_evidence_cell").on(t.h3Index),
        /** Decay and recency windows. */
        observedIdx: index("idx_spatial_concept_evidence_observed").on(t.observedAt),
    }),
);

export type SpatialConceptEvidence = typeof spatialConceptEvidence.$inferSelect;
export type InsertSpatialConceptEvidence = typeof spatialConceptEvidence.$inferInsert;
