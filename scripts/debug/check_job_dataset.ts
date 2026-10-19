import { db } from "@server/database_service.js";
import { jobs, datasets, datasetItems } from "../../shared/schema";
import { eq, count } from "drizzle-orm";

async function main() {
    console.log("=== Checking Job 29 ===");
    const [job] = await db.select().from(jobs).where(eq(jobs.id, 29)).limit(1);
    if (job) {
        console.log("Job 29:", JSON.stringify({
            id: job.id,
            name: job.name,
            type: job.type,
            outputDatasetId: job.outputDatasetId,
            enableKnowledgeStore: job.enableKnowledgeStore,
            outputKnowledgeTopicId: job.outputKnowledgeTopicId,
            outputStorageSettings: job.outputStorageSettings
        }, null, 2));
    } else {
        console.log("Job 29 not found!");
    }

    console.log("\n=== Checking Dataset 2 ===");
    const [dataset] = await db.select().from(datasets).where(eq(datasets.id, 2)).limit(1);
    if (dataset) {
        console.log("Dataset 2:", JSON.stringify({
            id: dataset.id,
            name: dataset.name,
            schemaMapping: dataset.schemaMapping
        }, null, 2));
    } else {
        console.log("Dataset 2 not found!");
    }

    console.log("\n=== Counting Dataset 2 Items ===");
    const [countResult] = await db.select({ count: count() }).from(datasetItems).where(eq(datasetItems.datasetId, 2));
    console.log("Dataset 2 item count:", countResult?.count ?? 0);

    console.log("\n=== Sample Dataset 2 Items ===");
    const items = await db.select().from(datasetItems).where(eq(datasetItems.datasetId, 2)).limit(5);
    console.log("Sample items:", JSON.stringify(items, null, 2));

    process.exit(0);
}

main().catch(err => {
    console.error("Error:", err);
    process.exit(1);
});
