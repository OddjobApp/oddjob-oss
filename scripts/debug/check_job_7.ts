import * as dotenv from "dotenv";
dotenv.config();
import { db } from "@server/database_service.js";
import { jobs } from "../../shared/schema/index.js";
import { eq } from "drizzle-orm";

async function checkJob() {
    try {
        const job = await db.select().from(jobs).where(eq(jobs.id, 7));
        console.log("Job 7:", JSON.stringify(job, null, 2));
    } catch (e) {
        console.error("Error:", e);
    }
    process.exit(0);
}

checkJob();
