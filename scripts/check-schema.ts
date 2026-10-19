
import { db } from "../server/db/index.js";
import { sql } from "drizzle-orm";

async function checkSchema() {
    const result = await db.execute(sql`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'agent_chat_messages';
    `);
    console.log("Schema for agent_chat_messages:");
    result.rows.forEach(r => {
        console.log(`- ${r.column_name} (${r.data_type})`);
    });
    process.exit(0);
}

checkSchema().catch(err => {
    console.error(err);
    process.exit(1);
});
