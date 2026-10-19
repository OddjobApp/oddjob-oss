import { db } from "../server/db/index.js";
import { knowledgeNodes, knowledgeDocuments } from "../shared/schema/index.ts";
import { enrichmentService } from "../server/domain/knowledge/index.js";
import { isNull, desc } from "drizzle-orm";

async function runBatchEnrichment() {
    console.log("[Batch Enrichment] Starting full backfill cycle...");

    // 1. Enrich Documents (Batch Process)
    let totalDocs = 0;
    while (true) {
        console.log("[Batch Enrichment] Scanning for next batch of unenriched documents...");
        const docs = await db.select()
            .from(knowledgeDocuments)
            .where(isNull(knowledgeDocuments.summary)) // Only unprocessed
            .limit(10); // Small batch for rate limits

        if (docs.length === 0) break;

        for (const doc of docs) {
            await enrichmentService.enrichDocument(doc.id, doc.organizationId || 0);
            // Small delay to be polite to API
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        totalDocs += docs.length;
        console.log(`[Batch Enrichment] Processed ${totalDocs} documents so far...`);
    }
    console.log(`[Batch Enrichment] Document enrichment complete. Total: ${totalDocs}`);

    // 2. Enrich Nodes (Batch Process - Limited for now to recent)
    console.log("[Batch Enrichment] Scanning for recent unenriched nodes...");

    // Fetch recent 200 nodes window
    const nodes = await db.select()
        .from(knowledgeNodes)
        .orderBy(desc(knowledgeNodes.createdAt))
        .limit(200);

    let nodeCount = 0;
    for (const node of nodes) {
        const data = node.data as Record<string, any>;
        if (!data.auto_summary && !data.topics) {
            await enrichmentService.enrichNode(node.id, node.organizationId || 0);
            nodeCount++;
            // Small delay
            await new Promise(resolve => setTimeout(resolve, 200));
        }
    }
    console.log(`[Batch Enrichment] Processed ${nodeCount} recent nodes.`);

    console.log("[Batch Enrichment] Cycle complete.");
    process.exit(0);
}

runBatchEnrichment().catch(err => {
    console.error("[Batch Enrichment] Failed:", err);
    process.exit(1);
});
