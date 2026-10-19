
import "dotenv/config";
import { db } from "../../server/db/index.js";
import { sql } from "drizzle-orm";
import { createRootTrace, createChildSpan } from "@domain/core/infrastructure/tracing/trace-context.service.js";
import { logForensicEvent } from "@domain/core/infrastructure/tracing/trace-logger.service.js";
import { checkDoomsdayProtocol } from "@domain/core/infrastructure/doomsday-clock.service.js";
import { forensicEventLog } from "@shared/schema/index.js";

import * as fs from 'fs';

function writeLog(msg: string) {
    console.log(msg);
    fs.appendFileSync('eval_log.txt', msg + '\n');
}

async function runEval() {
    fs.writeFileSync('eval_log.txt', '');
    writeLog("🔍 Starting Observability Evaluation...\n");

    // 1. Trace Context Generation
    writeLog("1️⃣  Testing Trace Context Generation...");
    const rootTrace = createRootTrace(true); // Sampled
    writeLog(`   Generared Root Trace: ${rootTrace.traceId}`);

    const childSpan = createChildSpan(rootTrace);
    writeLog(`   Generated Child Span: ${childSpan.spanId} (Parent: ${childSpan.parentSpanId})`);

    if (childSpan.traceId !== rootTrace.traceId) throw new Error("Trace ID Mismatch!");
    writeLog("   ✅ Trace Context Integrity Verified.\n");

    // 2. Doomsday Protocol
    writeLog("2️⃣  Testing Doomsday Safety Protocol...");
    const safetyCheck = await checkDoomsdayProtocol(childSpan);
    writeLog(`   Safety Check Result: ${safetyCheck.safe ? "SAFE" : "UNSAFE"}`);
    if (!safetyCheck.safe) throw new Error(`Unexpected Safety Violation: ${safetyCheck.reason}`);

    // Simulate Max Depth
    const deepTrace = { ...childSpan, depth: 51 };
    const unsafeCheck = await checkDoomsdayProtocol(deepTrace);
    if (unsafeCheck.safe) throw new Error("Doomsday Clock failed to catch max depth!");
    writeLog(`   ✅ Doomsday Clock correctly caught depth violation: ${unsafeCheck.reason}\n`);

    // 3. Forensic Logging
    writeLog("3️⃣  Testing Forensic Event Logging...");
    const testJobId = 99999;
    logForensicEvent(childSpan, {
        jobType: "eval_test_job",
        jobId: testJobId,
        status: "success",
        attributes: {
            telemetry: {
                test_key: "test_value",
                eval_timestamp: Date.now()
            }
        }
    });

    writeLog("   Logged event for test job. Waiting 2s for async write...");
    await new Promise(r => setTimeout(r, 2000));

    // Verify Log
    const logs = await db.select().from(forensicEventLog).where(
        sql`${forensicEventLog.traceId} = ${rootTrace.traceId}`
    );

    if (logs.length === 0) throw new Error("Forensic log not found in database!");
    const log = logs[0];
    writeLog(`   Found Log ID: ${log.id}`);

    // Check Telemetry
    const attrs = log.attributes as any;
    if (attrs?.telemetry?.test_key !== "test_value") throw new Error("Telemetry data missing or corrupt!");
    writeLog("   ✅ Forensic Log Verified with Telemetry.\n");

    // 4. KPI Views
    writeLog("4️⃣  Testing KPI Views...");
    try {
        const pipelineStats = await db.execute(sql`SELECT COUNT(*) as count FROM reporting.kpi_pipeline_performance`);
        writeLog(`   Accessible kpi_pipeline_performance: ${pipelineStats.rows[0].count} rows`);

        const aiStats = await db.execute(sql`SELECT COUNT(*) as count FROM reporting.kpi_ai_usage`);
        writeLog(`   Accessible kpi_ai_usage: ${aiStats.rows[0].count} rows`);

        writeLog("   ✅ KPI Views are queryable.\n");
    } catch (e: any) {
        throw new Error(`KPI View Query Failed: ${e.message}`);
    }

    writeLog("🎉 EVALUATION COMPLETE: All observability systems operational.");
    process.exit(0);
}

runEval().catch(e => {
    writeLog("\n❌ EVALUATION FAILED: " + (e.message || e));
    process.exit(1);
});
