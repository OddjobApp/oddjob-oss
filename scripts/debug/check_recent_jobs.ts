
import "dotenv/config";
import { db } from "@server/db/index.js";
import { jobs } from "@shared/schema/index.js";
import { desc } from "drizzle-orm";

async function checkJobs() {
    const recentJobs = await db.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(5);

    console.log(`Found ${recentJobs.length} recent jobs:`);
    recentJobs.forEach((j: any) => {
        console.log(`- [${j.id}] ${j.name} (Type: ${j.type}) - Created: ${j.createdAt}`);
    });

    process.exit(0);
}

checkJobs().catch(console.error);
