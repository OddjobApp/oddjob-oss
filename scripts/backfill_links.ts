
import "dotenv/config";
import { db } from "../server/db/index.js";
import { knowledgeDocuments } from "@shared/schema";
import { enrichmentService } from "../server/domain/knowledge/index.js";

async function backfillLinks() {
    console.log("[Link Backfill] Starting Context Link Backfill...");

    // Fetch ALL documents, not just unenriched ones
    const docs = await db.select().from(knowledgeDocuments);
    console.log(`[Link Backfill] Found ${docs.length} documents to scan.`);

    let count = 0;
    for (const doc of docs) {
        if (!doc.textContent) continue;

        // Scan for links (Jira, etc)
        // This is non-destructive and idempotent (checks for existing edges)
        await enrichmentService.scanForLinks(doc.id, doc.organizationId || 0, doc.textContent);

        count++;
        if (count % 10 === 0) process.stdout.write(".");
    }

    console.log(`\n[Link Backfill] Completed. Scanned ${count} documents.`);
    process.exit(0);
}

backfillLinks().catch(err => {
    console.error(err);
    process.exit(1);
});
