
import { db } from "../database_service.js";
import { missionRuns, pipelineExecutions, pipelineStepExecutions } from "../../shared/schema/index.js";
import { eq, desc } from "drizzle-orm";

async function inspectOutcomes() {
    const missionId = 45;
    console.log(`--- Inspecting Outcomes for Mission ${missionId} ---`);

    // 1. Get all runs for this mission
    const allRuns = await db.select()
        .from(missionRuns)
        .where(eq(missionRuns.missionId, missionId))
        .orderBy(desc(missionRuns.createdAt));

    for (const r of allRuns) {
        console.log(`\nMISSION RUN ${r.id} [${r.status}]`);

        if (!r.pipelineExecutionId) {
            console.log(`No execution record linked for run ${r.id}`);
            continue;
        }

        // 2. Fetch the pipeline execution for this mission
        const [execution] = await db.select()
            .from(pipelineExecutions)
            .where(eq(pipelineExecutions.id, r.pipelineExecutionId))
            .limit(1);

        if (execution) {
            console.log(`Execution ID: ${execution.id}, Status: ${execution.status}`);

            // 3. Fetch steps and their outputs
            const steps = await db.select()
                .from(pipelineStepExecutions)
                .where(eq(pipelineStepExecutions.pipelineExecutionId, execution.id))
                .orderBy(pipelineStepExecutions.stepOrder);

            console.log(`Steps Found: ${steps.length}`);
            for (const s of steps) {
                console.log(`- Step ${s.stepOrder}: ${s.status}`);
                if (s.output) {
                    const out = JSON.parse(s.output);
                    // Log a snippet of the output to see if there's data
                    const outStr = JSON.stringify(out, null, 2);
                    console.log(`  Output (first 200 chars): ${outStr.substring(0, 200)}...`);
                }
            }
        } else {
            console.log(`No execution record found for run ${r.id}`);
        }
    }
}

inspectOutcomes().catch((err: any) => console.error(err));

