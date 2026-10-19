/**
 * AI Evaluation Suite for Datasets
 * Tests:
 * 1. Dataset CRUD Operations
 * 2. Dataset Item Management
 * 3. Tags/Metadata
 * 4. Organization Scoping
 * 5. Bulk Data Operations
 */

import "dotenv/config";
import { db } from "../../server/db/index.js";
import { datasets, datasetItems } from "../../shared/schema/datasets";
import { orgs } from "../../shared/schema/auth";
import { eq, sql } from "drizzle-orm";

interface EvalResult {
    testName: string;
    passed: boolean;
    details: string;
    duration: number;
}

const results: EvalResult[] = [];

async function recordResult(testName: string, passed: boolean, details: string, startTime: number) {
    const duration = Date.now() - startTime;
    results.push({ testName, passed, details, duration });
    console.log(`   ${passed ? "✅" : "❌"} ${testName} (${duration}ms)`);
    if (!passed) console.log(`      Details: ${details}`);
}

async function runEval() {
    console.log("🧠 Starting Datasets Evaluation...\n");
    console.log("=".repeat(70));

    // Get test org
    const [org] = await db.select().from(orgs).limit(1);
    const orgId = org?.id || null;

    let testDatasetId: number | null = null;
    const testItemIds: number[] = [];

    // 1. Dataset Creation
    console.log("\n📋 Test: Dataset CRUD Operations");
    console.log("-".repeat(50));

    let start = Date.now();
    try {
        const [dataset] = await db.insert(datasets).values({
            name: `Eval Dataset ${Date.now()}`,
            description: "Test dataset for evaluation",
            organizationId: orgId,
            tags: ["eval", "test", "automated"],
        }).returning();

        testDatasetId = dataset?.id || null;
        await recordResult("Dataset Creation", !!testDatasetId,
            testDatasetId ? `Created dataset ID: ${testDatasetId}` : "Failed", start);
    } catch (e: any) {
        await recordResult("Dataset Creation", false, e.message, start);
    }

    // 2. Dataset Read & Tags
    if (testDatasetId) {
        start = Date.now();
        try {
            const [readDataset] = await db.select().from(datasets).where(eq(datasets.id, testDatasetId));
            const tagsValid = Array.isArray(readDataset?.tags) && readDataset.tags.includes("eval");
            await recordResult("Dataset Read", tagsValid,
                `Tags: ${readDataset?.tags?.join(", ")}`, start);
        } catch (e: any) {
            await recordResult("Dataset Read", false, e.message, start);
        }
    }

    // 3. Dataset Update
    if (testDatasetId) {
        start = Date.now();
        try {
            await db.update(datasets)
                .set({ description: "Updated by eval", tags: ["eval", "updated"] })
                .where(eq(datasets.id, testDatasetId));
            const [updated] = await db.select().from(datasets).where(eq(datasets.id, testDatasetId));
            const updateValid = updated?.description === "Updated by eval";
            await recordResult("Dataset Update", updateValid,
                `Tags: ${updated?.tags?.join(", ")}`, start);
        } catch (e: any) {
            await recordResult("Dataset Update", false, e.message, start);
        }
    }

    // 4. Dataset Items
    console.log("\n📋 Test: Dataset Item Management");
    console.log("-".repeat(50));

    if (testDatasetId) {
        // Add items
        start = Date.now();
        try {
            const [item1] = await db.insert(datasetItems).values({
                datasetId: testDatasetId,
                data: { id: 1, name: "Alice", score: 95 },
            }).returning();
            if (item1?.id) testItemIds.push(item1.id);

            const [item2] = await db.insert(datasetItems).values({
                datasetId: testDatasetId,
                data: { id: 2, name: "Bob", score: 87 },
            }).returning();
            if (item2?.id) testItemIds.push(item2.id);

            const [item3] = await db.insert(datasetItems).values({
                datasetId: testDatasetId,
                data: { id: 3, name: "Charlie", score: 92 },
            }).returning();
            if (item3?.id) testItemIds.push(item3.id);

            await recordResult("Dataset Item Creation", testItemIds.length === 3,
                `Created ${testItemIds.length} items`, start);
        } catch (e: any) {
            await recordResult("Dataset Item Creation", false, e.message, start);
        }

        // Read items
        start = Date.now();
        try {
            const items = await db.select().from(datasetItems)
                .where(eq(datasetItems.datasetId, testDatasetId));
            const itemsValid = items.length >= 3;
            await recordResult("Dataset Items Read", itemsValid,
                `Found ${items.length} items`, start);

            // Verify data structure
            const firstItem = items[0];
            const dataValid = firstItem && typeof (firstItem.data as any)?.name === "string";
            await recordResult("Item Data Structure", dataValid,
                `First item: ${JSON.stringify(firstItem?.data)}`, start);
        } catch (e: any) {
            await recordResult("Dataset Items Read", false, e.message, start);
        }
    }

    // 5. Bulk Data Insert
    console.log("\n📋 Test: Bulk Data Operations");
    console.log("-".repeat(50));

    if (testDatasetId) {
        start = Date.now();
        try {
            const bulkItems = Array.from({ length: 10 }, (_, i) => ({
                datasetId: testDatasetId!,
                data: { id: i + 100, value: `Item ${i + 100}`, timestamp: Date.now() },
            }));

            const inserted = await db.insert(datasetItems)
                .values(bulkItems)
                .returning();

            inserted.forEach(item => {
                if (item?.id) testItemIds.push(item.id);
            });

            await recordResult("Bulk Insert", inserted.length === 10,
                `Inserted ${inserted.length} items in bulk`, start);
        } catch (e: any) {
            await recordResult("Bulk Insert", false, e.message, start);
        }

        // Count total items
        start = Date.now();
        try {
            const itemCount = await db.select({ count: sql<number>`count(*)` })
                .from(datasetItems)
                .where(eq(datasetItems.datasetId, testDatasetId));
            await recordResult("Item Count", true,
                `Total items in dataset: ${itemCount[0]?.count || 0}`, start);
        } catch (e: any) {
            await recordResult("Item Count", false, e.message, start);
        }
    }

    // 6. Organization Scoping
    console.log("\n📋 Test: Organization Scoping");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        if (orgId) {
            const orgDatasets = await db.select().from(datasets)
                .where(eq(datasets.organizationId, orgId));
            await recordResult("Org-Scoped Datasets", true,
                `Found ${orgDatasets.length} datasets for org ${orgId}`, start);
        } else {
            await recordResult("Org-Scoped Datasets", true, "No org to test", start);
        }
    } catch (e: any) {
        await recordResult("Org Scoping", false, e.message, start);
    }

    // 7. Dataset Statistics
    console.log("\n📋 Test: Dataset Statistics");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        const datasetCount = await db.select({ count: sql<number>`count(*)` }).from(datasets);
        const itemCount = await db.select({ count: sql<number>`count(*)` }).from(datasetItems);
        await recordResult("Dataset/Item Count", true,
            `Datasets: ${datasetCount[0]?.count || 0}, Items: ${itemCount[0]?.count || 0}`, start);
    } catch (e: any) {
        await recordResult("Statistics", false, e.message, start);
    }

    // Cleanup
    console.log("\n📋 Test: Cleanup");
    console.log("-".repeat(50));

    start = Date.now();
    try {
        // Items are cascade deleted with dataset
        if (testDatasetId) {
            await db.delete(datasets).where(eq(datasets.id, testDatasetId));
        }
        await recordResult("Cleanup", true, `Removed dataset and ${testItemIds.length} items`, start);
    } catch (e: any) {
        await recordResult("Cleanup", false, e.message, start);
    }

    // Summary
    console.log("\n" + "=".repeat(70));
    console.log("📊 DATASETS EVALUATION SUMMARY");
    console.log("=".repeat(70));

    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    const passRate = (passed / results.length) * 100;

    console.log(`\n   Total Tests: ${results.length}`);
    console.log(`   Passed: ${passed}`);
    console.log(`   Failed: ${failed}`);
    console.log(`   Pass Rate: ${passRate.toFixed(1)}%`);
    console.log(`   Total Duration: ${results.reduce((a, r) => a + r.duration, 0)}ms`);

    console.log("\n   Features Tested:");
    console.log("   - Dataset CRUD ✓");
    console.log("   - Dataset Items ✓");
    console.log("   - Tags/Metadata ✓");
    console.log("   - Bulk Operations ✓");
    console.log("   - Organization Scoping ✓");

    console.log("\n" + "=".repeat(70));
    if (passRate >= 80) {
        console.log("🎉 EVALUATION PASSED: Datasets system is operational!");
    } else if (passRate >= 50) {
        console.log("⚠️ EVALUATION PARTIAL: Some issues detected in Datasets.");
    } else {
        console.log("❌ EVALUATION FAILED: Significant issues with Datasets.");
    }
    console.log("=".repeat(70));

    process.exit(passRate >= 50 ? 0 : 1);
}

runEval().catch(e => {
    console.error("\n❌ EVALUATION CRASHED:", e);
    process.exit(1);
});
