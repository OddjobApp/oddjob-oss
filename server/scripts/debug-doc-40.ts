import 'dotenv/config';
import { db } from "../database_service.js";
import { knowledgeDocuments, knowledgeDocumentExtractions } from "@shared/schema/index.js";
import { eq, sql, and } from "drizzle-orm";
import { KnowledgeExtractionService } from "../domain/knowledge/index.js";

async function main() {
    console.log(">>> EXTRACTION DEBUG - DOCUMENT 40 <<<");

    const SCHEMA_ID = 1;
    const TEST_ID = 40;

    const [doc] = await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, TEST_ID));

    if (!doc) {
        console.log(`Document ${TEST_ID} not found.`);
        process.exit(1);
    }

    console.log(`Title: ${doc.title}`);
    console.log(`Metadata: ${JSON.stringify(doc.metadata, null, 2)}`);

    // Test the SQL filter logic
    const sqlCheck = await db.select().from(knowledgeDocuments).where(
        and(
            eq(knowledgeDocuments.id, TEST_ID),
            sql`metadata->>'source' = 'confluence'`
        )
    );
    console.log(`Source matches 'confluence' (SQL check): ${sqlCheck.length > 0}`);

    const extractionService = new KnowledgeExtractionService();
    try {
        const [record] = await db.insert(knowledgeDocumentExtractions).values({
            documentId: doc.id,
            schemaId: SCHEMA_ID,
            status: "processing",
            organizationId: doc.organizationId,
            createdBy: "SYSTEM_DEBUG_40",
            progress: 0
        }).returning();

        console.log("Starting processExtractionTask...");
        await extractionService.processExtractionTask(
            record.id,
            doc.id,
            SCHEMA_ID,
            doc.organizationId,
            async (p, m) => console.log(`  [${p}%] ${m}`)
        );
        console.log(`✅ SUCCESS: DOC ${doc.id}`);
    } catch (e: any) {
        console.error(`❌ FAILED: DOC ${doc.id} - ${e.message}`);
    }

    process.exit(0);
}

main().catch(err => {
    console.error("FATAL ERROR:");
    console.error(err);
    process.exit(1);
});

