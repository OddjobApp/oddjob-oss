import { pgTable, serial, text, integer, timestamp, jsonb, decimal, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { orgs } from '../auth.js';

/**
 * ORGANIZATION LEARNING PROFILES
 * 
 * Per-organization adaptation and personalization of the AI system.
 */

export const orgLearningProfiles = pgTable("org_learning_profiles", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" })
    .unique(),
  
  // Organization characteristics (auto-detected)
  orgType: text("org_type"), // "startup", "enterprise", "agency", "individual"
  teamSize: integer("team_size"),
  primaryUseCases: jsonb("primary_use_cases").default([]), // ["app-building", "data-pipelines", "automation"]
  
  // Technical preferences
  preferredUiLibrary: text("preferred_ui_library").default("domain-ui"), // "domain-ui", "shadcn", "mui", "custom"
  preferredFramework: text("preferred_framework").default("nextjs"),
  preferredStyling: text("preferred_styling").default("tailwind"), // "tailwind", "css-modules", "styled-components"
  preferredDataFetching: text("preferred_data_fetching").default("swr"), // "swr", "react-query", "useEffect"
  
  // Communication style (learned from interactions)
  communicationStyle: text("communication_style").default("balanced"), // "concise", "detailed", "technical", "business"
  preferredExplanationDepth: text("preferred_explanation_depth").default("moderate"), // "minimal", "moderate", "comprehensive"
  
  // Success patterns (what works for this org)
  topPerformingComponents: jsonb("top_performing_components").default([]),
  mostUsedTools: jsonb("most_used_tools").default([]),
  successfulPatterns: jsonb("successful_patterns").default([]), // Code patterns that work well
  
  // Failure patterns (what to avoid)
  recurringIssues: jsonb("recurring_issues").default([]),
  avoidedPatterns: jsonb("avoided_patterns").default([]),
  
  // Performance baselines
  avgMissionCostUsd: decimal("avg_mission_cost_usd", { precision: 10, scale: 4 }),
  avgMissionDurationMs: integer("avg_mission_duration_ms"),
  avgCodeQualityScore: decimal("avg_code_quality_score", { precision: 5, scale: 2 }),
  
  // Learning settings
  learningEnabled: boolean("learning_enabled").default(true),
  autoApplyLearnings: boolean("auto_apply_learnings").default(false), // Auto-update prompts without approval
  allowCrossOrgLearning: boolean("allow_cross_org_learning").default(false), // Learn from anonymized other orgs
  
  // Active experiments for this org
  activeExperiments: jsonb("active_experiments").default([]),
  
  // System prompt customizations
  customSystemPromptAdditions: text("custom_system_prompt_additions"), // Extra context for all prompts
  
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  lastAnalyzedAt: timestamp("last_analyzed_at"), // When profile was last recalculated
}, (table) => ({
  orgUniqueIdx: index("org_profile_org_unique_idx").on(table.organizationId),
  learningEnabledIdx: index("org_profile_learning_idx").on(table.learningEnabled),
}));

export const insertOrgLearningProfileSchema = createInsertSchema(orgLearningProfiles, {
  orgType: z.enum(["startup", "enterprise", "agency", "individual"]).optional(),
  communicationStyle: z.enum(["concise", "detailed", "technical", "business", "balanced"]).optional(),
  preferredExplanationDepth: z.enum(["minimal", "moderate", "comprehensive"]).optional(),
  avgCodeQualityScore: z.number().min(0).max(100).optional(),
}).omit({ id: true, updatedAt: true, lastAnalyzedAt: true });

export type OrgLearningProfile = typeof orgLearningProfiles.$inferSelect;
export type InsertOrgLearningProfile = typeof orgLearningProfiles.$inferInsert;

/**
 * ORGANIZATION PREFERENCE LEARNING LOGS
 * 
 * Explicit and implicit feedback used to build the profile.
 */

export const orgPreferenceEvents = pgTable("org_preference_events", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => orgs.id).notNull(),
  
  // Event type
  eventType: text("event_type").notNull(), // "explicit_feedback", "implicit_accept", "implicit_reject", "pattern_detected"
  
  // Context
  missionId: integer("mission_id"),
  appId: integer("app_id"),
  userId: text("user_id"), // Who provided the feedback (null for implicit)
  
  // What was learned
  category: text("category").notNull(), // "component", "pattern", "communication", "tool"
  subject: text("subject").notNull(), // e.g., "Button", "detailed_explanations", "github_list_prs"
  value: text("value"), // The preference value
  confidence: decimal("confidence", { precision: 3, scale: 2 }).default("0.5"), // 0-1, how confident we are
  
  // Evidence
  evidenceCount: integer("evidence_count").default(1), // How many data points support this
  evidenceExamples: jsonb("evidence_examples").default([]), // Specific instances
  
  // Override
  isUserOverride: boolean("is_user_override").default(false), // User explicitly set this
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  orgCategoryIdx: index("org_pref_event_org_cat_idx").on(table.organizationId, table.category),
  eventTypeIdx: index("org_pref_event_type_idx").on(table.eventType),
  createdAtIdx: index("org_pref_event_created_idx").on(table.createdAt),
}));

export const insertOrgPreferenceEventSchema = createInsertSchema(orgPreferenceEvents, {
  eventType: z.enum(["explicit_feedback", "implicit_accept", "implicit_reject", "pattern_detected"]),
  category: z.enum(["component", "pattern", "communication", "tool"]),
  confidence: z.number().min(0).max(1).optional(),
}).omit({ id: true, createdAt: true });

export type OrgPreferenceEvent = typeof orgPreferenceEvents.$inferSelect;
export type InsertOrgPreferenceEvent = typeof orgPreferenceEvents.$inferInsert;

/**
 * CROSS-ORGANIZATION INSIGHTS (Anonymized)
 * 
 * Patterns learned across organizations for benchmarking and recommendations.
 */

export const crossOrgInsights = pgTable("cross_org_insights", {
  id: serial("id").primaryKey(),
  
  // Pattern description
  patternType: text("pattern_type").notNull(), // "component", "tool", "strategy", "pitfall"
  patternName: text("pattern_name").notNull(),
  description: text("description").notNull(),
  
  // Statistics (anonymized)
  orgCount: integer("org_count").notNull(), // How many orgs contributed
  totalOccurrences: integer("total_occurrences").notNull(),
  successRate: decimal("success_rate", { precision: 5, scale: 2 }), // % successful
  
  // Context
  applicableToOrgTypes: jsonb("applicable_to_org_types").default([]),
  applicableToUseCases: jsonb("applicable_to_use_cases").default([]),
  
  // Recommendation
  recommendationStrength: decimal("recommendation_strength", { precision: 3, scale: 2 }), // 0-1
  recommendedAlternative: text("recommended_alternative"), // If this is a pitfall, what's better
  
  // Status
  isVerified: boolean("is_verified").default(false), // Manually verified by Oddjob team
  isActive: boolean("is_active").default(true),
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  patternTypeIdx: index("cross_org_pattern_type_idx").on(table.patternType),
  strengthIdx: index("cross_org_strength_idx").on(table.recommendationStrength),
}));

export const insertCrossOrgInsightSchema = createInsertSchema(crossOrgInsights, {
  patternType: z.enum(["component", "tool", "strategy", "pitfall"]),
  successRate: z.number().min(0).max(100).optional(),
  recommendationStrength: z.number().min(0).max(1).optional(),
}).omit({ id: true, createdAt: true, updatedAt: true });

export type CrossOrgInsight = typeof crossOrgInsights.$inferSelect;
export type InsertCrossOrgInsight = typeof crossOrgInsights.$inferInsert;


