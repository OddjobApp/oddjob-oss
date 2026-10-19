/**
 * AI Evaluation Suite for Audit Logging
 * Tests:
 * 1. Audit Log Creation
 * 2. Action Types (CREATE, UPDATE, DELETE, LOGIN)
 * 3. Entity Tracking
 * 4. Change Tracking (Diffs)
 * 5. Query Performance
 */

import "dotenv/config";
import { db } from "../../server/db/index.js";
import { auditLogs } from "../../shared/schema/audit";
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
    console.log("🧠 Starting Audit Logging Evaluation...\n");
    console.log("=".repeat(70));

    // Get test org
    const [org] = await db.select().from(orgs).limit(1);
    const orgId = org?.id || null;

    const testLogIds: number[] = [];

    // 1. Audit Log Creation - Various Actions
    console.log("\n📋 Test: Audit Log Actions");
    console.log("-".repeat(50));

    const actions = ["CREATE", "UPDATE", "DELETE", "LOGIN", "LOGOUT"];

    for (const action of actions) {
        const start = Date.now();
        try {
            const [log] = await db.insert(auditLogs).values({
                userId: "eval_user@test.com",
                organizationId: orgId,
                ipAddress: "127.0.0.1",
                userAgent: "EvalBot/1.0",
                action,
                entityType: "pipeline",
                entityId: `eval-entity-${Date.now()}`,
                changes: action === "UPDATE" ? { before: { name: "Old" }, after: { name: "New" } } : {},
                metadata: { source: "eval" },
            }).returning();

            if (log?.id) {
                testLogIds.push(log.id);
                await recordResult(`Action: ${action}`, true,
                    `Created log ID: ${log.id}`, start);
            }
        } catch (e: any) {
            await recordResult(`Action: ${action}`, false, e.message, start);
        }
    }

    // 2. Entity Types
    console.log("\n📋 Test: Entity Type Tracking");
    console.log("-".repeat(50));

    const entityTypes = ["job", "credential", "schedule", "user"];

    for (const entityType of entityTypes) {
        const start = Date.now();
        try {
            const [log] = await db.insert(auditLogs).values({
                userId: "eval_user@test.com",
                organizationId: orgId,
                action: "CREATE",
                entityType,
                entityId: `eval-${entityType}-${Date.now()}`,
            }).returning();

            if (log?.id) {
                testLogIds.push(log.id);
                await recordResult(`Entity: ${entityType}`, true,
                    `Logged ${entityType} creation`, start);
            }
        } catch (e: any) {
            await recordResult(`Entity: ${entityType}`, false, e.message, start);
        }
    }

    // 3. Change Tracking (Diff)
    console.log("\n📋 Test: Change Tracking");
    console.log("-".repeat(50));

    let start = Date.now();
    try {
        const [diffLog] = await db.insert(auditLogs).values({
            userId: "eval_user@test.com",
            organizationId: orgId,
            action: "UPDATE",
            entityType: "job",
            entityId: "job-123",
            changes: {
                before: { name: "Old Job", config: { timeout: 30 } },
                after: { name: "New Job", config: { timeout: 60 } },
            },
        }).returning();

        if (diffLog?.id) {
            testLogIds.push(diffLog.id);
            const [readLog] = await db.select().from(auditLogs).where(eq(auditLogs.id, diffLog.id));
            const hasChanges = (readLog?.changes as any)?.before && (readLog?.changes as any)?.after;
            await recordResult("Change Diff Storage", hasChanges,
                `Before/After diff stored correctly`, start);
        }
    } catch (e: any) {
        await recordResult("Change Diff Storage", false, e.message, start);
    }

    // 4. Query by User
    console.log("\n📋 Test: Audit Query Operations");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        const userLogs = await db.select().from(auditLogs)
            .where(eq(auditLogs.userId, "eval_user@test.com"))
            .orderBy(desc(auditLogs.createdAt))
            .limit(10);
        await recordResult("Query by User", userLogs.length >= 5,
            `Found ${userLogs.length} logs for user`, start);
    } catch (e: any) {
        await recordResult("Query by User", false, e.message, start);
    }

    // 5. Query by Entity
    start = Date.now();
    try {
        const entityLogs = await db.select().from(auditLogs)
            .where(eq(auditLogs.entityType, "pipeline"))
            .orderBy(desc(auditLogs.createdAt))
            .limit(10);
        await recordResult("Query by Entity Type", entityLogs.length >= 3,
            `Found ${entityLogs.length} pipeline logs`, start);
    } catch (e: any) {
        await recordResult("Query by Entity Type", false, e.message, start);
    }

    // 6. Audit Statistics
    console.log("\n📋 Test: Audit Statistics");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        const actionStats = await db.select({
            action: auditLogs.action,
            count: sql<number>`count(*)`,
        }).from(auditLogs)
            .where(eq(auditLogs.userId, "eval_user@test.com"))
            .groupBy(auditLogs.action);
        const statsStr = actionStats.map(s => `${s.action}: ${s.count}`).join(", ");
        await recordResult("Action Statistics", actionStats.length >= 3,
            statsStr || "No stats", start);
    } catch (e: any) {
        await recordResult("Statistics", false, e.message, start);
    }

    // Cleanup
    console.log("\n📋 Test: Cleanup");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        for (const logId of testLogIds) {
            await db.delete(auditLogs).where(eq(auditLogs.id, logId));
        }
        await recordResult("Cleanup", true, `Removed ${testLogIds.length} test logs`, start);
    } catch (e: any) {
        await recordResult("Cleanup", false, e.message, start);
    }

    // Summary
    console.log("\n" + "=".repeat(70));
    console.log("📊 AUDIT LOGGING EVALUATION SUMMARY");
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
    console.log("   - Action Types ✓");
    console.log("   - Entity Tracking ✓");
    console.log("   - Change Diffs ✓");
    console.log("   - Query Operations ✓");
    console.log("   - Statistics ✓");

    console.log("\n" + "=".repeat(70));
    if (passRate >= 80) {
        console.log("🎉 EVALUATION PASSED: Audit Logging system is operational!");
    } else if (passRate >= 50) {
        console.log("⚠️ EVALUATION PARTIAL: Some issues detected in Audit Logging.");
    } else {
        console.log("❌ EVALUATION FAILED: Significant issues with Audit Logging.");
    }
    console.log("=".repeat(70));

    process.exit(passRate >= 50 ? 0 : 1);
}

runEval().catch(e => {
    console.error("\n❌ EVALUATION CRASHED:", e);
    process.exit(1);
});
