
import "dotenv/config";
import { db } from "../../server/database_service.js";
import { datasets, datasetItems, knowledgeNodes } from "../../shared/schema/index.js";
import { eq, isNotNull, sql } from "drizzle-orm";
import { processDatasetExtraction } from "../../server/domain/knowledge/core/dataset/dataset-extraction.js";

async function main() {
    console.log("Searching for dataset 'Job Output Test'...");
    const dataset = await db.query.datasets.findFirst({
        where: eq(datasets.name, "Job Output Test")
    });

    if (!dataset) {
        console.error("Dataset 'Job Output Test' not found!");
        process.exit(1);
    }

    console.log(`Found Dataset: ${dataset.name} (ID: ${dataset.id})`);

    const items = await db.select({
        id: datasetItems.id,
        pipelineExecutionId: datasetItems.pipelineExecutionId
    }).from(datasetItems).where(eq(datasetItems.datasetId, dataset.id));

    console.log(`Total Items: ${items.length}`);

    const itemsWithRun = items.filter((i: { pipelineExecutionId: number | null }) => i.pipelineExecutionId !== null);
    console.log(`Items with Pipeline Execution ID: ${itemsWithRun.length}`);

    if (itemsWithRun.length === 0) {
        console.log("CONCLUSION: Dataset items are NOT linked to any pipeline execution. The Knowledge Graph currently relies on this link.");
        process.exit(0);
    }

    const runIds = new Set(itemsWithRun.map((i: { pipelineExecutionId: number | null }) => i.pipelineExecutionId!));
    console.log(`Unique Pipeline Execution IDs: ${Array.from(runIds).join(', ')}`);

    for (const runId of Array.from(runIds)) {
        const nodes = await db.select({ count: sql<number>`count(*)` })
            .from(knowledgeNodes)
            .where(eq(knowledgeNodes.pipelineExecutionId, runId as number));

        console.log(`Run #${runId}: Found ${nodes[0].count} Knowledge Nodes.`);
    }

    process.exit(0);
}

main().catch(console.error);
