
import 'dotenv/config';
import { db } from "@server/db/index.js";
import { pipelines, pipelineExecutions, pipelineStepExecutions, jobs } from "@shared/schema/index.js";
import { desc, eq } from "drizzle-orm";

async function debug() {
    try {
        // 1. Get latest execution
        const [lastExec] = await db.select()
            .from(pipelineExecutions)
            .orderBy(desc(pipelineExecutions.id))
            .limit(1);

        if (!lastExec) {
            console.log("No pipeline executions found.");
            process.exit(0);
        }
        console.log("Last Execution:", lastExec.id, "Status:", lastExec.status, "Created:", lastExec.startedAt);

        // 2. Get its steps
        const steps = await db.select()
            .from(pipelineStepExecutions)
            .where(eq(pipelineStepExecutions.pipelineExecutionId, lastExec.id));

        console.log(`Found ${steps.length} step executions.`);

        // 3. Get Pipeline Config
        const [pipeline] = await db.select()
            .from(pipelines)
            .where(eq(pipelines.id, lastExec.pipelineId));

        console.log("Pipeline Config KG Enabled:", pipeline.enableKnowledgeGraph);
        console.log("Pipeline KG Config:", JSON.stringify(pipeline.knowledgeGraphConfig, null, 2));

        // 4. Check step outputs vs rules
        for (const step of steps) {
            console.log(`\nStep ${step.stepOrder} (Job ${step.jobId}):`);
            console.log("Output Preview:", step.output ? step.output.substring(0, 500) : "null");

            // Check job config
            if (step.jobId) {
                const [job] = await db.select().from(jobs).where(eq(jobs.id, step.jobId));
                if (job) {
                    const config = job.config as any;
                    console.log("Full Job Config:", JSON.stringify(config, null, 2));
                }
            }
        }

    } catch (err) {
        console.error(err);
    }
    process.exit(0);
}

debug();
