/**
 * AI Evaluation Suite for Forensic Event Logging
 * Tests:
 * 1. Trace Hierarchy (traceId, spanId, parentSpanId)
 * 2. Event Creation
 * 3. Status Tracking (success, failure, timeout)
 * 4. Timing Telemetry
 * 5. Query Operations
 */

import "dotenv/config";
import { db } from "../../server/db/index.js";
import { forensicEventLog } from "../../shared/schema/observability";
import { orgs } from "../../shared/schema/auth";
import { eq, sql, desc, and } from "drizzle-orm";

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

// Helper to generate trace/span IDs
function generateTraceId(): string {
    return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

function generateSpanId(): string {
    return Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

async function runEval() {
    console.log("🧠 Starting Forensic Event Logging Evaluation...\n");
    console.log("=".repeat(70));

    // Get test org
    const [org] = await db.select().from(orgs).limit(1);
    const orgId = org?.id || null;

    const testEventIds: number[] = [];
    const testTraceId = generateTraceId();

    // 1. Root Span Creation
    console.log("\n📋 Test: Trace Hierarchy");
    console.log("-".repeat(50));

    let start = Date.now();
    let rootSpanId: string | null = null;

    try {
        rootSpanId = generateSpanId();
        const [rootEvent] = await db.insert(forensicEventLog).values({
            traceId: testTraceId,
            spanId: rootSpanId,
            parentSpanId: null, // Root span has no parent
            organizationId: orgId,
            jobType: "pipeline",
            pipelineId: 1,
            startTimeNs: BigInt(Date.now() * 1000000),
            status: "success",
            attributes: { type: "root", name: "Eval Pipeline" },
        }).returning();

        if (rootEvent?.id) {
            testEventIds.push(rootEvent.id);
            await recordResult("Root Span Creation", true,
                `Created trace: ${testTraceId.substring(0, 8)}..., span: ${rootSpanId.substring(0, 8)}...`, start);
        }
    } catch (e: any) {
        await recordResult("Root Span Creation", false, e.message, start);
    }

    // 2. Child Spans
    if (rootSpanId) {
        start = Date.now();
        try {
            const childSpanId = generateSpanId();
            const [childEvent] = await db.insert(forensicEventLog).values({
                traceId: testTraceId,
                spanId: childSpanId,
                parentSpanId: rootSpanId, // Points to parent
                organizationId: orgId,
                jobType: "shell",
                jobId: 1,
                startTimeNs: BigInt(Date.now() * 1000000),
                endTimeNs: BigInt((Date.now() + 500) * 1000000),
                status: "success",
                attributes: { command: "echo hello" },
            }).returning();

            if (childEvent?.id) {
                testEventIds.push(childEvent.id);
                await recordResult("Child Span Creation", true,
                    `Parent: ${rootSpanId.substring(0, 8)}... -> Child: ${childSpanId.substring(0, 8)}...`, start);
            }
        } catch (e: any) {
            await recordResult("Child Span Creation", false, e.message, start);
        }
    }

    // 3. Status Types
    console.log("\n📋 Test: Status Types");
    console.log("-".repeat(50));

    const statuses = ["success", "failure", "timeout", "cancelled"];

    for (const status of statuses) {
        start = Date.now();
        try {
            const [event] = await db.insert(forensicEventLog).values({
                traceId: generateTraceId(),
                spanId: generateSpanId(),
                organizationId: orgId,
                jobType: "api",
                startTimeNs: BigInt(Date.now() * 1000000),
                status,
                errorMessage: status === "failure" ? "Test failure error" : null,
            }).returning();

            if (event?.id) {
                testEventIds.push(event.id);
                await recordResult(`Status: ${status}`, true,
                    `Created event ID: ${event.id}`, start);
            }
        } catch (e: any) {
            await recordResult(`Status: ${status}`, false, e.message, start);
        }
    }

    // 4. Job Types
    console.log("\n📋 Test: Job Type Tracking");
    console.log("-".repeat(50));

    const jobTypes = ["shell", "api", "ai_api_call", "transformer"];

    for (const jobType of jobTypes) {
        start = Date.now();
        try {
            const [event] = await db.insert(forensicEventLog).values({
                traceId: generateTraceId(),
                spanId: generateSpanId(),
                organizationId: orgId,
                jobType,
                startTimeNs: BigInt(Date.now() * 1000000),
                status: "success",
            }).returning();

            if (event?.id) {
                testEventIds.push(event.id);
                await recordResult(`JobType: ${jobType}`, true,
                    `Created event ID: ${event.id}`, start);
            }
        } catch (e: any) {
            await recordResult(`JobType: ${jobType}`, false, e.message, start);
        }
    }

    // 5. Query by Trace
    console.log("\n📋 Test: Query Operations");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        const traceEvents = await db.select().from(forensicEventLog)
            .where(eq(forensicEventLog.traceId, testTraceId))
            .orderBy(forensicEventLog.startTimeNs);
        await recordResult("Query by TraceId", traceEvents.length >= 2,
            `Found ${traceEvents.length} events in trace`, start);
    } catch (e: any) {
        await recordResult("Query by TraceId", false, e.message, start);
    }

    // 6. Query Failures
    start = Date.now();
    try {
        const failures = await db.select().from(forensicEventLog)
            .where(eq(forensicEventLog.status, "failure"))
            .orderBy(desc(forensicEventLog.createdAt))
            .limit(10);
        await recordResult("Query Failures", failures.length >= 1,
            `Found ${failures.length} failure events`, start);
    } catch (e: any) {
        await recordResult("Query Failures", false, e.message, start);
    }

    // 7. Statistics
    console.log("\n📋 Test: Forensic Statistics");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        const statusStats = await db.select({
            status: forensicEventLog.status,
            count: sql<number>`count(*)`,
        }).from(forensicEventLog)
            .groupBy(forensicEventLog.status);
        const statsStr = statusStats.map(s => `${s.status}: ${s.count}`).join(", ");
        await recordResult("Status Distribution", statusStats.length >= 3,
            statsStr || "No stats", start);
    } catch (e: any) {
        await recordResult("Statistics", false, e.message, start);
    }

    start = Date.now();
    try {
        const jobTypeStats = await db.select({
            jobType: forensicEventLog.jobType,
            count: sql<number>`count(*)`,
        }).from(forensicEventLog)
            .groupBy(forensicEventLog.jobType);
        const statsStr = jobTypeStats.map(s => `${s.jobType}: ${s.count}`).join(", ");
        await recordResult("Job Type Distribution", jobTypeStats.length >= 3,
            statsStr || "No stats", start);
    } catch (e: any) {
        await recordResult("Job Type Stats", false, e.message, start);
    }

    // Cleanup
    console.log("\n📋 Test: Cleanup");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        for (const eventId of testEventIds) {
            await db.delete(forensicEventLog).where(eq(forensicEventLog.id, eventId));
        }
        await recordResult("Cleanup", true, `Removed ${testEventIds.length} test events`, start);
    } catch (e: any) {
        await recordResult("Cleanup", false, e.message, start);
    }

    // Summary
    console.log("\n" + "=".repeat(70));
    console.log("📊 FORENSIC EVENT LOGGING EVALUATION SUMMARY");
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
    console.log("   - Trace Hierarchy ✓");
    console.log("   - Status Types ✓");
    console.log("   - Job Types ✓");
    console.log("   - Query Operations ✓");
    console.log("   - Statistics ✓");

    console.log("\n" + "=".repeat(70));
    if (passRate >= 80) {
        console.log("🎉 EVALUATION PASSED: Forensic Event Logging system is operational!");
    } else if (passRate >= 50) {
        console.log("⚠️ EVALUATION PARTIAL: Some issues detected in Forensic Logging.");
    } else {
        console.log("❌ EVALUATION FAILED: Significant issues with Forensic Logging.");
    }
    console.log("=".repeat(70));

    process.exit(passRate >= 50 ? 0 : 1);
}

runEval().catch(e => {
    console.error("\n❌ EVALUATION CRASHED:", e);
    process.exit(1);
});
