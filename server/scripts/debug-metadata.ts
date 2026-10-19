import 'dotenv/config';
import { db } from "../database_service.js";
import { knowledgeDocuments, knowledgeDocumentExtractions } from "@shared/schema/index.js";
import { sql } from "drizzle-orm";
import { KnowledgeExtractionService } from "../domain/knowledge/index.js";

async function main() {
    console.log("Checking knowledge documents metadata...");

    // Check total count 
    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(knowledgeDocuments);
    console.log(`Total documents: ${count}`);

    // Peek at some metadata
    const sample = await db.select({
        id: knowledgeDocuments.id,
        title: knowledgeDocuments.title,
        metadata: knowledgeDocuments.metadata
    }).from(knowledgeDocuments).limit(20);

    console.log("Sample Metadata:");
    sample.forEach(s => {
        console.log(`ID: ${s.id} | Title: ${s.title} | Metadata: ${JSON.stringify(s.metadata)}`);
    });

    // Try finding by metadata source
    const confluenceDocs = await db.select().from(knowledgeDocuments).where(
        sql`metadata->>'source' = 'confluence'`
    );
    console.log(`\nFound ${confluenceDocs.length} documents with source 'confluence' using raw SQL.`);
    if (confluenceDocs.length > 0) {
        console.log(`SAMPLE_ID: ${confluenceDocs[0].id}`);
    }

    process.exit(0);
}

main().catch(console.error);

