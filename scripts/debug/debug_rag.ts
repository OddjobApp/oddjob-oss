import { retrieveSimilarDocuments } from "@domain/knowledge/core/rag-langchain.service.js";
import { db } from "@server/db/index.js";
import { knowledgeTopicDocuments, knowledgeDocuments, knowledgeTopics } from '@shared/schema/index.js';
import { eq } from 'drizzle-orm';
import { reindexKnowledgeDocument as reindex } from "@domain/knowledge/core/knowledge-store.js";

async function main() {
    console.log("1. Finding document for Topic 6 (Billing)...");

    const relations = await db.select().from(knowledgeTopicDocuments).where(eq(knowledgeTopicDocuments.topicId, 6));
    if (relations.length === 0) {
        console.log("No documents found for Topic 6");
        process.exit(1);
    }

    const docId = relations[0].documentId;
    console.log(`Found Document ID: ${docId}`);

    const [doc] = await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, docId));
    if (!doc) {
        console.log("Document record not found");
        process.exit(1);
    }

    console.log("2. Triggering Re-indexing...");
    // This uses the UPDATED logic which should fetch topicIds
    await reindex(doc);
    console.log("Re-indexing complete.");

    // Wait a moment for Qdrant (though await should handle it)
    await new Promise((r: any) => setTimeout(r, 2000));

    console.log("3. Testing Retrieval with topicIds...");

    // Mimic the NEW filter from agent-tools.ts
    const qdrantFilter = {
        must: [
            {
                key: "topicIds",
                match: { any: [6] }
            }
        ]
    };

    console.log("Filter:", JSON.stringify(qdrantFilter, null, 2));

    try {
        const query = "billing subscription details";
        // Need to import retrieveSimilarDocuments from correctly
        const { retrieveSimilarDocuments } = await import('@domain/knowledge/core/rag-langchain.service.js');
        const docs = await retrieveSimilarDocuments(query, { k: 5, filter: qdrantFilter });

        console.log(`Found ${docs.length} documents.`);
        docs.forEach(d => {
            console.log(`- ${d.metadata.name}`);
            console.log(`  Topic IDs:`, d.metadata.topicIds);
        });

    } catch (error) {
        console.error("Retrieval failed:", error);
    }

    process.exit(0);
}

main().catch(console.error);
