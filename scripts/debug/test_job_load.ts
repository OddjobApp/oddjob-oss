
import { db } from "@server/database_service.js";
import { jobs } from "../../shared/schema/index.js";
import { eq } from "drizzle-orm";

async function run() {
    const jobId = 9;
    console.log(`Attempting to load job ${jobId}...`);

    try {
        // Attempt 1: Using db.query syntax
        const jobQuery = await db.query.jobs.findFirst({
            where: eq(jobs.id, jobId)
        });
        console.log("Method 1 (db.query):", jobQuery ? `Found (id: ${jobQuery.id})` : "Not Found");

        // Attempt 2: Using select().from() syntax
        const [jobSelect] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
        console.log("Method 2 (db.select):", jobSelect ? `Found (id: ${jobSelect.id})` : "Not Found");

        process.exit(0);
    } catch (error: any) {
        console.error("Load failed with error:", error.message);
        if (error.stack) console.error(error.stack);
        process.exit(1);
    }
}

run();
