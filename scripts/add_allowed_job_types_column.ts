
import 'dotenv/config';
import { db } from "../server/db/index.js";
import { sql } from "drizzle-orm";

async function main() {
    console.log("Adding allowed_job_types column to org_settings...");
    try {
        await db.execute(sql`ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS allowed_job_types text[];`);
        console.log("Success.");
    } catch (e) {
        console.error("Error:", e);
    }
    process.exit(0);
}

main();
