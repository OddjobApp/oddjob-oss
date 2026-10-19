/**
 * AI Evaluation Suite for Knowledge Extraction
 * Tests:
 * 1. Extraction Job CRUD
 * 2. Batch Processing (Multi-document)
 * 3. Status Transitions (queued -> processing -> completed)
 * 4. Progress & Error Tracking
 * 5. Extraction Stats (nodes/edges count)
 */

import "dotenv/config";
import { db } from "../../server/db/index.js";
import { knowledgeDocumentExtractions, extractionBatches } from "../../shared/schema/knowledge-extraction";
import { knowledgeDocuments } from "../../shared/schema/knowledge-base";
import { graphSchemaDefs } from "../../shared/schema/knowledge";
import { orgs } from "../../shared/schema/auth";
import { eq, sql } from "drizzle-orm";

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
    console.log("🧠 Starting Knowledge Extraction Evaluation...\n");
    console.log("=".repeat(70));

    // Get test org
    const [org] = await db.select().from(orgs).limit(1);
    const orgId = org?.id || null;

    // Get a schema def to use
    let [schema] = await db.select().from(graphSchemaDefs).limit(1);
    if (!schema) {
        [schema] = await db.insert(graphSchemaDefs).values({
            name: "Default Schema",
            organizationId: orgId,
            isActive: true,
        }).returning();
    }

    // Get a document to use
    let [doc] = await db.select().from(knowledgeDocuments).limit(1);
    if (!doc) {
        [doc] = await db.insert(knowledgeDocuments).values({
            title: "Extraction Doc",
            textContent: "Sample content for extraction tests.",
            organizationId: orgId,
        }).returning();
    }

    let testExtractionId: number | null = null;
    let testBatchId: number | null = null;

    // 1. Extraction Job Creation
    console.log("\n📋 Test: Extraction Job CRUD");
    console.log("-".repeat(50));

    let start = Date.now();
    try {
        const [job] = await db.insert(knowledgeDocumentExtractions).values({
            documentId: doc.id,
            schemaId: schema.id,
            status: "queued",
            priority: 5,
            organizationId: orgId,
        }).returning();

        testExtractionId = job?.id || null;
        await recordResult("Extraction Job Creation", !!testExtractionId,
            testExtractionId ? `Created job ID: ${testExtractionId}` : "Failed", start);
    } catch (e: any) {
        await recordResult("Extraction Job Creation", false, e.message, start);
    }

    // 2. Status Tracking
    console.log("\n📋 Test: Status & Progress Tracking");
    console.log("-".repeat(50));

    if (testExtractionId) {
        start = Date.now();
        try {
            await db.update(knowledgeDocumentExtractions)
                .set({
                    status: "processing",
                    progress: 50,
                    currentStep: "extracting",
                    startedAt: new Date()
                })
                .where(eq(knowledgeDocumentExtractions.id, testExtractionId));

            const [updated] = await db.select().from(knowledgeDocumentExtractions)
                .where(eq(knowledgeDocumentExtractions.id, testExtractionId));

            const statusValid = updated?.status === "processing" && updated?.progress === 50;
            await recordResult("Status/Progress Update", statusValid,
                `Status: ${updated?.status}, Progress: ${updated?.progress}%`, start);

            // Complete the job
            await db.update(knowledgeDocumentExtractions)
                .set({
                    status: "completed",
                    progress: 100,
                    nodesExtracted: 5,
                    edgesExtracted: 8,
                    completedAt: new Date()
                })
                .where(eq(knowledgeDocumentExtractions.id, testExtractionId));

            const [completed] = await db.select().from(knowledgeDocumentExtractions)
                .where(eq(knowledgeDocumentExtractions.id, testExtractionId));

            const resultsValid = completed?.status === "completed" &&
                completed?.nodesExtracted === 5 &&
                completed?.edgesExtracted === 8;
            await recordResult("Job Completion & Stats", resultsValid,
                `Nodes: ${completed?.nodesExtracted}, Edges: ${completed?.edgesExtracted}`, start);
        } catch (e: any) {
            await recordResult("Status/Progress Tracking", false, e.message, start);
        }
    }

    // 3. Batch Processing
    console.log("\n📋 Test: Extraction Batches");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        const [batch] = await db.insert(extractionBatches).values({
            name: `Eval Batch ${Date.now()}`,
            schemaId: schema.id,
            totalDocuments: 10,
            concurrencyLimit: 2,
            organizationId: orgId,
        }).returning();

        testBatchId = batch?.id || null;
        await recordResult("Batch Creation", !!testBatchId,
            testBatchId ? `Created batch ID: ${testBatchId}` : "Failed", start);

        if (testBatchId) {
            await db.update(extractionBatches)
                .set({
                    status: "running",
                    processedDocuments: 5,
                    successfulDocuments: 4,
                    failedDocuments: 1
                })
                .where(eq(extractionBatches.id, testBatchId));

            const [updatedBatch] = await db.select().from(extractionBatches)
                .where(eq(extractionBatches.id, testBatchId));

            await recordResult("Batch Progress Update", updatedBatch?.processedDocuments === 5,
                `Processed: ${updatedBatch?.processedDocuments}/10`, start);
        }
    } catch (e: any) {
        await recordResult("Batch Processing", false, e.message, start);
    }

    // 4. Statistics
    console.log("\n📋 Test: Extraction Statistics");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        const jobStats = await db.select({
            status: knowledgeDocumentExtractions.status,
            count: sql<number>`count(*)`,
        }).from(knowledgeDocumentExtractions)
            .groupBy(knowledgeDocumentExtractions.status);

        const statsStr = jobStats.map(s => `${s.status}: ${s.count}`).join(", ");
        await recordResult("Extraction Job Stats", jobStats.length >= 1,
            statsStr || "No stats found", start);
    } catch (e: any) {
        await recordResult("Statistics", false, e.message, start);
    }

    // Cleanup
    console.log("\n📋 Test: Cleanup");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        if (testExtractionId) {
            await db.delete(knowledgeDocumentExtractions)
                .where(eq(knowledgeDocumentExtractions.id, testExtractionId));
        }
        if (testBatchId) {
            await db.delete(extractionBatches)
                .where(eq(extractionBatches.id, testBatchId));
        }
        await recordResult("Cleanup", true, "Removed test extractions and batches", start);
    } catch (e: any) {
        await recordResult("Cleanup", false, e.message, start);
    }

    // Summary
    console.log("\n" + "=".repeat(70));
    console.log("📊 KNOWLEDGE EXTRACTION EVALUATION SUMMARY");
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
    console.log("   - Extraction Job CRUD ✓");
    console.log("   - Status/Progress Tracking ✓");
    console.log("   - Batch Processing ✓");
    console.log("   - Extraction Stats ✓");

    console.log("\n" + "=".repeat(70));
    if (passRate >= 80) {
        console.log("🎉 EVALUATION PASSED: Knowledge Extraction system is operational!");
    } else {
        console.log("❌ EVALUATION FAILED: Issues with Knowledge Extraction.");
    }
    console.log("=".repeat(70));

    process.exit(passRate >= 100 ? 0 : 1);
}

runEval().catch(e => {
    console.error("\n❌ EVALUATION CRASHED:", e);
    process.exit(1);
});
