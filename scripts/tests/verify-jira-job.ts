
import "dotenv/config";
import { db } from "../../server/db/index.js";
import { jobs } from "../../shared/schema";
import { eq } from "drizzle-orm";

async function main() {
    console.log("Verifying JIRA Job Config...");
    const jiraJobs = await db.select().from(jobs).where(eq(jobs.type, 'api'));
    const jiraJob = jiraJobs.find(j => j.name === 'Update JIRA Issue');

    if (!jiraJob) {
        console.error("Job not found!");
        return;
    }

    console.log("Job ID:", jiraJob.id);
    console.log("Config Type:", typeof jiraJob.config);
    console.log("Config:", JSON.stringify(jiraJob.config, null, 2));
}

main().catch(console.error);
