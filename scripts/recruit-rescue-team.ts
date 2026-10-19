
import { db } from "../server/db/index.js";
import { jobs } from "../shared/schema/index.js";
import { eq } from "drizzle-orm";

async function recruitRescueTeam() {
    console.log("=== Recruiting Rescue Team for System Triage Master ===");

    const [triage] = await db.select().from(jobs).where(eq(jobs.id, 55)).limit(1);
    if (!triage) {
        console.error("Job 55 (System Triage Master) not found.");
        process.exit(1);
    }

    const config = triage.config as any;
    const allowedPipelines = config.allowedPipelines || [];

    // Add Human Input Dispatcher (719) and Mission Rescue Dispatcher (720)
    if (!allowedPipelines.includes(719)) allowedPipelines.push(719);
    if (!allowedPipelines.includes(720)) allowedPipelines.push(720);

    config.allowedPipelines = allowedPipelines;

    await db.update(jobs).set({ config }).where(eq(jobs.id, 55));

    console.log("✅ Recruited Human Input and Rescue pipelines for Job 55.");
    process.exit(0);
}

recruitRescueTeam().catch(err => {
    console.error(err);
    process.exit(1);
});
