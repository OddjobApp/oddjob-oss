
import 'dotenv/config';
import { db } from "../../server/database_service.js";
import { datasets } from "../../shared/schema/index.js";

async function main() {
    console.log("=== Debugging Dataset Creation ===");

    // Simulate creating a dataset
    // We'll try to insert a new dataset directly using the Drizzle schema to see if DB constraints or logic fail.
    // NOTE: If the route does more than just DB insert (loops Qdrant?), we need to simulate that.

    const testDataset = {
        name: "Debug Dataset " + new Date().toISOString(),
        description: "Created by debug script",
        organizationId: 1,
        createdBy: "debug-script",
        status: "active",
        filterConfig: {
            // Some dummy filter
            sourceTypes: ["text"]
        }
    };

    console.log("Attempting to insert dataset:", testDataset);

    try {
        const [result] = await db.insert(datasets).values(testDataset).returning();
        console.log("Success! Created dataset ID:", result.id);
    } catch (e) {
        console.error("Dataset Creation FAILED:", e);
    }

    process.exit(0);
}

main();
