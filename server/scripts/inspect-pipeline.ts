
import { db } from "../database_service.js";
import { pipelines, pipelineSteps, jobs } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function inspectPipeline(id: number) {
    const pipeline = await db.query.pipelines.findFirst({
        where: eq(pipelines.id, id),
    });

    if (!pipeline) {
        console.log(`Pipeline ${id} not found`);
        return;
    }

    console.log("Pipeline:", JSON.stringify(pipeline, null, 2));

    const steps = await db.query.pipelineSteps.findMany({
        where: eq(pipelineSteps.pipelineId, id),
        orderBy: (steps, { asc }) => [asc(steps.order)],
    });

    console.log("Steps:");
    for (const step of steps) {
        const job = step.jobId ? await db.query.jobs.findFirst({
            where: eq(jobs.id, step.jobId),
        }) : null;
        console.log(`Step ${step.order}: Job ${step.jobId} (${job?.name}) - Type: ${job?.type}`);
        console.log("Job Config:", JSON.stringify(job?.config, null, 2));
    }
}

const id = parseInt(process.argv[2]);
if (isNaN(id)) {
    console.log("Usage: tsx inspect-pipeline.ts <pipeline_id>");
} else {
    inspectPipeline(id).catch(console.error);
}

