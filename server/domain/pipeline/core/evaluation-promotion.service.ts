import type {
    EvaluationPromotionAssessment,
    EvaluationPromotionCheck,
    EvaluationPromotionThresholds,
    EvaluationRunSummary,
} from "@shared/evaluation-promotion.js";

export const DEFAULT_EVALUATION_PROMOTION_THRESHOLDS: EvaluationPromotionThresholds = {
    minimumCases: 1,
    minimumPassRate: 90,
    maximumRegressionPoints: 5,
};

export function summarizeEvaluationRun(
    run: { id: number; status: string },
    results: Array<{ passed: boolean }>,
): EvaluationRunSummary {
    const total = results.length;
    const passed = results.filter((result) => result.passed).length;
    return {
        runId: run.id,
        status: run.status,
        total,
        passed,
        failed: total - passed,
        passRate: total === 0 ? 0 : Number(((passed / total) * 100).toFixed(2)),
    };
}

export function assessEvaluationPromotion(input: {
    candidate: EvaluationRunSummary;
    baseline?: EvaluationRunSummary | null;
    thresholds?: Partial<EvaluationPromotionThresholds>;
}): EvaluationPromotionAssessment {
    const thresholds: EvaluationPromotionThresholds = {
        ...DEFAULT_EVALUATION_PROMOTION_THRESHOLDS,
        ...input.thresholds,
    };
    thresholds.minimumCases = Math.max(1, Math.floor(thresholds.minimumCases));
    thresholds.minimumPassRate = Math.min(100, Math.max(0, thresholds.minimumPassRate));
    thresholds.maximumRegressionPoints = Math.min(100, Math.max(0, thresholds.maximumRegressionPoints));
    const { candidate } = input;
    const baseline = input.baseline ?? null;
    const passRateDelta = baseline
        ? Number((candidate.passRate - baseline.passRate).toFixed(2))
        : null;
    const checks: EvaluationPromotionCheck[] = [
        {
            id: "run-completed",
            label: "Candidate run completed",
            status: candidate.status === "completed" ? "pass" : "block",
            detail: candidate.status === "completed"
                ? "The candidate finished and its results are stable."
                : `Candidate status is ${candidate.status}.`,
        },
        {
            id: "minimum-cases",
            label: "Minimum evaluation coverage",
            status: candidate.total >= thresholds.minimumCases ? "pass" : "block",
            detail: `${candidate.total} of ${thresholds.minimumCases} required cases executed.`,
        },
        {
            id: "minimum-pass-rate",
            label: "Pass-rate threshold",
            status: candidate.passRate >= thresholds.minimumPassRate ? "pass" : "block",
            detail: `${candidate.passRate}% observed; ${thresholds.minimumPassRate}% required.`,
        },
    ];

    if (baseline) {
        const withinRegressionBudget = passRateDelta! >= -thresholds.maximumRegressionPoints;
        checks.push({
            id: "baseline-regression",
            label: "Baseline regression budget",
            status: withinRegressionBudget ? (passRateDelta! < 0 ? "warning" : "pass") : "block",
            detail: `${passRateDelta! >= 0 ? "+" : ""}${passRateDelta} points versus run #${baseline.runId}; maximum allowed drop is ${thresholds.maximumRegressionPoints}.`,
        });
    } else {
        checks.push({
            id: "baseline-regression",
            label: "Baseline comparison",
            status: "warning",
            detail: "No prior promoted baseline exists; this will establish the first baseline.",
        });
    }

    const ready = checks.every((check) => check.status !== "block");
    return {
        ready,
        state: ready ? "ready" : "blocked",
        candidate,
        baseline,
        thresholds,
        passRateDelta,
        checks,
    };
}
