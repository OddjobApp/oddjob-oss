/**
 * Skill Integration System Schema
 *
 * Tracks the lifecycle of imported and provisioned skills, including:
 *   - Skill Review records (status, compatibility scores, AI recommendations, security reports)
 *   - Review assignments & review SLAs
 *   - Skill Augmentations on Agent Cards with durable rollback snapshots
 *   - Skill Assignments to agents or standalone jobs
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
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { orgs } from "./auth.js";
import { skills } from "./skills.js";
import { agentCards } from "./agent-cards.js";

// ============================================================================
// TYPE CONSTANTS
// ============================================================================

export const skillReviewStatuses = [
    "pending",
    "in_review",
    "approved",
    "rejected",
    "augmented",
] as const;
export type SkillReviewStatus = (typeof skillReviewStatuses)[number];

export const skillDecisionRecommendations = [
    "create_new_agent",
    "augment_existing",
    "hybrid",
    "assign_multiple",
] as const;
export type SkillDecisionRecommendation = (typeof skillDecisionRecommendations)[number];

export interface SkillScoringBreakdown {
    capabilityOverlap: number; // 0-25
    personaAlignment: number;  // 0-25
    toolCompatibility: number; // 0-25
    riskScore: number;         // 0-25
    totalScore: number;        // 0-100
    matchedCapabilities: string[];
    newCapabilities: string[];
    matchedTools: string[];
    newTools: string[];
    semanticConfidence?: number;
}

export interface SkillAgentMatch {
    agentCardId: number;
    agentName: string;
    score: number;
    breakdown: SkillScoringBreakdown;
    recommendation: SkillDecisionRecommendation;
}

// ============================================================================
// 1. SKILL REVIEWS TABLE
// ============================================================================

export const skillReviews = pgTable("skill_reviews", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
        .references(() => orgs.id, { onDelete: "cascade" })
        .notNull(),
    skillId: integer("skill_id").references(() => skills.id, { onDelete: "set null" }),
    skillName: text("skill_name").notNull(),
    skillDescription: text("skill_description"),
    sourceUrl: text("source_url"),
    sourcePlatform: text("source_platform").default("custom"),
    extractedPersona: text("extracted_persona"),
    extractedCapabilities: jsonb("extracted_capabilities")
        .$type<string[]>()
        .default(sql`'[]'::jsonb`)
        .notNull(),
    extractedTools: jsonb("extracted_tools")
        .$type<string[]>()
        .default(sql`'[]'::jsonb`)
        .notNull(),
    status: text("status")
        .$type<SkillReviewStatus>()
        .default("pending")
        .notNull(),
    decisionRecommendation: text("decision_recommendation")
        .$type<SkillDecisionRecommendation>(),
    compatibilityScore: integer("compatibility_score"),
    scoringBreakdown: jsonb("scoring_breakdown").$type<SkillScoringBreakdown>(),
    targetAgentCardId: integer("target_agent_card_id").references(() => agentCards.id, {
        onDelete: "set null",
    }),
    topMatches: jsonb("top_matches").$type<SkillAgentMatch[]>().default(sql`'[]'::jsonb`),
    securityReport: jsonb("security_report"),
    riskLevel: text("risk_level").default("medium"),
    reviewerId: text("reviewer_id"),
    reviewNotes: text("review_notes"),
    submittedBy: text("submitted_by"),
    reviewedAt: timestamp("reviewed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
    index("idx_skill_reviews_org").on(t.organizationId),
    index("idx_skill_reviews_status").on(t.organizationId, t.status),
    index("idx_skill_reviews_agent").on(t.targetAgentCardId),
]);

// ============================================================================
// 2. SKILL AUGMENTATIONS TABLE
// ============================================================================

export const skillAugmentations = pgTable("skill_augmentations", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
        .references(() => orgs.id, { onDelete: "cascade" })
        .notNull(),
    skillId: integer("skill_id").references(() => skills.id, { onDelete: "set null" }),
    agentCardId: integer("agent_card_id")
        .references(() => agentCards.id, { onDelete: "cascade" })
        .notNull(),
    reviewId: integer("review_id").references(() => skillReviews.id, {
        onDelete: "set null",
    }),
    capabilitiesAdded: jsonb("capabilities_added")
        .$type<string[]>()
        .default(sql`'[]'::jsonb`)
        .notNull(),
    toolsAdded: jsonb("tools_added")
        .$type<string[]>()
        .default(sql`'[]'::jsonb`)
        .notNull(),
    topicAffinitiesAdded: jsonb("topic_affinities_added")
        .$type<string[]>()
        .default(sql`'[]'::jsonb`)
        .notNull(),
    intentAffinitiesAdded: jsonb("intent_affinities_added")
        .$type<string[]>()
        .default(sql`'[]'::jsonb`)
        .notNull(),
    rollbackSnapshot: jsonb("rollback_snapshot")
        .$type<Record<string, any>>()
        .notNull(),
    status: text("status").default("active").notNull(), // 'active' | 'rolled_back'
    appliedBy: text("applied_by"),
    appliedAt: timestamp("applied_at").defaultNow().notNull(),
    rolledBackBy: text("rolled_back_by"),
    rolledBackAt: timestamp("rolled_back_at"),
}, (t) => [
    index("idx_skill_aug_org_agent").on(t.organizationId, t.agentCardId),
    index("idx_skill_aug_skill").on(t.skillId),
]);

// ============================================================================
// 3. SKILL REVIEW ASSIGNMENTS TABLE
// ============================================================================

export const skillReviewAssignments = pgTable("skill_review_assignments", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
        .references(() => orgs.id, { onDelete: "cascade" })
        .notNull(),
    reviewId: integer("review_id")
        .references(() => skillReviews.id, { onDelete: "cascade" })
        .notNull(),
    reviewerId: text("reviewer_id").notNull(),
    assignedBy: text("assigned_by"),
    status: text("status").default("assigned").notNull(), // 'assigned' | 'accepted' | 'declined' | 'completed'
    dueAt: timestamp("due_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
    index("idx_skill_review_assign_org").on(t.organizationId),
    index("idx_skill_review_assign_rev").on(t.reviewId),
]);

// ============================================================================
// 4. SKILL ASSIGNMENTS TABLE
// ============================================================================

export const skillAssignments = pgTable("skill_assignments", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
        .references(() => orgs.id, { onDelete: "cascade" })
        .notNull(),
    skillId: integer("skill_id")
        .references(() => skills.id, { onDelete: "cascade" })
        .notNull(),
    targetAgentCardIds: jsonb("target_agent_card_ids")
        .$type<number[]>()
        .default(sql`'[]'::jsonb`)
        .notNull(),
    assignmentType: text("assignment_type").default("single_agent").notNull(), // 'single_agent' | 'multi_agent' | 'standalone'
    assignedBy: text("assigned_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
    index("idx_skill_assignments_org").on(t.organizationId),
    index("idx_skill_assignments_skill").on(t.skillId),
]);

// ============================================================================
// ZOD SCHEMAS & TYPES
// ============================================================================

export const insertSkillReviewSchema = createInsertSchema(skillReviews).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});
export const selectSkillReviewSchema = createSelectSchema(skillReviews);
export type SkillReview = typeof skillReviews.$inferSelect;
export type InsertSkillReview = typeof skillReviews.$inferInsert;

export const insertSkillAugmentationSchema = createInsertSchema(skillAugmentations).omit({
    id: true,
    appliedAt: true,
});
export const selectSkillAugmentationSchema = createSelectSchema(skillAugmentations);
export type SkillAugmentation = typeof skillAugmentations.$inferSelect;
export type InsertSkillAugmentation = typeof skillAugmentations.$inferInsert;

export const insertSkillReviewAssignmentSchema = createInsertSchema(skillReviewAssignments).omit({
    id: true,
    createdAt: true,
});
export const selectSkillReviewAssignmentSchema = createSelectSchema(skillReviewAssignments);
export type SkillReviewAssignment = typeof skillReviewAssignments.$inferSelect;
export type InsertSkillReviewAssignment = typeof skillReviewAssignments.$inferInsert;

export const insertSkillAssignmentSchema = createInsertSchema(skillAssignments).omit({
    id: true,
    createdAt: true,
});
export const selectSkillAssignmentSchema = createSelectSchema(skillAssignments);
export type SkillAssignment = typeof skillAssignments.$inferSelect;
export type InsertSkillAssignment = typeof skillAssignments.$inferInsert;
