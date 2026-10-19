import { config } from "dotenv";
config();
import { db } from "../server/db/index.js";
import { missionRuns, pipelineExecutions } from "../shared/schema/index";
import { eq } from "drizzle-orm";

async function main() {
    const runId = parseInt(process.argv[2]) || 39;
    try {
        const run = await db.query.missionRuns.findFirst({
            where: eq(missionRuns.id, runId)
        });
        console.log(`Run ${runId} basic data:`, JSON.stringify(run, null, 2));

        if (run?.pipelineExecutionId) {
            const exec = await db.query.pipelineExecutions.findFirst({
                where: eq(pipelineExecutions.id, run.pipelineExecutionId)
            });
            console.log("Execution contextSnapshot:", JSON.stringify(exec?.contextSnapshot, null, 2));
        } else {
            console.log(`No pipelineExecutionId found on run ${runId}.`);
        }
    } catch (err) {
        console.error("Error:", err);
    }
    process.exit(0);
}
main();
