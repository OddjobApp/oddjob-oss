import "dotenv/config";
import { db } from "../database_service.js";
import { apps, appDeployments, orgs } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";

async function main() {
    // 1. Find the Dispatcher app
    console.log("🔍 Looking up Dispatcher app...");
    const [dispatcherApp] = await db.select().from(apps).where(eq(apps.slug, "service-dispatch")).limit(1);

    if (!dispatcherApp) {
        console.error("❌ Dispatcher app not found. Run 'tsx server/scripts/register-dispatcher-app.ts' first.");
        process.exit(1);
    }
    console.log(`✅ Found app: "${dispatcherApp.name}" (ID: ${dispatcherApp.id})`);

    // 2. Find the Default Org — try by name, fall back to lowest ID
    console.log("🔍 Looking up Default Org...");
    const allOrgs = await db.select().from(orgs).limit(20);
    console.log("Available orgs:", allOrgs.map(o => `  [${o.id}] ${o.name}`).join("\n"));

    const defaultOrg = allOrgs.find(o =>
        o.name?.toLowerCase().includes("default") ||
        o.name?.toLowerCase().includes("oddjob global") ||
        o.name?.toLowerCase().includes("oddjob")
    ) || allOrgs.sort((a, b) => a.id - b.id)[0];

    if (!defaultOrg) {
        console.error("❌ No organization found in the database.");
        process.exit(1);
    }
    console.log(`✅ Using org: "${defaultOrg.name}" (ID: ${defaultOrg.id})`);

    // 3. Check if already installed
    const [existing] = await db.select().from(appDeployments).where(
        and(
            eq(appDeployments.appId, dispatcherApp.id),
            eq(appDeployments.organizationId, defaultOrg.id)
        )
    ).limit(1);

    if (existing) {
        console.log(`ℹ️  Dispatcher App is already installed on "${defaultOrg.name}" (deployment ID: ${existing.id}).`);
        process.exit(0);
    }

    // 4. Install it
    console.log(`🚀 Installing Dispatcher App on "${defaultOrg.name}"...`);
    const [deployment] = await db.insert(appDeployments).values({
        appId: dispatcherApp.id,
        organizationId: defaultOrg.id,
        status: "installed",
        config: {},
    }).returning();

    console.log(`✅ Dispatcher App installed! Deployment ID: ${deployment.id}`);
    process.exit(0);
}

main().catch((err) => {
    console.error("❌ Installation failed:", err.message || err);
    process.exit(1);
});
