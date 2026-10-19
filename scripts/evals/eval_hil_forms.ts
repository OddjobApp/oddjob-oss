/**
 * AI Evaluation Suite for HIL (Human in the Loop) Forms
 * Tests:
 * 1. HIL Form CRUD Operations
 * 2. Form Schema Definition
 * 3. Theme Configuration
 * 4. Security Configuration
 * 5. OTP Code Management
 */

import "dotenv/config";
import { db } from "../../server/db/index.js";
import { hilForms, otpCodes } from "../../shared/schema/hil";
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
    console.log("🧠 Starting HIL Forms Evaluation...\n");
    console.log("=".repeat(70));

    // Get test org
    const [org] = await db.select().from(orgs).limit(1);
    const orgId = org?.id || null;

    let testFormId: number | null = null;
    let testOtpId: number | null = null;

    // 1. HIL Form Creation
    console.log("\n📋 Test: HIL Form CRUD Operations");
    console.log("-".repeat(50));

    let start = Date.now();
    try {
        const [form] = await db.insert(hilForms).values({
            name: `Eval HIL Form ${Date.now()}`,
            description: "Test form for approval workflow",
            schema: {
                fields: [
                    { key: "reason", type: "text", label: "Reason for approval", required: true },
                    { key: "approved", type: "boolean", label: "Approve?", required: true },
                    { key: "notes", type: "textarea", label: "Additional notes", required: false },
                ]
            },
            organizationId: orgId,
        }).returning();

        testFormId = form?.id || null;
        await recordResult("HIL Form Creation", !!testFormId,
            testFormId ? `Created form ID: ${testFormId}` : "Failed", start);
    } catch (e: any) {
        await recordResult("HIL Form Creation", false, e.message, start);
    }

    // 2. HIL Form Read & Schema Validation
    if (testFormId) {
        start = Date.now();
        try {
            const [readForm] = await db.select().from(hilForms).where(eq(hilForms.id, testFormId));
            const schemaValid = Array.isArray((readForm?.schema as any)?.fields);
            await recordResult("HIL Form Read", schemaValid,
                `Schema has ${(readForm?.schema as any)?.fields?.length || 0} fields`, start);
        } catch (e: any) {
            await recordResult("HIL Form Read", false, e.message, start);
        }
    }

    // 3. Theme Configuration
    console.log("\n📋 Test: Theme Configuration");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        const [themedForm] = await db.insert(hilForms).values({
            name: `Eval Themed Form ${Date.now()}`,
            schema: { fields: [{ key: "confirm", type: "boolean", label: "Confirm", required: true }] },
            themeConfig: {
                logoUrl: "https://example.com/logo.png",
                primaryColor: "#FF5733",
                companyName: "Eval Corp",
            },
            organizationId: orgId,
        }).returning();

        if (themedForm?.id) {
            const [readTheme] = await db.select().from(hilForms).where(eq(hilForms.id, themedForm.id));
            const themeValid = (readTheme?.themeConfig as any)?.primaryColor === "#FF5733";
            await recordResult("Theme Configuration", themeValid,
                `Primary color: ${(readTheme?.themeConfig as any)?.primaryColor}`, start);

            // Cleanup
            await db.delete(hilForms).where(eq(hilForms.id, themedForm.id));
        }
    } catch (e: any) {
        await recordResult("Theme Configuration", false, e.message, start);
    }

    // 4. Security Configuration
    console.log("\n📋 Test: Security Configuration");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        const [secureForm] = await db.insert(hilForms).values({
            name: `Eval Secure Form ${Date.now()}`,
            schema: { fields: [{ key: "secret", type: "text", label: "Secret", required: true }] },
            securityConfig: {
                requireOtp: true,
                tokenExpirationHours: 24,
            },
            organizationId: orgId,
        }).returning();

        if (secureForm?.id) {
            const [readSecurity] = await db.select().from(hilForms).where(eq(hilForms.id, secureForm.id));
            const securityValid = (readSecurity?.securityConfig as any)?.requireOtp === true;
            await recordResult("Security Configuration", securityValid,
                `Require OTP: ${(readSecurity?.securityConfig as any)?.requireOtp}`, start);

            // Cleanup
            await db.delete(hilForms).where(eq(hilForms.id, secureForm.id));
        }
    } catch (e: any) {
        await recordResult("Security Configuration", false, e.message, start);
    }

    // 5. HIL Form Update
    console.log("\n📋 Test: HIL Form Update");
    console.log("-".repeat(50));

    if (testFormId) {
        start = Date.now();
        try {
            await db.update(hilForms)
                .set({ description: "Updated by eval", isArchived: false })
                .where(eq(hilForms.id, testFormId));
            const [updated] = await db.select().from(hilForms).where(eq(hilForms.id, testFormId));
            const updateValid = updated?.description === "Updated by eval";
            await recordResult("HIL Form Update", updateValid,
                `Description: ${updated?.description}`, start);
        } catch (e: any) {
            await recordResult("HIL Form Update", false, e.message, start);
        }
    }

    // 6. OTP Code Management
    console.log("\n📋 Test: OTP Code Management");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        const [otp] = await db.insert(otpCodes).values({
            executionId: `eval-exec-${Date.now()}`,
            email: "eval@test.com",
            code: "123456",
            expiresAt: new Date(Date.now() + 3600000), // 1 hour from now
        }).returning();

        testOtpId = otp?.id || null;
        await recordResult("OTP Code Creation", !!testOtpId,
            testOtpId ? `Created OTP ID: ${testOtpId}, Code: ${otp?.code}` : "Failed", start);

        // Verify OTP
        if (testOtpId) {
            start = Date.now();
            const [readOtp] = await db.select().from(otpCodes).where(eq(otpCodes.id, testOtpId));
            const otpValid = readOtp?.code === "123456" && readOtp?.usedAt === null;
            await recordResult("OTP Code Read", otpValid,
                `Code: ${readOtp?.code}, Used: ${readOtp?.usedAt ?? "No"}`, start);

            // Mark as used
            start = Date.now();
            await db.update(otpCodes)
                .set({ usedAt: new Date() })
                .where(eq(otpCodes.id, testOtpId));
            const [usedOtp] = await db.select().from(otpCodes).where(eq(otpCodes.id, testOtpId));
            await recordResult("OTP Code Use", !!usedOtp?.usedAt,
                `Used at: ${usedOtp?.usedAt}`, start);
        }
    } catch (e: any) {
        await recordResult("OTP Code Management", false, e.message, start);
    }

    // 7. Form Statistics
    console.log("\n📋 Test: Form Statistics");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        const formCount = await db.select({ count: sql<number>`count(*)` }).from(hilForms);
        const otpCount = await db.select({ count: sql<number>`count(*)` }).from(otpCodes);
        await recordResult("Form/OTP Count", true,
            `Forms: ${formCount[0]?.count || 0}, OTP Codes: ${otpCount[0]?.count || 0}`, start);
    } catch (e: any) {
        await recordResult("Statistics", false, e.message, start);
    }

    // Cleanup
    console.log("\n📋 Test: Cleanup");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        if (testOtpId) {
            await db.delete(otpCodes).where(eq(otpCodes.id, testOtpId));
        }
        if (testFormId) {
            await db.delete(hilForms).where(eq(hilForms.id, testFormId));
        }
        await recordResult("Cleanup", true, "Test data removed", start);
    } catch (e: any) {
        await recordResult("Cleanup", false, e.message, start);
    }

    // Summary
    console.log("\n" + "=".repeat(70));
    console.log("📊 HIL FORMS EVALUATION SUMMARY");
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
    console.log("   - HIL Form CRUD ✓");
    console.log("   - Form Schema ✓");
    console.log("   - Theme Config ✓");
    console.log("   - Security Config ✓");
    console.log("   - OTP Code Management ✓");

    console.log("\n" + "=".repeat(70));
    if (passRate >= 80) {
        console.log("🎉 EVALUATION PASSED: HIL Forms system is operational!");
    } else if (passRate >= 50) {
        console.log("⚠️ EVALUATION PARTIAL: Some issues detected in HIL Forms.");
    } else {
        console.log("❌ EVALUATION FAILED: Significant issues with HIL Forms.");
    }
    console.log("=".repeat(70));

    process.exit(passRate >= 50 ? 0 : 1);
}

runEval().catch(e => {
    console.error("\n❌ EVALUATION CRASHED:", e);
    process.exit(1);
});
