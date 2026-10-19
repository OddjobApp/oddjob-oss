
import { db } from "../server/db";
import { pipelineStepExecutions, missionRuns } from "../shared/schema/index.js";

async function run() {
    console.log("FETCHING_DATA");
    const [steps, runs] = await Promise.all([
        db.select().from(pipelineStepExecutions).execute(),
        db.select().from(missionRuns).execute()
    ]);
    
    const result = {
        steps: steps.map(s => ({id: s.id, status: s.status, execId: s.pipelineExecutionId})),
        runs: runs.map(r => ({id: r.id, status: r.status, execId: r.pipelineExecutionId}))
    };
    
    console.log("JSON_START");
    console.log(JSON.stringify(result, null, 2));
    console.log("JSON_END");
    process.exit(0);
}

run();
