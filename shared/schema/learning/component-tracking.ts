import { pgTable, serial, text, integer, timestamp, jsonb, decimal, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { orgs } from '../auth.js';

/**
 * COMPONENT USAGE TRACKING
 * 
 * Tracks which UI components, patterns, and code structures are used
 * and their success rates across different contexts.
 */

export const componentCategories = [
  "ui-layout",      // Card, Tabs, Sheet, Accordion, etc.
  "ui-data-viz",    // Chart, Table, Progress, Stat, etc.
  "ui-interactive", // Dialog, Popover, Command, Drawer, etc.
  "ui-inputs",      // Button, Input, Select, Checkbox, etc.
  "ui-feedback",    // Toast, Alert, Skeleton, Badge, etc.
  "ui-ai-workflow", // CopilotKit, FormRenderer, MarkdownEditor, etc.
  "pattern-fetch",  // Data fetching patterns (SWR, useEffect, etc.)
  "pattern-state",  // State management patterns
  "pattern-form",   // Form handling patterns
  "pattern-auth",   // Authentication patterns
] as const;

export type ComponentCategory = (typeof componentCategories)[number];

export const componentUsageRecords = pgTable("component_usage_records", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => orgs.id).notNull(),
  
  // Component identification
  componentName: text("component_name").notNull(),
  componentCategory: text("component_category").notNull(),
  componentVariant: text("component_variant"), // e.g., "default", "outline", "destructive"
  
  // Usage context
  appId: integer("app_id"),           // If used in a forged app
  missionId: integer("mission_id"),   // If used in a mission
  pipelineId: integer("pipeline_id"), // If used in a pipeline
  
  // Success metrics
  usedInFile: text("used_in_file").notNull(),
  deploymentSuccess: boolean("deployment_success").default(false),
  runtimeErrors: integer("runtime_errors").default(0),
  userEngagementScore: decimal("user_engagement_score", { precision: 5, scale: 2 }), // 0-100
  
  // Context for learning
  usedWithComponents: jsonb("used_with_components").default([]), // Array of component names used together
  propsUsed: jsonb("props_used").default({}), // Which props were configured
  complexityScore: decimal("complexity_score", { precision: 5, scale: 2 }), // Lines of code, prop count, etc.
  
  // LLM-generated insights
  effectivenessRating: decimal("effectiveness_rating", { precision: 3, scale: 2 }), // 0-5 stars
  suggestedImprovements: jsonb("suggested_improvements").default([]),
  
  // Metadata
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  orgComponentIdx: index("comp_usage_org_component_idx").on(table.organizationId, table.componentName),
  categoryIdx: index("comp_usage_category_idx").on(table.componentCategory),
  appIdx: index("comp_usage_app_idx").on(table.appId),
  missionIdx: index("comp_usage_mission_idx").on(table.missionId),
}));

export const insertComponentUsageSchema = createInsertSchema(componentUsageRecords, {
  componentCategory: z.enum(componentCategories),
  userEngagementScore: z.number().min(0).max(100).optional(),
  effectivenessRating: z.number().min(0).max(5).optional(),
}).omit({ id: true, createdAt: true, updatedAt: true });

export type ComponentUsageRecord = typeof componentUsageRecords.$inferSelect;
export type InsertComponentUsage = typeof componentUsageRecords.$inferInsert;

/**
 * COMPONENT EFFECTIVENESS AGGREGATES
 * 
 * Pre-computed statistics for fast querying of "what works best"
 */

export const componentEffectivenessAggregates = pgTable("component_effectiveness_aggregates", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => orgs.id).notNull(),
  
  componentName: text("component_name").notNull(),
  componentCategory: text("component_category").notNull(),
  
  // Aggregate stats
  totalUsages: integer("total_usages").default(0),
  successfulDeployments: integer("successful_deployments").default(0),
  failedDeployments: integer("failed_deployments").default(0),
  averageEngagementScore: decimal("avg_engagement_score", { precision: 5, scale: 2 }),
  averageEffectivenessRating: decimal("avg_effectiveness_rating", { precision: 3, scale: 2 }),
  
  // Context analysis
  mostCommonProps: jsonb("most_common_props").default({}),
  bestPerformingVariant: text("best_performing_variant"),
  commonPairings: jsonb("common_pairings").default([]), // Components often used together
  
  // Trending
  usageTrend7d: decimal("usage_trend_7d", { precision: 5, scale: 2 }), // % change
  usageTrend30d: decimal("usage_trend_30d", { precision: 5, scale: 2 }),
  
  // When was this aggregate last refreshed
  lastCalculatedAt: timestamp("last_calculated_at").defaultNow().notNull(),
}, (table) => ({
  orgComponentUniqueIdx: index("comp_eff_org_component_unique_idx").on(table.organizationId, table.componentName),
  categoryScoreIdx: index("comp_eff_category_score_idx").on(table.componentCategory, table.averageEffectivenessRating),
}));

export const insertComponentEffectivenessSchema = createInsertSchema(componentEffectivenessAggregates, {
  componentCategory: z.enum(componentCategories),
  usageTrend7d: z.number().optional(),
  usageTrend30d: z.number().optional(),
}).omit({ id: true, lastCalculatedAt: true });

export type ComponentEffectivenessAggregate = typeof componentEffectivenessAggregates.$inferSelect;
export type InsertComponentEffectiveness = typeof componentEffectivenessAggregates.$inferInsert;


