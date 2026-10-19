
import { db } from "../server/db/index.js";
import { knowledgeDocuments } from "../shared/schema/knowledge-base.js";
import { ilike, or, and, not, eq } from "drizzle-orm";

async function syncSourceTypes() {
    console.log("Syncing source_type for documents with Confluence URLs...");

    // Find all documents with 'atlassian.net/wiki' or '.atlassian.net/spaces' in URL
    // AND source_type is not already 'confluence'
    const docs = await db.select().from(knowledgeDocuments).where(
        and(
            or(
                ilike(knowledgeDocuments.url, "%atlassian.net/wiki%"),
                ilike(knowledgeDocuments.url, "%atlassian.net/spaces%")
            ),
            not(eq(knowledgeDocuments.sourceType, "confluence"))
        )
    );

    console.log(`Found ${docs.length} documents to update.`);

    let updated = 0;
    for (const doc of docs) {
        console.log(` - Updating [${doc.id}] "${doc.title}": ${doc.sourceType} -> confluence`);
        await db.update(knowledgeDocuments)
            .set({ sourceType: "confluence" })
            .where(eq(knowledgeDocuments.id, doc.id));
        updated++;
    }

    console.log(`Successfully updated ${updated} documents.`);
    process.exit(0);
}

syncSourceTypes().catch(err => {
    console.error(err);
    process.exit(1);
});
