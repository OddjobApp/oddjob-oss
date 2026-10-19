
import { db } from "../database_service.js";
import { jobs } from "../../shared/schema/jobs/table.js";
import { eq } from "drizzle-orm";
import fs from "fs";

async function run() {
    try {
        const [job] = await db.select().from(jobs).where(eq(jobs.id, 125)).limit(1);
        fs.writeFileSync('job_125_dump.json', JSON.stringify(job, null, 2));
        console.log("Dumped to job_125_dump.json");
    } catch (err: any) {
        fs.writeFileSync('job_125_error.txt', err.stack);
        console.error(err);
    } finally {
        process.exit();
    }
}
run();

