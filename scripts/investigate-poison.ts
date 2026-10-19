
import "dotenv/config";
import { db } from "../server/db/index.js";
import { knowledgeNodes } from "../shared/schema/index.js";
import { ilike, inArray } from "drizzle-orm";

async function run() {
    console.log("Investigating poisoned node sources...");
    const results = await db.select()
        .from(knowledgeNodes)
        .where(ilike(knowledgeNodes.name, "%Reasoning%"))
        .limit(10);

    results.forEach(e => {
        console.log(`- Node: ${e.name} (ID: ${e.id})`);
        console.log(`  Label: ${e.label}`);
        console.log(`  Doc ID: ${e.knowledgeDocumentId}`);
        console.log(`  Topic ID: ${e.knowledgeTopicId}`);
        console.log(`  Data: ${JSON.stringify(e.data)}`);
    });

    process.exit(0);
}

run();
