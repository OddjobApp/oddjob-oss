
import { db } from "../server/database_service.js";
import { evaluationRuns, evaluationRunResults, evaluationTestSets } from "../shared/schema/evaluation.js";
import { eq, desc } from "drizzle-orm";
import { evaluationService } from "../server/domain/pipeline/core/evaluation.service.js";
import { criticService } from "../server/domain/agents/core/critic-service.js";

async function main() {
    const [lastRun] = await db.select().from(evaluationRuns).orderBy(desc(evaluationRuns.id)).limit(1);
    if (!lastRun) {
        console.log("No runs found.");
        process.exit(0);
    }

    console.log(`Run ID: ${lastRun.id}`);
    console.log(`Status: ${lastRun.status}`);
    
    if (lastRun.status === 'completed') {
        const summary = await evaluationService.getRunSummary(lastRun.id);
        console.log("=== RUN SUMMARY ===");
        console.log(`Total: ${summary.total}`);
        console.log(`Passed: ${summary.passed}`);
        console.log(`Failed: ${summary.failed}`);
        console.log(`Pass Rate: ${summary.passRate}%`);
        
        console.log("\n=== DETAILED RESULTS ===");
        summary.results.forEach(r => {
            console.log(`- [${r.passed ? 'PASS' : 'FAIL'}] Case ${r.testCaseId}`);
            if (!r.passed) {
               console.log(`  Response: ${r.agentResponse?.slice(0, 100)}...`);
            }
        });
    } else {
        const results = await db.select().from(evaluationRunResults).where(eq(evaluationRunResults.runId, lastRun.id));
        console.log(`Progress: ${results.length} cases completed so far.`);
    }

    const critiques = await criticService.getCritiqueSummary(5);
    if (critiques) {
        console.log("\n=== RECENT CRITIQUES ===");
        console.log(`Avg Score: ${critiques.avgScore}`);
        console.log(`Common Issues: ${critiques.commonIssues.join(', ')}`);
    }

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
