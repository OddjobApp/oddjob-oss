
import { db } from "../database_service.js";
import { jobs } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function test() {
    console.log("Testing minimal job insert/update...");
    try {
        const [job] = await db.insert(jobs).values({
            name: "Minimal Test Job",
            type: "ai_agent",
            config: { type: 'ai_agent', config: { systemPrompt: 'Test' } } as any,
            organizationId: 1,
            createdBy: "test-user",
            tool: "None"
        }).returning();
        console.log("Insert success, id:", job.id);

        await db.update(jobs).set({ name: "Updated Name" }).where(eq(jobs.id, job.id));
        console.log("Update success");

        await db.delete(jobs).where(eq(jobs.id, job.id));
        console.log("Cleanup success");
    } catch (e) {
        console.error("Test failed:", e);
    } finally {
        process.exit();
    }
}

test();

