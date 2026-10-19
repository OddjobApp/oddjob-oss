import 'dotenv/config';
import { db } from "../database_service.js";
import { knowledgeDocuments } from "@shared/schema/index.js";
import { sql } from "drizzle-orm";

async function main() {
    console.log(">>> RUNNING DYNAMIC EXTRACTION <<<");

    // 1. Query docs FIRST before importing services
    const docs = await db.select().from(knowledgeDocuments).where(
        sql`metadata->>'source' = 'confluence'`
    );
    console.log(`Docs found: ${docs.length}`);

    if (docs.length > 0) {
        // 2. Dynamic imports
        const { KnowledgeExtractionService } = await import("../domain/knowledge/index.js");
        const { knowledgeDocumentExtractions } = await import("@shared/schema/index.js");

        const extractionService = new KnowledgeExtractionService();
        const doc = docs[0];
        console.log(`Processing Doc ${doc.id}: ${doc.title}`);

        try {
            const [record] = await db.insert(knowledgeDocumentExtractions).values({
                documentId: doc.id,
                schemaId: 1,
                status: "processing",
                organizationId: doc.organizationId,
                createdBy: "DYNAMIC_RUN",
                progress: 0
            }).returning();

            await extractionService.processExtractionTask(
                record.id,
                doc.id,
                1,
                doc.organizationId,
                async (p, m) => console.log(`  [${p}%] ${m}`)
            );
            console.log("✅ Extraction Finished.");
        } catch (e: any) {
            console.error("❌ Extraction Failed:", e.message);
        }
    } else {
        console.log("No confluence docs found.");
    }
    process.exit(0);
}
main().catch(console.error);

