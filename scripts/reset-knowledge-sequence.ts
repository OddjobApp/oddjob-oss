import { db } from "../server/db/index.js";
import { sql } from "drizzle-orm";

async function resetSequence() {
    console.log("Resetting knowledge_nodes_id_seq...");
    try {
        // Reset the sequence to the current max ID
        const result = await db.execute(sql`SELECT setval('knowledge_nodes_id_seq', (SELECT MAX(id) FROM knowledge_nodes));`);
        console.log("Sequence reset successfully:", result);
        process.exit(0);
    } catch (error) {
        console.error("Failed to reset sequence:", error);
        process.exit(1);
    }
}

resetSequence();
