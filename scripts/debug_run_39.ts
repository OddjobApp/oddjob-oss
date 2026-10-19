import { config } from "dotenv";
config();
import { db } from "../server/db/index.js";
import { missionRuns, pipelineExecutions } from "../shared/schema/index";
import { eq } from "drizzle-orm";
import * as fs from "fs";

async function main() {
    const runId = 39;
    try {
        const run = await db.query.missionRuns.findFirst({
            where: eq(missionRuns.id, runId)
        });
        
        const data: any = { run };

        if (run?.pipelineExecutionId) {
            const exec = await db.query.pipelineExecutions.findFirst({
                where: eq(pipelineExecutions.id, run.pipelineExecutionId)
            });
            data.execution = exec;
        }

        fs.writeFileSync("run_39_full.json", JSON.stringify(data, null, 2));
        console.log("Dumped Run 39 to run_39_full.json");
    } catch (err) {
        console.error("Error:", err);
    }
    process.exit(0);
}
main();
