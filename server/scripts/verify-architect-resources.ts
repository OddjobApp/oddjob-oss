import "dotenv/config";
import { db } from "../database_service.js";
import { missionService } from "../domain/mission/core/mission.service.js";
import { orgs, users, hilForms, documentTemplates } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function verifyArchitectResources() {
    console.log("--- Starting Mission Architect Resource Verification ---");

    try {
        // 1. Setup Data
        let orgs_list = await db.select().from(orgs).where(eq(orgs.name, "Test Org")).limit(1);
        let org = orgs_list[0];
        if (!org) {
            const [newOrg] = await db.insert(orgs).values({ name: "Test Org" }).returning();
            org = newOrg;
        }

        let users_list = await db.select().from(users).where(eq(users.defaultOrgId, org.id)).limit(1);
        let user = users_list[0];
        if (!user) {
            const [newUser] = await db.insert(users).values({
                id: "test-user-" + Date.now(),
                username: "testuser-" + Date.now(),
                password: "password123",
                email: "test-" + Date.now() + "@example.com",
                defaultOrgId: org.id,
                fullName: "Test User"
            } as any).returning();
            user = newUser;
        }

        // 2. Create a Form
        const [form] = await db.insert(hilForms).values({
            name: "Investment Approval Form",
            description: "Used to approve high-value investments",
            schema: { fields: [{ key: "approval", type: "boolean", label: "Approve?" }] },
            organizationId: org.id,
            createdBy: user.id
        }).returning();
        console.log(`Created HIL Form: ${form.name} (ID: ${form.id})`);

        // 3. Create a Document Template
        const [doc] = await db.insert(documentTemplates).values({
            name: "Quarterly Investment Report Standard",
            description: "Official template for investment reports",
            type: "markdown",
            content: "# Quarterly Investment Report\n\n## Overview\n{{overview}}",
            organizationId: org.id,
            createdBy: user.id
        }).returning();
        console.log(`Created Document Template: ${doc.name} (ID: ${doc.id})`);

        // 4. Test Planning
        console.log("\nTesting Mission Architect planning with HIL and Docs...");
        const prompt = "I need to analyze some investment options and then have a human approve the top choice before generating a quarterly report using our official standard.";

        const plan = await missionService.planMission(prompt, user.id, org.id, []);

        console.log("\n--- AI GENERATED PLAN ---");
        console.log(JSON.stringify(plan, null, 2));

        // 5. Validation
        let formMentioned = false;
        let docMentioned = false;

        if (JSON.stringify(plan).includes(form.name) || JSON.stringify(plan).includes(`Form ID: ${form.id}`)) {
            formMentioned = true;
            console.log("✅ SUCCESS: AI plan incorporates the HIL Form.");
        } else {
            console.log("❌ FAILURE: AI plan did not mention the HIL Form.");
        }

        if (JSON.stringify(plan).includes(doc.name) || JSON.stringify(plan).includes(`Doc Template ID: ${doc.id}`)) {
            docMentioned = true;
            console.log("✅ SUCCESS: AI plan incorporates the Document Template.");
        } else {
            console.log("❌ FAILURE: AI plan did not mention the Document Template.");
        }

        if (formMentioned && docMentioned) {
            console.log("\n--- Verification SUCCESS ---");
        } else {
            console.log("\n--- Verification PARTIAL or FAILED ---");
        }

    } catch (err) {
        console.error("Verification failed:", err);
        process.exit(1);
    } finally {
        // Cleanup optional, keeping for manual inspection if needed
        process.exit(0);
    }
}

verifyArchitectResources();

