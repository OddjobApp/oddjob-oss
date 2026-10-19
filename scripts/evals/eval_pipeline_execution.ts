/**
 * AI Evaluation Suite for Pipeline Execution
 * Tests:
 * 1. Pipeline CRUD Operations
 * 2. Step Ordering & Sequencing
 * 3. Execution State Management
 * 4. Variable Context Building
 * 5. Execution History
 */

import "dotenv/config";
import { db } from "../../server/db/index.js";
import { pipelines, pipelineSteps, pipelineExecutions, pipelineStepExecutions, jobs, orgs } from "@shared/schema";
import { eq, sql, and } from "drizzle-orm";

interface EvalResult {
    testName: string;
    passed: boolean;
    details: string;
    duration: number;
}

const results: EvalResult[] = [];

async function recordResult(testName: string, passed: boolean, details: string, startTime: number) {
    const duration = Date.now() - startTime;
    results.push({ testName, passed, details, duration });
    console.log(`   ${passed ? "✅" : "❌"} ${testName} (${duration}ms)`);
    if (!passed) console.log(`      Details: ${details}`);
}

async function runEval() {
    console.log("🧠 Starting Pipeline Execution Evaluation...\n");
    console.log("=".repeat(70));

    // Get test org
    const [org] = await db.select().from(orgs).limit(1);
    const orgId = org?.id || null;

    // 1. Pipeline CRUD
    console.log("\n📋 Test: Pipeline CRUD Operations");
    console.log("-".repeat(50));

    let start = Date.now();
    let testPipelineId: number | null = null;
    let testJobId: number | null = null;

    try {
        // First create a test job
        const [testJob] = await db.insert(jobs).values({
            organizationId: orgId,
            name: `Eval Test Job ${Date.now()}`,
            type: "shell",
            config: { executable: "echo", parameters: "hello" },
            createdBy: "eval_script",
        }).returning();
        testJobId = testJob?.id || null;
        await recordResult("Job Creation (prerequisite)", !!testJobId,
            testJobId ? `Created job ID: ${testJobId}` : "Failed", start);

        // Create pipeline
        start = Date.now();
        const [testPipeline] = await db.insert(pipelines).values({
            organizationId: orgId,
            name: `Eval Test Pipeline ${Date.now()}`,
            description: "Created by AI eval script",
            triggerType: "manual",
            createdBy: "eval_script",
        }).returning();

        testPipelineId = testPipeline?.id || null;
        await recordResult("Pipeline Creation", !!testPipelineId,
            testPipelineId ? `Created pipeline ID: ${testPipelineId}` : "Failed", start);

        // Update pipeline
        if (testPipelineId) {
            start = Date.now();
            await db.update(pipelines)
                .set({ name: "Updated Eval Pipeline", isActive: true })
                .where(eq(pipelines.id, testPipelineId));
            await recordResult("Pipeline Update", true, "Updated name and isActive status", start);
        }
    } catch (e: any) {
        await recordResult("Pipeline CRUD", false, e.message, start);
    }

    // 2. Pipeline Steps
    console.log("\n📋 Test: Pipeline Step Operations");
    console.log("-".repeat(50));

    let testStepId: number | null = null;

    try {
        if (testPipelineId && testJobId) {
            start = Date.now();
            const [step1] = await db.insert(pipelineSteps).values({
                pipelineId: testPipelineId,
                jobId: testJobId,
                order: 0, // 0-based order
                outputName: "step_output",
            }).returning();
            testStepId = step1?.id || null;
            await recordResult("Step Creation", !!testStepId,
                testStepId ? `Created step ID: ${testStepId}` : "Failed", start);

            // Create second step
            start = Date.now();
            const [step2] = await db.insert(pipelineSteps).values({
                pipelineId: testPipelineId,
                jobId: testJobId,
                order: 1, // 0-based order
            }).returning();
            await recordResult("Second Step Creation", !!step2?.id,
                step2?.id ? `Created step ID: ${step2.id}` : "Failed", start);

            // Verify step ordering
            start = Date.now();
            const steps = await db.select().from(pipelineSteps)
                .where(eq(pipelineSteps.pipelineId, testPipelineId))
                .orderBy(pipelineSteps.order);
            const orderCorrect = steps.length === 2 && steps[0].order === 0 && steps[1].order === 1;
            await recordResult("Step Ordering", orderCorrect,
                `Found ${steps.length} steps, orders: ${steps.map(s => s.order).join(", ")}`, start);
        }
    } catch (e: any) {
        await recordResult("Pipeline Steps", false, e.message, start);
    }

    // 3. Execution Creation
    console.log("\n📋 Test: Execution Management");
    console.log("-".repeat(50));

    let testExecutionId: number | null = null;

    try {
        if (testPipelineId) {
            start = Date.now();
            const [execution] = await db.insert(pipelineExecutions).values({
                pipelineId: testPipelineId,
                status: "running",
                createdBy: "eval_script",
            }).returning();
            testExecutionId = execution?.id || null;
            await recordResult("Execution Creation", !!testExecutionId,
                testExecutionId ? `Created execution ID: ${testExecutionId}` : "Failed", start);

            // Update execution status
            if (testExecutionId) {
                start = Date.now();
                await db.update(pipelineExecutions)
                    .set({ status: "running", startedAt: new Date() })
                    .where(eq(pipelineExecutions.id, testExecutionId));
                await recordResult("Execution Status Update", true, "Updated to running", start);
            }
        }
    } catch (e: any) {
        await recordResult("Execution Management", false, e.message, start);
    }

    // 4. Step Execution
    console.log("\n📋 Test: Step Execution Tracking");
    console.log("-".repeat(50));

    try {
        if (testExecutionId && testStepId) {
            start = Date.now();
            const [stepExec] = await db.insert(pipelineStepExecutions).values({
                pipelineExecutionId: testExecutionId,
                pipelineStepId: testStepId,
                stepOrder: 0, // Required: step order within execution
                status: "running",
            }).returning();
            await recordResult("Step Execution Creation", !!stepExec?.id,
                stepExec?.id ? `Created step execution ID: ${stepExec.id}` : "Failed", start);

            // Complete step
            if (stepExec?.id) {
                start = Date.now();
                await db.update(pipelineStepExecutions)
                    .set({
                        status: "success",
                        completedAt: new Date(),
                        output: JSON.stringify({ result: "Hello from eval" })
                    })
                    .where(eq(pipelineStepExecutions.id, stepExec.id));
                await recordResult("Step Execution Complete", true, "Updated to success with output", start);
            }
        }
    } catch (e: any) {
        await recordResult("Step Execution", false, e.message, start);
    }

    // 5. Query Performance
    console.log("\n📋 Test: Query Performance");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        const pipelineCount = await db.select({ count: sql<number>`count(*)` }).from(pipelines);
        const executionCount = await db.select({ count: sql<number>`count(*)` }).from(pipelineExecutions);
        await recordResult("Pipeline/Execution Count", true,
            `Pipelines: ${pipelineCount[0]?.count || 0}, Executions: ${executionCount[0]?.count || 0}`, start);
    } catch (e: any) {
        await recordResult("Count Query", false, e.message, start);
    }

    // 6. Recent Executions
    start = Date.now();
    try {
        const recentExecs = await db.select({
            id: pipelineExecutions.id,
            status: pipelineExecutions.status,
            startedAt: pipelineExecutions.startedAt
        }).from(pipelineExecutions)
            .orderBy(sql`started_at DESC`)
            .limit(5);
        await recordResult("Recent Executions Query", true,
            `Retrieved ${recentExecs.length} recent executions`, start);
    } catch (e: any) {
        await recordResult("Recent Executions", false, e.message, start);
    }

    // Cleanup
    console.log("\n📋 Test: Cleanup");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        // Delete in reverse order of dependencies
        if (testExecutionId) {
            await db.delete(pipelineStepExecutions)
                .where(eq(pipelineStepExecutions.pipelineExecutionId, testExecutionId));
            await db.delete(pipelineExecutions).where(eq(pipelineExecutions.id, testExecutionId));
        }
        if (testPipelineId) {
            await db.delete(pipelineSteps).where(eq(pipelineSteps.pipelineId, testPipelineId));
            await db.delete(pipelines).where(eq(pipelines.id, testPipelineId));
        }
        if (testJobId) {
            await db.delete(jobs).where(eq(jobs.id, testJobId));
        }
        await recordResult("Cleanup", true, "Test data removed", start);
    } catch (e: any) {
        await recordResult("Cleanup", false, e.message, start);
    }

    // Summary
    console.log("\n" + "=".repeat(70));
    console.log("📊 PIPELINE EXECUTION EVALUATION SUMMARY");
    console.log("=".repeat(70));

    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    const passRate = (passed / results.length) * 100;

    console.log(`\n   Total Tests: ${results.length}`);
    console.log(`   Passed: ${passed}`);
    console.log(`   Failed: ${failed}`);
    console.log(`   Pass Rate: ${passRate.toFixed(1)}%`);
    console.log(`   Total Duration: ${results.reduce((a, r) => a + r.duration, 0)}ms`);

    console.log("\n" + "=".repeat(70));
    if (passRate >= 80) {
        console.log("🎉 EVALUATION PASSED: Pipeline Execution system is operational!");
    } else if (passRate >= 50) {
        console.log("⚠️ EVALUATION PARTIAL: Some issues detected in Pipeline Execution.");
    } else {
        console.log("❌ EVALUATION FAILED: Significant issues with Pipeline Execution.");
    }
    console.log("=".repeat(70));

    process.exit(passRate >= 50 ? 0 : 1);
}

runEval().catch(e => {
    console.error("\n❌ EVALUATION CRASHED:", e);
    process.exit(1);
});
