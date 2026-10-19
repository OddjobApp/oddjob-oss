
import * as dotenv from "dotenv";
import { eq } from "drizzle-orm";

// Load environment variables FIRST
dotenv.config();

async function main() {
    // Dynamic imports to ensure env vars are loaded before DB connection
    const { db } = await import("@server/db/index.js");
    const { datasets, fineTuningDatasets } = await import("@shared/schema/index.js");

    console.log("Checking 'datasets' table...");
    try {
        const allDatasets = await db.select().from(datasets);
        console.log(`Found ${allDatasets.length} datasets:`);
        allDatasets.forEach(d => {
            console.log(`- ID: ${d.id}, Name: "${d.name}", OrgID: ${d.organizationId}`);
        });

        if (allDatasets.length === 0) {
            console.log("No datasets found in 'datasets' table.");
        }

        console.log("\nChecking 'fine_tuning_datasets' table...");
        const allFineTuning = await db.select().from(fineTuningDatasets);
        console.log(`Found ${allFineTuning.length} fine-tuning datasets:`);
        allFineTuning.forEach(d => {
            console.log(`- ID: ${d.id}, Name: "${d.name}", OrgID: ${d.organizationId}`);
        });
        if (allFineTuning.length === 0) {
            console.log("No fine-tuning datasets found.");
        }

    } catch (error) {
        console.error("Error querying datasets:", error);
    }
    process.exit(0);
}

main();
