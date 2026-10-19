import { db } from "../database_service.js";
import { pipelineExecutions } from "@shared/schema/pipelines/pipeline-execution.js";
import { eq } from "drizzle-orm";

async function checkExecution10() {
    try {
        console.log("=== CHECKING PIPELINE EXECUTION 10 ===");
        const execs = await db.select().from(pipelineExecutions).where(eq(pipelineExecutions.id, 10));
        console.log("Execution 10 record:", JSON.stringify(execs, null, 2));

        const allExecs = await db.select().from(pipelineExecutions);
        console.log("\nAll Existing Executions:", JSON.stringify(allExecs.map(e => ({ id: e.id, status: e.status, pipelineId: e.pipelineId })), null, 2));
    } catch (err: any) {
        console.error("DB error:", err.message);
    }
    process.exit(0);
}

checkExecution10();
