
import 'dotenv/config';
import { pool } from "../server/db/index.js";

async function investigate() {
    const runId = 88;
    console.log(`\n=== Investigating Run ${runId} ===`);

    const runRes = await pool.query('SELECT * FROM mission_runs WHERE id = $1', [runId]);
    if (runRes.rows.length === 0) {
        console.log("Mission run not found.");
        return;
    }
    const run = runRes.rows[0];
    console.log("Mission Run Details:", JSON.stringify(run, null, 2));

    const executionId = run.pipeline_execution_id;
    console.log(`\nPipeline Execution ID: ${executionId}`);

    if (executionId && executionId !== -1) {
        const execRes = await pool.query('SELECT * FROM pipeline_executions WHERE id = $1', [executionId]);
        if (execRes.rows.length > 0) {
            console.log("\nPipeline Execution details:", JSON.stringify(execRes.rows[0], null, 2));

            const stepsRes = await pool.query('SELECT * FROM pipeline_step_executions WHERE pipeline_execution_id = $1 ORDER BY step_order', [executionId]);
            console.log(`\nFound ${stepsRes.rows.length} step executions:`);
            stepsRes.rows.forEach(s => {
                console.log(`Step ${s.step_order}: ${s.status} - Error: ${s.error}`);
            });
        }
    }

    console.log("\nSearching for any failed runs with 'mismatch' in error...");
    const mismatchRes = await pool.query(`
        SELECT r.id, r.status, e.error, r.error AS mission_run_error
        FROM mission_runs r
        LEFT JOIN pipeline_executions e ON r.pipeline_execution_id = e.id
        WHERE e.error ILIKE '%mismatch%' OR CAST(r.mission_context AS TEXT) ILIKE '%mismatch%'
    `);
    console.log(`Found ${mismatchRes.rows.length} runs:`);
    mismatchRes.rows.forEach(r => {
        console.log(`Run ${r.id}: status=${r.status}, error=${r.error}, mission_run_error=${r.mission_run_error}`);
    });
}

investigate().catch(console.error).finally(() => process.exit(0));
