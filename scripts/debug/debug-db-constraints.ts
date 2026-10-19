
import { db } from "../../server/database_service.js";
import { sql } from "drizzle-orm";

async function debugConstraints() {
    console.log("🔍 Checking constraints for agent_chat_messages...");
    try {
        const result = await db.execute(sql`
            SELECT conname, pg_get_constraintdef(c.oid) 
            FROM pg_constraint c 
            JOIN pg_class t ON c.conrelid = t.oid 
            WHERE t.relname = 'agent_chat_messages';
        `);
        console.log("Current constraints:", JSON.stringify(result.rows, null, 2));
    } catch (error) {
        console.error("❌ Failed to query constraints:", error);
    }
}

debugConstraints();
