
import "dotenv/config";
import { db } from "../server/db/index.js";
import { datasets, datasetItems } from "@shared/schema/datasets";
import { rescueGeoService } from "../server/domain/rescue/index.js";
import { eq, and } from "drizzle-orm";

async function seedProviders(orgId: number) {
    console.log(`🚀 Seeding Service Providers for Org #${orgId}...`);

    // 1. Ensure the "Service Providers" Dataset exists
    let providersDataset = await db.query.datasets.findFirst({
        where: and(
            eq(datasets.name, "Service Providers"),
            eq(datasets.organizationId, orgId)
        )
    });

    if (!providersDataset) {
        const [newDs] = await db.insert(datasets).values({
            name: "Service Providers",
            description: "Active technicians and responders for proximity dispatch.",
            organizationId: orgId,
            tags: ["platform:dispatch", "utility:providers"]
        }).returning();
        providersDataset = newDs;
        console.log(`✅ Dataset created: ${providersDataset.name}`);
    }

    // 2. Define Sample Providers
    const sampleProviders = [
        {
            name: "Alex Johnson",
            data: {
                role: "HVAC Senior Tech",
                phone: "555-0101",
                rating: 4.9,
                skills: ["cooling", "electrical"],
                status: "active"
            },
            loc: { lat: 40.7580, lng: -73.9855 } // Times Square area
        },
        {
            name: "Maria Garcia",
            data: {
                role: "Master Plumber",
                phone: "555-0102",
                rating: 4.8,
                skills: ["leaks", "sewer"],
                status: "active"
            },
            loc: { lat: 40.7128, lng: -74.0060 } // Downtown NYC
        },
        {
            name: "Unit 7 (Support)",
            data: {
                role: "Emergency Fleet",
                phone: "555-0911",
                rating: 5.0,
                skills: ["rapid-response", "heavy-lift"],
                status: "active"
            },
            loc: { lat: 40.8075, lng: -73.9626 } // Morningside Heights
        }
    ];

    for (const p of sampleProviders) {
        // Create Dataset Item
        const [item] = await db.insert(datasetItems).values({
            datasetId: providersDataset.id,
            data: {
                ...p.data,
                name: p.name
            }
        }).returning();

        const providerId = `dp-${item.id}`; // Custom prefix for Dispatch Provider

        // Register in Redis Geospatial Index
        await rescueGeoService.updateHelperLocation(providerId, p.loc.lat, p.loc.lng);

        console.log(`✅ Registered Provider: ${p.name} (ID: ${providerId}) at [${p.loc.lat}, ${p.loc.lng}]`);
    }

    console.log("\n✨ Provider seeding complete. These providers are now visible to the geo_discovery tool.");
    process.exit(0);
}

const orgId = parseInt(process.argv[2]) || 1;
seedProviders(orgId).catch(err => {
    console.error("❌ Seeding failed:", err);
    process.exit(1);
});
