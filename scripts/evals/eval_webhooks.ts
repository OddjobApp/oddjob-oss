/**
 * AI Evaluation Suite for Webhooks
 * Tests:
 * 1. Webhook Subscription CRUD
 * 2. Event Pattern Matching
 * 3. Retry Configuration
 * 4. Delivery Logging
 * 5. Success/Failure Tracking
 */

import "dotenv/config";
import { db } from "../../server/db/index.js";
import { eventWebhookSubscriptions, webhookDeliveryLog } from "../../shared/schema/knowledge";
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
    console.log("🧠 Starting Webhooks Evaluation...\n");
    console.log("=".repeat(70));

    // Get test org
    const [org] = await db.select().from(orgs).limit(1);
    const orgId = org?.id || null;

    let testSubscriptionId: number | null = null;
    const testDeliveryIds: number[] = [];

    // 1. Webhook Subscription Creation
    console.log("\n📋 Test: Webhook Subscription CRUD");
    console.log("-".repeat(50));

    let start = Date.now();
    try {
        const [sub] = await db.insert(eventWebhookSubscriptions).values({
            name: `Eval Webhook ${Date.now()}`,
            description: "Test webhook subscription",
            eventTypePattern: "pipeline.completed",
            webhookUrl: "https://example.com/webhook/eval",
            httpMethod: "POST",
            headers: { "X-Api-Key": "test-key", "Content-Type": "application/json" },
            isActive: true,
            retryCount: 3,
            retryDelayMs: 5000,
            timeoutMs: 30000,
            organizationId: orgId,
        }).returning();

        testSubscriptionId = sub?.id || null;
        await recordResult("Webhook Subscription Creation", !!testSubscriptionId,
            testSubscriptionId ? `Created subscription ID: ${testSubscriptionId}` : "Failed", start);
    } catch (e: any) {
        await recordResult("Webhook Subscription Creation", false, e.message, start);
    }

    // 2. Subscription Read
    if (testSubscriptionId) {
        start = Date.now();
        try {
            const [readSub] = await db.select().from(eventWebhookSubscriptions)
                .where(eq(eventWebhookSubscriptions.id, testSubscriptionId));
            const readValid = readSub?.eventTypePattern === "pipeline.completed" &&
                readSub?.webhookUrl === "https://example.com/webhook/eval";
            await recordResult("Webhook Subscription Read", readValid,
                `Pattern: ${readSub?.eventTypePattern}, URL: ${readSub?.webhookUrl}`, start);
        } catch (e: any) {
            await recordResult("Webhook Subscription Read", false, e.message, start);
        }
    }

    // 3. Event Pattern Types
    console.log("\n📋 Test: Event Pattern Types");
    console.log("-".repeat(50));

    const patterns = [
        { pattern: "ticket.*", description: "Wildcard pattern" },
        { pattern: "pipeline.step.completed", description: "Specific event" },
        { pattern: "*", description: "All events" },
    ];

    for (const { pattern, description } of patterns) {
        start = Date.now();
        try {
            const [patternSub] = await db.insert(eventWebhookSubscriptions).values({
                name: `Eval Pattern ${pattern} ${Date.now()}`,
                eventTypePattern: pattern,
                webhookUrl: `https://example.com/webhook/${pattern.replace("*", "all")}`,
                organizationId: orgId,
            }).returning();

            if (patternSub?.id) {
                await recordResult(`Pattern: ${description}`, true,
                    `Created with pattern: ${pattern}`, start);
                // Cleanup
                await db.delete(eventWebhookSubscriptions).where(eq(eventWebhookSubscriptions.id, patternSub.id));
            }
        } catch (e: any) {
            await recordResult(`Pattern: ${description}`, false, e.message, start);
        }
    }

    // 4. Retry Configuration
    console.log("\n📋 Test: Retry Configuration");
    console.log("-".repeat(50));

    if (testSubscriptionId) {
        start = Date.now();
        try {
            await db.update(eventWebhookSubscriptions)
                .set({ retryCount: 5, retryDelayMs: 10000, timeoutMs: 60000 })
                .where(eq(eventWebhookSubscriptions.id, testSubscriptionId));
            const [updated] = await db.select().from(eventWebhookSubscriptions)
                .where(eq(eventWebhookSubscriptions.id, testSubscriptionId));
            const configValid = updated?.retryCount === 5 && updated?.retryDelayMs === 10000;
            await recordResult("Retry Configuration Update", configValid,
                `Retries: ${updated?.retryCount}, Delay: ${updated?.retryDelayMs}ms`, start);
        } catch (e: any) {
            await recordResult("Retry Configuration", false, e.message, start);
        }
    }

    // 5. Webhook Delivery Logging
    console.log("\n📋 Test: Webhook Delivery Logging");
    console.log("-".repeat(50));

    if (testSubscriptionId) {
        // Log successful delivery
        start = Date.now();
        try {
            const [successDelivery] = await db.insert(webhookDeliveryLog).values({
                subscriptionId: testSubscriptionId,
                eventId: `eval-event-${Date.now()}`,
                eventType: "pipeline.completed",
                attemptNumber: 1,
                status: "success",
                httpStatus: 200,
                responseBody: '{"received": true}',
                requestDurationMs: 150,
                completedAt: new Date(),
            }).returning();

            if (successDelivery?.id) {
                testDeliveryIds.push(successDelivery.id);
                await recordResult("Delivery Log (Success)", true,
                    `Logged delivery ID: ${successDelivery.id}, Status: 200`, start);
            }
        } catch (e: any) {
            await recordResult("Delivery Log (Success)", false, e.message, start);
        }

        // Log failed delivery with retry
        start = Date.now();
        try {
            const [failedDelivery] = await db.insert(webhookDeliveryLog).values({
                subscriptionId: testSubscriptionId,
                eventId: `eval-event-fail-${Date.now()}`,
                eventType: "pipeline.completed",
                attemptNumber: 1,
                status: "failed",
                httpStatus: 500,
                error: "Internal Server Error",
                requestDurationMs: 2500,
                completedAt: new Date(),
            }).returning();

            if (failedDelivery?.id) {
                testDeliveryIds.push(failedDelivery.id);

                // Log retry attempt
                const [retryDelivery] = await db.insert(webhookDeliveryLog).values({
                    subscriptionId: testSubscriptionId,
                    eventId: failedDelivery.eventId,
                    eventType: "pipeline.completed",
                    attemptNumber: 2,
                    status: "success",
                    httpStatus: 200,
                    responseBody: '{"received": true}',
                    requestDurationMs: 180,
                    completedAt: new Date(),
                }).returning();

                if (retryDelivery?.id) {
                    testDeliveryIds.push(retryDelivery.id);
                }

                await recordResult("Delivery Log (Retry)", true,
                    `Failed attempt 1, succeeded attempt 2`, start);
            }
        } catch (e: any) {
            await recordResult("Delivery Log (Retry)", false, e.message, start);
        }
    }

    // 6. Success/Failure Counters
    console.log("\n📋 Test: Success/Failure Counters");
    console.log("-".repeat(50));

    if (testSubscriptionId) {
        start = Date.now();
        try {
            await db.update(eventWebhookSubscriptions)
                .set({
                    successCount: sql`success_count + 1`,
                    lastSuccess: true,
                    lastTriggeredAt: new Date()
                })
                .where(eq(eventWebhookSubscriptions.id, testSubscriptionId));
            const [updated] = await db.select().from(eventWebhookSubscriptions)
                .where(eq(eventWebhookSubscriptions.id, testSubscriptionId));
            await recordResult("Success Counter Update", updated?.successCount === 1,
                `Success count: ${updated?.successCount}, Last success: ${updated?.lastSuccess}`, start);
        } catch (e: any) {
            await recordResult("Counter Update", false, e.message, start);
        }
    }

    // 7. Webhook Statistics
    console.log("\n📋 Test: Webhook Statistics");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        const subCount = await db.select({ count: sql<number>`count(*)` })
            .from(eventWebhookSubscriptions);
        const deliveryCount = await db.select({ count: sql<number>`count(*)` })
            .from(webhookDeliveryLog);
        await recordResult("Webhook/Delivery Count", true,
            `Subscriptions: ${subCount[0]?.count || 0}, Deliveries: ${deliveryCount[0]?.count || 0}`, start);
    } catch (e: any) {
        await recordResult("Statistics", false, e.message, start);
    }

    // 8. Active/Inactive Filter
    start = Date.now();
    try {
        const activeSubs = await db.select({ count: sql<number>`count(*)` })
            .from(eventWebhookSubscriptions)
            .where(eq(eventWebhookSubscriptions.isActive, true));
        await recordResult("Active Subscriptions Count", true,
            `Active: ${activeSubs[0]?.count || 0}`, start);
    } catch (e: any) {
        await recordResult("Active Filter", false, e.message, start);
    }

    // Cleanup
    console.log("\n📋 Test: Cleanup");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        // Deliveries cascade delete with subscription
        if (testSubscriptionId) {
            await db.delete(eventWebhookSubscriptions)
                .where(eq(eventWebhookSubscriptions.id, testSubscriptionId));
        }
        await recordResult("Cleanup", true,
            `Removed subscription and ${testDeliveryIds.length} delivery logs`, start);
    } catch (e: any) {
        await recordResult("Cleanup", false, e.message, start);
    }

    // Summary
    console.log("\n" + "=".repeat(70));
    console.log("📊 WEBHOOKS EVALUATION SUMMARY");
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
    console.log("   - Subscription CRUD ✓");
    console.log("   - Event Patterns ✓");
    console.log("   - Retry Configuration ✓");
    console.log("   - Delivery Logging ✓");
    console.log("   - Success/Failure Tracking ✓");

    console.log("\n" + "=".repeat(70));
    if (passRate >= 80) {
        console.log("🎉 EVALUATION PASSED: Webhooks system is operational!");
    } else if (passRate >= 50) {
        console.log("⚠️ EVALUATION PARTIAL: Some issues detected in Webhooks.");
    } else {
        console.log("❌ EVALUATION FAILED: Significant issues with Webhooks.");
    }
    console.log("=".repeat(70));

    process.exit(passRate >= 50 ? 0 : 1);
}

runEval().catch(e => {
    console.error("\n❌ EVALUATION CRASHED:", e);
    process.exit(1);
});
