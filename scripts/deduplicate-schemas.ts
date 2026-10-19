import "dotenv/config";
import { db } from "../server/db/index.js";
import { graphSchemaDefs } from "../shared/schema/index.ts";
import { eq, and, notInArray, inArray } from "drizzle-orm";

async function main() {
    console.log("🚀 Starting extraction schema deduplication...");
    try {
        const schemas = await db.select().from(graphSchemaDefs);
        console.log(`Found ${schemas.length} total schemas.`);

        const seenNames = new Set();
        const toDeleteIds = [];

        // Sort by ID descending to keep the newest one (or we could keep the oldest)
        // Usually keeping the oldest (lowest ID) is safer for relational integrity, 
        // but here they are likely identical.
        const sortedSchemas = [...schemas].sort((a, b) => a.id - b.id);

        for (const schema of sortedSchemas) {
            if (seenNames.has(schema.name)) {
                console.log(`- Marking duplicate: [${schema.id}] ${schema.name}`);
                toDeleteIds.push(schema.id);
            } else {
                seenNames.add(schema.name);
                console.log(`- Keeping unique: [${schema.id}] ${schema.name}`);
            }
        }

        if (toDeleteIds.length > 0) {
            console.log(`🗑️ Deleting ${toDeleteIds.length} duplicate schemas...`);
            await db.delete(graphSchemaDefs).where(inArray(graphSchemaDefs.id, toDeleteIds));
            console.log("✅ Deduplication complete!");
        } else {
            console.log("✨ No duplicates found.");
        }
    } catch (err) {
        console.error("❌ Error during deduplication:", err);
    }
    process.exit(0);
}

main();
