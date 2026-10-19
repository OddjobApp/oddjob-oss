import 'dotenv/config';
import { db } from "../database_service.js";
import { knowledgeDocuments, knowledgeDocumentExtractions } from "@shared/schema/index.js";
import { sql } from "drizzle-orm";
import { KnowledgeExtractionService } from "../domain/knowledge/index.js";

async function main() {
    console.log(">>> CONFLUENCE AI EXTRACTION STARTING <<<");

    const SCHEMA_ID = 1;

    // Fetch all for this org just to be safe, then filter in JS
    console.log("Fetching documents from database...");
    const allDocs = await db.select().from(knowledgeDocuments);
    console.log(`Total documents fetched: ${allDocs.length}`);

    const confluenceDocs = allDocs.filter(d => (d.metadata as any)?.source === 'confluence');
    console.log(`Filtered Confluence documents: ${confluenceDocs.length}`);

    if (confluenceDocs.length === 0) {
        console.log("Still no Confluence documents found in JS filter. Dumping first 5 metadata:");
        allDocs.slice(0, 5).forEach(d => console.log(JSON.stringify(d.metadata)));
        process.exit(0);
    }

    const extractionService = new KnowledgeExtractionService();
    let successCount = 0;

    for (const doc of confluenceDocs) {
        console.log(`\nDOC ${doc.id}: ${doc.title}`);

        try {
            // Skip check
            const [existing] = await db.select().from(knowledgeDocumentExtractions).where(
                sql`document_id = ${doc.id} AND schema_id = ${SCHEMA_ID} AND status = 'completed'`
            ).limit(1);

            if (existing) {
                console.log(`  Skipping (already done).`);
                successCount++;
                continue;
            }

            const [record] = await db.insert(knowledgeDocumentExtractions).values({
                documentId: doc.id,
                schemaId: SCHEMA_ID,
                status: "processing",
                organizationId: doc.organizationId,
                createdBy: "SYSTEM_FINAL_V3",
                progress: 0
            }).returning();

            await extractionService.processExtractionTask(
                record.id,
                doc.id,
                SCHEMA_ID,
                doc.organizationId,
                async (p, m) => { if (p % 50 === 0) console.log(`  [${p}%] ${m}`); }
            );

            console.log(`✅ SUCCESS: ${doc.id}`);
            successCount++;
        } catch (e: any) {
            console.error(`❌ FAILED: ${doc.id} - ${e.message}`);
        }
    }

    console.log(`\nDONE. Total Success: ${successCount}`);
    process.exit(0);
}

main().catch(console.error);

