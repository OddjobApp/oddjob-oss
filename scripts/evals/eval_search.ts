/**
 * AI Evaluation Suite for Universal Analyst Search
 * Tests:
 * 1. Query Classification (Keyword vs Graph vs Semantic)
 * 2. Unified Search Results (Jobs, Pipelines, Datasets)
 * 3. Search Relevance Scores
 */

import "dotenv/config";
import { searchService } from "@domain/knowledge/core/search/search-service.js";
const { classifySearchQuery, executeUnifiedSearch } = searchService;

import { db } from "../../server/db/index.js";
import { datasets, fineTuningDatasets } from "../../shared/schema";
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
    console.log("🧠 Starting Universal Search Evaluation...\n");
    console.log("=".repeat(70));

    // 1. Classification Tests
    console.log("\n📋 Test: Search Query Classification");
    console.log("-".repeat(50));

    const classificationTests = [
        { q: "How do I fix a timeout?", expected: "vector" },
        { q: "Connections between JIRA and Slack", expected: "graph" },
        { q: "Show me all active pipelines", expected: "vector" }, // 5 words = vector fallback
        { q: "dataset:customer_records", expected: "keyword" }, // Classification routes short queries to keyword
    ];

    for (const test of classificationTests) {
        let start = Date.now();
        try {
            const res = await classifySearchQuery(test.q);
            console.log(`🔍 Debug: Query "${test.q}" -> ${res.queryType} (${res.confidence}) - ${res.explanation}`);
            await recordResult(`Classify: "${test.q}"`, res.queryType === test.expected,
                `Expected: ${test.expected}, Got: ${res.queryType}`, start);
        } catch (e: any) {
            await recordResult(`Classify: "${test.q}"`, false, e.message, start);
        }
    }

    // 2. Unified Search Results
    console.log("\n📋 Test: Unified Search Results");
    console.log("-".repeat(50));

    // Get test org
    const [org] = await db.select().from(orgs).limit(1);
    const orgId = org?.id || null;

    let start = Date.now();
    try {
        // Create a test dataset to find
        const [ds] = await db.insert(datasets).values({
            name: "Search Eval Dataset",
            description: "Testing unified search routing",
            organizationId: orgId,
        }).returning();

        const searchRes = await executeUnifiedSearch("Search Eval", "keyword", orgId);
        const found = searchRes.some((r: any) => r.type === "dataset" && r.title === "Search Eval Dataset");

        await recordResult("Unified Search: Find Dataset", found,
            `Found: ${found}, Total results: ${searchRes.length}`, start);

        if (ds?.id) await db.delete(datasets).where(eq(datasets.id, ds.id));
    } catch (e: any) {
        await recordResult("Unified Search: Find Dataset", false, e.message, start);
    }

    // 3. Score Sorting
    start = Date.now();
    try {
        const searchRes = await executeUnifiedSearch("Pipeline", "unknown", orgId);
        const scores = searchRes.map((r: any) => r.score || 0);
        const sorted = [...scores].sort((a, b) => b - a);
        const isSorted = JSON.stringify(scores) === JSON.stringify(sorted);

        await recordResult("Result Scoring/Ordering", isSorted,
            `Scores: ${scores.join(", ")}`, start);
    } catch (e: any) {
        await recordResult("Result Scoring/Ordering", false, e.message, start);
    }

    // Summary
    console.log("\n" + "=".repeat(70));
    console.log("📊 UNIVERSAL SEARCH EVALUATION SUMMARY");
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
    console.log("   - Query Intent Classification ✓");
    console.log("   - Cross-domain Search Routing ✓");
    console.log("   - Relevance Scoring ✓");

    console.log("\n" + "=".repeat(70));
    if (passRate >= 80) {
        console.log("🎉 EVALUATION PASSED: Universal Search system is operational!");
    } else {
        console.log("❌ EVALUATION FAILED: Issues with Universal Search.");
    }
    console.log("=".repeat(70));

    process.exit(passRate >= 100 ? 0 : 1);
}

runEval().catch(e => {
    console.error("\n❌ EVALUATION CRASHED:", e);
    process.exit(1);
});
