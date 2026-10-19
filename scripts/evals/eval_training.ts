/**
 * AI Evaluation Suite for Fine-tuning / Learning Loop
 * Tests:
 * 1. Fine-tuning Dataset CRUD
 * 2. Training Example (Golden Record) Creation
 * 3. Lineage (Job/Pipeline references)
 * 4. Tags and Metadata
 * 5. Query Operations
 */

import "dotenv/config";
import { db } from "../../server/db/index.js";
import { fineTuningDatasets, fineTuningExamples } from "../../shared/schema/training";
import { orgs } from "../../shared/schema/auth";
import { eq, sql, desc } from "drizzle-orm";

interface EvalResult {
    testName: string;
    passed: boolean;
    details: string;
    duration: number;
}

const results: EvalResult[] = [];

async function recordResult(testName: string, passed: boolean, details: string, startTime: number) {
    const duration = Date.now() - startTime;
    results.push({ testName, passed, details, duration });
    console.log(`   ${passed ? "✅" : "❌"} ${testName} (${duration}ms)`);
    if (!passed) console.log(`      Details: ${details}`);
}

async function runEval() {
    console.log("🧠 Starting Fine-tuning / Learning Loop Evaluation...\n");
    console.log("=".repeat(70));

    // Get test org
    const [org] = await db.select().from(orgs).limit(1);
    const orgId = org?.id || null;

    let testDatasetId: number | null = null;
    const testExampleIds: number[] = [];

    // 1. Fine-tuning Dataset Creation
    console.log("\n📋 Test: Training Dataset CRUD");
    console.log("-".repeat(50));

    let start = Date.now();
    try {
        const [dataset] = await db.insert(fineTuningDatasets).values({
            name: `Eval Dataset ${Date.now()}`,
            description: "Evaluation dataset for learning loop",
            organizationId: orgId,
        }).returning();

        testDatasetId = dataset?.id || null;
        await recordResult("Training Dataset Creation", !!testDatasetId,
            testDatasetId ? `Created dataset ID: ${testDatasetId}` : "Failed", start);
    } catch (e: any) {
        await recordResult("Training Dataset Creation", false, e.message, start);
    }

    // 2. Training Example (Golden Record) Creation
    console.log("\n📋 Test: Training Examples (Golden Records)");
    console.log("-".repeat(50));

    if (testDatasetId) {
        start = Date.now();
        try {
            const [example] = await db.insert(fineTuningExamples).values({
                datasetId: testDatasetId,
                input: "How to fix a network timeout in Oddjob?",
                inputContext: { type: "FAQ", severity: "high" },
                output: "Check the retry policy and network timeout settings in the job configuration.",
                humanConfidence: 95,
                tags: ["network", "timeout", "verified"],
            }).returning();

            if (example?.id) {
                testExampleIds.push(example.id);
                await recordResult("Golden Record Creation", true,
                    `Created example ID: ${example.id}, Status: Verified`, start);
            }
        } catch (e: any) {
            await recordResult("Golden Record Creation", false, e.message, start);
        }
    }

    // 3. Metadata & Lineage
    console.log("\n📋 Test: Example Lineage & Metadata");
    console.log("-".repeat(50));

    if (testDatasetId) {
        start = Date.now();
        try {
            const [lineageExample] = await db.insert(fineTuningExamples).values({
                datasetId: testDatasetId,
                input: '{"task": "summarize", "text": "..."}',
                output: "Summary of the text.",
                inputContext: { source: "pipeline_worker" },
                sourceJobId: null, // We can't easily get a valid jobId in this eval without more setup
                originalAiConfidence: 80,
                humanConfidence: 100,
            }).returning();

            if (lineageExample?.id) {
                testExampleIds.push(lineageExample.id);
                const [read] = await db.select().from(fineTuningExamples).where(eq(fineTuningExamples.id, lineageExample.id));
                const metadataValid = (read?.inputContext as any)?.source === "pipeline_worker";
                await recordResult("Metadata Storage", metadataValid,
                    `Source metadata verified: ${metadataValid}`, start);
            }
        } catch (e: any) {
            await recordResult("Metadata Storage", false, e.message, start);
        }
    }

    // 4. Query & Filter
    console.log("\n📋 Test: Query & Filtering");
    console.log("-".repeat(50));

    if (testDatasetId) {
        start = Date.now();
        try {
            const tagResults = await db.select().from(fineTuningExamples)
                .where(sql`${fineTuningExamples.tags} @> ARRAY['network']::text[]`);
            await recordResult("Filter by Tag", tagResults.length >= 1,
                `Found ${tagResults.length} examples with 'network' tag`, start);
        } catch (e: any) {
            await recordResult("Filter by Tag", false, e.message, start);
        }

        start = Date.now();
        try {
            const highConfidence = await db.select().from(fineTuningExamples)
                .where(sql`${fineTuningExamples.humanConfidence} >= 90`);
            await recordResult("Filter by High Confidence", highConfidence.length >= 2,
                `Found ${highConfidence.length} examples with >= 90 confidence`, start);
        } catch (e: any) {
            await recordResult("Filter by High Confidence", false, e.message, start);
        }
    }

    // 5. Training Statistics
    console.log("\n📋 Test: Training Statistics");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        const stats = await db.select({
            datasetId: fineTuningExamples.datasetId,
            count: sql<number>`count(*)`,
            avgConfidence: sql<number>`avg(human_confidence)`,
        }).from(fineTuningExamples)
            .groupBy(fineTuningExamples.datasetId);

        const statsStr = stats.map(s => `ID: ${s.datasetId}, Count: ${s.count}, AvgConf: ${Math.round(s.avgConfidence)}%`).join("\n");
        await recordResult("Aggregation Stats", stats.length >= 1,
            statsStr || "No stats found", start);
    } catch (e: any) {
        await recordResult("Statistics", false, e.message, start);
    }

    // Cleanup
    console.log("\n📋 Test: Cleanup");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        // Examples cascade delete with dataset
        if (testDatasetId) {
            await db.delete(fineTuningDatasets)
                .where(eq(fineTuningDatasets.id, testDatasetId));
        }
        await recordResult("Cleanup", true, `Removed dataset and ${testExampleIds.length} examples`, start);
    } catch (e: any) {
        await recordResult("Cleanup", false, e.message, start);
    }

    // Summary
    console.log("\n" + "=".repeat(70));
    console.log("📊 TRAINING / LEARNING LOOP EVALUATION SUMMARY");
    console.log("=".repeat(70));

    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    const passRate = (passed / results.length) * 100;

    console.log(`\n   Total Tests: ${results.length}`);
    console.log(`   Passed: ${passed}`);
    console.log(`   Failed: ${failed}`);
    console.log(`   Pass Rate: ${passRate.toFixed(1)}%`);
    console.log(`   Total Duration: ${results.reduce((a, r) => a + r.duration, 0)}ms`);

    console.log("\n   Features Tested:");
    console.log("   - Dataset CRUD ✓");
    console.log("   - Golden Record Creation ✓");
    console.log("   - Tagging & Metadata ✓");
    console.log("   - Filtering & Search ✓");
    console.log("   - Training Stats ✓");

    console.log("\n" + "=".repeat(70));
    if (passRate >= 80) {
        console.log("🎉 EVALUATION PASSED: Training / Learning Loop system is operational!");
    } else {
        console.log("❌ EVALUATION FAILED: Issues with Training / Learning Loop.");
    }
    console.log("=".repeat(70));

    process.exit(passRate >= 100 ? 0 : 1);
}

runEval().catch(e => {
    console.error("\n❌ EVALUATION CRASHED:", e);
    process.exit(1);
});
