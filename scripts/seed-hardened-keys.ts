// @ts-nocheck
import "dotenv/config";
import { db } from "../server/db/index.js";
import { apiKeys, orgs } from "@shared/schema/index.js";
import { apiKeyService } from "@domain/core/auth/api-key.service.js";
import { eq } from "drizzle-orm";

async function seed() {
    console.log("--- SECURE API KEY SEEDING ---");

    // 1. Ensure Orgs exist
    const [org1] = await db.select().from(orgs).where(eq(orgs.id, 1));
    const [org2] = await db.select().from(orgs).where(eq(orgs.id, 2));

    if (!org1) {
        console.error("Organization 1 not found. Please ensure database is seeded with basic orgs.");
        return;
    }

    // 2. Clear existing pilot keys if any
    await db.delete(apiKeys);

    // 3. Create Hardened Keys
    const partners = [
        { name: "Flick Towing Response", id: 1, type: 'partner' as const },
        { name: "Boost Roadside", id: 2, type: 'partner' as const },
        { name: "Rescue Client Pilot", id: 1, type: 'client' as const },
    ];

    for (const p of partners) {
        const { rawKey, apiKey } = await apiKeyService.generateKey(p.id, p.name, p.type);
        console.log(`\nGenerated ${p.type} key for: ${p.name}`);
        console.log(`PREFIX: ${apiKey.prefix}...`);
        console.log(`RAW KEY (SAVE THIS!): ${rawKey}`);
    }

    console.log("\n--- SEEDING COMPLETE ---");
    process.exit(0);
}

seed().catch(err => {
    console.error("Seeding failed:", err);
    process.exit(1);
});
