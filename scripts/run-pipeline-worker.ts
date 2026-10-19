
import "dotenv/config";
import { db } from "../server/db/index.js";
import { PipelineExecutor } from "../server/core/pipeline-executor";
import { pipelineExecutions } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

const EXEC_ID = process.argv[2] ? parseInt(process.argv[2]) : 409;

async function runWorker() {
    console.log(`👷 Manually running worker for Execution ${EXEC_ID}...`);

    // 1. Get Execution
    const [exec] = await db.select().from(pipelineExecutions).where(eq(pipelineExecutions.id, EXEC_ID));

    if (!exec) {
        console.error("Exec not found");
        process.exit(1);
    }

    // 2. Initialize Executor
    const executor = new PipelineExecutor();

    // 3. Run (Resume)
    try {
        console.log("🚀 Resuming/Starting Execution loop...");
        const result = await executor.resumePipelineExecution(EXEC_ID);
        console.log("✅ Pipeline Execution Result:", result.success ? "Success" : "Failed", result.error || "");
    } catch (err) {
        console.error("❌ Pipeline Execution Failed:", err);
    }
    process.exit(0);
}

runWorker().catch(console.error);
