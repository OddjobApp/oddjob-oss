import "dotenv/config";
import { db } from "../server/db/index.js";
import { datasets, datasetItems, knowledgeNodes } from "@shared/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { processDatasetExtraction } from "../server/domain/knowledge/core/dataset/dataset-extraction.js";
import { processSemanticEnrichment } from "../server/domain/knowledge/core/extraction/knowledge-graph-integration.js";

async function main() {
    const datasetName = "Job Output Test";
    const dataset = await db.query.datasets.findFirst({
        where: eq(datasets.name, datasetName)
    });

    if (!dataset) { console.error("Dataset not found"); process.exit(1); }

    // 1. Inject JIRA Config (via entityTypes)
    console.log("[Trace] FIX: Injecting JIRA Extraction Rule (via entityTypes)...");

    // NOTE: This resembles User Input from the UI "Knowledge Config" form
    const defaultConfig = {
        entityTypes: [
            {
                name: "Ticket",
                nodeLabel: "Ticket",
                rootPath: "$.issues[*]",
                extractRules: [
                    { type: "json_path", sourceField: "$.key", targetProperty: "name" },
                    { type: "json_path", sourceField: "$.id", targetProperty: "externalId" }
                ]
            }
        ]
    };

    await db.update(datasets)
        .set({ knowledgeConfig: defaultConfig as any })
        .where(eq(datasets.id, dataset.id));

    // 2. Run Extraction
    console.log("[Trace] Running Extraction...");
    const result = await processDatasetExtraction(dataset.id, "system_fix_jira");
    console.log(`[Trace] Extraction Result: Processed=${result?.processedCount}, Errors=${result?.errorCount}`);

    // 3. Verify Nodes
    const items = await db.select().from(datasetItems).where(eq(datasetItems.datasetId, dataset.id));
    const runIds = [...new Set(items.map(i => i.pipelineExecutionId).filter(id => id !== null) as number[])];
    console.log(`[Trace] Linked Run IDs: ${runIds.join(', ')}`);

    if (runIds.length > 0) {
        const nodes = await db.select({ count: sql<number>`count(*)` })
            .from(knowledgeNodes)
            .where(inArray(knowledgeNodes.pipelineExecutionId, runIds));
        console.log(`[Trace] Total Knowledge Nodes Linked: ${nodes[0].count}`);
    } else {
        console.log("[Trace] No linked runs found? Check fix logic.");
    }

    process.exit(0);
}

main().catch(console.error);
