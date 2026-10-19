
import "dotenv/config";
import { db } from "./server/db/index.js";
import { knowledgeDocumentExtractions } from "./shared/schema/index.js";
import { sql } from "drizzle-orm";

async function checkStatuses() {
    console.log("--- Extraction Status Counts ---");
    const results = await db.select({
        status: knowledgeDocumentExtractions.status,
        count: sql<number>`count(*)`
    })
    .from(knowledgeDocumentExtractions)
    .groupBy(knowledgeDocumentExtractions.status);

    console.table(results);
    process.exit(0);
}

checkStatuses();
