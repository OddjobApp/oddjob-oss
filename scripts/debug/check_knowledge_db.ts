
import { db } from "@server/database_service.js";
import { knowledgeDocuments, graphSchemaDefs, knowledgeDocumentExtractions } from "../../shared/schema";
import { count, desc } from "drizzle-orm";

async function main() {
    console.log("--- DB STATE CHECK ---");

    const docsCount = await db.select({ value: count() }).from(knowledgeDocuments);
    console.log(`Knowledge Documents: ${docsCount[0].value}`);

    const schemasCount = await db.select({ value: count() }).from(graphSchemaDefs);
    console.log(`Graph Schemas: ${schemasCount[0].value}`);

    const extractions = await db.select().from(knowledgeDocumentExtractions).orderBy(desc(knowledgeDocumentExtractions.id)).limit(5);
    console.log("Recent Extractions:");
    console.log(JSON.stringify(extractions, null, 2));

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
