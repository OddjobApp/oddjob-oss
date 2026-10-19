
import "dotenv/config";
import { handleGetUserIntent } from "../../server/mcp/handlers";
import { db } from "../../server/db/index.js";
import { contactIntentStates, engagementLogs } from "../../shared/schema";
import { eq } from "drizzle-orm";

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
    console.log("🧠 Starting Ephemeral Event Engine & Concierge Evaluation...\n");
    console.log("=".repeat(70));

    const testFingerprint = "test-fingerprint-" + Date.now();
    const testStateVector = "S:High C:Low O:Med R:High E:Low";

    // 1. Database Persistence Test
    console.log("\n📋 Test: Database Persistence");
    console.log("-".repeat(50));

    let start = Date.now();
    try {
        await db.insert(contactIntentStates).values({
            userFingerprint: testFingerprint,
            stateVector: testStateVector,
            confidence: 0.85,
            routePath: "/test/path"
        });

        await db.insert(engagementLogs).values({
            userFingerprint: testFingerprint,
            strategyName: "aggressive_upsell",
            promptText: "Buy now!",
            userAction: "clicked"
        });

        const states = await db.select().from(contactIntentStates).where(eq(contactIntentStates.userFingerprint, testFingerprint));
        const logs = await db.select().from(engagementLogs).where(eq(engagementLogs.userFingerprint, testFingerprint));

        const passed = states.length > 0 && logs.length > 0;
        await recordResult("Persist State & Logs", passed,
            `States: ${states.length}, Logs: ${logs.length}`, start);

    } catch (e: any) {
        await recordResult("Persist State & Logs", false, e.message, start);
    }

    // 2. Concierge Handler Test
    console.log("\n📋 Test: Concierge Tool (get_user_intent)");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        const response: any = await handleGetUserIntent({
            fingerprint: testFingerprint
        });

        // MCP response format: { content: [{ type: 'text', text: JSON_STRING }] }
        const parsedContent = JSON.parse(response.content[0].text);

        const passed = parsedContent.success === true &&
            parsedContent.data.current_state.vector === testStateVector &&
            parsedContent.data.recent_engagements.length > 0;

        await recordResult("Retrieve User Context", passed,
            `Success: ${parsedContent.success}, Vector Matches: ${parsedContent.data?.current_state?.vector === testStateVector}`, start);

    } catch (e: any) {
        await recordResult("Retrieve User Context", false, e.message, start);
    }

    // 3. Error Case Test
    start = Date.now();
    try {
        const response: any = await handleGetUserIntent({
            fingerprint: "non-existent-user"
        });

        const parsedContent = JSON.parse(response.content[0].text);

        const passed = parsedContent.success === false;

        await recordResult("Handle Missing User", passed,
            `Expected success: false, Got: ${parsedContent.success}`, start);

    } catch (e: any) {
        await recordResult("Handle Missing User", false, e.message, start);
    }

    // Cleanup
    try {
        await db.delete(contactIntentStates).where(eq(contactIntentStates.userFingerprint, testFingerprint));
        await db.delete(engagementLogs).where(eq(engagementLogs.userFingerprint, testFingerprint));
        console.log("\n🧹 Cleaned up test data.");
    } catch (e) {
        console.error("Cleanup failed:", e);
    }

    // Summary
    console.log("\n" + "=".repeat(70));
    console.log("📊 EPHEMERAL ENGINE EVALUATION SUMMARY");
    console.log("=".repeat(70));

    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    const passRate = (passed / results.length) * 100;

    console.log(`\n   Total Tests: ${results.length}`);
    console.log(`   Passed: ${passed}`);
    console.log(`   Failed: ${failed}`);
    console.log(`   Pass Rate: ${passRate.toFixed(1)}%`);
    console.log(`   Total Duration: ${results.reduce((a, r) => a + r.duration, 0)}ms`);

    if (passRate >= 100) {
        console.log("🎉 EVALUATION PASSED: Ephemeral Engine is operational!");
    } else {
        console.log("❌ EVALUATION FAILED: Issues found.");
    }
    console.log("=".repeat(70));
}

runEval().catch(e => {
    console.error("\n❌ EVALUATION CRASHED:", e);
    process.exit(1);
});
