import "dotenv/config";
import { db } from "../database_service.js";
import { apps } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function main() {
    console.log("🏪 Checking Dispatcher app registration...");

    // Check for existing by slug - we want to update the one created by tests if it exists
    const [existing] = await db.select().from(apps).where(eq(apps.slug, "service-dispatch")).limit(1);

    const appData = {
        name: "Dispatcher",
        slug: "service-dispatch",
        description: "Coordinate emergency assistance, helper discovery, and real-time tracking with geospatial orchestration.",
        icon: "Navigation",
        isPublic: true,
        isSystem: true,
        distribution: "standard",
        version: "1.0.0",
        developerOrgId: null,
    };

    if (existing) {
        console.log("♻️ Updating existing Dispatcher app...");
        await db.update(apps).set(appData).where(eq(apps.id, existing.id));
    } else {
        console.log("🚀 Registering new Dispatcher app...");
        await db.insert(apps).values(appData);
    }

    console.log("✅ Successfully registered Dispatcher as a system app.");
    process.exit(0);
}

main().catch((err) => {
    console.error("❌ Registration failed:", err);
    process.exit(1);
});

