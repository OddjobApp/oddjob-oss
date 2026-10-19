
import { db } from "../database_service.js";
import { jobs } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function reproduce() {
    console.log("Reproduce script starting...");
    try {
        // 1. Create a job exactly like the test script does
        const [job] = await db.insert(jobs).values({
            name: "Repro Job " + Date.now(),
            type: "ai_agent",
            config: { systemPrompt: "Old" },
            organizationId: 1,
            createdBy: "test-user",
            tool: "None"
        }).returning();
        console.log("Created job", job.id);

        // 2. Simulate applySuggestion logic
        const jobId = job.id;
        const [fetchedJob] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
        const config = fetchedJob.config as any || {};
        config.systemPrompt = "New Prompt";

        console.log("Updating job...");
        await db.update(jobs).set({ config }).where(eq(jobs.id, jobId));
        console.log("Update success!");

        // Cleanup
        await db.delete(jobs).where(eq(jobs.id, job.id));
    } catch (e: any) {
        console.error("FAILED:", e.message);
        if (e.detail) console.error("Detail:", e.detail);
    } finally {
        process.exit();
    }
}

reproduce();

