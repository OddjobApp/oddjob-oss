
import { db } from "../server/db/index.js";
import { knowledgeDocuments } from "../shared/schema/knowledge-base.js";
import { eq, isNull, isNotNull } from "drizzle-orm";

async function backfillUrls() {
    console.log("Starting URL backfill...");
    const docs = await db.select().from(knowledgeDocuments).where(isNull(knowledgeDocuments.url));
    console.log(`Found ${docs.length} documents with null URL.`);

    let updatedCount = 0;
    for (const doc of docs) {
        const metadata = doc.metadata as any;
        if (metadata && metadata.url) {
            console.log(`Updating document ${doc.id} ("${doc.title}") with URL: ${metadata.url}`);
            await db.update(knowledgeDocuments)
                .set({ url: metadata.url })
                .where(eq(knowledgeDocuments.id, doc.id));
            updatedCount++;
        }
    }

    console.log(`Backfill complete. Updated ${updatedCount} documents.`);
    process.exit(0);
}

backfillUrls().catch(err => {
    console.error("Backfill failed:", err);
    process.exit(1);
});
