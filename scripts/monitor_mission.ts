
import { db } from "../server/database_service.js";
import { missionRuns, eventLog, pipelineExecutions, missions } from "../shared/schema/index.js";
import { eq, and, sql, desc, or } from "drizzle-orm";

async function monitor() {
    const args = process.argv.slice(2);
    const runId = parseInt(args[args.indexOf("--run-id") + 1]);

    if (isNaN(runId)) {
        throw new Error("Valid --run-id is required");
    }

    const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, runId)).limit(1);
    
    if (!run) {
        console.log(`Mission run ${runId} not found.`);
        return;
    }

    const [mission] = await db.select().from(missions).where(eq(missions.id as any, run.missionId)).limit(1);

    console.log("--- Mission Details ---");
    console.log(`Name: ${mission?.name}`);
    console.log(`Strategy: ${(mission as any)?.executionStrategy}`);
    console.log(`Objective: ${mission?.objective}`);
    console.log("\n--- Mission Run Status ---");
    console.log(`ID: ${run.id}`);
    console.log(`Status: ${run.status}`);
    if (run.status === 'failed') {
        console.log(`Failure Reason: ${run.failureReason}`);
    }
    console.log(`Phase: ${(run.missionContext as any)?.phase || 'N/A'}`);
    console.log(`Started At: ${run.createdAt}`);
    console.log("\n--- Dynamic Trace ---");
    console.log(JSON.stringify(run.dynamicTrace, null, 2));
    console.log("\n--- Mission Context ---");
    console.log(JSON.stringify(run.missionContext, null, 2));
    
    // Get pipeline executions
    const execs = await db.select()
        .from(pipelineExecutions)
        .where(eq(pipelineExecutions.missionRunId as any, runId))
        .orderBy(desc(pipelineExecutions.startedAt))
        .limit(3);

    if (execs.length > 0) {
        console.log("\n--- Pipeline Executions ---");
        execs.forEach(ex => {
            console.log(`[${ex.startedAt?.toISOString()}] Pipeline ${ex.pipelineId} - Status: ${ex.status}`);
        });
    }

    // Polling loop for logs
    console.log("\n--- Watching for Logs (60s) ---");
    for (let i = 0; i < 12; i++) {
        // Refresh run status
        const [currentRun] = await db.select().from(missionRuns).where(eq(missionRuns.id as any, runId)).limit(1);
        if (currentRun.status !== 'active') {
            console.log(`\nMission run ${runId} finished with status: ${currentRun.status}`);
            break;
        }

        const events = await db.select()
            .from(eventLog)
            .where(or(eq(eventLog.type, "mission.log"), eq(eventLog.type, "pipeline.log")))
            .orderBy(desc(eventLog.emittedAt))
            .limit(10);

        if (events.length > 0) {
            console.log(`\n[${new Date().toLocaleTimeString()}] Recent Logs:`);
            events.reverse().forEach(e => {
                const payload = e.payload as any;
                console.log(`[${e.emittedAt?.toISOString()}] ${payload.message || JSON.stringify(payload)}`);
            });
        } else {
            process.stdout.write(".");
        }

        await new Promise(resolve => setTimeout(resolve, 5000));
    }
}

monitor().catch(err => {
    console.error(err);
    process.exit(1);
});
