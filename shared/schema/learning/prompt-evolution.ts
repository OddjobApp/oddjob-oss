import { pgTable, serial, text, integer, timestamp, jsonb, decimal, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { orgs } from '../auth.js';

/**
 * PROMPT EVOLUTION SYSTEM
 * 
 * Tracks system prompts and their variants, measuring effectiveness
 * to enable auto-optimization through evolutionary pressure.
 */

export const promptTypes = [
  "orchestrator-system",
  "tool-selection",
  "code-generation",
  "refactoring",
  "ui-design",
  "debugging",
  "documentation",
  "testing",
  "security-review",
] as const;

export type PromptType = (typeof promptTypes)[number];

export const promptEvolutionStatus = [
  "experimental",    // New variant being tested
  "active",          // Currently in use
  "deprecated",      // Replaced by better variant
  "retired",         // No longer used
] as const;

export type PromptEvolutionStatus = (typeof promptEvolutionStatus)[number];

/**
 * PROMPT VERSIONS
 * 
 * Each system prompt has multiple versions that compete for effectiveness.
 */

export const promptVersions = pgTable("prompt_versions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => orgs.id).notNull(),
  
  // Identification
  promptType: text("prompt_type").notNull(),
  versionId: text("version_id").notNull(), // UUID for this specific version
  parentVersionId: text("parent_version_id"), // Which version this evolved from
  
  // Content
  systemPrompt: text("system_prompt").notNull(),
  userPromptTemplate: text("user_prompt_template"), // If there's a template structure
  
  // Evolution metadata
  generationMethod: text("generation_method").notNull(), // "manual", "llm-mutated", "a-b-tested", "gradient-descent"
  mutationDescription: text("mutation_description"), // What changed from parent
  
  // Performance tracking
  status: text("status").notNull().default("experimental"),
  usageCount: integer("usage_count").default(0),
  successRate: decimal("success_rate", { precision: 5, scale: 2 }), // % successful completions
  averageTokensUsed: decimal("avg_tokens_used", { precision: 10, scale: 0 }),
  averageCostUsd: decimal("avg_cost_usd", { precision: 10, scale: 4 }),
  userSatisfactionScore: decimal("user_satisfaction_score", { precision: 5, scale: 2 }), // 0-100
  
  // Quality metrics
  taskCompletionRate: decimal("task_completion_rate", { precision: 5, scale: 2 }),
  errorRate: decimal("error_rate", { precision: 5, scale: 2 }),
  retryRate: decimal("retry_rate", { precision: 5, scale: 2 }), // How often users retry
  
  // Selection pressure
  fitnessScore: decimal("fitness_score", { precision: 5, scale: 2 }), // Combined metric for selection
  selectionProbability: decimal("selection_probability", { precision: 5, scale: 4 }), // 0-1 chance of being selected
  
  // A/B testing
  isInAbTest: boolean("is_in_ab_test").default(false),
  abTestGroup: text("ab_test_group"), // "control" or "variant"
  abTestId: integer("ab_test_id"), // References prompt_ab_tests
  
  // Metadata
  createdBy: text("created_by").notNull(), // "user", "system", "evolution-engine"
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  retiredAt: timestamp("retired_at"),
}, (table) => ({
  orgTypeVersionIdx: index("prompt_ver_org_type_version_idx").on(table.organizationId, table.promptType, table.versionId),
  statusFitnessIdx: index("prompt_ver_status_fitness_idx").on(table.status, table.fitnessScore),
  abTestIdx: index("prompt_ver_ab_test_idx").on(table.abTestId),
}));

export const insertPromptVersionSchema = createInsertSchema(promptVersions, {
  promptType: z.enum(promptTypes),
  status: z.enum(promptEvolutionStatus),
  generationMethod: z.enum(["manual", "llm-mutated", "a-b-tested", "gradient-descent"]),
  successRate: z.number().min(0).max(100).optional(),
  userSatisfactionScore: z.number().min(0).max(100).optional(),
  fitnessScore: z.number().optional(),
  selectionProbability: z.number().min(0).max(1).optional(),
}).omit({ id: true, createdAt: true, updatedAt: true, retiredAt: true });

export type PromptVersion = typeof promptVersions.$inferSelect;
export type InsertPromptVersion = typeof promptVersions.$inferInsert;

/**
 * PROMPT A/B TESTS
 * 
 * Formal experiments comparing prompt variants.
 */

export const promptAbTests = pgTable("prompt_ab_tests", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => orgs.id).notNull(),
  
  // Test configuration
  name: text("name").notNull(),
  promptType: text("prompt_type").notNull(),
  controlVersionId: text("control_version_id").notNull(),
  hypothesis: text("hypothesis"), // What we're testing
  
  // Traffic allocation
  trafficSplitPercent: decimal("traffic_split_percent", { precision: 5, scale: 2 }), // e.g., 50/50
  minSampleSize: integer("min_sample_size").default(100), // Min runs before conclusion
  
  // Results
  status: text("status").notNull().default("running"), // "running", "conclusive", "inconclusive", "stopped"
  winnerVersionId: text("winner_version_id"),
  confidenceLevel: decimal("confidence_level", { precision: 5, scale: 2 }), // Statistical confidence
  improvementPercent: decimal("improvement_percent", { precision: 5, scale: 2 }),
  
  // Analysis
  startedAt: timestamp("started_at").defaultNow().notNull(),
  endedAt: timestamp("ended_at"),
  analysisNotes: text("analysis_notes"),
}, (table) => ({
  orgStatusIdx: index("prompt_ab_org_status_idx").on(table.organizationId, table.status),
}));

export const insertPromptAbTestSchema = createInsertSchema(promptAbTests, {
  promptType: z.enum(promptTypes),
  trafficSplitPercent: z.number().min(0).max(100).optional(),
  confidenceLevel: z.number().min(0).max(100).optional(),
}).omit({ id: true, startedAt: true, endedAt: true });

export type PromptAbTest = typeof promptAbTests.$inferSelect;
export type InsertPromptAbTest = typeof promptAbTests.$inferInsert;

/**
 * PROMPT PERFORMANCE LOGS
 * 
 * Individual usage instances for detailed analysis.
 */

export const promptPerformanceLogs = pgTable("prompt_performance_logs", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => orgs.id).notNull(),
  
  // What was used
  promptVersionId: integer("prompt_version_id").notNull(),
  promptType: text("prompt_type").notNull(),
  
  // Usage context
  missionId: integer("mission_id"),
  appId: integer("app_id"),
  jobId: integer("job_id"),
  
  // Input/Output (hashed/anonymized)
  inputHash: text("input_hash"), // For deduplication/analysis without storing full content
  outputQualityScore: decimal("output_quality_score", { precision: 5, scale: 2 }), // LLM-evaluated quality
  
  // Metrics
  tokensUsed: integer("tokens_used"),
  costUsd: decimal("cost_usd", { precision: 10, scale: 4 }),
  latencyMs: integer("latency_ms"),
  
  // Outcome
  success: boolean("success").notNull(),
  errorType: text("error_type"), // If failed, what kind of error
  retryCount: integer("retry_count").default(0),
  
  // User feedback (if provided)
  userRating: integer("user_rating"), // 1-5 stars
  userFeedback: text("user_feedback"),
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  orgVersionIdx: index("prompt_perf_org_version_idx").on(table.organizationId, table.promptVersionId),
  missionIdx: index("prompt_perf_mission_idx").on(table.missionId),
  createdAtIdx: index("prompt_perf_created_at_idx").on(table.createdAt),
}));

export const insertPromptPerformanceLogSchema = createInsertSchema(promptPerformanceLogs, {
  outputQualityScore: z.number().min(0).max(100).optional(),
  userRating: z.number().min(1).max(5).optional(),
}).omit({ id: true, createdAt: true });

export type PromptPerformanceLog = typeof promptPerformanceLogs.$inferSelect;
export type InsertPromptPerformanceLog = typeof promptPerformanceLogs.$inferInsert;


