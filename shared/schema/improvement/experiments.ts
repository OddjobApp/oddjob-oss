import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { orgs } from "../auth.js";
import { improvementHypotheses, improvementOpportunities } from "./opportunities.js";

/** Which way the primary metric must move for the hypothesis to be supported. */
export type MetricDirection = "increase" | "decrease";

/** A metric that must not get worse, whatever the primary metric does. */
export interface GuardrailMetric {
    metric: string;
    /** The direction that constitutes DEGRADATION for this metric. */
    degradesWhen: MetricDirection;
    /**
     * How much degradation is tolerated before the guardrail is breached,
     * in the metric's own units. Zero means any degradation breaches.
     */
    maxDegradation: number;
}

/** The declared envelope. Nothing outside this may be spent or touched. */
export interface ExperimentBoundaries {
    maxCases: number;
    maxBudgetUsd: number;
    /** External side effects permitted, e.g. ["none"] or ["slack_post"]. */
    permittedExternalActions: string[];
    permittedTools: string[];
    permittedDatasets: string[];
}

/** Conditions that halt the experiment without waiting for a human. */
export interface StopConditions {
    /** Halt if this many execution failures occur. */
    maxExecutionFailures?: number;
    /** Halt if any guardrail breaches. */
    haltOnGuardrailBreach: boolean;
    /** Free-text conditions a human monitors; advisory, not enforced. */
    manual: string[];
}

export type ExperimentStatus =
    | "draft"
    | "pending_approval"
    | "approved"
    | "running"
    | "stopped"
    | "completed"
    | "abandoned";

/**
 * A bounded, pre-registered experiment.
 *
 * "Pre-registered" is the whole point: the success criteria, the guardrails and
 * the minimum evidence threshold are fixed BEFORE the run, so a disappointing
 * result cannot be rescued by choosing a different metric afterwards. The
 * validator enforces that every field below is present before the status may
 * leave `draft`.
 */
export const improvementExperiments = pgTable(
    "improvement_experiments",
    {
        id: serial("id").primaryKey(),
        organizationId: integer("organization_id")
            .notNull()
            .references(() => orgs.id, { onDelete: "cascade" }),
        opportunityId: integer("opportunity_id")
            .notNull()
            .references(() => improvementOpportunities.id, { onDelete: "cascade" }),
        hypothesisId: integer("hypothesis_id")
            .notNull()
            .references(() => improvementHypotheses.id, { onDelete: "cascade" }),
        status: text("status").$type<ExperimentStatus>().default("draft").notNull(),

        /** How the baseline is computed, and over what window. */
        baselineDefinition: text("baseline_definition").notNull(),
        baselineWindowStart: timestamp("baseline_window_start"),
        baselineWindowEnd: timestamp("baseline_window_end"),

        /** What is being changed, and what it is compared against. */
        intervention: text("intervention").notNull(),
        control: text("control"),
        inclusionCriteria: jsonb("inclusion_criteria").$type<string[]>().default([]).notNull(),
        exclusionCriteria: jsonb("exclusion_criteria").$type<string[]>().default([]).notNull(),

        startsAt: timestamp("starts_at"),
        endsAt: timestamp("ends_at"),

        boundaries: jsonb("boundaries").$type<ExperimentBoundaries>(),

        primaryMetric: text("primary_metric").notNull(),
        primaryMetricDirection: text("primary_metric_direction").$type<MetricDirection>().notNull(),
        /** Smallest change worth acting on, in the metric's own units. */
        minimumEffect: integer("minimum_effect").default(0).notNull(),
        /** Below this many usable intervention cases the result is inconclusive. */
        minimumSampleSize: integer("minimum_sample_size").default(0).notNull(),

        guardrails: jsonb("guardrails").$type<GuardrailMetric[]>().default([]).notNull(),
        stopConditions: jsonb("stop_conditions").$type<StopConditions>(),
        rollbackPlan: text("rollback_plan"),

        requiredApproverRole: text("required_approver_role").notNull(),
        approvedBy: text("approved_by"),
        approvedAt: timestamp("approved_at"),

        missionId: integer("mission_id"),
        shadowMissionId: integer("shadow_mission_id"),

        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at").defaultNow().notNull(),
    },
    (table) => [
        index("improvement_experiments_org_status_idx").on(table.organizationId, table.status),
        index("improvement_experiments_opportunity_idx").on(table.opportunityId),
    ],
);

/** Deterministic verdict against the pre-registered criteria. */
export type CriterionOutcome = "passed" | "failed" | "inconclusive" | "not_run";

/**
 * Why the verdict came out that way.
 *
 * The distinction that matters most: `execution_failure` and `policy_stop` mean
 * the machinery did not deliver a clean test, NOT that the hypothesis was
 * wrong. Collapsing them into "failed" is how a broken pipeline becomes a
 * discarded good idea — and how a recovered failure becomes a success.
 */
export type ResultClassification =
    | "hypothesis_supported"
    | "hypothesis_not_supported"
    | "guardrail_breach"
    | "insufficient_evidence"
    | "execution_failure"
    | "policy_stop"
    | "not_run";

export interface GuardrailOutcome {
    metric: string;
    baselineValue: number | null;
    interventionValue: number | null;
    degradation: number | null;
    maxDegradation: number;
    breached: boolean;
}

/**
 * Computed measurements, kept strictly apart from interpretation.
 *
 * The measured columns are produced by deterministic services. The model may
 * write `interpretation`, and a human writes `disposition`. Neither may alter
 * the numbers, and the verdict column is computed, never authored.
 */
export const improvementResults = pgTable(
    "improvement_results",
    {
        id: serial("id").primaryKey(),
        organizationId: integer("organization_id")
            .notNull()
            .references(() => orgs.id, { onDelete: "cascade" }),
        experimentId: integer("experiment_id")
            .notNull()
            .references(() => improvementExperiments.id, { onDelete: "cascade" }),

        baselineValue: integer("baseline_value"),
        baselineSampleCount: integer("baseline_sample_count").default(0).notNull(),
        interventionValue: integer("intervention_value"),
        interventionSampleCount: integer("intervention_sample_count").default(0).notNull(),

        /** Data quality, reported rather than silently absorbed. */
        missingRecordCount: integer("missing_record_count").default(0).notNull(),
        excludedRecordCount: integer("excluded_record_count").default(0).notNull(),
        exclusionReasons: jsonb("exclusion_reasons").$type<Record<string, number>>().default({}).notNull(),

        /** Machinery faults — never counted as hypothesis evidence. */
        executionFailureCount: integer("execution_failure_count").default(0).notNull(),
        policyStopCount: integer("policy_stop_count").default(0).notNull(),

        guardrailResults: jsonb("guardrail_results").$type<GuardrailOutcome[]>().default([]).notNull(),

        /** Computed by the criteria service. Never authored by a model. */
        criterionOutcome: text("criterion_outcome").$type<CriterionOutcome>().notNull(),
        classification: text("classification").$type<ResultClassification>().notNull(),
        verdictReasons: jsonb("verdict_reasons").$type<string[]>().default([]).notNull(),

        /** Model-generated, with citations. Advisory only. */
        interpretation: text("interpretation"),
        interpretationCitations: jsonb("interpretation_citations").$type<number[]>().default([]).notNull(),

        /** The human decision, and why. */
        disposition: text("disposition"),
        dispositionRationale: text("disposition_rationale"),
        dispositionBy: text("disposition_by"),
        dispositionAt: timestamp("disposition_at"),

        computedAt: timestamp("computed_at").defaultNow().notNull(),
    },
    (table) => [
        index("improvement_results_experiment_idx").on(table.experimentId),
        index("improvement_results_org_outcome_idx").on(table.organizationId, table.criterionOutcome),
    ],
);

export type ImprovementExperiment = typeof improvementExperiments.$inferSelect;
export type InsertImprovementExperiment = typeof improvementExperiments.$inferInsert;
export type ImprovementResult = typeof improvementResults.$inferSelect;
export type InsertImprovementResult = typeof improvementResults.$inferInsert;
