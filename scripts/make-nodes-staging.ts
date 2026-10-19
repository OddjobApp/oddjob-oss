
import { db } from "../server/db/index.js";
import { knowledgeNodes, knowledgeDocuments, datasetItems } from "@shared/schema/index.js";
import { eq, and, inArray, sql } from "drizzle-orm";

async function makeStaging() {
    const docs = await db
        .select({ id: knowledgeDocuments.id })
        .from(knowledgeDocuments)
        .innerJoin(datasetItems, eq(knowledgeDocuments.datasetItemId, datasetItems.id))
        .where(eq(datasetItems.datasetId, 2));

    if (docs.length === 0) {
        console.log("No docs for dataset 2");
        process.exit(0);
    }

    // Pick top 10 nodes and make them staging
    const nodes = await db
        .select({ id: knowledgeNodes.id })
        .from(knowledgeNodes)
        .where(inArray(knowledgeNodes.knowledgeDocumentId, docs.map(d => d.id)))
        .limit(10);

    await db
        .update(knowledgeNodes)
        .set({ verificationStatus: 'staging' })
        .where(inArray(knowledgeNodes.id, nodes.map(n => n.id)));

    console.log(`Updated ${nodes.length} nodes to staging for Dataset 2`);
    process.exit(0);
}

makeStaging();
