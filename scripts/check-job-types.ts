
import { db } from "../server/database_service.js";
import { jobs } from "../shared/schema/index.js";
import { sql } from "drizzle-orm";

async function checkJobTypes() {
    console.log("Checking Job Types in DB...");
    const results = await db.select({ 
        type: jobs.type,
        count: sql<number>`count(*)`
    }).from(jobs).groupBy(jobs.type);
    
    console.log("Found Job Types:");
    console.log(JSON.stringify(results, null, 2));
    process.exit(0);
}

checkJobTypes().catch(err => {
    console.error(err);
    process.exit(1);
});
