
import 'dotenv/config';
import { db } from "../../server/database_service.js";
import { fineTuningDatasets } from "../../shared/schema/index.js";

async function main() {
    console.log("=== Debugging Fine-Tuning Dataset Creation ===");

    // Simulate creating a FINE TUNING dataset (distinct from generic datasets)

    const testDataset = {
        name: "Debug FT Dataset " + new Date().toISOString(),
        description: "Created by debug script",
        organizationId: 1,
        status: "active",
        // Check schema for required fields
    };

    console.log("Attempting to insert FT dataset:", testDataset);

    try {
        const [result] = await db.insert(fineTuningDatasets).values(testDataset).returning();
        console.log("Success! Created FT dataset ID:", result.id);
    } catch (e) {
        console.error("FT Dataset Creation FAILED:", e);
    }

    process.exit(0);
}

main();
