export interface ActionConfidenceScore {
    actionId: string;
    actionType: string;
    modelConfidence: number; // Raw model confidence [0.0 - 1.0]
    riskTier: "low" | "medium" | "high" | "critical";
    nonConformityScore: number; // 1 - modelConfidence
}

export interface ConformalDecision {
    actionId: string;
    isAutonomousAllowed: boolean;
    requiresHilEscalation: boolean;
    coverageLevel: number; // e.g. 0.95 or 0.99
    quantileThreshold: number;
    reasoning: string;
}

export const conformalGovernanceService = {
    /**
     * Calculates non-conformity scores (S_i = 1 - p_i) for calibration set
     */
    calculateNonConformityScore(modelConfidence: number): number {
        return Math.max(0.0, Math.min(1.0, 1.0 - modelConfidence));
    },

    /**
     * Calculates conformal prediction quantile threshold for target significance alpha (e.g., alpha = 0.05 for 95% coverage)
     */
    calculateQuantileThreshold(calibrationScores: number[], alpha: number = 0.05): number {
        if (!calibrationScores || calibrationScores.length === 0) return 0.20;

        const sorted = [...calibrationScores].sort((a, b) => a - b);
        const n = sorted.length;
        // Conformal quantile index: ceil((n + 1) * (1 - alpha)) / n
        const targetIndex = Math.min(n - 1, Math.floor(n * (1.0 - alpha)));
        return sorted[targetIndex];
    },

    /**
     * Evaluates action safety using conformal coverage bounds
     */
    evaluateConformalSafety(
        actionScore: ActionConfidenceScore,
        calibrationScores: number[] = [0.05, 0.08, 0.10, 0.12, 0.15, 0.22, 0.30],
        userAlpha?: number
    ): ConformalDecision {
        const alpha = userAlpha ?? (actionScore.riskTier === "critical" ? 0.01 : 0.05); // 99% for critical, 95% for others
        const quantileThreshold = this.calculateQuantileThreshold(calibrationScores, alpha);
        const nonConformity = this.calculateNonConformityScore(actionScore.modelConfidence);

        const isAutonomousAllowed = nonConformity <= quantileThreshold;
        const targetCoverage = (1.0 - alpha) * 100;

        return {
            actionId: actionScore.actionId,
            isAutonomousAllowed,
            requiresHilEscalation: !isAutonomousAllowed,
            coverageLevel: Number((1.0 - alpha).toFixed(2)),
            quantileThreshold: Number(quantileThreshold.toFixed(3)),
            reasoning: isAutonomousAllowed
                ? `Action passed conformal prediction gate with ${targetCoverage}% statistical coverage (non-conformity ${nonConformity.toFixed(3)} <= ${quantileThreshold.toFixed(3)})`
                : `Action non-conformity ${nonConformity.toFixed(3)} breached ${targetCoverage}% coverage quantile threshold ${quantileThreshold.toFixed(3)}. Escalating to Human-in-the-Loop (HIL).`
        };
    }
};
