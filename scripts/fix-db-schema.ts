
import { db } from "../server/db/index.js";
import { sql } from "drizzle-orm";

async function fix() {
    try {
        console.log("Adding organization_id to agent_chat_messages...");
        await db.execute(sql`ALTER TABLE agent_chat_messages ADD COLUMN organization_id integer;`);
        console.log("SUCCESS: Column added.");
    } catch (err: any) {
        console.error("FAILURE:", err.message);
    }
    process.exit(0);
}

fix().catch(err => {
    console.error(err);
    process.exit(1);
});
