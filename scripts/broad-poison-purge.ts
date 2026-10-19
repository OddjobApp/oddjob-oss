
import "dotenv/config";
import { db } from "../server/db/index.js";
import { knowledgeDocuments } from "../shared/schema/index.js";
import { ilike, or, eq } from "drizzle-orm"; // Added eq

async function run() {
    console.log("Searching DB for poisoned text...");
    const results = await db.select().from(knowledgeDocuments).where(
        or(
            ilike(knowledgeDocuments.textContent, "%circular references%"),
            ilike(knowledgeDocuments.textContent, "%failed attempts%"),
            ilike(knowledgeDocuments.textContent, "%car status notification%"),
            ilike(knowledgeDocuments.textContent, "%poisoning%")
        )
    );

    console.log(`Found ${results.length} poisoned documents.`);
    for (const doc of results) {
        console.log(`- ID: ${doc.id}, Title: ${doc.title}`);
        console.log(`  Deleting...`);
        await db.delete(knowledgeDocuments).where(eq(knowledgeDocuments.id, doc.id));
    }

    process.exit(0);
}

run();
