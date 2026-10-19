
import { db } from '../database_service.js';
import { jobs } from '../../shared/schema/index.js';
import { eq } from 'drizzle-orm';

async function run() {
    try {
        const [job] = await db.select().from(jobs).where(eq(jobs.id, 133)).limit(1);
        if (job) {
            console.log("JOB_133_CONFIG_START");
            console.log(JSON.stringify(job, null, 2));
            console.log("JOB_133_CONFIG_END");
        } else {
            console.log("Job 133 not found");
        }
    } catch (e: any) {
        console.error("Error fetching job 133:", e);
    }
    process.exit();
}

run();

