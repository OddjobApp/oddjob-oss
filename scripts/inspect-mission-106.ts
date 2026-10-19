// @ts-nocheck

import { db } from "../server/db/index.js";
import { missionRuns, pipelineExecutions, pipelineStepExecutions } from "@shared/schema/index.js";
import { eq, desc } from "drizzle-orm";

async function main() {
    console.log("INSPECTING MISSION 106 / RUN 301...");
    
    // 1. Check Mission Run
    const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, 301)).limit(1);
    if (!run) {
        console.error("MISSION RUN 301 NOT FOUND");
        process.exit(1);
    }
    console.log("RUN STATUS:", run.status);
    console.log("REASONING PROTOCOL:", run.reasoningProtocol);
    console.log("DYNAMIC TRACE (last 2):", JSON.stringify((run.dynamicTrace as any[])?.slice(-2), null, 2));

    // 2. Check current execution
    const execs = await db.select()
        .from(pipelineExecutions)
        .where(eq(pipelineExecutions.missionRunId, 301))
        .orderBy(desc(pipelineExecutions.createdAt))
        .limit(1);

    if (execs.length === 0) {
        console.log("NO PIPELINE EXECUTIONS FOUND FOR RUN 301");
        process.exit(0);
    }

    const exec = execs[0];
    console.log("EXECUTION STATUS:", exec.status);
    console.log("EXECUTION ERROR:", exec.error);

    // 3. Check steps
    const steps = await db.select()
        .from(pipelineStepExecutions)
        .where(eq(pipelineStepExecutions.pipelineExecutionId, exec.id))
        .orderBy(pipelineStepExecutions.stepOrder);

    console.log("STEPS COUNT:", steps.length);
    for (const step of steps) {
        console.log(`Step ${step.stepOrder} (${step.id}): [${step.status}] - ${step.error || 'No error'}`);
        if (step.status === 'failed' && step.error) {
            console.log("DETAIL ERROR:", step.error);
        }
    }
}

main().catch(console.error).finally(() => process.exit(0));
