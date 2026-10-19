/**
 * Evaluation Studio schema
 * Test sets, test cases, runs, and results for agent evaluation.
 */

import { pgTable, serial, text, integer, boolean, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { orgs } from './auth.js';
import { missions } from './missions/core.js';
import { missionRuns } from './missions/runs.js';
import type { EvaluationPromotionAssessment } from "../evaluation-promotion.js";

export const evaluationTestSets = pgTable("evaluation_test_sets", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    jobId: integer("job_id"), // Agent job to evaluate
    missionId: integer("mission_id").references(() => missions.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [index("evaluation_test_sets_mission_idx").on(t.missionId)]);

export const evaluationTestCases = pgTable("evaluation_test_cases", {
    id: serial("id").primaryKey(),
    testSetId: integer("test_set_id").notNull().references(() => evaluationTestSets.id, { onDelete: "cascade" }),
    inputPrompt: text("input_prompt").notNull(),
    expectedCriteria: text("expected_criteria").notNull(),
    method: text("method").default("llm_judge").notNull(), // regex | keyword | llm_judge
    sourceMissionRunId: integer("source_mission_run_id").references(() => missionRuns.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [index("evaluation_test_cases_source_run_idx").on(t.sourceMissionRunId)]);

export const evaluationRuns = pgTable("evaluation_runs", {
    id: serial("id").primaryKey(),
    testSetId: integer("test_set_id").notNull().references(() => evaluationTestSets.id, { onDelete: "cascade" }),
    status: text("status").default("running").notNull(), // running | completed | failed
    startedAt: timestamp("started_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
});

export const evaluationRunResults = pgTable("evaluation_run_results", {
    id: serial("id").primaryKey(),
    runId: integer("run_id").notNull().references(() => evaluationRuns.id, { onDelete: "cascade" }),
    testCaseId: integer("test_case_id").notNull().references(() => evaluationTestCases.id, { onDelete: "cascade" }),
    passed: boolean("passed").notNull(),
    agentResponse: text("agent_response"),
    messageId: integer("message_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const evaluationPromotions = pgTable("evaluation_promotions", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    testSetId: integer("test_set_id").notNull().references(() => evaluationTestSets.id, { onDelete: "cascade" }),
    candidateRunId: integer("candidate_run_id").notNull().references(() => evaluationRuns.id, { onDelete: "cascade" }),
    baselineRunId: integer("baseline_run_id").references(() => evaluationRuns.id, { onDelete: "set null" }),
    assessment: jsonb("assessment").$type<EvaluationPromotionAssessment>().notNull(),
    reason: text("reason"),
    promotedBy: text("promoted_by").notNull(),
    promotedAt: timestamp("promoted_at").defaultNow().notNull(),
}, (t) => [
    index("evaluation_promotions_org_set_idx").on(t.organizationId, t.testSetId),
    index("evaluation_promotions_candidate_idx").on(t.candidateRunId),
]);

export const insertEvaluationTestSetSchema = createInsertSchema(evaluationTestSets).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});
export const insertEvaluationTestCaseSchema = createInsertSchema(evaluationTestCases).omit({
    id: true,
    createdAt: true,
});
export const insertEvaluationRunSchema = createInsertSchema(evaluationRuns).omit({
    id: true,
    startedAt: true,
});
export const insertEvaluationRunResultSchema = createInsertSchema(evaluationRunResults).omit({
    id: true,
    createdAt: true,
});
export const insertEvaluationPromotionSchema = createInsertSchema(evaluationPromotions).omit({
    id: true,
    promotedAt: true,
});



