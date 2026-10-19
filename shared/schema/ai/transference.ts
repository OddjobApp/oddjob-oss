/**
 * Transference Engine Schema
 * Tracks LLM execution logs for mining and defines active/shadow replacement rules.
 */

import { pgTable, serial, integer, text, timestamp, jsonb, varchar, index } from "drizzle-orm/pg-core";

export const aiExecutionLogs = pgTable("ai_execution_logs", {
    id: serial("id").primaryKey(),
    promptHash: varchar("prompt_hash", { length: 32 }).notNull(),
    systemPrompt: text("system_prompt").notNull(),
    inputVariables: jsonb("input_variables").notNull(),
    rawOutput: text("raw_output").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    totalTokens: integer("total_tokens"),
    organizationId: integer("organization_id"),
    createdAt: timestamp("created_at").defaultNow().notNull()
}, (t) => ({
    promptHashIdx: index("ai_exec_logs_prompt_hash_idx").on(t.promptHash),
    orgIdx: index("ai_exec_logs_org_idx").on(t.organizationId),
    createdAtIdx: index("ai_exec_logs_created_at_idx").on(t.createdAt)
}));

export const transferenceRules = pgTable("transference_rules", {
    id: serial("id").primaryKey(),
    promptHash: varchar("prompt_hash", { length: 32 }).unique().notNull(),
    systemPrompt: text("system_prompt").notNull(),
    mode: varchar("mode", { length: 20 }).default("shadow").notNull(), // 'shadow' | 'active' | 'disabled'
    tier: integer("tier").notNull(), // 1 (rules/regex), 2 (classic ML), 3 (SLM)
    handlerPath: text("handler_path").notNull(),
    modelPath: text("model_path"),
    accuracyScore: integer("accuracy_score"),
    totalShadowCount: integer("total_shadow_count").default(0).notNull(),
    mismatchCount: integer("mismatch_count").default(0).notNull(),
    adapterPath: text("adapter_path"),
    finetunedAt: timestamp("finetuned_at"),
    trainingPairsCount: integer("training_pairs_count").default(0).notNull(),
    estimatedCostSavingsUsd: integer("estimated_cost_savings_usd").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
}, (t) => ({
    promptHashIdx: index("transference_rules_prompt_hash_idx").on(t.promptHash),
    modeIdx: index("transference_rules_mode_idx").on(t.mode)
}));
