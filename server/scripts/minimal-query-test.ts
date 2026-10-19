import 'dotenv/config';
import { db } from "../database_service.js";
import { knowledgeDocuments } from "@shared/schema/index.js";
import { sql } from "drizzle-orm";

async function main() {
    console.log("Starting minimal query test...");
    const docs = await db.select().from(knowledgeDocuments).where(
        sql`metadata->>'source' = 'confluence'`
    );
    console.log(`Minimal query found: ${docs.length}`);
    process.exit(0);
}
main();

