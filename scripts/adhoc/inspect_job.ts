import { db } from "../../server/database_service.js";
import { sql, eq, desc, or, like } from "drizzle-orm";
import { jobs, pipelineExecutions, pipelineStepExecutions, integrationLogs } from "../../shared/schema/index.js";

async function inspect() {
    const runUuid = "1d5f5df9-7850-4dab-a406-ceb34000ce87";
    console.log(`\n--- Inspecting Pipeline Run: ${runUuid} ---`);

    try {
        // 1. Get Pipeline Execution by UUID
        const [execution] = await db.select()
            .from(pipelineExecutions)
            .where(eq(pipelineExecutions.runUuid, runUuid))
            .limit(1);

        if (!execution) {
            console.log("No pipeline execution found with this UUID.");
            
            // Fallback: Check if it's a traceId in logs
            const logs = await db.select()
                .from(integrationLogs)
                .where(eq(integrationLogs.traceId, runUuid))
                .orderBy(desc(integrationLogs.createdAt))
                .limit(10);
                
            if (logs.length > 0) {
                console.log("\nFound in Integration Logs (Telemetry Trace):");
                logs.forEach((l: any) => {
                    console.log(`[${l.createdAt.toISOString()}] ${l.platform} ${l.action} | Status: ${l.responseStatus}`);
                });
            } else {
                console.log("Not found in integration logs either.");
            }
            return;
        }

        console.log("Status:", execution.status);
        console.log("Started At:", execution.startedAt);
        console.log("Completed At:", execution.completedAt);
        if (execution.error) console.log("Error:", execution.error);

        // 2. Get Step Executions
        const steps = await db.select()
            .from(pipelineStepExecutions)
            .where(eq(pipelineStepExecutions.pipelineExecutionId, execution.id))
            .orderBy(pipelineStepExecutions.stepOrder);

        if (steps.length > 0) {
            console.log("\n--- Execution Steps ---");
            steps.forEach((s: any) => {
                const duration = s.completedAt ? (s.completedAt.getTime() - s.executedAt.getTime()) / 1000 : "N/A";
                console.log(`${s.stepOrder}. [${s.status}] ${s.outputName || 'Step'} | Duration: ${duration}s`);
                if (s.error) console.log(`   Error: ${s.error.substring(0, 100)}`);
            });
        }

        // 3. Get Recent Telemetry linked to this execution
        const logs = await db.select()
            .from(integrationLogs)
            .where(or(
                eq(integrationLogs.traceId, runUuid),
                like(integrationLogs.traceId, `%${runUuid.substring(0, 8)}%`)
            ))
            .orderBy(desc(integrationLogs.createdAt))
            .limit(20);

        if (logs.length > 0) {
            console.log("\n--- Integration Telemetry ---");
            logs.forEach((l: any) => {
                console.log(`[${l.createdAt.toISOString()}] ${l.platform} ${l.action} | Status: ${l.responseStatus} | Latency: ${l.durationMs}ms`);
            });
        }

    } catch (err) {
        console.error("Inspection failed:", err);
    } finally {
        process.exit(0);
    }
}

inspect();
