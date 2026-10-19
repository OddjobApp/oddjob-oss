import "dotenv/config";
import { db } from "../database_service.js";
import { apps } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function main() {
    console.log("🏪 Checking Location Search app registration...");

    const [existing] = await db.select().from(apps).where(eq(apps.slug, "location-search")).limit(1);

    const appData = {
        name: "Location Search",
        slug: "location-search",
        description: "Generic location search tool using geospatial datasets and browser geolocation to find nearby points of interest.",
        icon: "Compass",
        isPublic: true,
        isSystem: true,
        distribution: "standard",
        version: "1.0.0",
        developerOrgId: null,
    };

    if (existing) {
        console.log("♻️ Updating existing Location Search app...");
        await db.update(apps).set(appData).where(eq(apps.id, existing.id));
    } else {
        console.log("🚀 Registering new Location Search app...");
        await db.insert(apps).values(appData);
    }

    console.log("✅ Successfully registered Location Search as a system app.");
    process.exit(0);
}

main().catch((err) => {
    console.error("❌ Registration failed:", err);
    process.exit(1);
});
