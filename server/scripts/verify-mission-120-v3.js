
import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function verify() {
    const client = await pool.connect();
    try {
        const parentExecutionId = 234;
        console.log(`--- Investigating Child Executions for Parent ${parentExecutionId} ---`);

        // 1. Check for ANY executions of pipeline 41/42 recently
        const recentExecs = await client.query(`
        SELECT id, pipeline_id, status, started_at, completed_at, parent_execution_id, workgroup_id
        FROM pipeline_executions 
        WHERE pipeline_id IN (41, 42) 
        ORDER BY started_at DESC 
        LIMIT 10
    `);

        console.log('Recent 41/42 Executions:', JSON.stringify(recentExecs.rows, null, 2));

        // 2. Check if the parent execution (234) has any steps that launched these?
        // This is harder to check directly without parsing agent logs, but let's see if 234 is even running.
        const parentRes = await client.query('SELECT status, started_at, completed_at FROM pipeline_executions WHERE id = $1', [parentExecutionId]);
        console.log('Parent Status:', parentRes.rows[0]);

    } finally {
        client.release();
        await pool.end();
    }
}

verify();
