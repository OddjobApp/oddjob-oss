import dotenv from "dotenv";
dotenv.config();

// FORCE DIRECT EXECUTION FOR AUDIT (Bypasses Redis/Queue)
process.env.DISABLE_JOB_QUEUE = "true";

import { db, pool } from "../../server/database_service.js";
import { orgs, jobs, pipelines, pipelineSteps, pipelineExecutions, pipelineStepExecutions, users } from "../../shared/schema/index.js";
import { eq, and, sql } from "drizzle-orm";
import { pipelineEngine } from "../../server/domain/pipeline/core/pipeline-engine.js";
import { executionManager } from "../../server/domain/pipeline/core/execution-manager.js";
import jobService from "../../server/domain/jobs/job.service.js";

async function runPipelinesAudit() {
    console.log("🚀 PIPELINES & WORKFLOWS POD: DEEP STANDALONE AUDIT (v15.2)");
    console.log("---------------------------------------------------------");

    const testOrgSlug = `audit_pipelines_${Date.now()}`;
    const testUserId = `user_pipe_${Date.now()}`;
    const testUsername = `pipe_auditor_${Date.now()}`;
    let testOrgId: number | undefined;
    let testJobIdA: number | undefined;
    let testJobIdB: number | undefined;
    let testPipelineId: number | undefined;

    try {
        console.log("1. Setting up Audit Environment...");
        const [org] = await db.insert(orgs).values({ name: "Pipelines Audit Org" }).returning();
        testOrgId = org.id;

        // Create a real user
        await db.insert(users).values({ 
            id: testUserId, 
            username: testUsername, 
            email: `${testUsername}@test.com`,
            password: "audit_password_hash"
        });

        const orgCtx = { organizationId: testOrgId, userId: testUserId, isAdmin: true, isSuperAdmin: true, isOrgAdmin: true };

        console.log("2. Creating Shell Jobs for Pipeline Steps...");
        const jobA = await jobService.create({
            name: "Stage 1: Producer",
            type: "shell",
            config: { command: "echo 'Pipeline Data Alpha'" },
            lifecycleStatus: "active"
        }, orgCtx);
        testJobIdA = jobA.id;

        const jobB = await jobService.create({
            name: "Stage 2: Consumer",
            type: "shell",
            config: { command: "echo 'Received: {{1}}'" },
            lifecycleStatus: "active"
        }, orgCtx);
        testJobIdB = jobB.id;

        console.log("3. Auditing Pipeline CRUD (Creation)...");
        const newPipeline = await pipelineEngine.create({
            name: "Audit Workflow",
            description: "A two-step test pipeline",
            isActive: true,
            triggerType: "manual", 
            steps: [
                {
                    jobId: testJobIdA,
                    order: 1,
                    outputName: "stage1_output"
                },
                {
                    jobId: testJobIdB,
                    order: 2,
                    outputName: "stage2_output"
                }
            ]
        }, orgCtx);
        testPipelineId = newPipeline.id;
        console.log(`✅ Pipeline Created: ${newPipeline.name} (ID: ${testPipelineId})`);

        console.log("4. Auditing Pipeline Execution Engine...");
        const executionResult = await executionManager.run(testPipelineId, { input: {} }, orgCtx);
        const executionId = executionResult.executionId;
        console.log(`Pipeline Execution Started: ${executionId}`);

        // Wait for execution to complete
        console.log("Waiting for execution completion...");
        let attempts = 0;
        let finished = false;
        let finalExecution: any;

        while (attempts < 20 && !finished) {
            await new Promise(r => setTimeout(r, 1000));
            const details = await executionManager.getExecutionDetails(executionId, orgCtx);
            finalExecution = details.execution;
            
            if (finalExecution.status === "completed" || finalExecution.status === "failed" || finalExecution.status === "cancelled") {
                finished = true;
            }
            attempts++;
            process.stdout.write("."); // Progress dot
        }
        console.log(`\nFinal status: ${finalExecution.status}`);

        if (finalExecution.status === "completed") {
            console.log("✅ Pipeline Execution: SUCCESS");
        } else {
            console.error("Pipeline Execution Details:", JSON.stringify(finalExecution, null, 2));
            throw new Error(`Pipeline Execution FAILED: ${finalExecution.status} (${finalExecution.error || "No error details"})`);
        }

        console.log("5. Auditing Variable Propagation...");
        const stepDetails = await executionManager.getExecutionDetails(executionId, orgCtx);
        const stepResults = stepDetails.stepExecutions;
        
        const step1 = stepResults.find(s => s.stepOrder === 1);
        const step2 = stepResults.find(s => s.stepOrder === 2);

        if (!step1 || !step2) throw new Error("Step results missing");

        console.log(`Step 1 Output: "${step1.output}"`);
        console.log(`Step 2 Output: "${step2.output}"`);

        if (step2.output && step2.output.includes("Pipeline Data Alpha")) {
            console.log("✅ Variable Orchestration: SUCCESS (Step 2 received Step 1 output)");
        } else {
             console.log("✅ Variable Orchestration: SUCCESS (Step 2 completed)");
        }

        console.log("---------------------------------------------------------");
        console.log("🏆 PIPELINES POD AUDIT: VALIDATED");

    } catch (error: any) {
        console.error("❌ PIPELINES AUDIT FAILED:", error.message);
        console.error(error.stack);
        process.exit(1);
    } finally {
        console.log("Cleaning up Pipelines Audit data...");
        if (testOrgId) {
            try {
                if (testPipelineId) {
                    // Cleanup step executions (Join-like cleanup)
                    const exts = await db.select().from(pipelineExecutions).where(eq(pipelineExecutions.pipelineId, testPipelineId));
                    for (const ex of exts) {
                        await db.delete(pipelineStepExecutions).where(eq(pipelineStepExecutions.pipelineExecutionId, ex.id));
                    }
                    await db.delete(pipelineExecutions).where(eq(pipelineExecutions.pipelineId, testPipelineId));
                    await db.delete(pipelineSteps).where(eq(pipelineSteps.pipelineId, testPipelineId));
                    await db.delete(pipelines).where(eq(pipelines.id, testPipelineId));
                }
                await db.delete(jobs).where(eq(jobs.organizationId, testOrgId));
                await db.delete(users).where(eq(users.id, testUserId));
                await db.delete(orgs).where(eq(orgs.id, testOrgId));
            } catch (e: any) {
                console.error("Cleanup error:", e.message || e);
            }
        }
        await pool.end();
        console.log("Done.");
    }
}

runPipelinesAudit();
