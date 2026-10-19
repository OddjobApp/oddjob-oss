/**
 * Pre-registration and deterministic verdicts for bounded experiments.
 *
 * Two jobs, both deliberately free of any model:
 *
 * 1. **Pre-registration** — refuse to approve an experiment whose success
 *    criteria are not fully declared. Criteria chosen after seeing the numbers
 *    are not criteria.
 * 2. **Verdict** — decide `passed` / `failed` / `inconclusive` / `not_run` from
 *    measurements alone, in an order that keeps machinery faults from being
 *    read as evidence about the hypothesis.
 *
 * The ordering in `evaluateExperiment` is the substance of this file. A broken
 * pipeline must not discredit a good idea, and a recovered failure must not be
 * counted as success.
 */

import type {
    CriterionOutcome,
    GuardrailMetric,
    GuardrailOutcome,
    ImprovementExperiment,
    MetricDirection,
    ResultClassification,
} from "@shared/schema/improvement/index.js";

/* ────────────────────────────  pre-registration  ──────────────────────────── */

export interface PreRegistrationIssue {
    field: string;
    reason: string;
}

export type PreRegistrationResult =
    | { ok: true }
    | { ok: false; issues: PreRegistrationIssue[] };

/** The fields §4.4 requires before an experiment may be approved. */
export function validatePreRegistration(
    experiment: Partial<ImprovementExperiment>,
): PreRegistrationResult {
    const issues: PreRegistrationIssue[] = [];
    const require = (field: string, ok: boolean, reason: string) => {
        if (!ok) issues.push({ field, reason });
    };

    require("hypothesisId", !!experiment.hypothesisId, "An experiment must test a stated hypothesis.");
    require(
        "baselineDefinition",
        !!experiment.baselineDefinition?.trim(),
        "Without a declared baseline there is nothing to compare against.",
    );
    require(
        "baselineWindow",
        !!experiment.baselineWindowStart && !!experiment.baselineWindowEnd,
        "The baseline measurement window must be fixed in advance.",
    );
    require("intervention", !!experiment.intervention?.trim(), "State what is being changed.");
    require(
        "startsAt/endsAt",
        !!experiment.startsAt && !!experiment.endsAt,
        "A bounded experiment needs a declared start and end.",
    );
    require("primaryMetric", !!experiment.primaryMetric?.trim(), "Declare one primary metric.");
    require(
        "primaryMetricDirection",
        experiment.primaryMetricDirection === "increase" || experiment.primaryMetricDirection === "decrease",
        "Declare which direction counts as improvement.",
    );
    require(
        "minimumSampleSize",
        typeof experiment.minimumSampleSize === "number" && experiment.minimumSampleSize > 0,
        "Declare the minimum evidence threshold, or the result cannot be called inconclusive honestly.",
    );
    require(
        "guardrails",
        Array.isArray(experiment.guardrails) && experiment.guardrails.length > 0,
        "Declare at least one guardrail metric that must not degrade.",
    );
    require("requiredApproverRole", !!experiment.requiredApproverRole?.trim(), "Name the approving role.");
    require("stopConditions", !!experiment.stopConditions, "Declare stop conditions before running.");
    require("rollbackPlan", !!experiment.rollbackPlan?.trim(), "Declare how to undo this.");

    const b = experiment.boundaries;
    require(
        "boundaries",
        !!b && typeof b.maxCases === "number" && b.maxCases > 0 && typeof b.maxBudgetUsd === "number",
        "Declare the case, budget and action envelope.",
    );
    if (b && Array.isArray(b.permittedExternalActions) && b.permittedExternalActions.length === 0) {
        issues.push({
            field: "boundaries.permittedExternalActions",
            reason: "State external actions explicitly — use ['none'] rather than an empty list, so silence is never read as permission.",
        });
    }

    if (experiment.startsAt && experiment.endsAt && experiment.endsAt <= experiment.startsAt) {
        issues.push({ field: "endsAt", reason: "The end must follow the start." });
    }
    if (
        experiment.baselineWindowStart &&
        experiment.baselineWindowEnd &&
        experiment.baselineWindowEnd <= experiment.baselineWindowStart
    ) {
        issues.push({ field: "baselineWindowEnd", reason: "The baseline window must end after it starts." });
    }

    return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

export class PreRegistrationError extends Error {
    constructor(readonly issues: PreRegistrationIssue[]) {
        super(`Experiment is not fully pre-registered: ${issues.map(i => i.field).join(", ")}`);
        this.name = "PreRegistrationError";
    }
}

export function assertPreRegistered(experiment: Partial<ImprovementExperiment>): void {
    const result = validatePreRegistration(experiment);
    if (!result.ok) throw new PreRegistrationError(result.issues);
}

/* ──────────────────────────────  evaluation  ─────────────────────────────── */

export interface MeasuredOutcome {
    /** `null` means the metric could not be computed at all. */
    baselineValue: number | null;
    baselineSampleCount: number;
    interventionValue: number | null;
    /** Usable cases — already net of excluded and failed ones. */
    interventionSampleCount: number;
    executionFailureCount: number;
    policyStopCount: number;
    /** Measured values per guardrail metric. */
    guardrailMeasurements: Record<string, { baseline: number | null; intervention: number | null }>;
    /** True when the experiment never started. */
    ran: boolean;
}

export interface ExperimentCriteria {
    primaryMetric: string;
    primaryMetricDirection: MetricDirection;
    minimumEffect: number;
    minimumSampleSize: number;
    guardrails: GuardrailMetric[];
}

export interface EvaluationVerdict {
    outcome: CriterionOutcome;
    classification: ResultClassification;
    reasons: string[];
    guardrailResults: GuardrailOutcome[];
    /** Signed change in the primary metric, positive meaning "increased". */
    observedEffect: number | null;
}

/** How much a guardrail degraded, in its own units. Negative means it improved. */
export function computeGuardrailOutcome(
    guardrail: GuardrailMetric,
    measurement: { baseline: number | null; intervention: number | null } | undefined,
): GuardrailOutcome {
    const baselineValue = measurement?.baseline ?? null;
    const interventionValue = measurement?.intervention ?? null;

    if (baselineValue === null || interventionValue === null) {
        // Unmeasured is not "safe". It is unknown, and it breaches: a guardrail
        // nobody measured cannot testify that nothing got worse.
        return {
            metric: guardrail.metric,
            baselineValue,
            interventionValue,
            degradation: null,
            maxDegradation: guardrail.maxDegradation,
            breached: true,
        };
    }

    const delta = interventionValue - baselineValue;
    const degradation = guardrail.degradesWhen === "increase" ? delta : -delta;

    return {
        metric: guardrail.metric,
        baselineValue,
        interventionValue,
        degradation,
        maxDegradation: guardrail.maxDegradation,
        breached: degradation > guardrail.maxDegradation,
    };
}

/**
 * Decide the verdict from measurements alone.
 *
 * Order matters, and it is this:
 *
 *   1. never ran            → `not_run`
 *   2. policy stopped it    → `inconclusive` / `policy_stop`
 *   3. machinery broke      → `inconclusive` / `execution_failure`
 *   4. too little evidence  → `inconclusive` / `insufficient_evidence`
 *   5. a guardrail breached → `failed` / `guardrail_breach`
 *   6. effect met the bar   → `passed`
 *   7. otherwise            → `failed` / `hypothesis_not_supported`
 *
 * Steps 2-4 precede any judgement about the hypothesis on purpose. Only after
 * a clean, sufficient test does the primary metric get to mean anything, and
 * only a `passed` at step 6 is a success — recovery from a fault never is.
 */
export function evaluateExperiment(
    criteria: ExperimentCriteria,
    measured: MeasuredOutcome,
): EvaluationVerdict {
    const guardrailResults = criteria.guardrails.map(g =>
        computeGuardrailOutcome(g, measured.guardrailMeasurements[g.metric]),
    );

    const verdict = (
        outcome: CriterionOutcome,
        classification: ResultClassification,
        reasons: string[],
        observedEffect: number | null = null,
    ): EvaluationVerdict => ({ outcome, classification, reasons, guardrailResults, observedEffect });

    if (!measured.ran) {
        return verdict("not_run", "not_run", ["The experiment did not run."]);
    }

    if (measured.policyStopCount > 0) {
        return verdict("inconclusive", "policy_stop", [
            `Stopped by policy ${measured.policyStopCount} time(s). This says nothing about the hypothesis.`,
        ]);
    }

    if (measured.executionFailureCount > 0 && measured.interventionSampleCount < criteria.minimumSampleSize) {
        return verdict("inconclusive", "execution_failure", [
            `${measured.executionFailureCount} execution failure(s) left ${measured.interventionSampleCount} usable case(s), below the pre-registered minimum of ${criteria.minimumSampleSize}.`,
            "An execution fault is not evidence against the hypothesis.",
        ]);
    }

    if (
        measured.interventionSampleCount < criteria.minimumSampleSize ||
        measured.baselineValue === null ||
        measured.interventionValue === null
    ) {
        return verdict("inconclusive", "insufficient_evidence", [
            measured.baselineValue === null || measured.interventionValue === null
                ? "A required metric could not be computed."
                : `${measured.interventionSampleCount} usable case(s) is below the pre-registered minimum of ${criteria.minimumSampleSize}.`,
        ]);
    }

    const breached = guardrailResults.filter(g => g.breached);
    if (breached.length > 0) {
        return verdict(
            "failed",
            "guardrail_breach",
            breached.map(g =>
                g.degradation === null
                    ? `Guardrail '${g.metric}' was not measured, so it cannot show that nothing got worse.`
                    : `Guardrail '${g.metric}' degraded by ${g.degradation}, beyond the tolerated ${g.maxDegradation}.`,
            ),
            measured.interventionValue - measured.baselineValue,
        );
    }

    const delta = measured.interventionValue - measured.baselineValue;
    const improvement = criteria.primaryMetricDirection === "increase" ? delta : -delta;

    if (improvement >= criteria.minimumEffect && improvement > 0) {
        return verdict(
            "passed",
            "hypothesis_supported",
            [
                `'${criteria.primaryMetric}' moved ${improvement} in the declared direction, meeting the pre-registered minimum effect of ${criteria.minimumEffect}.`,
            ],
            delta,
        );
    }

    return verdict(
        "failed",
        "hypothesis_not_supported",
        [
            `'${criteria.primaryMetric}' moved ${improvement} in the declared direction, short of the pre-registered minimum effect of ${criteria.minimumEffect}.`,
        ],
        delta,
    );
}

/** Pull the criteria off a persisted experiment row. */
export function criteriaFromExperiment(experiment: ImprovementExperiment): ExperimentCriteria {
    return {
        primaryMetric: experiment.primaryMetric,
        primaryMetricDirection: experiment.primaryMetricDirection,
        minimumEffect: experiment.minimumEffect,
        minimumSampleSize: experiment.minimumSampleSize,
        guardrails: experiment.guardrails,
    };
}
