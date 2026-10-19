import "dotenv/config";
import { db } from "../server/db/index.js";
import { knowledgeDocumentExtractions, knowledgeDocuments } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { queueExtractionJob } from "../server/domain/knowledge/index";

async function main() {
    const documentId = 8;
    console.log(`Re-triggering extraction for document ${documentId}...`);

    const [doc] = await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, documentId));
    if (!doc) {
        console.error(`Document ${documentId} not found.`);
        process.exit(1);
    }

    // Create a new extraction record
    const [extraction] = await db.insert(knowledgeDocumentExtractions).values({
        documentId,
        schemaId: 5, // Global General Knowledge (now updated)
        organizationId: doc.organizationId,
        status: "queued",
        priority: 5,
        createdBy: "system",
        metadata: { source: "re-trigger" }
    }).returning();

    console.log(`Created extraction record ${extraction.id}. Queuing...`);

    await queueExtractionJob({
        type: 'document',
        extractionId: extraction.id,
        documentId,
        schemaId: extraction.schemaId,
        organizationId: extraction.organizationId!
    });

    console.log("✅ Job queued.");
    process.exit(0);
}

main().catch(console.error);
