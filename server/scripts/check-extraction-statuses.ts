import { db } from "../database_service.js";
import { extractionBatches, knowledgeDocumentExtractions } from "@shared/schema/knowledge-extraction.js";
import { sql } from "drizzle-orm";

async function checkStatuses() {
    try {
        const batchCounts = await db.select({
            status: extractionBatches.status,
            count: sql<number>`count(*)`
        }).from(extractionBatches).groupBy(extractionBatches.status);

        console.log("Extraction Batches Status Counts:", batchCounts);

        const extractionCounts = await db.select({
            status: knowledgeDocumentExtractions.status,
            count: sql<number>`count(*)`
        }).from(knowledgeDocumentExtractions).groupBy(knowledgeDocumentExtractions.status);

        console.log("Knowledge Document Extractions Status Counts:", extractionCounts);
        process.exit(0);
    } catch (e: any) {
        console.error(e);
        process.exit(1);
    }
}

checkStatuses();
