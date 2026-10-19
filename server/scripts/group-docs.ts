import 'dotenv/config';
import { db } from "../database_service.js";
import { knowledgeDocuments } from "@shared/schema/index.js";
import { sql } from "drizzle-orm";

async function main() {
    console.log("Grouping docs by metadata source...");
    try {
        const res = await db.select({
            source: sql<string>`metadata->>'source'`,
            count: sql<number>`count(*)`
        }).from(knowledgeDocuments).groupBy(sql`metadata->>'source'`);

        console.log("Source Summary:");
        res.forEach(r => console.log(`- ${r.source || 'NULL'}: ${r.count}`));

        const total = await db.select({ count: sql<number>`count(*)` }).from(knowledgeDocuments);
        console.log(`TOTAL DOCS: ${total[0].count}`);
    } catch (e: any) {
        console.error("Query failed:", e.message);
    }
    process.exit(0);
}
main();

