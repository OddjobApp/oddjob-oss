
import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function check() {
    const client = await pool.connect();
    try {
        const executionId = 236;
        console.log(`--- Inspecting Execution ${executionId} ---`);

        // 1. Check Execution Status
        const execRes = await client.query('SELECT * FROM pipeline_executions WHERE id = $1', [executionId]);
        console.log('Execution Status:', JSON.stringify(execRes.rows[0], null, 2));

        // 2. Check Step Executions
        const stepsRes = await client.query(
            'SELECT id, step_id, status, started_at, completed_at, error, output_message FROM pipeline_step_executions WHERE execution_id = $1 ORDER BY started_at ASC',
            [executionId]
        );
        console.log('\nSteps:');
        stepsRes.rows.forEach(s => {
            console.log(`- Step ${s.step_id} (ID: ${s.id}): Status=${s.status}, Error=${s.error}, Msg=${s.output_message?.substring(0, 50) || 'N/A'}`);
        });

        // 3. Check Checkpoints
        // Try both possible table names if unsure, but I think it's pipeline_checkpoints or checkpoint_executions
        const cpRes = await client.query(
            "SELECT * FROM pipeline_checkpoints WHERE execution_id = $1 ORDER BY created_at DESC",
            [executionId]
        );
        console.log('\nCheckpoints:');
        cpRes.rows.forEach(cp => {
            console.log(`- CP ${cp.id}: Type=${cp.type}, Status=${cp.status}, Resolved=${cp.resolved_at}`);
        });

        // 4. Check for current awaiting approval checkpoint
        const pendingCp = await client.query(
            "SELECT * FROM pipeline_checkpoints WHERE execution_id = $1 AND status = 'pending' LIMIT 1",
            [executionId]
        );
        if (pendingCp.rows.length > 0) {
            console.log('\nPending Checkpoint Detail:', JSON.stringify(pendingCp.rows[0], null, 2));
        } else {
            console.log('\nNo pending checkpoints found.');
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

check();
