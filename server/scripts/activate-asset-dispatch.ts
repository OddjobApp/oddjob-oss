/**
 * Activate asset dispatch cycles, Location Search app, bind blueprints, and pre-start app instances
 * Usage: npx tsx server/scripts/activate-asset-dispatch.ts
 */
import { db } from "../database_service.js";
import { operationalCycles, appDeployments, apps } from "@shared/schema/index.js";
import { appRegistryService } from "../domain/apps/app-registry.service.js";
import { eq, and, inArray } from "drizzle-orm";

const ORG_ID = 291;
const TARGET_CYCLES = [296, 324, 301];

async function main() {
    console.log("⚡ Activating cycles in DB...");
    const updatedCycles = await db.update(operationalCycles)
        .set({ status: "active" })
        .where(
            and(
                inArray(operationalCycles.id, TARGET_CYCLES),
                eq(operationalCycles.organizationId, ORG_ID)
            )
        )
        .returning();

    console.log(`✅ Activated ${updatedCycles.length} cycles:`, updatedCycles.map(c => ({ id: c.id, name: c.name, status: c.status })));

    console.log("🔧 Binding correct blueprints to target apps in DB...");
    
    // Update Dispatcher app
    const [updatedDispatcherApp] = await db.update(apps)
        .set({ blueprint: "rescue-dispatch" })
        .where(eq(apps.slug, "service-dispatch"))
        .returning();
    if (updatedDispatcherApp) {
        console.log(`✅ Bound blueprint 'rescue-dispatch' to app 'service-dispatch' (ID: ${updatedDispatcherApp.id})`);
    } else {
        console.warn("⚠️ App 'service-dispatch' not found.");
    }

    // Update Location Search app
    const [updatedLocApp] = await db.update(apps)
        .set({ blueprint: "location-search" })
        .where(eq(apps.slug, "location-search"))
        .returning();
    if (updatedLocApp) {
        console.log(`✅ Bound blueprint 'location-search' to app 'location-search' (ID: ${updatedLocApp.id})`);
    } else {
        console.warn("⚠️ App 'location-search' not found.");
    }

    // Make sure Dispatcher deployment is active, published, and publicSlug is dispatcher
    const [dispatcherApp] = await db.select().from(apps).where(eq(apps.slug, "service-dispatch")).limit(1);
    if (dispatcherApp) {
        const [existingDisp] = await db.select().from(appDeployments).where(
            and(
                eq(appDeployments.appId, dispatcherApp.id),
                eq(appDeployments.organizationId, ORG_ID)
            )
        ).limit(1);

        if (existingDisp) {
            console.log(`♻️ Updating Dispatcher deployment (ID: ${existingDisp.id})...`);
            await db.update(appDeployments).set({
                status: "active",
                isPublished: true,
                publicSlug: "dispatcher",
            } as any).where(eq(appDeployments.id, existingDisp.id));
        } else {
            console.log(`🚀 Creating new active deployment for Dispatcher...`);
            await db.insert(appDeployments).values({
                appId: dispatcherApp.id,
                organizationId: ORG_ID,
                status: "active",
                isPublished: true,
                publicSlug: "dispatcher",
                config: {},
            } as any);
        }
    }

    // Check Location Search app
    const [locApp] = await db.select().from(apps).where(eq(apps.slug, "location-search")).limit(1);
    if (locApp) {
        const [existingLoc] = await db.select().from(appDeployments).where(
            and(
                eq(appDeployments.appId, locApp.id),
                eq(appDeployments.organizationId, ORG_ID)
            )
        ).limit(1);

        if (existingLoc) {
            console.log(`♻️ Updating Location Search deployment (ID: ${existingLoc.id})...`);
            await db.update(appDeployments).set({
                status: "active",
                isPublished: true,
                publicSlug: "location-search",
            } as any).where(eq(appDeployments.id, existingLoc.id));
        } else {
            console.log(`🚀 Creating new active deployment for Location Search...`);
            await db.insert(appDeployments).values({
                appId: locApp.id,
                organizationId: ORG_ID,
                status: "active",
                isPublished: true,
                publicSlug: "location-search",
                config: {},
            } as any);
        }
    }

    console.log("🚀 Starting app instances to trigger JIT compilation/Next.js builds...");
    if (dispatcherApp) {
        try {
            console.log("Starting Dispatcher app...");
            const res = await appRegistryService.startApp(dispatcherApp.id, ORG_ID);
            console.log("✅ Dispatcher app started successfully:", res);
        } catch (err: any) {
            console.error("❌ Failed to start Dispatcher app:", err.message);
        }
    }

    if (locApp) {
        try {
            console.log("Starting Location Search app...");
            const res = await appRegistryService.startApp(locApp.id, ORG_ID);
            console.log("✅ Location Search app started successfully:", res);
        } catch (err: any) {
            console.error("❌ Failed to start Location Search app:", err.message);
        }
    }

    console.log("🎉 Activation, blueprint binding, and pre-start completed successfully!");
    process.exit(0);
}

main().catch(err => {
    console.error("❌ Activation failed:", err);
    process.exit(1);
});
