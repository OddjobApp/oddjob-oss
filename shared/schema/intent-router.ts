/**
 * Intent Router Schema
 * Classification logging, Topic/Intent types, and request/result interfaces
 */

import {
  pgTable,
  serial,
  integer,
  text,
  varchar,
  real,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import type { z } from "zod";
import { llmModels } from "./ai/llm-router.js";
import { agentCards, topicCategories, intentCategories } from "./agent-cards.js";
import type { TopicCategory, IntentCategory } from "./agent-cards.js";

// Re-export for backward compatibility
export { topicCategories, intentCategories };
export type { TopicCategory, IntentCategory };

// ============================================================================
// INTENT CLASSIFICATION LOGS TABLE
// ============================================================================

export const intentClassificationLogs = pgTable(
  "intent_classification_logs",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull(),
    sessionId: text("session_id").notNull(),
    promptHash: text("prompt_hash").notNull(),
    topic: text("topic").notNull().$type<TopicCategory>(),
    topicConfidence: real("topic_confidence").notNull(),
    intent: text("intent").notNull().$type<IntentCategory>(),
    intentConfidence: real("intent_confidence").notNull(),
    combinedConfidence: real("combined_confidence").notNull(),
    selectedAgentCardId: integer("selected_agent_card_id").references(
      () => agentCards.id,
    ),
    resolvedModelId: integer("resolved_model_id").references(
      () => llmModels.id,
    ),
    latencyMs: integer("latency_ms").notNull(),
    wasCached: boolean("was_cached").default(false),
    wasOverride: boolean("was_override").default(false),
    overrideAgentCardId: integer("override_agent_card_id"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    orgSessionIdx: index("idx_icl_org_session").on(
      t.organizationId,
      t.sessionId,
    ),
    createdIdx: index("idx_icl_created").on(t.createdAt),
  }),
);

// ============================================================================
// ZOD SCHEMAS
// ============================================================================

export const insertIntentClassificationLogSchema = createInsertSchema(
  intentClassificationLogs,
).omit({
  id: true,
  createdAt: true,
});

// ============================================================================
// TYPES
// ============================================================================

export type IntentClassificationLog =
  typeof intentClassificationLogs.$inferSelect;
export type InsertIntentClassificationLog = z.infer<
  typeof insertIntentClassificationLogSchema
>;

export interface ClassificationResult {
  topic: TopicCategory;
  topicConfidence: number;
  intent: IntentCategory;
  intentConfidence: number;
  combinedConfidence: number;
  selectedAgentCardId: number;
  selectedAgentCardName: string;
  resolvedModelProviderId: number;
  resolvedModelId: number;
  latencyMs: number;
}

export interface ClassifyRequest {
  prompt: string;
  organizationId: number;
  sessionId: string;
  bypassCache?: boolean;
}

// ============================================================================
// LEARNED TOPIC KEYWORDS TABLE
// ============================================================================

/**
 * Vocabulary the keyword classifier learned from declared topic tags
 * (crew_turn_topics): when a user tags a turn #[compound interest] on a
 * Finance-classified turn, "compound interest" is reinforced as a Finance
 * keyword for this org. classifyTopic reads it as a scoring boost on top of
 * the static TOPIC_KEYWORDS — the TopicCategory enum itself never grows.
 *
 * Org-scoped: vocabulary is private to the tenant that declared it.
 */
export const learnedTopicKeywords = pgTable(
  "learned_topic_keywords",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull(),
    /** Normalized declared label ("Compound Interest"). */
    label: text("label").notNull(),
    /** The classified TopicCategory the label was observed under. */
    topic: varchar("topic", { length: 64 }).notNull(),
    /** Reinforcement count — repeated observation outweighs a one-off tag. */
    weight: integer("weight").default(1).notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    orgLabelUnique: uniqueIndex("ltk_org_label_unique").on(
      table.organizationId,
      table.label,
    ),
    orgIdx: index("idx_ltk_org").on(table.organizationId),
  }),
);

export type LearnedTopicKeywordRecord = typeof learnedTopicKeywords.$inferSelect;
