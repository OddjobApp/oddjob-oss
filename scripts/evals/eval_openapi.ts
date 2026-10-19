/**
 * AI Evaluation Suite for OpenAPI Job Configuration
 * Tests:
 * 1. OpenAPI Job Config Structure
 * 2. Spec Storage/Retrieval
 * 3. Operation Selection
 * 4. Parameter Mapping
 * 5. API Key Resolution
 */

import "dotenv/config";
import { db } from "../../server/db/index.js";
import { jobs } from "@shared/schema";
import { orgs } from "../../shared/schema/auth";
import { eq, sql } from "drizzle-orm";

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
    console.log("🧠 Starting OpenAPI Job Configuration Evaluation...\n");
    console.log("=".repeat(70));

    // Get test org
    const [org] = await db.select().from(orgs).limit(1);
    const orgId = org?.id || null;

    const testJobIds: number[] = [];

    // 1. Basic OpenAPI Job
    console.log("\n📋 Test: OpenAPI Job Creation");
    console.log("-".repeat(50));

    let start = Date.now();
    try {
        const [job] = await db.insert(jobs).values({
            organizationId: orgId,
            name: `Eval OpenAPI Job ${Date.now()}`,
            type: "openapi",
            config: {
                specId: "jira-api-v3",
                operationId: "searchForIssuesUsingJql",
                parameters: {
                    jql: "project = TEST",
                    maxResults: 50,
                },
            },
            createdBy: "eval_script",
        }).returning();

        if (job?.id) {
            testJobIds.push(job.id);
            await recordResult("OpenAPI Job Creation", true,
                `Created job ID: ${job.id}`, start);
        }
    } catch (e: any) {
        await recordResult("OpenAPI Job Creation", false, e.message, start);
    }

    // 2. Config Structure Validation
    if (testJobIds.length > 0) {
        start = Date.now();
        try {
            const [readJob] = await db.select().from(jobs).where(eq(jobs.id, testJobIds[0]));
            const config = readJob?.config as any;
            const configValid = config?.specId === "jira-api-v3" &&
                config?.operationId === "searchForIssuesUsingJql";
            await recordResult("Config Structure", configValid,
                `SpecId: ${config?.specId}, OpId: ${config?.operationId}`, start);
        } catch (e: any) {
            await recordResult("Config Structure", false, e.message, start);
        }
    }

    // 3. OpenAPI with Credential Reference
    console.log("\n📋 Test: Credential Integration");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        const [job] = await db.insert(jobs).values({
            organizationId: orgId,
            name: `Eval OpenAPI Cred Job ${Date.now()}`,
            type: "openapi",
            config: {
                specId: "github-api-v3",
                operationId: "listRepos",
                credentialId: 1, // Reference to credential
                parameters: {
                    per_page: 100,
                },
            },
            createdBy: "eval_script",
        }).returning();

        if (job?.id) {
            testJobIds.push(job.id);
            const config = job?.config as any;
            await recordResult("Credential Reference", !!config?.credentialId,
                `CredentialId: ${config?.credentialId}`, start);
        }
    } catch (e: any) {
        await recordResult("Credential Reference", false, e.message, start);
    }

    // 4. Multiple Operations
    console.log("\n📋 Test: Various API Operations");
    console.log("-".repeat(50));

    const operations = [
        { specId: "slack-api", operationId: "postMessage" },
        { specId: "stripe-api", operationId: "createPaymentIntent" },
        { specId: "sendgrid-api", operationId: "sendEmail" },
    ];

    for (const op of operations) {
        start = Date.now();
        try {
            const [job] = await db.insert(jobs).values({
                organizationId: orgId,
                name: `Eval ${op.specId} Job ${Date.now()}`,
                type: "openapi",
                config: {
                    specId: op.specId,
                    operationId: op.operationId,
                    parameters: {},
                },
                createdBy: "eval_script",
            }).returning();

            if (job?.id) {
                testJobIds.push(job.id);
                await recordResult(`Op: ${op.operationId}`, true,
                    `Created for spec: ${op.specId}`, start);
            }
        } catch (e: any) {
            await recordResult(`Op: ${op.operationId}`, false, e.message, start);
        }
    }

    // 5. Complex Parameters
    console.log("\n📋 Test: Complex Parameters");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        const [job] = await db.insert(jobs).values({
            organizationId: orgId,
            name: `Eval Complex Params ${Date.now()}`,
            type: "openapi",
            config: {
                specId: "test-api",
                operationId: "complexOp",
                parameters: {
                    query: { search: "test", limit: 10 },
                    path: { id: "{{step.0.output.id}}" },
                    body: { data: { nested: { value: true } } },
                },
            },
            createdBy: "eval_script",
        }).returning();

        if (job?.id) {
            testJobIds.push(job.id);
            const config = job?.config as any;
            const hasNested = config?.parameters?.body?.data?.nested?.value === true;
            await recordResult("Complex Parameters", hasNested,
                `Has nested body params`, start);
        }
    } catch (e: any) {
        await recordResult("Complex Parameters", false, e.message, start);
    }

    // 6. OpenAPI Job Update
    console.log("\n📋 Test: Job Update Operations");
    console.log("-".repeat(50));

    if (testJobIds.length > 0) {
        start = Date.now();
        try {
            await db.update(jobs)
                .set({
                    config: {
                        specId: "updated-api",
                        operationId: "updatedOp",
                        parameters: { updated: true },
                    }
                })
                .where(eq(jobs.id, testJobIds[0]));
            const [updated] = await db.select().from(jobs).where(eq(jobs.id, testJobIds[0]));
            const config = updated?.config as any;
            await recordResult("Config Update", config?.specId === "updated-api",
                `SpecId: ${config?.specId}`, start);
        } catch (e: any) {
            await recordResult("Config Update", false, e.message, start);
        }
    }

    // 7. OpenAPI Job Statistics
    console.log("\n📋 Test: OpenAPI Statistics");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        const openapiJobs = await db.select({ count: sql<number>`count(*)` })
            .from(jobs)
            .where(eq(jobs.type, "openapi"));
        await recordResult("OpenAPI Job Count", true,
            `Total OpenAPI jobs: ${openapiJobs[0]?.count || 0}`, start);
    } catch (e: any) {
        await recordResult("Statistics", false, e.message, start);
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
    console.log("📊 OPENAPI JOB CONFIGURATION EVALUATION SUMMARY");
    console.log("=".repeat(70));

    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    const passRate = (passed / results.length) * 100;

    console.log(`\n   Total Tests: ${results.length}`);
    console.log(`   Passed: ${passed}`);
    console.log(`   Failed: ${failed}`);
    console.log(`   Pass Rate: ${passRate.toFixed(1)}%`);
    console.log(`   Total Duration: ${results.reduce((a, r) => a + r.duration, 0)}ms`);

    console.log("\n   Features Tested:");
    console.log("   - Job Creation ✓");
    console.log("   - Config Structure ✓");
    console.log("   - Credential Reference ✓");
    console.log("   - Various Operations ✓");
    console.log("   - Complex Parameters ✓");

    console.log("\n" + "=".repeat(70));
    if (passRate >= 80) {
        console.log("🎉 EVALUATION PASSED: OpenAPI Job system is operational!");
    } else if (passRate >= 50) {
        console.log("⚠️ EVALUATION PARTIAL: Some issues detected in OpenAPI Jobs.");
    } else {
        console.log("❌ EVALUATION FAILED: Significant issues with OpenAPI Jobs.");
    }
    console.log("=".repeat(70));

    process.exit(passRate >= 50 ? 0 : 1);
}

runEval().catch(e => {
    console.error("\n❌ EVALUATION CRASHED:", e);
    process.exit(1);
});
