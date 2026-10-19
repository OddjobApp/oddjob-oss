import { sql } from "drizzle-orm";
import {
    pgTable,
    text,
    serial,
    integer,
    timestamp,
    jsonb,
    index,
    boolean,
} from "drizzle-orm/pg-core";
import { orgs } from '../auth.js';
import { jobs } from '../jobs/table.js';
import { pipelines } from '../pipelines/pipeline-core.js';
import { missions } from '../missions/core.js';

export const agentChatContexts = pgTable("agent_chat_contexts", {
    id: serial("id").primaryKey(),
    agentId: integer("agent_id").references(() => jobs.id).notNull(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    contextData: jsonb("context_data").notNull(), // Stores context like mode, page, audience, etc.
    isTemplate: boolean("is_template").default(false),
    usageCount: integer("usage_count").default(0),
    organizationId: integer("organization_id").references(() => orgs.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    lastUsedAt: timestamp("last_used_at"),
}, (table) => ({
    agentIdIdx: index("agent_chat_contexts_agent_idx").on(table.agentId),
    userIdIdx: index("agent_chat_contexts_user_idx").on(table.userId),
    isTemplateIdx: index("agent_chat_contexts_template_idx").on(table.isTemplate),
}));

export const agentChatThreads = pgTable("agent_chat_threads", {
    id: serial("id").primaryKey(),
    agentId: integer("agent_id").references(() => jobs.id).notNull(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    status: text("status", { enum: ['active', 'archived', 'deleted'] }).default('active'),
    messageCount: integer("message_count").default(0),
    lastMessageAt: timestamp("last_message_at"),
    organizationId: integer("organization_id").references(() => orgs.id),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    archivedAt: timestamp("archived_at"),
}, (table) => ({
    agentIdIdx: index("agent_chat_threads_agent_idx").on(table.agentId),
    userIdIdx: index("agent_chat_threads_user_idx").on(table.userId),
    statusIdx: index("agent_chat_threads_status_idx").on(table.status),
}));

export const agentChatMessages = pgTable("agent_chat_messages", {
    id: serial("id").primaryKey(),
    threadId: integer("thread_id").references(() => agentChatThreads.id, { onDelete: "cascade" }),
    jobId: integer("job_id").references(() => jobs.id),
    userId: text("user_id").notNull(),
    sessionId: text("session_id"),
    role: text("role", { enum: ['user', 'agent'] }).notNull(),
    content: text("content").notNull(),
    rating: integer("rating").default(0),
    feedback: text("feedback"),
    feedbackReason: text("feedback_reason"),
    effectivenessScore: integer("effectiveness_score").default(0),
    // JSON-encoded embedding array. The retrieval path parses this value and
    // scores it in application code; the supported PostgreSQL images do not
    // bundle the optional pgvector extension.
    embedding: text("embedding"),
    missionId: integer("mission_id").references(() => missions.id, { onDelete: "set null" }),
    organizationId: integer("organization_id").references(() => orgs.id),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    threadIdIdx: index("agent_chat_messages_thread_idx").on(table.threadId),
    sessionIdIdx: index("agent_chat_messages_session_idx").on(table.sessionId),
    sessionCreatedIdx: index("idx_chat_messages_session_created").on(table.sessionId, table.createdAt),
    userRoleCreatedIdx: index("idx_chat_messages_user_role_created").on(table.userId, table.role, table.createdAt),
    jobIdIdx: index("agent_chat_messages_job_idx").on(table.jobId),
    missionIdIdx: index("agent_chat_messages_mission_idx").on(table.missionId),
}));

export const agentToolHints = pgTable("agent_tool_hints", {
    id: serial("id").primaryKey(),
    jobId: integer("job_id").references(() => jobs.id).notNull(),
    pipelineId: integer("pipeline_id").references(() => pipelines.id, { onDelete: "cascade" }),
    toolName: text("tool_name"),
    promptPattern: text("prompt_pattern").notNull(),
    hintText: text("hint_text").notNull(),
    sourceMessageId: integer("source_message_id"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const agentRunSteps = pgTable("agent_run_steps", {
    id: serial("id").primaryKey(),
    runId: text("run_id").notNull(),
    jobId: integer("job_id").references(() => jobs.id),
    organizationId: integer("organization_id").references(() => orgs.id),
    userId: text("user_id"), // Link to the user/session that triggered the run
    type: text("type").notNull(), // 'thought', 'action', 'observation', 'user', 'final_result'
    content: text("content").notNull(),
    toolName: text("tool_name"),
    toolArgs: jsonb("tool_args"),
    missionId: integer("mission_id").references(() => missions.id, { onDelete: "set null" }),
    missionRunId: integer("mission_run_id"),
    confidence: integer("confidence"), // 0-100 per-step confidence (AI_AGENT_ENHANCEMENTS_SPEC)
    
    // Autopilot fields
    stepIndex: integer("step_index"),
    action: text("action"),
    selector: text("selector"),
    value: text("value"),
    optional: boolean("optional").default(false),
    metadata: jsonb("metadata").default({}),
    
    createdAt: timestamp("created_at").defaultNow(),
});

export const optimizationSuggestions = pgTable("optimization_suggestions", {
    id: serial("id").primaryKey(),
    jobId: integer("job_id").references(() => jobs.id),
    runId: text("run_id").notNull(),
    type: text("type", { enum: ['tool_suggestion', 'prompt_improvement', 'test_case', 'user_correction'] }).notNull(),
    content: text("content").notNull(),
    reasoning: text("reasoning"),
    status: text("status").default('pending'),
    createdAt: timestamp("created_at").defaultNow(),
});

export const agentResponseTemplates = pgTable("agent_response_templates", {
    id: serial("id").primaryKey(),
    jobId: integer("job_id").references(() => jobs.id),
    name: text("name").notNull(),
    scenario: text("scenario"),
    userQuery: text("user_query").notNull(),
    preferredResponse: text("preferred_response").notNull(),
    reasoning: text("reasoning"),
    effectivenessScore: integer("effectiveness_score").default(0),
    metadata: jsonb("metadata").default({}),
    organizationId: integer("organization_id").references(() => orgs.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AgentResponseTemplate = typeof agentResponseTemplates.$inferSelect;
export type InsertAgentResponseTemplate = typeof agentResponseTemplates.$inferInsert;

export type InsertOptimizationSuggestion = typeof optimizationSuggestions.$inferInsert;

export const referenceTest = pgTable("reference_test", {
    id: serial("id").primaryKey(),
    jobId: integer("job_id").references(() => jobs.id),
});



