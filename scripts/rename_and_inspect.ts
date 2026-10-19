import { db } from "../server/db/index.js";
import { sql } from "drizzle-orm";

async function main() {
    console.log("--- Rename and Inspect ---");

    try {
        console.log("Attempting to rename agent_chat_messages...");
        await db.execute(sql.raw('ALTER TABLE agent_chat_messages RENAME TO agent_chat_messages_old'));
        console.log("Rename Success");
    } catch (e: any) {
        console.warn(`Rename Failed: ${e.message}`);
    }

    const res = await db.execute(sql`
        SELECT c.relname, c.relkind 
        FROM pg_class c 
        JOIN pg_namespace n ON n.oid = c.relnamespace 
        WHERE n.nspname = 'public' 
        AND (c.relname LIKE '%agent_chat_messages%' OR c.relname LIKE '%health_check%')
        ORDER BY c.relname
    `);

    console.log(JSON.stringify(res.rows, null, 2));
    process.exit(0);
}

main().catch(console.error);
