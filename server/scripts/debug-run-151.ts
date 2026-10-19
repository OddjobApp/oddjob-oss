
import { db } from "../database_service.js";
import { missionRuns, forensicEventLog, pipelineExecutions, pipelineStepExecutions } from "@shared/schema/index.js";
import { eq, desc, and } from "drizzle-orm";

async function investigate() {
    console.log("Investigating Run #151...");

    const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, 151)).limit(1);
    if (!run) {
        console.log("Run 151 not found.");
        return;
    }

    console.log("\n================ Mission Run #151 Details ================");
    console.log("- Status:", run.status);
    console.log("- Failure Reason:", run.failureReason);
    console.log("- Created At:", run.createdAt);
    console.log("- Mission Context:", JSON.stringify(run.missionContext, null, 2));

    const pipelineExecutionId = run.pipelineExecutionId;
    console.log("\n================ Pipeline Execution Details ================");
    console.log("- ID:", pipelineExecutionId);
    
    if (pipelineExecutionId) {
        const [exec] = await db.select().from(pipelineExecutions).where(eq(pipelineExecutions.id, pipelineExecutionId)).limit(1);
        if (exec) {
            console.log("\n================ Pipeline Execution Details ================");
            console.log("- Status:", exec.status);
            console.log("- Error:", exec.error);
            console.log("- Trace ID:", exec.traceId);

            const steps = await db.select()
                .from(pipelineStepExecutions)
                .where(eq(pipelineStepExecutions.pipelineExecutionId, pipelineExecutionId))
                .orderBy(pipelineStepExecutions.stepOrder);

            console.log("\n--- Step Executions ---");
            steps.forEach(s => {
                console.log(`[Order ${s.stepOrder}] ID: ${s.id} | Job ${s.jobId} | Status: ${s.status} | Err: ${s.error || 'None'}`);
                if (s.stepOrder === 0) {
                    try {
                        const plan = JSON.parse(s.output || '{}');
                        console.log("\n--- FULL SUPERVISOR PLAN ---");
                        console.log(JSON.stringify(plan, null, 2));
                    } catch (e) {
                        console.log("  > Output (preview):", s.output?.substring(0, 200));
                    }
                }
            });
        }

        const events = await db.select()
            .from(forensicEventLog)
            .where(and(
                eq(forensicEventLog.organizationId, run.organizationId || 0),
                eq(forensicEventLog.pipelineId, pipelineExecutionId)
            ))
            .orderBy(desc(forensicEventLog.createdAt));

        console.log("\n================ Forensic Events for Execution ================");
        events.forEach(e => {
            console.log(`[${e.createdAt.toISOString()}] ${e.jobType} | ${e.status} | Err: ${e.errorMessage || 'None'}`);
            if (e.thoughts) console.log(`  > Thoughts: ${e.thoughts.substring(0, 150)}...`);
        });
    }
}

investigate().catch(console.error).finally(() => process.exit(0));

