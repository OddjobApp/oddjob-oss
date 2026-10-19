import 'dotenv/config';
import { db } from "../database_service.js";
import { knowledgeNodes, knowledgeTopicDocuments } from "@shared/schema/index.js";
import { eq, inArray, sql } from "drizzle-orm";

async function main() {
    console.log("Propagating Topics from Documents to Nodes...");
    const orgId = 1;

    // 1. Fetch doc-topic links
    const docTopicLinks = await db.select().from(knowledgeTopicDocuments);
    console.log(`Found ${docTopicLinks.length} document-topic links.`);

    // Map docId -> topicId (just take the first one for now as primary topic)
    const docToTopicMap = new Map<number, number>();
    docTopicLinks.forEach(link => {
        if (!docToTopicMap.has(link.documentId)) {
            docToTopicMap.set(link.documentId, link.topicId);
        }
    });

    const docIds = Array.from(docToTopicMap.keys());
    if (docIds.length === 0) {
        console.log("No document topics found to propagate.");
        process.exit(0);
    }

    // 2. Batch update nodes in chunks to be efficient
    let totalUpdated = 0;
    const chunkSize = 100;

    for (let i = 0; i < docIds.length; i += chunkSize) {
        const batchDocIds = docIds.slice(i, i + chunkSize);

        // Fetch nodes for these docs
        const nodes = await db.select().from(knowledgeNodes).where(
            and(
                eq(knowledgeNodes.organizationId, orgId),
                inArray(knowledgeNodes.knowledgeDocumentId, batchDocIds)
            )
        );

        for (const node of nodes) {
            const topicId = docToTopicMap.get(node.knowledgeDocumentId!);
            if (topicId && node.knowledgeTopicId !== topicId) {
                await db.update(knowledgeNodes)
                    .set({ knowledgeTopicId: topicId })
                    .where(eq(knowledgeNodes.id, node.id));
                totalUpdated++;
            }
        }
        console.log(`Progress: ${i + batchDocIds.length}/${docIds.length} docs processed...`);
    }

    console.log(`Propagation Complete. Updated ${totalUpdated} nodes.`);
    process.exit(0);
}

// Helper to handle the 'and' import since I missed it
import { and } from "drizzle-orm";

main().catch(console.error);

