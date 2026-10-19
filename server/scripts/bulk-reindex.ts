
import { db } from '../database_service.js';
import { knowledgeDocuments } from '@shared/schema/index.js';
import { reindexKnowledgeDocument } from "@server/knowledge/knowledge-store.js";

async function main() {
    console.log("Starting bulk re-indexing from server/scripts...");

    try {
        const docs = await db.select().from(knowledgeDocuments);
        console.log(`Found ${docs.length} documents.`);

        for (const doc of docs) {
            try {
                console.log(`Re-indexing document ${doc.id}: "${doc.title}"...`);
                await reindexKnowledgeDocument(doc);
            } catch (error) {
                console.error(`Failed to re-index document ${doc.id}:`, error);
            }
        }

        console.log("Bulk re-indexing complete.");
        process.exit(0);
    } catch (err) {
        console.error("Bulk re-indexing failed:", err);
        process.exit(1);
    }
}

main();

