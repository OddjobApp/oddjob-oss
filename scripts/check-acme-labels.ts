
import 'dotenv/config';
import { db } from "../server/db/index.js";
import { knowledgeNodes } from "../shared/schema/index";
import { eq, sql } from "drizzle-orm";

async function main() {
    console.log("Unique labels in Org 2 (Acme):");
    const labels = await db.select({
        label: knowledgeNodes.label,
        count: sql`count(*)`
    })
        .from(knowledgeNodes)
        .where(eq(knowledgeNodes.organizationId, 2))
        .groupBy(knowledgeNodes.label);

    console.log(JSON.stringify(labels, null, 2));
    process.exit(0);
}

main().catch(console.error);
