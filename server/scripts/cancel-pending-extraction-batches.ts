import { db } from "../database_service.js";
import { extractionBatches, knowledgeDocumentExtractions } from "@shared/schema/knowledge-extraction.js";
import { inArray } from "drizzle-orm";

async function cancelPendingExtractionBatches() {
    try {
        console.log("\n🚫 Cancelling all pending and running Knowledge Extraction Batches...\n");

        // 1. Cancel pending & running extraction batches
        const cancelledBatches = await db.update(extractionBatches)
            .set({
                status: "cancelled",
                completedAt: new Date()
            })
            .where(inArray(extractionBatches.status, ["pending", "running", "queued"]))
            .returning({ id: extractionBatches.id, name: extractionBatches.name, status: extractionBatches.status });

        console.log(`✅ Cancelled ${cancelledBatches.length} extraction batches:`);
        for (const batch of cancelledBatches) {
            console.log(`   - Batch #${batch.id}: "${batch.name}" (Status: cancelled)`);
        }

        // 2. Cancel pending & running document extractions
        const cancelledExtractions = await db.update(knowledgeDocumentExtractions)
            .set({
                status: "cancelled",
                completedAt: new Date(),
                // The column is `error`; there is no errorMessage on this table.
                error: "Cancelled by operator request"
            })
            .where(inArray(knowledgeDocumentExtractions.status, ["pending", "running", "queued", "in_progress"]))
            .returning({ id: knowledgeDocumentExtractions.id, status: knowledgeDocumentExtractions.status });

        console.log(`✅ Cancelled ${cancelledExtractions.length} pending document extraction tasks.`);

        console.log(`\n══════════════════════════════════════════════════════════════`);
        console.log(`✅ Knowledge Extraction Cancellation Complete!`);
        console.log(`══════════════════════════════════════════════════════════════\n`);
        process.exit(0);
    } catch (err: any) {
        console.error(`❌ Failed to cancel extraction batches: ${err.message}`);
        process.exit(1);
    }
}

cancelPendingExtractionBatches();
