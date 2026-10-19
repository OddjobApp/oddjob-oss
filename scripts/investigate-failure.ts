
import { db } from "../server/db/index.js";
import { missions, missionRuns, missionBlackboardHistory } from "@shared/schema/missions";
import { pipelineExecutions, pipelineStepExecutions } from "@shared/schema";
import { eq, and, desc, asc } from "drizzle-orm";

async function investigate() {
    const missionId = 73;
    const runId = 88;

    console.log(`\n=== Investigating Mission ${missionId}, Run ${runId} ===`);

    const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, runId)).limit(1);

    if (!run) {
        console.log("Mission run not found.");
        return;
    }

    console.log("Mission Run Details:");
    console.log(JSON.stringify(run, null, 2));

    const missionExecutionId = run.pipelineExecutionId;
    console.log(`\nPipeline Execution ID: ${missionExecutionId}`);

    if (missionExecutionId && missionExecutionId !== -1) {
        const [execution] = await db.select().from(pipelineExecutions).where(eq(pipelineExecutions.id, missionExecutionId)).limit(1);
        if (execution) {
            console.log("\nPipeline Execution details:");
            console.log(JSON.stringify(execution, null, 2));

            const steps = await db.select().from(pipelineStepExecutions).where(eq(pipelineStepExecutions.pipelineExecutionId, missionExecutionId));
            console.log(`\nFound ${steps.length} step executions:`);
            steps.forEach(s => {
                console.log(`Step ${s.stepOrder}: ${s.status} - Error: ${s.error}`);
                if (s.error && s.error.includes("mismatch")) {
                    console.log("MATCH FOUND IN STEP ERROR!");
                }
            });
        }
    } else if (run.missionId) {
        console.log("\nPipeline Execution ID is -1 or null. Checking blackboard history for mission.");
        const history = await db.select().from(missionBlackboardHistory)
            .where(eq(missionBlackboardHistory.missionId, run.missionId))
            .orderBy(desc(missionBlackboardHistory.createdAt))
            .limit(10);

        console.log(`\nFound ${history.length} recent blackboard history entries:`);
        history.forEach(h => {
            console.log(`[${h.createdAt.toISOString()}] Reason: ${h.changeReason} - By: ${h.changedBy}`);
            const ctx = h.blackboard as any;
            if (ctx?.launchError) {
                console.log(`Launch Error: ${ctx.launchError}`);
            }
        });
    }

    // Search for ALL mission runs with "mismatch" in error or context
    console.log("\nSearching for any mission runs with 'mismatch' in status or context...");
    const allRuns = await db.select().from(missionRuns);
    const mismatchRuns = allRuns.filter(r =>
        (r.status === "failed") &&
        JSON.stringify(r).toLowerCase().includes("mismatch")
    );

    console.log(`Found ${mismatchRuns.length} runs with 'mismatch' in status/context:`);
    mismatchRuns.forEach(r => {
        console.log(`Run ${r.id}: status=${r.status}, pipelineExecutionId=${r.pipelineExecutionId}`);
        console.log(`Context snippet: ${JSON.stringify(r.missionContext).substring(0, 200)}...`);
    });
}

investigate().catch(console.error).finally(() => process.exit(0));
