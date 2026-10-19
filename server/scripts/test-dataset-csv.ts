// @ts-nocheck

import "dotenv/config";
import { datasetService } from "@domain/knowledge/core/dataset-service.js";
import { db } from "../database_service.js";
import { datasets } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function runTest() {
    console.log("Starting Dataset CSV Test...");

    // Mock org context
    const orgContext = { organizationId: 1, userId: "test-user", isSuperAdmin: true };

    // 1. Create a Dataset
    console.log("\n1. Creating Dataset...");
    const dataset = await datasetService.create({
        name: "Test CSV Dataset",
        description: "Testing CSV import/export"
    }, orgContext);
    console.log("   Created Dataset:", dataset.id);

    try {
        // 2. Import CSV
        console.log("\n2. Importing CSV...");
        const csvContent = `name,age,active\nAlice,30,true\nBob,25,false\nCharlie,35,true`;
        const importResult = await datasetService.importCsv(dataset.id, csvContent, orgContext);
        console.log("   Import Result:", importResult);

        if (importResult.inserted !== 3) {
            throw new Error(`Expected 3 inserted, got ${importResult.inserted}`);
        }

        // 3. Verify Items
        console.log("\n3. Verifying Items...");
        const itemsResult = await datasetService.getItems(dataset.id, orgContext, { limit: 10 });
        console.log(`   Found ${itemsResult.items.length} items.`);

        const alice = itemsResult.items.find(i => (i.data as any).name === 'Alice');
        if (!alice) throw new Error("Alice not found");
        if ((alice.data as any).age !== 30) throw new Error("Alice age mismatch");
        if ((alice.data as any).active !== true) throw new Error("Alice active mismatch");

        // 4. Export CSV
        console.log("\n4. Exporting CSV...");
        const generator = await datasetService.exportCsv(dataset.id, orgContext, {});
        let fullCsv = "";
        for await (const chunk of generator) {
            fullCsv += chunk;
        }
        console.log("   Exported CSV Length:", fullCsv.length);
        console.log("   Exported Content Preview:\n" + fullCsv.substring(0, 100));

        if (!fullCsv.includes("Alice") || !fullCsv.includes("30")) {
            throw new Error("Exported CSV missing data");
        }

        console.log("\n✅ TEST PASSED");

    } catch (e) {
        console.error("\n❌ TEST FAILED:", e);
    } finally {
        // Cleanup
        console.log("\nCleaning up...");
        await datasetService.delete(dataset.id, orgContext);
    }
}

runTest().catch(console.error).finally(() => process.exit(0));

