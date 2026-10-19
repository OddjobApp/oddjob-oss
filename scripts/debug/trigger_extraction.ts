// @ts-nocheck

import { db } from "@server/database_service.js";
import { knowledgeDocuments, graphSchemaDefs, knowledgeDocumentExtractions } from "../../shared/schema";
import { queueExtractionJob } from "@domain/knowledge/knowledge-queue.js";
import { eq } from "drizzle-orm";

async function main() {
    // 1. Get first document
    const [doc] = await db.select().from(knowledgeDocuments).limit(1);
    if (!doc) {
        console.log("No documents found to extract");
        process.exit(0);
    }

    // 2. Get first schema
    const [schema] = await db.select().from(graphSchemaDefs).limit(1);
    if (!schema) {
        console.log("No schemas found");
        process.exit(0);
    }

    console.log(`Triggering extraction for Doc ${doc.id} ("${doc.title}") using Schema ${schema.id} ("${schema.name}")`);

    // 3. Create Extraction Record
    const [extraction] = await db.insert(knowledgeDocumentExtractions).values({
        documentId: doc.id,
        schemaId: schema.id,
        organizationId: doc.organizationId,
        status: "queued",
        priority: 10,
        createdBy: "debug_script"
    }).returning();

    // 4. Queue Job
    await queueExtractionJob({
        extractionId: extraction.id,
        documentId: doc.id,
        schemaId: schema.id,
        organizationId: doc.organizationId
    }, 10);

    console.log(`Job queued: extraction-${extraction.id}`);
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
