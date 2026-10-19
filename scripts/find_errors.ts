import 'dotenv/config';
import { pool } from "../server/db/index.js";

async function main() {
    console.log("Searching for errors in mission_runs...");
    const runsRes = await pool.query("SELECT id, mission_id, status, mission_context::text as context FROM mission_runs WHERE status = 'failed' OR mission_context::text ILIKE '%mismatch%' ORDER BY id DESC LIMIT 20");
    console.log("Mission Runs with potential errors:");
    console.log(JSON.stringify(runsRes.rows, null, 2));

    console.log("\nSearching for errors in pipeline_executions...");
    const execsRes = await pool.query("SELECT id, pipeline_id, status, error FROM pipeline_executions WHERE status = 'failed' OR error ILIKE '%mismatch%' ORDER BY id DESC LIMIT 20");
    console.log("Pipeline Executions with potential errors:");
    console.log(JSON.stringify(execsRes.rows, null, 2));

    pool.end();
}

main().catch(console.error);
