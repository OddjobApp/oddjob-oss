import { db } from "../../server/database_service.js";
import { sql } from "drizzle-orm";

async function cleanup() {
    try {
        console.log("Deleting orphan incidents with mission_run_id = 0...");
        const result = await db.execute(sql`
            DELETE FROM antigravity_incidents 
            WHERE mission_run_id = 0;
        `);
        console.log("Cleanup successful.");
        process.exit(0);
    } catch (err) {
        console.error("Cleanup failed:", err);
        process.exit(1);
    }
}

cleanup();
