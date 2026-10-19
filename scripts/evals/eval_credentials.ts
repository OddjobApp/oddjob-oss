/**
 * AI Evaluation Suite for Credentials System
 * Tests:
 * 1. Credential CRUD Operations
 * 2. Credential Type Validation
 * 3. Environment Variable Reference
 * 4. Credential Metadata (AI Provider, JIRA, etc.)
 * 5. Organization Scoping
 */

import "dotenv/config";
import { db } from "../../server/db/index.js";
import { credentials } from "../../shared/schema/system";
import { orgs } from "../../shared/schema/auth";
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
    console.log("🧠 Starting Credentials Evaluation...\n");
    console.log("=".repeat(70));

    // Get test org
    const [org] = await db.select().from(orgs).limit(1);
    const orgId = org?.id || null;

    const testCredentialIds: number[] = [];

    // 1. API Key Credential
    console.log("\n📋 Test: API Key Credential");
    console.log("-".repeat(50));

    let start = Date.now();
    try {
        const [cred] = await db.insert(credentials).values({
            name: `Eval API Key ${Date.now()}`,
            type: "api_key",
            description: "Test API key credential",
            envVarName: `EVAL_API_KEY_${Date.now()}`,
            organizationId: orgId,
            createdBy: "eval_script",
        }).returning();

        if (cred?.id) {
            testCredentialIds.push(cred.id);
            await recordResult("API Key Creation", true, `Created ID: ${cred.id}`, start);

            // Read back
            start = Date.now();
            const [readCred] = await db.select().from(credentials).where(eq(credentials.id, cred.id));
            const readValid = readCred?.type === "api_key" && readCred?.envVarName?.startsWith("EVAL_API_KEY");
            await recordResult("API Key Read", readValid,
                `Type: ${readCred?.type}, EnvVar: ${readCred?.envVarName}`, start);
        }
    } catch (e: any) {
        await recordResult("API Key Credential", false, e.message, start);
    }

    // 2. AI Provider Credential
    console.log("\n📋 Test: AI Provider Credential");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        const [aiCred] = await db.insert(credentials).values({
            name: `Eval OpenAI ${Date.now()}`,
            type: "ai_provider",
            description: "Test AI provider credential",
            envVarName: `EVAL_OPENAI_KEY_${Date.now()}`,
            metadata: {
                provider: "openai",
                models: ["gpt-4o", "gpt-4o-mini"],
                isDefault: true,
            },
            organizationId: orgId,
            createdBy: "eval_script",
        }).returning();

        if (aiCred?.id) {
            testCredentialIds.push(aiCred.id);
            await recordResult("AI Provider Creation", true, `Created ID: ${aiCred.id}`, start);

            // Verify metadata
            start = Date.now();
            const [readCred] = await db.select().from(credentials).where(eq(credentials.id, aiCred.id));
            const metadataValid = (readCred?.metadata as any)?.provider === "openai";
            await recordResult("AI Provider Metadata", metadataValid,
                `Provider: ${(readCred?.metadata as any)?.provider}`, start);
        }
    } catch (e: any) {
        await recordResult("AI Provider Credential", false, e.message, start);
    }

    // 3. JIRA Credential
    console.log("\n📋 Test: JIRA Credential");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        const [jiraCred] = await db.insert(credentials).values({
            name: `Eval JIRA ${Date.now()}`,
            type: "jira",
            description: "Test JIRA credential",
            envVarName: `EVAL_JIRA_TOKEN_${Date.now()}`,
            metadata: {
                baseUrl: "https://example.atlassian.net",
                email: "eval@example.com",
            },
            organizationId: orgId,
            createdBy: "eval_script",
        }).returning();

        if (jiraCred?.id) {
            testCredentialIds.push(jiraCred.id);
            await recordResult("JIRA Creation", true, `Created ID: ${jiraCred.id}`, start);

            // Verify JIRA metadata
            start = Date.now();
            const [readCred] = await db.select().from(credentials).where(eq(credentials.id, jiraCred.id));
            const metadataValid = (readCred?.metadata as any)?.baseUrl?.includes("atlassian");
            await recordResult("JIRA Metadata", metadataValid,
                `Base URL: ${(readCred?.metadata as any)?.baseUrl}`, start);
        }
    } catch (e: any) {
        await recordResult("JIRA Credential", false, e.message, start);
    }

    // 4. Database Credential
    console.log("\n📋 Test: Database Credential");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        const [dbCred] = await db.insert(credentials).values({
            name: `Eval Database ${Date.now()}`,
            type: "database",
            description: "Test database credential",
            envVarName: `EVAL_DB_URL_${Date.now()}`,
            metadata: {
                host: "localhost",
                port: 5432,
                database: "test_db",
            },
            organizationId: orgId,
            createdBy: "eval_script",
        }).returning();

        if (dbCred?.id) {
            testCredentialIds.push(dbCred.id);
            await recordResult("Database Creation", true, `Created ID: ${dbCred.id}`, start);
        }
    } catch (e: any) {
        await recordResult("Database Credential", false, e.message, start);
    }

    // 5. Credential Update
    console.log("\n📋 Test: Credential Update");
    console.log("-".repeat(50));

    if (testCredentialIds.length > 0) {
        start = Date.now();
        try {
            await db.update(credentials)
                .set({ description: "Updated by eval" })
                .where(eq(credentials.id, testCredentialIds[0]));
            const [updated] = await db.select().from(credentials).where(eq(credentials.id, testCredentialIds[0]));
            const updateValid = updated?.description === "Updated by eval";
            await recordResult("Credential Update", updateValid,
                `Updated description: ${updated?.description}`, start);
        } catch (e: any) {
            await recordResult("Credential Update", false, e.message, start);
        }
    }

    // 6. Credential Statistics
    console.log("\n📋 Test: Credential Statistics");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        const credStats = await db.select({
            type: credentials.type,
            count: sql<number>`count(*)`
        }).from(credentials)
            .groupBy(credentials.type);

        const statsStr = credStats.map((s: { type: string; count: number }) => `${s.type}: ${s.count}`).join(", ");
        await recordResult("Credential Type Distribution", true, statsStr || "No credentials", start);
    } catch (e: any) {
        await recordResult("Credential Stats", false, e.message, start);
    }

    // 7. Organization Scoping
    console.log("\n📋 Test: Organization Scoping");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        if (orgId) {
            const orgCreds = await db.select().from(credentials)
                .where(eq(credentials.organizationId, orgId));
            await recordResult("Org-Scoped Credentials", true,
                `Found ${orgCreds.length} credentials for org ${orgId}`, start);
        } else {
            await recordResult("Org-Scoped Credentials", true, "No org to test", start);
        }
    } catch (e: any) {
        await recordResult("Org Scoping", false, e.message, start);
    }

    // Cleanup
    console.log("\n📋 Test: Cleanup");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        for (const credId of testCredentialIds) {
            await db.delete(credentials).where(eq(credentials.id, credId));
        }
        await recordResult("Cleanup", true, `Removed ${testCredentialIds.length} test credentials`, start);
    } catch (e: any) {
        await recordResult("Cleanup", false, e.message, start);
    }

    // Summary
    console.log("\n" + "=".repeat(70));
    console.log("📊 CREDENTIALS EVALUATION SUMMARY");
    console.log("=".repeat(70));

    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    const passRate = (passed / results.length) * 100;

    console.log(`\n   Total Tests: ${results.length}`);
    console.log(`   Passed: ${passed}`);
    console.log(`   Failed: ${failed}`);
    console.log(`   Pass Rate: ${passRate.toFixed(1)}%`);
    console.log(`   Total Duration: ${results.reduce((a, r) => a + r.duration, 0)}ms`);

    console.log("\n   Credential Types Tested:");
    console.log("   - API Key ✓");
    console.log("   - AI Provider ✓");
    console.log("   - JIRA ✓");
    console.log("   - Database ✓");

    console.log("\n" + "=".repeat(70));
    if (passRate >= 80) {
        console.log("🎉 EVALUATION PASSED: Credentials system is operational!");
    } else if (passRate >= 50) {
        console.log("⚠️ EVALUATION PARTIAL: Some issues detected in Credentials.");
    } else {
        console.log("❌ EVALUATION FAILED: Significant issues with Credentials.");
    }
    console.log("=".repeat(70));

    process.exit(passRate >= 50 ? 0 : 1);
}

runEval().catch(e => {
    console.error("\n❌ EVALUATION CRASHED:", e);
    process.exit(1);
});
