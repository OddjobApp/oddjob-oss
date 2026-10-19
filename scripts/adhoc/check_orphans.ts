import { db } from "../../server/database_service.js";
import { sql } from "drizzle-orm";

async function checkOrphans() {
    try {
        console.log("Checking for orphan incidents (mission_run_id = 0 or non-existent)...");
        const orphans = await db.execute(sql`
            SELECT id, mission_run_id FROM antigravity_incidents
            WHERE mission_run_id = 0
            OR mission_run_id NOT IN (SELECT id FROM mission_runs);
        `);
        console.table(orphans.rows);

        process.exit(0);
    } catch (err) {
        console.error("Failed to check orphans:", err);
        process.exit(1);
    }
}

checkOrphans();
