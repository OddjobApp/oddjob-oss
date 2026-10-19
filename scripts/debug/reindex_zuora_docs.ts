
import { db } from "@server/database_service.js";
import { knowledgeDocuments } from "../../shared/schema/index.js";
import { inArray } from "drizzle-orm";
import { reindexKnowledgeDocument } from "../../server/knowledge/knowledge-store";

async function run() {
    const ids = [38, 45, 342, 108, 137];
    console.log(`Re-indexing documents: ${ids.join(", ")}...`);

    const docs = await db.select().from(knowledgeDocuments).where(inArray(knowledgeDocuments.id, ids));

    for (const doc of docs) {
        try {
            console.log(`- Indexing doc ${doc.id}: ${doc.title}...`);
            await reindexKnowledgeDocument(doc as any);
        } catch (error: any) {
            console.error(`  FAILED: ${error.message}`);
        }
    }

    console.log("Re-indexing complete.");
    process.exit(0);
}

run();
