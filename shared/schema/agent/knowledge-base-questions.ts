import { pgTable, serial, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { orgs } from '../auth.js';

// ============================================================================
// KNOWLEDGE BASE QUESTIONS (Human-in-the-Loop Feedback / Auditing Queue)
// ============================================================================

export const knowledgeBaseQuestions = pgTable("knowledge_base_questions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .references(() => orgs.id, { onDelete: "cascade" })
    .notNull(),
  repositoryId: text("repository_id").notNull(),
  questionText: text("question_text").notNull(),
  status: text("status").default("pending").notNull(), // pending, answered, ignored, archived
  triggerSource: text("trigger_source").notNull(), // predictive_failure, memory_contradiction, low_confidence_compaction
  contextData: jsonb("context_data").default({}).$type<{
    filePaths?: string[];
    errorCategory?: string;
    conflictingPatterns?: string[];
    missionRunId?: number;
    jobId?: number;
    [key: string]: any;
  }>().notNull(),
  proposedAnswer: text("proposed_answer"),
  answerText: text("answer_text"),
  answeredBy: text("answered_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
}, (table) => [
  index("idx_kb_questions_org_repo_status").on(table.organizationId, table.repositoryId, table.status),
]);

export const insertKnowledgeBaseQuestionSchema = createInsertSchema(knowledgeBaseQuestions);
export const selectKnowledgeBaseQuestionSchema = createSelectSchema(knowledgeBaseQuestions);

export type KnowledgeBaseQuestion = typeof knowledgeBaseQuestions.$inferSelect;
export type InsertKnowledgeBaseQuestion = typeof knowledgeBaseQuestions.$inferInsert;


