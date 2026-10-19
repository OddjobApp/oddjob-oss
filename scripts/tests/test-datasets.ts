
import "dotenv/config";
import { db } from "../../server/db/index.js";
import { datasets, datasetItems, orgs } from "../../shared/schema";
import { eq, desc } from "drizzle-orm";

async function runConstraintAnalysis() {
    console.log("----------------------------------------------------------------");
    console.log("🧪  DATASET INTEGRATION VALIDATION");
    console.log("----------------------------------------------------------------");

    // 1. Setup
    const testName = "Test Dataset " + Date.now();
    console.log(`[1] Creating dataset: ${testName}`);

    // Fetch a valid org
    const org = await db.query.orgs.findFirst();
    const orgId = org ? org.id : null;
    console.log(`Using Organization ID: ${orgId}`);

    try {
        const [dataset] = await db.insert(datasets).values({
            name: testName,
            description: "Created by automated validation script",
            organizationId: orgId
        }).returning();

        console.log(`✅ Dataset created. ID: ${dataset.id}`);

        // 2. Add Items
        console.log(`[2] Adding items to dataset ${dataset.id}...`);

        const itemsToInsert = [
            { datasetId: dataset.id, data: { name: "Alice", role: "User" } },
            { datasetId: dataset.id, data: { name: "Bob", role: "Admin" } }
        ];

        const insertedItems = await db.insert(datasetItems).values(itemsToInsert).returning();
        console.log(`✅ Inserted ${insertedItems.length} items.`);

        // 3. Verify Retrieval
        console.log(`[3] Verifying retrieval...`);
        const fetchedItems = await db.query.datasetItems.findMany({
            where: eq(datasetItems.datasetId, dataset.id),
            orderBy: [desc(datasetItems.createdAt)]
        });

        if (fetchedItems.length !== 2) throw new Error("Item count mismatch");
        if ((fetchedItems[0].data as any)['name'] !== "Bob" && (fetchedItems[0].data as any)['name'] !== "Alice") throw new Error("Data mismatch");

        console.log(`✅ Items verified correctly.`);

        // 4. Cleanup
        console.log(`[4] Cleaning up...`);
        await db.delete(datasets).where(eq(datasets.id, dataset.id));
        console.log(`✅ Cleanup successful.`);

        console.log("----------------------------------------------------------------");
        console.log("🎉  ALL TESTS PASSED");
        console.log("----------------------------------------------------------------");
        process.exit(0);

    } catch (err) {
        console.error("❌ TEST FAILED:", err);
        process.exit(1);
    }
}

runConstraintAnalysis();
