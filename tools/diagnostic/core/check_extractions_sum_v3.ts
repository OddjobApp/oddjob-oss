
import "dotenv/config";
import { db } from "./server/db.js";
import { knowledgeDocumentExtractions } from "./shared/schema/index.js";
import { eq, sql } from "drizzle-orm";

async function checkSum() {
    const res = await db.select({ 
        count: sql`count(*)`, 
        sum: sql`sum(nodes_extracted)` 
    }).from(knowledgeDocumentExtractions).where(eq(knowledgeDocumentExtractions.organizationId, 1));
    console.log(JSON.stringify(res, null, 2));
    process.exit(0);
}
checkSum();
