
const { Client } = require('pg');

async function debug() {
    const runId = 116;
    const connectionString = 'postgresql://postgres:postgres@127.0.0.1:5433/oddjob';
    
    const client = new Client({ connectionString });
    await client.connect();

    console.log(`--- Debugging Run ${runId} ---`);
    const runRes = await client.query('SELECT * FROM mission_runs WHERE id = $1', [runId]);
    if (runRes.rows.length > 0) {
        const run = runRes.rows[0];
        console.log("Status:", run.status);
        console.log("MissionID (from run):", run.mission_id);
        console.log("PipelineExecutionID:", run.pipeline_execution_id);
        console.log("MissionContext:", JSON.stringify(run.mission_context, null, 2));

        if (run.pipeline_execution_id) {
            console.log(`\n--- Debugging Pipeline Execution ${run.pipeline_execution_id} ---`);
            const execRes = await client.query('SELECT * FROM pipeline_executions WHERE id = $1', [run.pipeline_execution_id]);
            if (execRes.rows.length > 0) {
                const exec = execRes.rows[0];
                console.log("Status:", exec.status);
                console.log("MissionID (from execution):", exec.mission_id);
            } else {
                console.log("Execution not found");
            }
        }
    } else {
        console.log("Run not found");
    }

    await client.end();
    process.exit(0);
}

debug().catch(console.error);
