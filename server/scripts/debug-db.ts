
import { db } from "../database_service.js";
import { jobs } from "@shared/schema/index.js";
import { eq, desc, sql } from "drizzle-orm";

async function main() {
    console.log("Checking tables...");
    try {
        const result = await db.execute(sql`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name IN ('agent_run_steps', 'approval_requests', 'jobs')
        `);
        console.log("Existing tables:", result.rows.map(r => r.table_name));

        const job = await db.select().from(jobs).where(eq(jobs.id, 21));
        console.log("Job 21 check:", job.length > 0 ? "Found" : "Not Found");

    } catch (e) {
        console.error("Error checking tables:", e);
    }
}

main().catch(console.error).finally(() => process.exit(0));

