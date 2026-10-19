import { db } from "@server/database_service.js";
import { jobs } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { jobTestService } from "@domain/jobs/core/job-test.service.js";
import { createRootTrace } from "@domain/core/infrastructure/tracing/trace-context.service.js";

async function testJob() {
    const jobId = 125;
    const input = "Analyze the attached URL for sales psychology. \nhttps://www.bellastarr.com/";

    console.log(`Testing Job ${jobId} directly via service...`);

    try {
        const [jobData] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
        if (!jobData) throw new Error("Job not found");

        const config = typeof jobData.config === 'string' ? JSON.parse(jobData.config) : jobData.config;
        const capture = { captureInput: false, captureOutput: false, input };

        const result = await jobTestService.testAIAgentJob(jobData, config, capture);

        console.log('Result Success:', result.success);
        console.log('Result Output:', result.output);
        if (result.error) console.log('Result Error:', result.error);
    } catch (err: any) {
        console.error('Error:', err);
    } finally {
        process.exit();
    }
}

testJob();

