
import "dotenv/config";
import { db } from "../../server/database_service.js";
import { jobs } from "../../shared/schema/index.js";
import { sql } from "drizzle-orm";

async function main() {
    const job101 = await db.select().from(jobs).where(sql`${jobs.id} = 101`).limit(1);

    if (job101.length > 0) {
        console.log(`Job 101 found:`, job101[0]);
    } else {
        console.log("Job 101 DOES NOT EXIST in the database.");
    }

    const orgs = await db.select({ id: jobs.organizationId, count: sql<number>`count(*)` }).from(jobs).groupBy(jobs.organizationId);
    console.table(orgs);

    process.exit(0);
}

main().catch(console.error);
