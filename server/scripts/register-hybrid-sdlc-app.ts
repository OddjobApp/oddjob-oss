import "dotenv/config";
import { db } from "../database_service.js";
import { apps, appDeployments, orgs } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";

async function main() {
    console.log("🏪 Registering Oddjob Enterprise Hybrid AI SDLC as a system app...");

    const slug = "hybrid-sdlc";
    const name = "Oddjob Enterprise Hybrid AI SDLC";

    // 1. Check if the app already exists
    const [existingApp] = await db.select().from(apps).where(eq(apps.slug, slug)).limit(1);

    const appData = {
        name,
        slug,
        description: "A highly-structured 30-day Software Development Life Cycle utilizing 9 Specialized AI Agents, 6 Orchestrated Missions, and strict Value Stream Management (VSM) telemetry.",
        icon: "GitBranch",
        isPublic: true,
        isSystem: true,
        distribution: "standard",
        version: "1.0.0",
        status: "active",
        developerOrgId: null,
    };

    let appRecord;
    if (existingApp) {
        console.log("♻️  Updating existing Hybrid SDLC app record...");
        const [updated] = await db.update(apps).set(appData).where(eq(apps.id, existingApp.id)).returning();
        appRecord = updated;
    } else {
        console.log("🚀 Creating new Hybrid SDLC app record...");
        const [inserted] = await db.insert(apps).values(appData).returning();
        appRecord = inserted;
    }

    console.log(`✅ App registered: "${appRecord.name}" (ID: ${appRecord.id})`);

    // 2. Fetch all organizations
    const allOrgs = await db.select().from(orgs);
    console.log(`Found ${allOrgs.length} organizations in the database.`);

    // 3. Install the app for each organization
    for (const org of allOrgs) {
        const [existingDeployment] = await db.select().from(appDeployments).where(
            and(
                eq(appDeployments.appId, appRecord.id),
                eq(appDeployments.organizationId, org.id)
            )
        ).limit(1);

        if (existingDeployment) {
            console.log(`ℹ️  App already installed for Org: ${org.name} (ID: ${org.id})`);
        } else {
            console.log(`🚀 Installing app for Org: ${org.name} (ID: ${org.id})...`);
            await db.insert(appDeployments).values({
                appId: appRecord.id,
                organizationId: org.id,
                status: "installed",
                config: {},
            });
        }
    }

    console.log("✅ Successfully installed Oddjob Enterprise Hybrid AI SDLC for all organizations.");
    process.exit(0);
}

main().catch((err) => {
    console.error("❌ App registration/installation failed:", err);
    process.exit(1);
});
