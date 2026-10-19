import 'dotenv/config';
import { db } from "../database_service.js";
import { knowledgeDocuments, knowledgeDocumentExtractions } from "@shared/schema/index.js";
import { sql } from "drizzle-orm";
import { KnowledgeExtractionService } from "../domain/knowledge/index.js";

async function main() {
    console.log(">>> STARTING BULK AI EXTRACTION V2 <<<");

    const SCHEMA_ID = 1;

    // Direct search
    const docs = await db.select().from(knowledgeDocuments).where(
        sql`metadata->>'source' = 'confluence'`
    );

    console.log(`Found docs: ${docs.length}`);

    if (docs.length === 0) {
        process.exit(0);
    }

    const extractionService = new KnowledgeExtractionService();
    let successCount = 0;

    // Just process 2 for absolute certainty
    const subset = docs.slice(0, 2);

    for (const doc of subset) {
        console.log(`Working on Doc ${doc.id}: ${doc.title}`);
        try {
            const [extractionRecord] = await db.insert(knowledgeDocumentExtractions).values({
                documentId: doc.id,
                schemaId: SCHEMA_ID,
                status: "processing",
                organizationId: doc.organizationId,
                createdBy: "SYSTEM_BULK_EXTRACT_V2",
                progress: 0,
                progressMessage: "Starting V2 extraction..."
            }).returning();

            await extractionService.processExtractionTask(
                extractionRecord.id,
                doc.id,
                SCHEMA_ID,
                doc.organizationId,
                async (p: number, m: string) => console.log(`  [${p}%] ${m}`)
            );
            console.log(`✅ Success for Doc ${doc.id}`);
            successCount++;
        } catch (e: any) {
            console.error(`❌ Failed for Doc ${doc.id}: ${e.message}`);
        }
    }

    console.log(`\nDone. Success: ${successCount}`);
    process.exit(0);
}

main().catch(console.error);

