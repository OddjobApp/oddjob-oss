
import { pgTable, serial, text, integer, real, boolean, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { relations, sql } from "drizzle-orm";

// Action Configuration Type
export type TriggeredAction = {
    type: 'toast' | 'tooltip' | 'highlight' | 'confetti' | 'navigate' | 'concierge_prompt' | 'prefill' | 'modal';
    config: Record<string, any>;
};

// 6-Level Hierarchical Scoring Rules
export const scoringRules = pgTable('scoring_rules', {
    id: serial('id').primaryKey(), // Keeping legacy tables as is
    name: text('name').notNull(),
    description: text('description'),

    // Rule Type Discriminator
    ruleType: text('rule_type').default('ui_interaction').notNull(), // 'ui_interaction' | 'agent_evaluation' | 'prospecting'

    // Agent Evaluation Configuration
    evaluationConfig: jsonb('evaluation_config').$type<{
        method: 'regex' | 'keyword' | 'llm_judge';
        criteria: string;
        model?: string;
    }>(),

    // Hierarchy Levels (Specific -> General)
    page: text('page'),             // Level 1: Page ID (e.g., 'job_config')
    pageState: text('page_state'),  // Level 2: Page State (e.g., 'editing', 'viewing')
    card: text('card'),             // Level 3: Card/Component ID
    elementType: text('element_type'), // Level 4: Element Type (button, input)
    elementId: text('element_id'),  // Level 5: Specific HTML ID

    // Trigger
    activity: text('activity').notNull(), // Level 6: User Action (click, hover, error)

    // Outcome
    vector: text('vector').notNull(), // S/C/O/R/E
    weight: real('weight').default(1.0).notNull(),
    activityModifier: real('activity_modifier').default(1.0), // Multiplier for specific actions
    sortOrder: integer('sort_order'),

    // Meta
    priority: text('priority').default('medium'),
    enabled: boolean('enabled').default(true),
    triggeredAction: jsonb('triggered_action').$type<TriggeredAction>(), // Linked action
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
    createdBy: integer('created_by'),
});

// Score Thresholds
export const scoreThresholds = pgTable('score_thresholds', {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),

    // Condition
    vector: text('vector').notNull(), // S/C/O/R/E
    operator: text('operator').notNull(), // '>', '>=', '<', '<='
    thresholdValue: real('threshold_value').notNull(),

    // Meta
    cooldownMs: integer('cooldown_ms').default(60000), // Prevent spamming
    enabled: boolean('enabled').default(true),
    triggeredAction: jsonb('triggered_action').$type<TriggeredAction>(), // Linked action
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
    createdBy: integer('created_by'),
});

// Analytics & Events Log
export const scoringEvents = pgTable('scoring_events', {
    id: serial('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    eventType: text('event_type').notNull(), // 'rule_match', 'threshold_trigger'
    ruleId: integer('rule_id').references(() => scoringRules.id),
    thresholdId: integer('threshold_id').references(() => scoreThresholds.id),
    prospectId: integer('prospect_id'), // Linked to prospect_profiles.id
    actionType: text('action_type').notNull(), // 'toast', 'highlight', etc.
    actionConfig: jsonb('action_config'),
    vectorState: jsonb('vector_state'), // Snapshot of S/C/O/R/E
    confidence: real('confidence'),
    location: text('location'),
    // Mission/Agent attribution (no FK for now — populated from execution context)
    missionRunId: integer('mission_run_id'),
    agentDeploymentId: integer('agent_deployment_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
    index("idx_scoring_run").on(table.missionRunId),
    index("idx_scoring_agent").on(table.agentDeploymentId),
    // The decayed S.C.O.R.E. vector is rebuilt from this table on every scored
    // event, filtering by prospect and a recent time window. Without this the
    // rebuild is a sequential scan on the ingest hot path (worker concurrency 20).
    index("idx_scoring_prospect_time").on(table.prospectId, table.createdAt),
]);

// Relations
export const scoringEventsRelations = relations(scoringEvents, ({ one }) => ({
    rule: one(scoringRules, {
        fields: [scoringEvents.ruleId],
        references: [scoringRules.id],
    }),
    threshold: one(scoreThresholds, {
        fields: [scoringEvents.thresholdId],
        references: [scoreThresholds.id],
    }),
}));

// Interventions Registry
export const scoringInterventions = pgTable('scoring_interventions', {
    id: serial('id').primaryKey(),
    title: text('title').notNull(),
    conditionState: text('condition_state').notNull(), // e.g. 'S', 'C', or combined like 'S+C'
    conditionConfidenceThreshold: real('condition_confidence_threshold').notNull(),
    effectType: text('effect_type').notNull(), // 'popup', 'highlight', 'guide_prompt'
    effectTargetSelector: text('effect_target_selector'),
    userMessageTemplate: text('user_message_template'),
    aiPromptTemplate: text('ai_prompt_template'),
    enabled: boolean('enabled').default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Zod Schemas
export const insertScoringRuleSchema = createInsertSchema(scoringRules);
export const selectScoringRuleSchema = createSelectSchema(scoringRules);
export const insertScoreThresholdSchema = createInsertSchema(scoreThresholds);
export const selectScoreThresholdSchema = createSelectSchema(scoreThresholds);
export const insertInterventionSchema = createInsertSchema(scoringInterventions);
export const selectInterventionSchema = createSelectSchema(scoringInterventions);
export const insertScoringEventSchema = createInsertSchema(scoringEvents);

export type ScoringRule = z.infer<typeof selectScoringRuleSchema>;
export type NewScoringRule = z.infer<typeof insertScoringRuleSchema>;
export type ScoreThreshold = z.infer<typeof selectScoreThresholdSchema>;
export type NewScoreThreshold = z.infer<typeof insertScoreThresholdSchema>;

export type ScoringIntervention = z.infer<typeof selectInterventionSchema>;
export type NewScoringIntervention = z.infer<typeof insertInterventionSchema>;
// Scoring Rule Templates
export const scoringRuleTemplates = pgTable('scoring_rule_templates', {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    name: text('name').notNull(),
    description: text('description'),
    icon: text('icon'), // Lucide icon name
    config: jsonb('config').notNull(), // Stores the rule config partial
    isSystem: boolean('is_system').default(false), // Protected templates
    createdAt: timestamp('created_at').defaultNow().notNull(),
    createdBy: integer('created_by'),
});

export const insertScoringRuleTemplateSchema = createInsertSchema(scoringRuleTemplates);
export const selectScoringRuleTemplateSchema = createSelectSchema(scoringRuleTemplates);

export type ScoringRuleTemplate = z.infer<typeof selectScoringRuleTemplateSchema>;
export type NewScoringRuleTemplate = z.infer<typeof insertScoringRuleTemplateSchema>;

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Intervention Agent â€” learning tables
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * One record per intervention shown to a user.
 * The agent reads the last N records as in-context few-shot examples when
 * deciding whether to fire a new intervention.
 */
export const interventionMemory = pgTable('intervention_memory', {
    id: serial('id').primaryKey(),
    interventionId: text('intervention_id').notNull(),
    thresholdId: integer('threshold_id').references(() => scoreThresholds.id),
    sessionId: text('session_id').notNull(),
    vector: text('vector').notNull(),
    /** Full SCORE snapshot at the time of the intervention */
    vectorState: jsonb('vector_state'),
    /** Route / page the user was on */
    location: text('location'),
    /** What the agent decided: 'fire' | 'suppress' */
    agentDecision: text('agent_decision'),
    /** Agent confidence for the decision (0-1) */
    agentConfidence: real('agent_confidence'),
    /** Which policy rules were cited by the agent */
    policiesCited: jsonb('policies_cited').$type<string[]>(),
    /** What the user did: 'accepted' | 'dismissed' | 'expired' | 'ignored' */
    outcome: text('outcome'),
    /** How long until the user acted (ms) */
    timeToActionMs: integer('time_to_action_ms'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    resolvedAt: timestamp('resolved_at'),
});

/**
 * Plain-English rules the agent writes for itself, distilled every 50 outcomes.
 * Applied as a policy prefix in the evaluate() prompt.
 */
export const interventionPolicies = pgTable('intervention_policies', {
    id: serial('id').primaryKey(),
    /** Human-readable rule, e.g. "Don't fire S-vector on pipeline pages before 3 min" */
    rule: text('rule').notNull(),
    /** Which SCORE vectors this rule applies to â€” null means all */
    vectors: jsonb('vectors').$type<string[]>(),
    /** How strongly to apply (0-1); 1 = always enforce */
    weight: real('weight').default(1.0).notNull(),
    /** Distillation batch that produced this rule */
    distillationRound: integer('distillation_round').notNull(),
    enabled: boolean('enabled').default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
});

/**
 * Agent suggestions for changes to scoreThresholds / scoring rules.
 * Surface in the admin UI for human approval before taking effect.
 */
export const interventionPolicySuggestions = pgTable('intervention_policy_suggestions', {
    id: serial('id').primaryKey(),
    /** 'threshold_adjust' | 'rule_disable' | 'cooldown_extend' | 'new_policy' */
    suggestionType: text('suggestion_type').notNull(),
    /** Prose explanation of why the agent is making this suggestion */
    rationale: text('rationale').notNull(),
    /** The proposed change as a JSON diff / patch */
    proposedChange: jsonb('proposed_change').notNull(),
    /** thresholdId or ruleId the suggestion targets (if applicable) */
    targetId: integer('target_id'),
    targetTable: text('target_table'), // 'score_thresholds' | 'scoring_rules'
    distillationRound: integer('distillation_round').notNull(),
    /** 'pending' | 'approved' | 'rejected' */
    status: text('status').default('pending').notNull(),
    /**
     * users.id is a text UUID, so this must be text. It was `integer`, which made
     * every approve/reject 500 with "invalid input syntax for type integer" — the
     * write site cast through `as any`, so the type checker never saw the mismatch.
     */
    reviewedBy: text('reviewed_by'),
    reviewedAt: timestamp('reviewed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const insertInterventionMemorySchema = createInsertSchema(interventionMemory);
export const selectInterventionMemorySchema = createSelectSchema(interventionMemory);
export const insertInterventionPolicySchema = createInsertSchema(interventionPolicies);
export const selectInterventionPolicySchema = createSelectSchema(interventionPolicies);
export const insertInterventionPolicySuggestionSchema = createInsertSchema(interventionPolicySuggestions);
export const selectInterventionPolicySuggestionSchema = createSelectSchema(interventionPolicySuggestions);

export type InterventionMemory = z.infer<typeof selectInterventionMemorySchema>;
export type NewInterventionMemory = z.infer<typeof insertInterventionMemorySchema>;
export type InterventionPolicy = z.infer<typeof selectInterventionPolicySchema>;
export type NewInterventionPolicy = z.infer<typeof insertInterventionPolicySchema>;
export type InterventionPolicySuggestion = z.infer<typeof selectInterventionPolicySuggestionSchema>;
export type NewInterventionPolicySuggestion = z.infer<typeof insertInterventionPolicySuggestionSchema>;


