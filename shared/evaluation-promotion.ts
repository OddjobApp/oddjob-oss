export type EvaluationPromotionCheckStatus = "pass" | "warning" | "block";

export interface EvaluationRunSummary {
    runId: number;
    status: string;
    total: number;
    passed: number;
    failed: number;
    passRate: number;
}

export interface EvaluationPromotionThresholds {
    minimumCases: number;
    minimumPassRate: number;
    maximumRegressionPoints: number;
}

export interface EvaluationPromotionCheck {
    id: string;
    label: string;
    status: EvaluationPromotionCheckStatus;
    detail: string;
}

export interface EvaluationPromotionAssessment {
    ready: boolean;
    state: "blocked" | "ready";
    candidate: EvaluationRunSummary;
    baseline: EvaluationRunSummary | null;
    thresholds: EvaluationPromotionThresholds;
    passRateDelta: number | null;
    checks: EvaluationPromotionCheck[];
}

export interface EvaluationLifecycleRun extends EvaluationRunSummary {
    startedAt: string | Date;
    completedAt: string | Date | null;
    isActiveBaseline: boolean;
}
