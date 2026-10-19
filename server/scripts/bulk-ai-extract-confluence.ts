import 'dotenv/config';
import { db } from "../database_service.js";
import { knowledgeDocuments, knowledgeDocumentExtractions } from "@shared/schema/index.js";
import { sql } from "drizzle-orm";
import { KnowledgeExtractionService } from "../domain/knowledge/index.js";

async function main() {
    console.log(">>> FINAL CONFLUENCE AI EXTRACTION JOB <<<");

    // Connection warm-up (proven to help document discovery in this env)
    const all = await db.select().from(knowledgeDocuments);
    console.log(`Total local documents: ${all.length}`);

    const docs = await db.select().from(knowledgeDocuments).where(
        sql`metadata->>'source' = 'confluence'`
    );
    console.log(`Confluence documents discovered: ${docs.length}`);

    if (docs.length === 0) {
        console.log("No confluence documents found. Check metadata structure.");
        process.exit(0);
    }

    const extractionService = new KnowledgeExtractionService();
    let successCount = 0;
    const SCHEMA_ID = 1;

    // Scale-up test: Process first 10
    const subset = docs.slice(0, 10);
    console.log(`Processing subset of ${subset.length} documents...`);

    for (const doc of subset) {
        console.log(`\n---------------------------------------------------------`);
        console.log(`DOC ID: ${doc.id} | TITLE: ${doc.title}`);

        try {
            // Check for previous completed run
            const [existing] = await db.select().from(knowledgeDocumentExtractions).where(
                sql`document_id = ${doc.id} AND schema_id = ${SCHEMA_ID} AND status = 'completed'`
            ).limit(1);

            if (existing) {
                console.log(`  >> Skipping: Already completed (Extraction ID: ${existing.id})`);
                successCount++;
                continue;
            }

            // Create status record
            const [record] = await db.insert(knowledgeDocumentExtractions).values({
                documentId: doc.id,
                schemaId: SCHEMA_ID,
                status: "processing",
                organizationId: doc.organizationId,
                createdBy: "SYSTEM_REINGEST_FINAL",
                progress: 0
            }).returning();

            // Run AI Extraction
            await extractionService.processExtractionTask(
                record.id,
                doc.id,
                SCHEMA_ID,
                doc.organizationId,
                async (p: number, m: string) => {
                    if (p % 50 === 0) console.log(`  [Progress ${p}%] ${m}`);
                }
            );

            console.log(`✅ Extraction successful for Document ${doc.id}`);
            successCount++;
        } catch (err: any) {
            console.error(`❌ Extraction failed for Document ${doc.id}:`, err.message);
        }
    }

    console.log(`\n>>> SUBSET EXTRACTION COMPLETE <<<`);
    console.log(`Successfully processed: ${successCount} / ${subset.length}`);
    process.exit(0);
}

main().catch(err => {
    console.error("\nFATAL ERROR DURING EXTRACTION:");
    console.error(err);
    process.exit(1);
});

