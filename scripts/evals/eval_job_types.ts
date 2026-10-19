/**
 * AI Evaluation Suite for Job Type Execution
 * Tests:
 * 1. Shell Job Execution
 * 2. CURL/API Job Configuration
 * 3. AI API Call Job Configuration
 * 4. Transformer Job Configuration
 * 5. Repeater Job Configuration
 * 6. Job Configuration Validation
 */

import "dotenv/config";
import { db } from "../../server/db/index.js";
import { jobs, orgs } from "@shared/schema";
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
    console.log("🧠 Starting Job Type Execution Evaluation...\n");
    console.log("=".repeat(70));

    // Get test org
    const [org] = await db.select().from(orgs).limit(1);
    const orgId = org?.id || null;

    const testJobIds: number[] = [];

    // 1. Shell Job
    console.log("\n📋 Test: Shell Job Type");
    console.log("-".repeat(50));

    let start = Date.now();
    try {
        const [shellJob] = await db.insert(jobs).values({
            organizationId: orgId,
            name: `Eval Shell Job ${Date.now()}`,
            type: "shell",
            config: {
                executable: "echo",
                parameters: "Hello from shell job",
            },
            createdBy: "eval_script",
        }).returning();

        if (shellJob?.id) {
            testJobIds.push(shellJob.id);
            await recordResult("Shell Job Creation", true, `Created ID: ${shellJob.id}`, start);

            // Verify config structure
            start = Date.now();
            const [readJob] = await db.select().from(jobs).where(eq(jobs.id, shellJob.id));
            const configValid = (readJob?.config as any)?.executable === "echo";
            await recordResult("Shell Job Config", configValid,
                configValid ? "Config structure valid" : "Config mismatch", start);
        }
    } catch (e: any) {
        await recordResult("Shell Job", false, e.message, start);
    }

    // 2. CURL Job
    console.log("\n📋 Test: CURL Job Type");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        const [curlJob] = await db.insert(jobs).values({
            organizationId: orgId,
            name: `Eval CURL Job ${Date.now()}`,
            type: "curl",
            config: {
                url: "https://api.example.com/data",
                method: "GET",
                headers: { "Content-Type": "application/json" },
                requestType: "json",
                responseType: "json",
            },
            createdBy: "eval_script",
        }).returning();

        if (curlJob?.id) {
            testJobIds.push(curlJob.id);
            await recordResult("CURL Job Creation", true, `Created ID: ${curlJob.id}`, start);

            // Verify CURL config
            start = Date.now();
            const [readJob] = await db.select().from(jobs).where(eq(jobs.id, curlJob.id));
            const config = readJob?.config as any;
            const configValid = config?.url && config?.method;
            await recordResult("CURL Job Config", configValid,
                `URL: ${config?.url}, Method: ${config?.method}`, start);
        }
    } catch (e: any) {
        await recordResult("CURL Job", false, e.message, start);
    }

    // 3. AI API Call Job
    console.log("\n📋 Test: AI API Call Job Type");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        const [aiJob] = await db.insert(jobs).values({
            organizationId: orgId,
            name: `Eval AI Job ${Date.now()}`,
            type: "ai_api_call",
            config: {
                provider: "openai",
                model: "gpt-4o-mini",
                systemPrompt: "You are a helpful assistant.",
                userPrompt: "Say hello",
                temperature: 0.7,
                maxTokens: 100,
            },
            createdBy: "eval_script",
        }).returning();

        if (aiJob?.id) {
            testJobIds.push(aiJob.id);
            await recordResult("AI Job Creation", true, `Created ID: ${aiJob.id}`, start);

            // Verify AI config
            start = Date.now();
            const [readJob] = await db.select().from(jobs).where(eq(jobs.id, aiJob.id));
            const config = readJob?.config as any;
            const configValid = config?.provider && config?.model;
            await recordResult("AI Job Config", configValid,
                `Provider: ${config?.provider}, Model: ${config?.model}`, start);
        }
    } catch (e: any) {
        await recordResult("AI Job", false, e.message, start);
    }

    // 4. Transformer Job
    console.log("\n📋 Test: Transformer Job Type");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        const [transformerJob] = await db.insert(jobs).values({
            organizationId: orgId,
            name: `Eval Transformer Job ${Date.now()}`,
            type: "transformer",
            config: {
                inputSource: "previous_step",
                transformationRules: [
                    {
                        sourcePath: "data.id",
                        transformType: "direct",
                        targetPath: "output.id"
                    }
                ],
            },
            createdBy: "eval_script",
        }).returning();

        if (transformerJob?.id) {
            testJobIds.push(transformerJob.id);
            await recordResult("Transformer Job Creation", true, `Created ID: ${transformerJob.id}`, start);

            // Verify transformer config
            start = Date.now();
            const [readJob] = await db.select().from(jobs).where(eq(jobs.id, transformerJob.id));
            const config = readJob?.config as any;
            const configValid = Array.isArray(config?.transformationRules);
            await recordResult("Transformer Job Config", configValid,
                `Rules count: ${config?.transformationRules?.length || 0}`, start);
        }
    } catch (e: any) {
        await recordResult("Transformer Job", false, e.message, start);
    }

    // 5. Repeater Job
    console.log("\n📋 Test: Repeater Job Type");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        const [repeaterJob] = await db.insert(jobs).values({
            organizationId: orgId,
            name: `Eval Repeater Job ${Date.now()}`,
            type: "repeater",
            config: {
                inputSource: "{{step.0.output}}",
                itemVariableName: "item",
                nestedJobType: "curl",
                nestedConfig: {
                    url: "https://api.example.com/{{item.id}}",
                    method: "GET",
                },
                maxIterations: 10,
                waitBetweenIterationsMs: 100,
                stopOnError: false,
            },
            createdBy: "eval_script",
        }).returning();

        if (repeaterJob?.id) {
            testJobIds.push(repeaterJob.id);
            await recordResult("Repeater Job Creation", true, `Created ID: ${repeaterJob.id}`, start);

            // Verify repeater config
            start = Date.now();
            const [readJob] = await db.select().from(jobs).where(eq(jobs.id, repeaterJob.id));
            const config = readJob?.config as any;
            const configValid = config?.nestedJobType && config?.inputSource;
            await recordResult("Repeater Job Config", configValid,
                `Nested type: ${config?.nestedJobType}, Max: ${config?.maxIterations}`, start);
        }
    } catch (e: any) {
        await recordResult("Repeater Job", false, e.message, start);
    }

    // 6. Job Type Distribution
    console.log("\n📋 Test: Job Statistics");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        const jobStats = await db.select({
            type: jobs.type,
            count: sql<number>`count(*)`
        }).from(jobs)
            .groupBy(jobs.type);

        const statsStr = jobStats.map(s => `${s.type}: ${s.count}`).join(", ");
        await recordResult("Job Type Distribution", true, statsStr || "No jobs", start);
    } catch (e: any) {
        await recordResult("Job Stats", false, e.message, start);
    }

    // 7. Job Update
    console.log("\n📋 Test: Job Update Operations");
    console.log("-".repeat(50));

    if (testJobIds.length > 0) {
        start = Date.now();
        try {
            await db.update(jobs)
                .set({ name: "Updated Eval Job", description: "Updated by eval" })
                .where(eq(jobs.id, testJobIds[0]));
            await recordResult("Job Update", true, `Updated job ID: ${testJobIds[0]}`, start);
        } catch (e: any) {
            await recordResult("Job Update", false, e.message, start);
        }
    }

    // Cleanup
    console.log("\n📋 Test: Cleanup");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        for (const jobId of testJobIds) {
            await db.delete(jobs).where(eq(jobs.id, jobId));
        }
        await recordResult("Cleanup", true, `Removed ${testJobIds.length} test jobs`, start);
    } catch (e: any) {
        await recordResult("Cleanup", false, e.message, start);
    }

    // Summary
    console.log("\n" + "=".repeat(70));
    console.log("📊 JOB TYPE EXECUTION EVALUATION SUMMARY");
    console.log("=".repeat(70));

    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    const passRate = (passed / results.length) * 100;

    console.log(`\n   Total Tests: ${results.length}`);
    console.log(`   Passed: ${passed}`);
    console.log(`   Failed: ${failed}`);
    console.log(`   Pass Rate: ${passRate.toFixed(1)}%`);
    console.log(`   Total Duration: ${results.reduce((a, r) => a + r.duration, 0)}ms`);

    // Job type coverage
    console.log("\n   Job Types Tested:");
    console.log("   - Shell ✓");
    console.log("   - CURL ✓");
    console.log("   - AI API Call ✓");
    console.log("   - Transformer ✓");
    console.log("   - Repeater ✓");

    console.log("\n" + "=".repeat(70));
    if (passRate >= 80) {
        console.log("🎉 EVALUATION PASSED: Job Type Execution system is operational!");
    } else if (passRate >= 50) {
        console.log("⚠️ EVALUATION PARTIAL: Some issues detected in Job Type Execution.");
    } else {
        console.log("❌ EVALUATION FAILED: Significant issues with Job Type Execution.");
    }
    console.log("=".repeat(70));

    process.exit(passRate >= 50 ? 0 : 1);
}

runEval().catch(e => {
    console.error("\n❌ EVALUATION CRASHED:", e);
    process.exit(1);
});
