
import { db } from "@server/database_service.js";
import { knowledgeDocuments } from "../../shared/schema/index.js";
import { sql } from "drizzle-orm";

async function checkDocs() {
    const result = await db.execute(sql`SELECT COUNT(*) FROM ${knowledgeDocuments}`);
    console.log("Document Count:", result.rows[0].count);
    process.exit(0);
}

checkDocs().catch(console.error);
