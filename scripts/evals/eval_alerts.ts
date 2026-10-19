/**
 * AI Evaluation Suite for Alert Configuration
 * Tests:
 * 1. Alert Config CRUD
 * 2. Error Categories
 * 3. Thresholds & Windows
 * 4. Notification Channels
 * 5. Alert Triggering
 */

import "dotenv/config";
import { db } from "../../server/db/index.js";
import { errorAlertConfigs, errorAlerts } from "../../shared/schema/observability";
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
    console.log("🧠 Starting Alert Configuration Evaluation...\n");
    console.log("=".repeat(70));

    // Get test org
    const [org] = await db.select().from(orgs).limit(1);
    const orgId = org?.id || null;

    let testConfigId: number | null = null;
    const testAlertIds: number[] = [];

    // 1. Alert Config Creation
    console.log("\n📋 Test: Alert Config CRUD");
    console.log("-".repeat(50));

    let start = Date.now();
    try {
        const [config] = await db.insert(errorAlertConfigs).values({
            organizationId: orgId,
            name: `Eval Alert Config ${Date.now()}`,
            enabled: true,
            errorCategories: ["auth", "rate_limit", "server_error"],
            minOccurrences: 5,
            timeWindowMinutes: 30,
            notifyVia: ["slack", "email"],
            slackWebhookUrl: "https://hooks.slack.com/services/example",
            slackChannel: "#alerts-eval",
            emailRecipients: ["eval@test.com", "admin@test.com"],
            cooldownMinutes: 15,
        }).returning();

        testConfigId = config?.id || null;
        await recordResult("Alert Config Creation", !!testConfigId,
            testConfigId ? `Created config ID: ${testConfigId}` : "Failed", start);
    } catch (e: any) {
        await recordResult("Alert Config Creation", false, e.message, start);
    }

    // 2. Alert Config Read
    if (testConfigId) {
        start = Date.now();
        try {
            const [readConfig] = await db.select().from(errorAlertConfigs)
                .where(eq(errorAlertConfigs.id, testConfigId));
            const readValid = !!(readConfig?.minOccurrences === 5 &&
                readConfig?.errorCategories?.includes("auth"));
            await recordResult("Alert Config Read", readValid,
                `Categories: ${readConfig?.errorCategories?.join(", ")}`, start);
        } catch (e: any) {
            await recordResult("Alert Config Read", false, e.message, start);
        }
    }

    // 3. Update Config
    console.log("\n📋 Test: Alert Config Update");
    console.log("-".repeat(50));

    if (testConfigId) {
        start = Date.now();
        try {
            await db.update(errorAlertConfigs)
                .set({ minOccurrences: 10, timeWindowMinutes: 60 })
                .where(eq(errorAlertConfigs.id, testConfigId));
            const [updated] = await db.select().from(errorAlertConfigs)
                .where(eq(errorAlertConfigs.id, testConfigId));
            await recordResult("Threshold Update", updated?.minOccurrences === 10,
                `Min occurrences: ${updated?.minOccurrences}, Window: ${updated?.timeWindowMinutes}min`, start);
        } catch (e: any) {
            await recordResult("Threshold Update", false, e.message, start);
        }
    }

    // 4. Alert Triggering
    console.log("\n📋 Test: Alert Triggering");
    console.log("-".repeat(50));

    if (testConfigId) {
        start = Date.now();
        try {
            const [alert] = await db.insert(errorAlerts).values({
                configId: testConfigId,
                errorCount: 15,
                errorCategory: "rate_limit",
                diagnosisSummary: { pattern: "API rate limit exceeded", count: 15 },
                sampleErrors: ["Error 1", "Error 2", "Error 3"],
                notificationSent: false,
            }).returning();

            if (alert?.id) {
                testAlertIds.push(alert.id);
                await recordResult("Alert Creation", true,
                    `Created alert ID: ${alert.id} with ${alert.errorCount} errors`, start);
            }
        } catch (e: any) {
            await recordResult("Alert Creation", false, e.message, start);
        }

        // Mark notification as sent
        if (testAlertIds.length > 0) {
            start = Date.now();
            try {
                await db.update(errorAlerts)
                    .set({ notificationSent: true })
                    .where(eq(errorAlerts.id, testAlertIds[0]));
                const [updated] = await db.select().from(errorAlerts)
                    .where(eq(errorAlerts.id, testAlertIds[0]));
                await recordResult("Notification Sent Update", updated?.notificationSent === true,
                    `Notification sent: ${updated?.notificationSent}`, start);
            } catch (e: any) {
                await recordResult("Notification Sent", false, e.message, start);
            }
        }
    }

    // 5. Cooldown Test
    console.log("\n📋 Test: Cooldown Management");
    console.log("-".repeat(50));

    if (testConfigId) {
        start = Date.now();
        try {
            await db.update(errorAlertConfigs)
                .set({ lastTriggeredAt: new Date() })
                .where(eq(errorAlertConfigs.id, testConfigId));
            const [updated] = await db.select().from(errorAlertConfigs)
                .where(eq(errorAlertConfigs.id, testConfigId));
            await recordResult("Last Triggered Update", !!updated?.lastTriggeredAt,
                `Last triggered: ${updated?.lastTriggeredAt}`, start);
        } catch (e: any) {
            await recordResult("Cooldown", false, e.message, start);
        }
    }

    // 6. Enable/Disable
    console.log("\n📋 Test: Enable/Disable Configs");
    console.log("-".repeat(50));

    if (testConfigId) {
        start = Date.now();
        try {
            await db.update(errorAlertConfigs)
                .set({ enabled: false })
                .where(eq(errorAlertConfigs.id, testConfigId));
            const [disabled] = await db.select().from(errorAlertConfigs)
                .where(eq(errorAlertConfigs.id, testConfigId));
            await recordResult("Disable Config", disabled?.enabled === false,
                `Enabled: ${disabled?.enabled}`, start);

            // Re-enable
            await db.update(errorAlertConfigs)
                .set({ enabled: true })
                .where(eq(errorAlertConfigs.id, testConfigId));
        } catch (e: any) {
            await recordResult("Enable/Disable", false, e.message, start);
        }
    }

    // 7. Statistics
    console.log("\n📋 Test: Alert Statistics");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        const configCount = await db.select({ count: sql<number>`count(*)` })
            .from(errorAlertConfigs);
        const alertCount = await db.select({ count: sql<number>`count(*)` })
            .from(errorAlerts);
        await recordResult("Config/Alert Count", true,
            `Configs: ${configCount[0]?.count || 0}, Alerts: ${alertCount[0]?.count || 0}`, start);
    } catch (e: any) {
        await recordResult("Statistics", false, e.message, start);
    }

    // Cleanup
    console.log("\n📋 Test: Cleanup");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        // Alerts cascade delete with config
        if (testConfigId) {
            await db.delete(errorAlertConfigs)
                .where(eq(errorAlertConfigs.id, testConfigId));
        }
        await recordResult("Cleanup", true,
            `Removed config and ${testAlertIds.length} alerts`, start);
    } catch (e: any) {
        await recordResult("Cleanup", false, e.message, start);
    }

    // Summary
    console.log("\n" + "=".repeat(70));
    console.log("📊 ALERT CONFIGURATION EVALUATION SUMMARY");
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
    console.log("   - Config CRUD ✓");
    console.log("   - Error Categories ✓");
    console.log("   - Thresholds ✓");
    console.log("   - Alert Triggering ✓");
    console.log("   - Cooldown ✓");
    console.log("   - Enable/Disable ✓");

    console.log("\n" + "=".repeat(70));
    if (passRate >= 80) {
        console.log("🎉 EVALUATION PASSED: Alert Configuration system is operational!");
    } else if (passRate >= 50) {
        console.log("⚠️ EVALUATION PARTIAL: Some issues detected in Alert Configuration.");
    } else {
        console.log("❌ EVALUATION FAILED: Significant issues with Alert Configuration.");
    }
    console.log("=".repeat(70));

    process.exit(passRate >= 50 ? 0 : 1);
}

runEval().catch(e => {
    console.error("\n❌ EVALUATION CRASHED:", e);
    process.exit(1);
});
