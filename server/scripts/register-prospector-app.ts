import "dotenv/config";
import { db } from "../database_service.js";
import { apps } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function main() {
    console.log("🏪 Checking Prospector app registration...");

    const [existing] = await db.select().from(apps).where(eq(apps.slug, "prospecting")).limit(1);

    if (existing) {
        console.log("✅ Prospector app already registered.");
        process.exit(0);
    }

    console.log("🚀 Registering AI Prospector & Co-pilot...");

    await db.insert(apps).values({
        name: "AI Prospector & Co-pilot",
        slug: "prospecting",
        description: "Advanced visitor de-anonymization and interaction tracking. Identify anonymous traffic and score intent in real-time.",
        icon: "Search",
        isPublic: true,
        isSystem: true,
        distribution: "standard",
        version: "1.0.0",
        developerOrgId: null,
    });

    console.log("✅ Successfully registered Prospector as a system app.");
    process.exit(0);
}

main().catch((err) => {
    console.error("❌ Registration failed:", err);
    process.exit(1);
});

