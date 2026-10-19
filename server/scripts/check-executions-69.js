import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function checkExecutions(wgId) {
    const client = await pool.connect();
    try {
        console.log(`--- PIPELINE EXECUTIONS for WG ${wgId} ---`);
        const execs = await client.query('SELECT * FROM pipeline_executions WHERE workgroup_id = $1 ORDER BY id DESC LIMIT 5', [wgId]);
        for (const e of execs.rows) {
            console.log(`Execution ${e.id}: Status=${e.status} | PipelineID=${e.pipeline_id} | CreatedAt=${e.created_at.toISOString()}`);

            const steps = await client.query('SELECT * FROM pipeline_step_executions WHERE pipeline_execution_id = $1 ORDER BY step_order DESC LIMIT 3', [e.id]);
            steps.rows.forEach(s => {
                console.log(`  - Step ${s.pipeline_step_id} (Order ${s.step_order}): Status=${s.status} | JobID=${s.job_id}`);
            });
        }

        console.log(`\n--- ACTIVE MISSIONS for WG ${wgId} ---`);
        const missions = await client.query('SELECT * FROM missions WHERE workgroup_id = $1 AND status = \'active\'', [wgId]);
        missions.rows.forEach(m => {
            console.log(`Mission ${m.id}: Status=${m.status} | ExecutionID=${m.pipeline_execution_id}`);
        });

    } finally {
        client.release();
        await pool.end();
    }
}

checkExecutions(69);
