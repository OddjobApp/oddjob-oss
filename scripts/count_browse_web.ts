
import "dotenv/config";
import { db } from "../server/db/index.js";
import { jobs } from "../shared/schema/jobs/index.js";
import { eq } from "drizzle-orm";

async function countBrowseWeb() {
    const results = await db.select().from(jobs).where(eq(jobs.type, "browse_web"));
    console.log("Browse Web jobs found:", results.length);
    if (results.length > 0) {
        console.log("Job IDs:", results.map(r => r.id));
    }
    process.exit(0);
}

countBrowseWeb().catch(err => {
    console.error(err);
    process.exit(1);
});
