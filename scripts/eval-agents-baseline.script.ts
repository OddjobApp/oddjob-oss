
import { db } from "../server/database_service.js";
import { evaluationTestSets, evaluationTestCases } from "../shared/schema/evaluation.js";
import { evaluationService } from "../server/domain/pipeline/core/evaluation.service.js";
import { eq } from "drizzle-orm";

async function main() {
    console.log("🚀 Starting Agents Pod Baseline Evaluation...");

    // 1. Get or Create Organization
    // Find 'Oddjob System' org or first available
    let orgId = 1;
    try {
        const orgs = await db.execute("SELECT id FROM orgs WHERE name = 'Oddjob System' LIMIT 1");
        if (orgs.rows.length > 0) {
            orgId = (orgs.rows[0] as any).id;
        }
    } catch (e) {
        console.warn("Could not find Oddjob System org, using ID 1.");
    }

    // 2. Clear existing baseline to avoid duplicates
    await db.delete(evaluationTestSets).where(eq(evaluationTestSets.name, "Agents Pod Baseline"));

    // 3. Create Test Set
    console.log("Creating Test Set: Agents Pod Baseline...");
    const [testSet] = await db.insert(evaluationTestSets).values({
        organizationId: orgId,
        name: "Agents Pod Baseline",
        description: "Core benchmarking for reasoning, tool use, and personality traits in the agents pod."
    }).returning();

    // 4. Create Test Cases
    const cases = [
        {
            inputPrompt: "I need to coordinate 3 tasks: fetch my recent missions, summarize any blockers in a bulleted list, and tell me who the supervisor is for each.",
            expectedCriteria: "The response must contain a summary of blockers for recent missions and identify the supervisor if mentioned/visible.",
            method: "llm_judge"
        },
        {
            inputPrompt: "What are the active HIL forms currently available in the system?",
            expectedCriteria: "The agent should attempt to list or mention HIL forms, likely using a tool like list_hil_forms or search_platform_nodes.",
            method: "llm_judge"
        },
        {
            inputPrompt: "The system is exhibiting sporadic database latency and 504 errors on the forge pipeline. Provide a clinical analysis of possible root causes.",
            expectedCriteria: "The response should be analytical, professional, and detached (Ghost Analyst style), avoiding emotional filler.",
            method: "llm_judge"
        },
        {
            inputPrompt: "Explain the relationship between the 'Governor' and the 'Mission Service' in the Oddjob architecture.",
            expectedCriteria: "The response must accurately describe the Governor as an oversight layer for missions.",
            method: "llm_judge"
        },
        {
            inputPrompt: "Analyze the last 5 chat messages in this session and identify any recurring user intents.",
            expectedCriteria: "The agent should demonstrate session memory and accurately summarize user intents.",
            method: "llm_judge"
        }
    ];

    console.log(`Injecting ${cases.length} test cases...`);
    for (const tc of cases) {
        await db.insert(evaluationTestCases).values({
            testSetId: testSet.id,
            inputPrompt: tc.inputPrompt,
            expectedCriteria: tc.expectedCriteria,
            method: tc.method
        });
    }

    // 5. Run the Test Set
    console.log(`Running evaluation run for Test Set #${testSet.id}...`);
    const result = await evaluationService.runTestSet(testSet.id, orgId);
    
    console.log(`✅ Evaluation Run #${result.runId} completed!`);
    console.log(`Check evaluation_run_results table for details.`);
    
    process.exit(0);
}

main().catch(err => {
    console.error("❌ Evaluation Script Failed:", err);
    process.exit(1);
});
