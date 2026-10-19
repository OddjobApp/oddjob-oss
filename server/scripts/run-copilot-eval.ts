import { evaluationService } from "../domain/pipeline/core/evaluation.service.js";
import { db } from "../database_service.js";
import { evaluationRunResults, evaluationTestCases } from "@shared/schema/evaluation.js";
import { eq } from "drizzle-orm";

async function main() {
  console.log("🚀 Launching Copilot AI Evaluation on HF Tool Calling & API Selection (Test Set ID: 5)...");
  const start = Date.now();
  const { runId } = await evaluationService.runTestSet(5, 291);
  const duration = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n✅ Evaluation run completed in ${duration}s (Run ID: ${runId})`);

  const results = await db.select()
    .from(evaluationRunResults)
    .innerJoin(evaluationTestCases, eq(evaluationRunResults.testCaseId, evaluationTestCases.id))
    .where(eq(evaluationRunResults.runId, runId));

  const total = results.length;
  const passed = results.filter(r => r.evaluation_run_results.passed).length;
  const accuracy = Math.round((passed / total) * 100);

  console.log(`\n==================================================`);
  console.log(`📊 COPILOT AI EVALUATION SCORECARD`);
  console.log(`==================================================`);
  console.log(`Test Set: HF Tool Calling and API Selection (ID: 5)`);
  console.log(`Total Cases: ${total}`);
  console.log(`Passed:      ${passed}`);
  console.log(`Failed:      ${total - passed}`);
  console.log(`Accuracy:    ${accuracy}%`);
  console.log(`==================================================\n`);

  console.log(`🔍 DETAILED CASE BREAKDOWN:`);
  for (const r of results) {
    const status = r.evaluation_run_results.passed ? "✅ PASS" : "❌ FAIL";
    console.log(`${status} | [Prompt]: ${r.evaluation_test_cases.inputPrompt}`);
    console.log(`      [Criteria]: ${r.evaluation_test_cases.expectedCriteria}`);
    console.log(`      [Response]: ${r.evaluation_run_results.agentResponse?.substring(0, 150).replace(/\n/g, " ")}...\n`);
  }
}

main().catch(console.error).finally(() => process.exit(0));
