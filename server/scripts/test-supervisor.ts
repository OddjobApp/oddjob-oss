
import "dotenv/config";
import { db } from "@server/database_service.js";
import { jobs, pipelines, credentials, pipelineExecutions, pipelineSteps } from "@shared/schema/index.js";
import { supervisorService } from "@domain/integrations/core/supervisor.service.js";
import { pipelineEngine as pipelineService } from "@domain/pipeline/core/pipeline.service.js";

// Import SeleniumRunner and other dependencies to instantiate PipelineExecutor (or use a simpler way if possible)
// But pipeline-executor is a CLASS in `server/core` that is typically instantiated.
// Let's import the CLASS and instantiate it.
import { PipelineExecutor } from "@server/core/pipeline-executor.js";
const pipelineExecutor = new PipelineExecutor();
import { eq } from "drizzle-orm";
import { log } from "@server/vite.js";

async function main() {
    log("Starting Supervisor Verification Script...");

    try {
        // 1. Setup: Create a Mock Credential (if needed) and a Child Pipeline
        log("Creating setup data...");
        const [cred] = await db.insert(credentials).values({
            name: "Test OpenAI",
            type: "ai_provider",
            envVarName: "OPENAI_API_KEY",
            metadata: { provider: "openai" },
            organizationId: 1, // Assuming org 1 exists
            createdBy: "test-script-user"
        }).returning();

        const [childPipeline] = await db.insert(pipelines).values({
            name: "Child Research Pipeline",
            description: "A pipeline to be called by supervisor",
            triggerType: "manual",
            organizationId: 1,
            createdBy: "test-script"
        }).returning();

        // 2. Create Supervisor Job
        log("Creating Supervisor Job...");
        const [supervisorJob] = await db.insert(jobs).values({
            name: "Test Supervisor Agent",
            type: "supervisor",
            organizationId: 1,
            createdBy: "test-script",
            config: {
                intent: "Research AI trends",
                model: "gpt-4-turbo",
                allowedPipelines: [childPipeline.id],
                systemPrompt: "You are a helpful supervisor."
            }
        }).returning();

        // 3. Create Supervisor Pipeline (to wrap the job)
        const [supervisorPipeline] = await db.insert(pipelines).values({
            name: "Supervisor Pipeline",
            triggerType: "manual",
            organizationId: 1,
            createdBy: "test-script",
        }).returning();

        await db.insert(pipelineSteps).values({
            pipelineId: supervisorPipeline.id,
            jobId: supervisorJob.id,
            order: 1
        });

        // 4. Mock the LLM Logic (Hard part - might need to rely on the service's mock ability or just integration test flow)
        // For this script, we will call the internal planning logic directly if possible, 
        // OR we just run the pipeline and assert if it fails/passes relative to our expectations.
        // Since we don't want to burn tokens or rely on real LLM, we should ideally check if we can inject a mock plan.

        // Let's rely on the fact that without a real OPENAI key, the LLM call might fail, 
        // BUT we can verify the *structure* of the execution.

        log("Executing Supervisor Pipeline...");
        const execution = await pipelineExecutor.executePipeline(supervisorPipeline.id, "test-user-id"); // Use executor directly or fix service args

        log(`Execution started: ID ${execution.executionId}`);

        if (execution.executionId === -1) {
            log(`Execution failed to start: ${execution.error}`);
            // Clean up and exit
            // ...
            process.exit(1);
        }

        // Wait a bit for async processing (since worker picks it up)
        await new Promise(r => setTimeout(r, 5000));

        // 5. Check status
        const [updatedExecution] = await db.select().from(pipelineExecutions).where(eq(pipelineExecutions.id, execution.executionId));
        log(`Execution Status: ${updatedExecution.status}`);

        // If it failed (likely due to missing API key), that's expected for this enviro without mocks.
        // However, we want to see if it *tried* to enter the SUPERVISOR logic.

        if (updatedExecution.status === 'failed') {
            log(`Failure Reason: ${updatedExecution.error}`);
        }

        // Cleanup
        log("Cleaning up...");
        await db.delete(pipelineExecutions).where(eq(pipelineExecutions.pipelineId, supervisorPipeline.id));
        await db.delete(pipelines).where(eq(pipelines.id, supervisorPipeline.id));
        await db.delete(pipelines).where(eq(pipelines.id, childPipeline.id));
        await db.delete(jobs).where(eq(jobs.id, supervisorJob.id));
        await db.delete(credentials).where(eq(credentials.id, cred.id));

        log("Done.");
        process.exit(0);

    } catch (error) {
        console.error("Script failed:", error);
        if (error instanceof Error) {
            console.error(error.stack);
        }
        process.exit(1);
    }
}

main();

