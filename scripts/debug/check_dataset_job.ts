/**
 * Debug script to check job 29 dataset configuration and dataset 2 items
 */
import { db } from "@server/database_service.js";
import { jobs, datasets, datasetItems } from "../../shared/schema/index.js";
import { eq, count } from "drizzle-orm";

async function main() {
    // Check job 29 configuration
    const [job] = await db.select().from(jobs).where(eq(jobs.id, 29)).limit(1);
    if (!job) {
        console.log("Job 29 not found!");
        process.exit(1);
    }

    console.log("=== Job 29 Configuration ===");
    console.log("Name:", job.name);
    console.log("Type:", job.type);
    console.log("Output Dataset ID:", job.outputDatasetId);
    console.log("Enable Knowledge Store:", job.enableKnowledgeStore);
    console.log("Output Knowledge Topic ID:", job.outputKnowledgeTopicId);
    console.log("Config:", JSON.stringify(job.config, null, 2));

    // Check dataset 2
    const [dataset] = await db.select().from(datasets).where(eq(datasets.id, 2)).limit(1);
    if (!dataset) {
        console.log("\nDataset 2 not found!");
    } else {
        console.log("\n=== Dataset 2 ===");
        console.log("Name:", dataset.name);
        console.log("Schema Mapping:", JSON.stringify(dataset.schemaMapping, null, 2));
    }

    // Count items in dataset 2
    const [itemCount] = await db.select({ count: count() }).from(datasetItems).where(eq(datasetItems.datasetId, 2));
    console.log("\nDataset 2 Item Count:", itemCount?.count ?? 0);

    // Show recent items if any
    const recentItems = await db.select().from(datasetItems).where(eq(datasetItems.datasetId, 2)).limit(3);
    console.log("\nRecent Items:", recentItems.length > 0 ? JSON.stringify(recentItems, null, 2) : "None");

    process.exit(0);
}

main().catch(console.error);
