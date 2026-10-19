/**
 * Security Posture Score Evaluator
 * 
 * Deterministically evaluates security audit metrics against compliance thresholds:
 * Score = max(0, 100 - (25 * critical + 10 * high + 3 * medium + 1 * low))
 */

export interface SecurityScoreContext {
    criticalFindings?: number;
    highFindings?: number;
    mediumFindings?: number;
    lowFindings?: number;
    totalCodeLines?: number;
    unresolvedCves?: number;
}

export interface SecurityScoreResult {
    score: number;
    status: "PASSED" | "WARNING" | "FAILED";
    grade: "A" | "B" | "C" | "D" | "F";
    complianceThresholdMet: boolean;
    breakdown: {
        criticalDeductions: number;
        highDeductions: number;
        mediumDeductions: number;
        lowDeductions: number;
        totalDeductions: number;
    };
    recommendation: string;
}

export function evaluateSecurityScore(context: SecurityScoreContext): SecurityScoreResult {
    const critical = Math.max(0, context.criticalFindings || 0);
    const high = Math.max(0, context.highFindings || 0);
    const medium = Math.max(0, context.mediumFindings || 0);
    const low = Math.max(0, context.lowFindings || 0);

    const criticalDeductions = critical * 25;
    const highDeductions = high * 10;
    const mediumDeductions = medium * 3;
    const lowDeductions = low * 1;

    const totalDeductions = criticalDeductions + highDeductions + mediumDeductions + lowDeductions;
    const score = Math.max(0, 100 - totalDeductions);

    let status: "PASSED" | "WARNING" | "FAILED";
    let grade: "A" | "B" | "C" | "D" | "F";

    if (critical > 0 || score < 60) {
        status = "FAILED";
        grade = score < 40 ? "F" : "D";
    } else if (high > 0 || score < 80) {
        status = "WARNING";
        grade = "C";
    } else if (score < 90) {
        status = "PASSED";
        grade = "B";
    } else {
        status = "PASSED";
        grade = "A";
    }

    const complianceThresholdMet = status === "PASSED";

    let recommendation = "Codebase security posture satisfies compliance thresholds.";
    if (critical > 0) {
        recommendation = `CRITICAL: ${critical} critical security vulnerabilities detected. Remediate blockers immediately before release.`;
    } else if (high > 0) {
        recommendation = `WARNING: ${high} high severity vulnerabilities found. Review and schedule patches in the current sprint.`;
    } else if (medium > 0 || low > 0) {
        recommendation = `INFO: Minor findings detected. Address during routine refactoring and dependency updates.`;
    }

    return {
        score,
        status,
        grade,
        complianceThresholdMet,
        breakdown: {
            criticalDeductions,
            highDeductions,
            mediumDeductions,
            lowDeductions,
            totalDeductions,
        },
        recommendation,
    };
}
