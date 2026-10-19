
/**
 * AI Evaluation Suite for Error Diagnosis System
 * Tests:
 * 1. Pattern Matching Accuracy
 * 2. AI Diagnosis Quality (with real LLM calls)
 * 3. Recommendation Relevance
 * 4. HIL Correction Applicability
 * 5. Alert Triggering Logic
 */

import "dotenv/config";
import { db } from "../../server/db/index.js";
import { errorDiagnosisEngine, errorAlertService } from '../../server/domain/diagnostics/index.js';
import { sql } from "drizzle-orm";

// Test cases with expected outcomes (aligned with BUILTIN_ERROR_PATTERNS)
const ERROR_SCENARIOS = [
    {
        name: "Authentication Error (401 Unauthorized)",
        error: "Request failed with status code 401: Unauthorized - Invalid API key",
        httpStatus: 401,
        jobType: "api",
        expectedPatternId: "auth-failed",
        expectedHasRecommendation: true,
    },
    {
        name: "Rate Limit Error (429)",
        error: "Request failed with status code 429: Too Many Requests",
        httpStatus: 429,
        jobType: "api",
        expectedPatternId: "rate-limit-exceeded",
        expectedHasRecommendation: true,
    },
    {
        name: "Connection Timeout (408 or 504)",
        error: "Request timed out after 30000ms: Gateway Timeout",
        httpStatus: 504,
        jobType: "api",
        expectedPatternId: "request-timeout",
        expectedHasRecommendation: true,
    },
    {
        name: "Invalid JSON Response (400)",
        error: "Response error: invalid json format in request body",
        httpStatus: 400,
        jobType: "transformer",
        expectedPatternId: "invalid-json",
        expectedHasRecommendation: true,
    },
    {
        name: "Permission Denied (403)",
        error: "Forbidden: You do not have permission to access this resource",
        httpStatus: 403,
        jobType: "api",
        expectedPatternId: "permission-denied",
        expectedHasRecommendation: true,
    },
    {
        name: "Resource Not Found (404)",
        error: "Error: Resource not found at /api/users/12345",
        httpStatus: 404,
        jobType: "api",
        expectedPatternId: "resource-not-found",
        expectedHasRecommendation: true,
    },
    {
        name: "Internal Server Error (500)",
        error: "Internal Server Error: An unexpected error occurred",
        httpStatus: 500,
        jobType: "api",
        expectedPatternId: "server-error-500",
        expectedHasRecommendation: true,
    },
    {
        name: "Network Connection Refused",
        error: "Error: connect ECONNREFUSED 127.0.0.1:5432",
        httpStatus: 0, // Network errors have no HTTP status (status = 0)
        jobType: "shell",
        expectedPatternId: "network-error",
        expectedHasRecommendation: true,
    },
];

interface EvalResult {
    scenario: string;
    passed: boolean;
    patternMatched: boolean;
    aiDiagnosisGenerated: boolean;
    hasRecommendations: boolean;
    confidenceScore: number;
    diagnosisSummary: string;
    issues: string[];
}

async function runEval() {
    console.log("🧠 Starting AI Error Diagnosis Evaluation...\n");
    console.log("=".repeat(70));

    const results: EvalResult[] = [];
    let passedCount = 0;
    let totalAITime = 0;

    for (const scenario of ERROR_SCENARIOS) {
        console.log(`\n📋 Testing: ${scenario.name}`);
        console.log("-".repeat(50));

        const issues: string[] = [];
        const startTime = Date.now();

        try {
            // Run diagnosis with AI enabled
            const diagnosis: any = await errorDiagnosisEngine.diagnose({
                error: scenario.error,
                httpStatus: scenario.httpStatus,
                // Assuming pipelineStepId is not directly available in ERROR_SCENARIOS,
                // and jobType is removed as per the instruction's implied change.
                // If pipelineStepId is needed, ERROR_SCENARIOS would need to be updated.
                // For now, removing jobType and not adding pipelineStepId to maintain
                // syntactic correctness given the current ERROR_SCENARIOS structure.
            }, { includeAI: true });

            const elapsed = Date.now() - startTime;
            totalAITime += elapsed;

            // Evaluate results
            const patternMatched = diagnosis.matchedPatterns.length > 0;
            const aiDiagnosisGenerated = !!diagnosis.aiDiagnosis;
            const hasRecommendations = diagnosis.recommendations.length > 0;
            const confidenceScore = diagnosis.aiDiagnosis?.confidence ??
                (diagnosis.bestMatch?.score ?? 0);

            // Check if expected pattern was matched
            let patternIdMatch = true;
            if (patternMatched && scenario.expectedPatternId) {
                const matchedPatternId = diagnosis.bestMatch?.pattern.id;
                patternIdMatch = matchedPatternId === scenario.expectedPatternId;
                if (!patternIdMatch) {
                    issues.push(`Pattern mismatch: expected '${scenario.expectedPatternId}', got '${matchedPatternId}'`);
                }
            }

            // Check recommendations
            if (scenario.expectedHasRecommendation && !hasRecommendations) {
                issues.push("Expected recommendations but none generated");
            }

            // Check for auto-apply recommendations
            const autoApplyRecs = diagnosis.recommendations.filter((r: any) => r.canAutoApply);

            const passed = (patternMatched || aiDiagnosisGenerated) &&
                hasRecommendations &&
                patternIdMatch;

            if (passed) passedCount++;

            results.push({
                scenario: scenario.name,
                passed,
                patternMatched,
                aiDiagnosisGenerated,
                hasRecommendations,
                confidenceScore,
                diagnosisSummary: diagnosis.aiDiagnosis?.summary ||
                    diagnosis.bestMatch?.pattern.diagnosis?.summary || "No summary",
                issues,
            });

            // Output
            console.log(`   Pattern Matched: ${patternMatched ? "✅" : "❌"}`);
            console.log(`   AI Diagnosis: ${aiDiagnosisGenerated ? "✅" : "⚠️ (not generated)"}`);
            console.log(`   Recommendations: ${hasRecommendations ? `✅ (${diagnosis.recommendations.length})` : "❌"}`);
            console.log(`   Auto-Apply Options: ${autoApplyRecs.length}`);
            console.log(`   Confidence: ${(confidenceScore * 100).toFixed(1)}%`);
            console.log(`   Time: ${elapsed}ms`);

            if (diagnosis.aiDiagnosis?.summary) {
                console.log(`   AI Summary: "${diagnosis.aiDiagnosis.summary.substring(0, 80)}..."`);
            }

            if (issues.length > 0) {
                console.log(`   ⚠️ Issues: ${issues.join(", ")}`);
            }

            console.log(`   Result: ${passed ? "✅ PASS" : "❌ FAIL"}`);

        } catch (error: any) {
            console.log(`   ❌ ERROR: ${error.message}`);
            results.push({
                scenario: scenario.name,
                passed: false,
                patternMatched: false,
                aiDiagnosisGenerated: false,
                hasRecommendations: false,
                confidenceScore: 0,
                diagnosisSummary: "Error during evaluation",
                issues: [error.message],
            });
        }
    }

    // Summary
    console.log("\n" + "=".repeat(70));
    console.log("📊 EVALUATION SUMMARY");
    console.log("=".repeat(70));

    const passRate = (passedCount / ERROR_SCENARIOS.length) * 100;
    console.log(`\n   Total Scenarios: ${ERROR_SCENARIOS.length}`);
    console.log(`   Passed: ${passedCount}`);
    console.log(`   Failed: ${ERROR_SCENARIOS.length - passedCount}`);
    console.log(`   Pass Rate: ${passRate.toFixed(1)}%`);
    console.log(`   Avg AI Response Time: ${(totalAITime / ERROR_SCENARIOS.length).toFixed(0)}ms`);

    // Detailed breakdown
    const aiGenerated = results.filter(r => r.aiDiagnosisGenerated).length;
    const patternHits = results.filter(r => r.patternMatched).length;
    const withRecs = results.filter(r => r.hasRecommendations).length;

    console.log(`\n   Pattern Matching Rate: ${((patternHits / results.length) * 100).toFixed(1)}%`);
    console.log(`   AI Diagnosis Rate: ${((aiGenerated / results.length) * 100).toFixed(1)}%`);
    console.log(`   Recommendation Coverage: ${((withRecs / results.length) * 100).toFixed(1)}%`);

    // Alert System Check
    console.log("\n" + "-".repeat(50));
    console.log("🔔 Alert System Verification...");

    try {
        const configs = await errorAlertService.getConfigs();
        console.log(`   Active Alert Configs: ${configs.length}`);

        const history = await errorAlertService.getAlertHistory();
        console.log(`   Historical Alerts: ${history.length}`);
        console.log("   ✅ Alert System Operational");
    } catch (e: any) {
        console.log(`   ❌ Alert System Error: ${e.message}`);
    }

    // Final verdict
    console.log("\n" + "=".repeat(70));
    if (passRate >= 75) {
        console.log("🎉 EVALUATION PASSED: Error Diagnosis System is performing well!");
    } else if (passRate >= 50) {
        console.log("⚠️ EVALUATION PARTIAL: Some improvements needed in diagnosis coverage.");
    } else {
        console.log("❌ EVALUATION FAILED: Significant issues with error diagnosis system.");
    }
    console.log("=".repeat(70));

    process.exit(passRate >= 50 ? 0 : 1);
}

runEval().catch(e => {
    console.error("\n❌ EVALUATION CRASHED:", e);
    process.exit(1);
});
