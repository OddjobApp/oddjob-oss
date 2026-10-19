
import "dotenv/config";
import { db } from "../server/db/index.js";
import { knowledgeDocuments } from "../shared/schema/index.js";
import { ilike, or, eq } from "drizzle-orm";

async function run() {
    console.log("Searching DB for more poisoned 'Mission Lesson' or 'Reasoning' docs...");
    const results = await db.select().from(knowledgeDocuments).where(
        or(
            ilike(knowledgeDocuments.title, "%Mission Lesson%"),
            ilike(knowledgeDocuments.title, "%Reasoning Step%"),
            ilike(knowledgeDocuments.textContent, "%returned no relevant information%")
        )
    );

    console.log(`Found ${results.length} poisoned documents.`);
    for (const doc of results) {
        console.log(`- ID: ${doc.id}, Title: ${doc.title}`);
        console.log(`  Deleting from DB...`);
        await db.delete(knowledgeDocuments).where(eq(knowledgeDocuments.id, doc.id));
    }

    process.exit(0);
}

run();
