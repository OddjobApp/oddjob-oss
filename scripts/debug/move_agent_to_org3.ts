
import { db } from "@server/database_service.js";
import { jobs } from "../../shared/schema/index.js";
import { eq } from "drizzle-orm";

async function run() {
    try {
        await db.update(jobs)
            .set({ organizationId: 3 })
            .where(eq(jobs.id, 9));
        console.log("Successfully moved Agent-7 (Job 9) to Organization 3.");
        process.exit(0);
    } catch (error: any) {
        console.error("Failed to update job:", error.message);
        process.exit(1);
    }
}

run();
