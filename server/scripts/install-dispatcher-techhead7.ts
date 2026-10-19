/**
 * Install the Dispatcher app into TECHHEAD7 (Org 291)
 */
import { db } from "../database_service.js";
import { apps, appDeployments } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";

const ORG_ID = 291;

async function main() {
    console.log("🔍 Looking up Dispatcher app...");
    const [dispatcherApp] = await db.select().from(apps).where(eq(apps.slug, "service-dispatch")).limit(1);

    if (!dispatcherApp) {
        console.error("❌ Dispatcher app not found.");
        process.exit(1);
    }
    console.log(`✅ Found: "${dispatcherApp.name}" (ID: ${dispatcherApp.id})`);

    // Check if already installed
    const [existing] = await db.select().from(appDeployments).where(
        and(eq(appDeployments.appId, dispatcherApp.id), eq(appDeployments.organizationId, ORG_ID))
    ).limit(1);

    if (existing) {
        console.log(`ℹ️  Already installed on TECHHEAD7 (deployment ID: ${existing.id}, status: ${existing.status})`);
        process.exit(0);
    }

    // Install
    console.log(`🚀 Installing Dispatcher on TECHHEAD7 (org ${ORG_ID})...`);
    const [deployment] = await db.insert(appDeployments).values({
        appId: dispatcherApp.id,
        organizationId: ORG_ID,
        status: "active",
        isPublished: true,
        publicSlug: "dispatcher",
        config: {},
    } as any).returning();

    console.log(`✅ Installed! Deployment ID: ${deployment.id}`);
    console.log(`   Public URL: /app/dispatcher`);
    process.exit(0);
}

main().catch(err => { console.error("Failed:", err.message); process.exit(1); });
