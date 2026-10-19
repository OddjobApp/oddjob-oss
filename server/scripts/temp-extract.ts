import 'dotenv/config';
import { db } from "../database_service.js";
import { knowledgeDocuments, knowledgeDocumentExtractions } from "@shared/schema/index.js";
import { sql } from "drizzle-orm";
import { KnowledgeExtractionService } from "../domain/knowledge/index.js";

async function main() {
    console.log(">>> DIAGNOSTIC START <<<");
    console.log("DB URL:", process.env.DATABASE_URL);

    const all = await db.select().from(knowledgeDocuments);
    console.log(`Total Docs: ${all.length}`);

    const confluenceSql = await db.select().from(knowledgeDocuments).where(
        sql`metadata->>'source' = 'confluence'`
    );
    console.log(`Filter [metadata->>'source' = 'confluence']: ${confluenceSql.length}`);

    const integrationType = await db.select().from(knowledgeDocuments).where(
        sql`source_type = 'integration'`
    );
    console.log(`Filter [source_type = 'integration']: ${integrationType.length}`);

    const textType = await db.select().from(knowledgeDocuments).where(
        sql`source_type = 'text'`
    );
    console.log(`Filter [source_type = 'text']: ${textType.length}`);

    if (all.length > 0) {
        const samples = all.filter(d => (d.metadata as any)?.source === 'confluence');
        console.log(`JS Filter [metadata.source === 'confluence']: ${samples.length}`);

        if (samples.length > 0) {
            console.log("Sample Confluence Doc:", JSON.stringify({
                id: samples[0].id,
                title: samples[0].title,
                metadata: samples[0].metadata
            }, null, 2));
        } else {
            console.log("Dumping first doc metadata:", JSON.stringify(all[0].metadata));
        }
    }

    process.exit(0);
}

main().catch(console.error);

