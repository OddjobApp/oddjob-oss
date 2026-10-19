
import "dotenv/config";
import { db } from "../server/db/index.js";
import { apps, appDeployments, systemLicenses } from "@shared/schema";
import { eq, and } from "drizzle-orm";

async function onboard(orgId: number) {
    console.log(`🚀 Onboarding Organization #${orgId} for Service Dispatch...`);

    // 1. Find the App
    const app = await db.query.apps.findFirst({
        where: eq(apps.slug, "service-dispatch")
    });

    if (!app) {
        console.error("❌ App 'service-dispatch' not found. Please run 'npx tsx scripts/seed-rescue-app.ts' first.");
        process.exit(1);
    }

    // 2. Install/Activate in app_deployments
    const [existingDeployment] = await db.select().from(appDeployments).where(
        and(
            eq(appDeployments.appId, app.id),
            eq(appDeployments.organizationId, orgId)
        )
    ).limit(1);

    if (!existingDeployment) {
        await db.insert(appDeployments).values({
            appId: app.id,
            organizationId: orgId,
            status: "active",
            isPublished: true,
            title: "Service Dispatch",
            description: app.description
        });
        console.log("✅ App installed and activated for organization.");
    } else {
        await db.update(appDeployments)
            .set({ status: "active", isPublished: true })
            .where(eq(appDeployments.id, existingDeployment.id));
        console.log("✅ Existing deployment updated to 'active'.");
    }

    // 3. Grant Licensing Entitlement
    const [activeLicense] = await db.select()
        .from(systemLicenses)
        .where(eq(systemLicenses.isActive, true))
        .limit(1);

    if (activeLicense) {
        const features = (activeLicense.features as string[]) || [];
        if (!features.includes("rescue_module") && !features.includes("*")) {
            features.push("rescue_module");
            await db.update(systemLicenses)
                .set({ features })
                .where(eq(systemLicenses.id, activeLicense.id));
            console.log("✅ 'rescue_module' entitlement added to active license.");
        } else {
            console.log("ℹ️ Organization already has rescue entitlement.");
        }
    } else {
        // Create a trial license if none exists
        await db.insert(systemLicenses).values({
            key: `trial-${Math.random().toString(36).substring(7)}`,
            planType: 'enterprise',
            seats: "unlimited",
            features: ["rescue_module"],
            customerName: "Trial Org",
            issuedAt: new Date(),
            isActive: true
        });
        console.log("✅ New trial license created with 'rescue_module' entitlement.");
    }

    console.log("\n✨ Onboarding Complete! The Service Dispatch Mini-App is now functional and available.");
    console.log("👉 Published agents will now proactively offer dispatch services when service-related intents are detected.");
    process.exit(0);
}

const orgId = parseInt(process.argv[2]);
if (isNaN(orgId)) {
    console.error("Usage: npx tsx scripts/onboard-rescue-org.ts <orgId>");
    process.exit(1);
}

onboard(orgId).catch(err => {
    console.error("❌ Onboarding failed:", err);
    process.exit(1);
});
