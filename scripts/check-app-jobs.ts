
import { db } from "../server/db/index.js";
import { jobs } from "@shared/schema/index.js";
import { like } from "drizzle-orm";

async function checkAppJobs() {
    const appJobs = await db.select().from(jobs).where(like(jobs.name, 'App:%'));
    console.log(`Found ${appJobs.length} App-related jobs:`);
    appJobs.forEach(j => {
        console.log(`- [ID: ${j.id}] ${j.name} (Type: ${j.type}, Org: ${j.organizationId})`);
        console.log(`  Config: ${JSON.stringify(j.config)}`);
    });
    process.exit(0);
}

checkAppJobs().catch(err => {
    console.error(err);
    process.exit(1);
});
