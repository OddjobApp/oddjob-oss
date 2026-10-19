
import { db } from "../database_service.js";
import { jobs, pipelineExecutions } from "@shared/schema/index.js";
import { ilike, desc } from "drizzle-orm";

async function main() {
    console.log("Searching for 'hosting' in Jobs:");
    const matchingJobs = await db.select().from(jobs).where(ilike(jobs.name, '%hosting%'));

    if (matchingJobs.length === 0) {
        console.log("No jobs found matching 'hosting'. Searching by description/triggers...");
        // In a real scenario we'd check triggers or generic jobs, but let's stick to name for now.
    } else {
        console.log(`Found ${matchingJobs.length} jobs:`);
        matchingJobs.forEach(j => console.log(`[${j.id}] ${j.name} (Type: ${j.type})`));
    }

    console.log("\nSearching for 'hosting' in Pipeline Executions (inputs/outputs not easily searchable via SQL, checking triggers/ids)...");
    // We can't easily ILIKE jsonb columns in all drivers, but let's try a simple select and filter in memory for recent ones.

    const recentExecutions = await db.select().from(pipelineExecutions).orderBy(desc(pipelineExecutions.id)).limit(50);
    const hostingExecs = recentExecutions.filter(e => JSON.stringify(e).toLowerCase().includes("hosting"));

    if (hostingExecs.length > 0) {
        console.log(`Found ${hostingExecs.length} executions related to 'hosting':`);
        hostingExecs.forEach(e => {
            console.log(`[${e.id}] Status: ${e.status}, PipelineId: ${e.pipelineId}, MissionId: ${e.missionId}`);
        });
    } else {
        console.log("No recent executions found matching 'hosting'.");
    }
}

main().catch(console.error).finally(() => process.exit(0));

