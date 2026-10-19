
import "dotenv/config";
import { db } from "../../server/database_service.js";
import { pipelineStepExecutions } from "../../shared/schema/index.js";

async function dumpSteps() {
    console.log("Dumping all step executions...");
    const steps = await db.select().from(pipelineStepExecutions).limit(10);
    steps.forEach((s: any) => {
        console.log(`ID: ${s.id}, ExecID: ${s.pipelineExecutionId}, JobID: ${s.jobId}, Status: ${s.status}`);
    });
    process.exit(0);
}
dumpSteps().catch(console.error);
