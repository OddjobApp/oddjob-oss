/**
 * Agent Beliefs & Theory-of-Mind Calibration
 *
 * `agent_knowledge_graph_entries` already stores confidence-weighted claims, but
 * it answers "what have I learned". A belief is a *position an agent holds that
 * could turn out to be wrong* — it must be revisable, and it must record what
 * changed it. Conflating the two loses the revision history that makes a belief
 * meaningful rather than just a remembered fact.
 *
 * Predictions are what keep the theory-of-mind layer honest. A model asked what
 * another agent believes will always produce fluent, plausible text; the only
 * way to know whether that model is any good is to predict before observing and
 * score afterwards.
 */

import { sql } from "drizzle-orm";
import {
    pgTable,
    serial,
    integer,
    text,
    timestamp,
    jsonb,
    index,
    type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { agentCards } from "./agent-cards.js";
import { crewSessions, crewTurns } from "./crew.js";

// ============================================================================
// TYPES
// ============================================================================

export const beliefStatuses = ["held", "revised", "abandoned"] as const;
export type BeliefStatus = (typeof beliefStatuses)[number];

/** What a belief rests on — turn ids and knowledge-graph entry ids. */
export interface BeliefEvidence {
    turnIds?: number[];
    knowledgeEntryIds?: number[];
    note?: string;
}

// ============================================================================
// TABLES
// ============================================================================

export const agentBeliefs = pgTable("agent_beliefs", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull(),
    projectId: integer("project_id"),
    agentCardId: integer("agent_card_id")
        .references(() => agentCards.id, { onDelete: "cascade" })
        .notNull(),
    /** The position itself, as a single claim. */
    proposition: text("proposition").notNull(),
    confidence: integer("confidence").default(50).notNull(),
    status: text("status").$type<BeliefStatus>().default("held").notNull(),
    evidence: jsonb("evidence")
        .$type<BeliefEvidence>()
        .default(sql`'[]'::jsonb`)
        .notNull(),
    sourceSessionId: integer("source_session_id").references(() => crewSessions.id, {
        onDelete: "set null",
    }),
    sourceRound: integer("source_round"),
    /** Set when a later belief replaces this one, so the trail stays inspectable. */
    supersededBy: integer("superseded_by").references((): AnyPgColumn => agentBeliefs.id, {
        onDelete: "set null",
    }),
    revisionReason: text("revision_reason"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
    agentIdx: index("idx_agent_beliefs_agent").on(table.agentCardId, table.status),
    orgIdx: index("idx_agent_beliefs_org").on(table.organizationId),
    projectIdx: index("idx_agent_beliefs_project").on(table.projectId),
}));

export const agentBeliefPredictions = pgTable("agent_belief_predictions", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull(),
    sessionId: integer("session_id")
        .references(() => crewSessions.id, { onDelete: "cascade" })
        .notNull(),
    round: integer("round").default(0).notNull(),
    /** The agent doing the modelling. */
    predictorAgentCardId: integer("predictor_agent_card_id")
        .references(() => agentCards.id, { onDelete: "cascade" })
        .notNull(),
    /** The agent whose position is being predicted. */
    subjectAgentCardId: integer("subject_agent_card_id")
        .references(() => agentCards.id, { onDelete: "cascade" })
        .notNull(),
    predictedPosition: text("predicted_position").notNull(),
    /** The turn the subject actually produced; null until they speak. */
    observedTurnId: integer("observed_turn_id").references(() => crewTurns.id, {
        onDelete: "set null",
    }),
    /** 0-100 similarity between prediction and what was actually said. */
    accuracyScore: integer("accuracy_score"),
    scoredAt: timestamp("scored_at"),
    createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
    predictorIdx: index("idx_abp_predictor").on(table.predictorAgentCardId),
    sessionIdx: index("idx_abp_session").on(table.sessionId, table.round),
}));

// ============================================================================
// EXPORTED TYPES
// ============================================================================

export type AgentBeliefRecord = typeof agentBeliefs.$inferSelect;
export type AgentBeliefPredictionRecord = typeof agentBeliefPredictions.$inferSelect;
