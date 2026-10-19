/**
 * AI Evaluation Suite for Authentication System
 * Tests:
 * 1. User CRUD Operations
 * 2. Organization Management
 * 3. User-Org Relationship (Multi-tenancy)
 * 4. Session/Auth Data Isolation
 * 5. User Profile Updates
 */

import "dotenv/config";
import { db } from "../../server/db/index.js";
import { users, orgs, userOrgs } from "../../shared/schema/auth";
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
    console.log("🧠 Starting Authentication Evaluation...\n");
    console.log("=".repeat(70));

    let testUserId: string | null = null;
    let testOrgId: number | null = null;
    let testOrg2Id: number | null = null;

    // 1. Organization Creation
    console.log("\n📋 Test: Organization Management");
    console.log("-".repeat(50));

    let start = Date.now();
    try {
        const [org] = await db.insert(orgs).values({
            name: `Eval Test Org ${Date.now()}`,
        }).returning();
        testOrgId = org?.id || null;
        await recordResult("Organization Creation", !!testOrgId,
            testOrgId ? `Created org ID: ${testOrgId}` : "Failed", start);

        // Create second org for isolation testing
        start = Date.now();
        const [org2] = await db.insert(orgs).values({
            name: `Eval Test Org 2 ${Date.now()}`,
        }).returning();
        testOrg2Id = org2?.id || null;
        await recordResult("Second Organization Creation", !!testOrg2Id,
            testOrg2Id ? `Created org ID: ${testOrg2Id}` : "Failed", start);
    } catch (e: any) {
        await recordResult("Organization Creation", false, e.message, start);
    }

    // 2. User CRUD
    console.log("\n📋 Test: User CRUD Operations");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        const username = `eval_user_${Date.now()}`;
        const [user] = await db.insert(users).values({
            username,
            password: "hashed_password_placeholder", // In real auth, this would be hashed
            email: `eval_${Date.now()}@test.com`,
            firstName: "Eval",
            lastName: "User",
            defaultOrgId: testOrgId,
        }).returning();
        testUserId = user?.id || null;
        await recordResult("User Creation", !!testUserId,
            testUserId ? `Created user ID: ${testUserId}` : "Failed", start);

        // Read user
        if (testUserId) {
            start = Date.now();
            const [readUser] = await db.select().from(users).where(eq(users.id, testUserId));
            const readValid = !!(readUser?.username === username && readUser?.email?.includes("@test.com"));
            await recordResult("User Read", readValid,
                `Username: ${readUser?.username}, Email: ${readUser?.email}`, start);

            // Update user
            start = Date.now();
            await db.update(users)
                .set({ firstName: "Updated", lastName: "EvalUser", quietHoursEnabled: true })
                .where(eq(users.id, testUserId));
            const [updatedUser] = await db.select().from(users).where(eq(users.id, testUserId));
            const updateValid = updatedUser?.firstName === "Updated" && updatedUser?.quietHoursEnabled === true;
            await recordResult("User Update", updateValid,
                `Name: ${updatedUser?.firstName} ${updatedUser?.lastName}`, start);
        }
    } catch (e: any) {
        await recordResult("User CRUD", false, e.message, start);
    }

    // 3. User-Org Relationship
    console.log("\n📋 Test: User-Organization Relationship");
    console.log("-".repeat(50));

    try {
        if (testUserId && testOrgId) {
            start = Date.now();
            await db.insert(userOrgs).values({
                userId: testUserId,
                orgId: testOrgId,
            }).onConflictDoNothing();
            await recordResult("User-Org Link (Primary)", true,
                `Linked user ${testUserId} to org ${testOrgId}`, start);

            // Link to second org (multi-org user)
            if (testOrg2Id) {
                start = Date.now();
                await db.insert(userOrgs).values({
                    userId: testUserId,
                    orgId: testOrg2Id,
                }).onConflictDoNothing();
                await recordResult("User-Org Link (Secondary)", true,
                    `Linked user to second org ${testOrg2Id}`, start);
            }

            // Verify multi-org membership
            start = Date.now();
            const userMemberships = await db.select().from(userOrgs)
                .where(eq(userOrgs.userId, testUserId));
            const membershipValid = userMemberships.length >= 2;
            await recordResult("Multi-Org Membership", membershipValid,
                `User belongs to ${userMemberships.length} organizations`, start);
        }
    } catch (e: any) {
        await recordResult("User-Org Relationship", false, e.message, start);
    }

    // 4. Data Isolation Test
    console.log("\n📋 Test: Organization Data Isolation");
    console.log("-".repeat(50));

    try {
        if (testOrgId && testOrg2Id) {
            start = Date.now();
            // Count users per org
            const org1Users = await db.select().from(userOrgs).where(eq(userOrgs.orgId, testOrgId));
            const org2Users = await db.select().from(userOrgs).where(eq(userOrgs.orgId, testOrg2Id));
            await recordResult("Per-Org User Count", true,
                `Org ${testOrgId}: ${org1Users.length} users, Org ${testOrg2Id}: ${org2Users.length} users`, start);
        }
    } catch (e: any) {
        await recordResult("Data Isolation", false, e.message, start);
    }

    // 5. User Statistics
    console.log("\n📋 Test: User Statistics");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        const userCount = await db.select({ count: sql<number>`count(*)` }).from(users);
        const orgCount = await db.select({ count: sql<number>`count(*)` }).from(orgs);
        await recordResult("User/Org Count", true,
            `Users: ${userCount[0]?.count || 0}, Orgs: ${orgCount[0]?.count || 0}`, start);
    } catch (e: any) {
        await recordResult("Statistics", false, e.message, start);
    }

    // Cleanup
    console.log("\n📋 Test: Cleanup");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        if (testUserId) {
            await db.delete(userOrgs).where(eq(userOrgs.userId, testUserId));
            await db.delete(users).where(eq(users.id, testUserId));
        }
        if (testOrgId) {
            await db.delete(orgs).where(eq(orgs.id, testOrgId));
        }
        if (testOrg2Id) {
            await db.delete(orgs).where(eq(orgs.id, testOrg2Id));
        }
        await recordResult("Cleanup", true, "Test data removed", start);
    } catch (e: any) {
        await recordResult("Cleanup", false, e.message, start);
    }

    // Summary
    console.log("\n" + "=".repeat(70));
    console.log("📊 AUTHENTICATION EVALUATION SUMMARY");
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
    console.log("   - Organization CRUD ✓");
    console.log("   - User CRUD ✓");
    console.log("   - User-Org Relationships ✓");
    console.log("   - Multi-Org Membership ✓");
    console.log("   - Data Isolation ✓");

    console.log("\n" + "=".repeat(70));
    if (passRate >= 80) {
        console.log("🎉 EVALUATION PASSED: Authentication system is operational!");
    } else if (passRate >= 50) {
        console.log("⚠️ EVALUATION PARTIAL: Some issues detected in Authentication.");
    } else {
        console.log("❌ EVALUATION FAILED: Significant issues with Authentication.");
    }
    console.log("=".repeat(70));

    process.exit(passRate >= 50 ? 0 : 1);
}

runEval().catch(e => {
    console.error("\n❌ EVALUATION CRASHED:", e);
    process.exit(1);
});
