/**
 * Strategy ML Database Schema
 * 
 * Tables for storing ML model data, predictions, and performance metrics.
 */

import { pgTable, serial, varchar, integer, boolean, jsonb, timestamp, real, index } from "drizzle-orm/pg-core";

/**
 * Strategy Performance Logs
 * 
 * Historical performance data for each strategy on different task types.
 * Used to train and improve the prediction model.
 */
export const strategyPerformanceLogs = pgTable("strategy_performance_logs", {
  id: serial("id").primaryKey(),
  
  // Strategy identification
  strategy: varchar("strategy", { length: 50 }).notNull(),
  
  // Task features (extracted characteristics)
  taskFeatures: jsonb("task_features").notNull(),
  
  // Outcome metrics
  success: boolean("success").notNull(),
  qualityScore: real("quality_score").notNull(), // 0-1
  executionTimeMs: integer("execution_time_ms").notNull(),
  tokenUsage: integer("token_usage").notNull(),
  correctionCount: integer("correction_count").default(0),
  
  // Context
  agentId: varchar("agent_id", { length: 100 }).notNull(),
  organizationId: integer("organization_id").notNull(),
  
  // Metadata
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  strategyIdx: index("strategy_perf_strategy_idx").on(table.strategy),
  orgIdx: index("strategy_perf_org_idx").on(table.organizationId),
  agentIdx: index("strategy_perf_agent_idx").on(table.agentId),
  createdAtIdx: index("strategy_perf_created_idx").on(table.createdAt),
}));

/**
 * ML Strategy Predictions
 * 
 * Log of all predictions made by the ML model.
 * Used to track accuracy and improve the model over time.
 */
export const mlStrategyPredictions = pgTable("ml_strategy_predictions", {
  id: serial("id").primaryKey(),
  
  // Prediction details
  predictedStrategy: varchar("predicted_strategy", { length: 50 }).notNull(),
  confidence: real("confidence").notNull(), // 0-1
  expectedSuccessRate: real("expected_success_rate").notNull(),
  
  // Task features at prediction time
  taskFeatures: jsonb("task_features").notNull(),
  
  // Actual outcome (filled in later)
  actualStrategy: varchar("actual_strategy", { length: 50 }),
  actualSuccess: boolean("actual_success"),
  actualQuality: real("actual_quality"),
  accuracyDelta: real("accuracy_delta"), // How accurate was the prediction
  
  // Context
  agentId: varchar("agent_id", { length: 100 }).notNull(),
  organizationId: integer("organization_id").notNull(),
  
  // Metadata
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  predictedStrategyIdx: index("ml_pred_strategy_idx").on(table.predictedStrategy),
  orgIdx: index("ml_pred_org_idx").on(table.organizationId),
  agentIdx: index("ml_pred_agent_idx").on(table.agentId),
  createdAtIdx: index("ml_pred_created_idx").on(table.createdAt),
  actualSuccessIdx: index("ml_pred_success_idx").on(table.actualSuccess),
}));

/**
 * Strategy Model Versions
 * 
 * Track model versions and their performance over time.
 */
export const strategyModelVersions = pgTable("strategy_model_versions", {
  id: serial("id").primaryKey(),
  
  version: varchar("version", { length: 20 }).notNull().unique(),
  featureWeights: jsonb("feature_weights").notNull(),
  trainingRecordsCount: integer("training_records_count").notNull(),
  validationAccuracy: real("validation_accuracy").notNull(),
  
  // Performance metrics
  avgPredictionConfidence: real("avg_prediction_confidence"),
  avgActualSuccessRate: real("avg_actual_success_rate"),
  
  // Context
  organizationId: integer("organization_id").notNull(),
  trainedBy: varchar("trained_by", { length: 100 }),
  
  // Metadata
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  isActive: boolean("is_active").default(false),
}, (table) => ({
  versionIdx: index("model_version_idx").on(table.version),
  orgIdx: index("model_version_org_idx").on(table.organizationId),
  activeIdx: index("model_version_active_idx").on(table.isActive),
}));

// Type exports
export type StrategyPerformanceLog = typeof strategyPerformanceLogs.$inferSelect;
export type InsertStrategyPerformanceLog = typeof strategyPerformanceLogs.$inferInsert;
export type MLStrategyPrediction = typeof mlStrategyPredictions.$inferSelect;
export type InsertMLStrategyPrediction = typeof mlStrategyPredictions.$inferInsert;
export type StrategyModelVersion = typeof strategyModelVersions.$inferSelect;
export type InsertStrategyModelVersion = typeof strategyModelVersions.$inferInsert;


