
import 'dotenv/config';
import { db } from "@server/database_service.js";
import { pipelines, pipelineSteps, jobs, pipelineTemplates } from "@shared/schema/index.js";
import { eq, asc } from "drizzle-orm";

async function main() {
    const pipelineId = 1;
    const name = "Debug Template Save";
    const organizationId = 1; // Assuming org 1

    console.log(`Attempting to save pipeline ${pipelineId} as template...`);

    // 1. Get Pipeline
    const [pipeline] = await db
        .select()
        .from(pipelines)
        .where(eq(pipelines.id, pipelineId))
        .limit(1);

    if (!pipeline) {
        console.error("Pipeline not found");
        return;
    }

    // 2. Get Steps
    const steps = await db
        .select()
        .from(pipelineSteps)
        .where(eq(pipelineSteps.pipelineId, pipeline.id))
        .orderBy(asc(pipelineSteps.order));

    // 3. Get Jobs
    const templateSteps = [];
    for (const step of steps) {
        if (!step.jobId) continue;
        const [job] = await db
            .select()
            .from(jobs)
            .where(eq(jobs.id, step.jobId))
            .limit(1);

        if (job) {
            templateSteps.push({
                moduleType: "job",
                jobConfig: {
                    name: job.name,
                    type: job.type,
                    config: job.config
                }
            });
        }
    }

    const templateConfig = {
        description: pipeline.description,
        steps: templateSteps,
        triggers: [] // Simplified
    };

    console.log("Config constructed. Inserting...");

    try {
        const [newTemplate] = await db.insert(pipelineTemplates).values({
            name,
            description: pipeline.description || "Created from pipeline",
            category: "custom",
            config: templateConfig as any,
            parameterSchema: {},
            isFeatured: false
        } as any).returning();

        console.log("SUCCESS! Created template:", newTemplate.id);
    } catch (err) {
        console.error("FAILED to insert template:", err);
    }

    process.exit(0);
}

main().catch(console.error);
