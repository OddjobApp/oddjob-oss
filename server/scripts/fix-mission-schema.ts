
import { db } from "../database_service.js";
import { sql } from "drizzle-orm";

async function applyFix() {
    console.log("Applying database fix: adding pipeline_execution_id to missions table...");
    try {
        await db.execute(sql`ALTER TABLE missions ADD COLUMN IF NOT EXISTS pipeline_execution_id integer;`);
        console.log("Success: pipeline_execution_id column added to missions table.");
    } catch (error) {
        console.error("Failed to add column:", error);
        process.exit(1);
    }
}

applyFix().then(() => process.exit(0));

