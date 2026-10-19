
import "dotenv/config";
import { db } from "../server/db/index.js";
import { knowledgeNodes } from "../shared/schema/knowledge";
import { sql, isNotNull, ne } from "drizzle-orm";

async function main() {
    console.log("=== Finding Nodes with Extraction Sources ===");

    const nodes = await db.select().from(knowledgeNodes)
        .where(sql`extraction_sources != '[]'::jsonb`)
        .limit(5);

    console.log(`Found ${nodes.length} nodes with non-empty extraction sources.`);
    for (const node of nodes) {
        console.log(`\nNode ID: ${node.id}, Name: ${node.name}`);
        console.log(`Source: ${JSON.stringify(node.extractionSources, null, 2)}`);
    }
}

main().catch(console.error).finally(() => process.exit());
