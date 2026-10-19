
import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function check() {
    const client = await pool.connect();
    try {
        const executionId = 236;
        console.log(`--- Detail for Execution ${executionId} ---`);

        const res = await client.query('SELECT * FROM pipeline_executions WHERE id = $1', [executionId]);
        console.log(JSON.stringify(res.rows, null, 2));

        const stepsRes = await client.query('SELECT * FROM pipeline_step_executions WHERE pipeline_execution_id = $1', [executionId]);
        console.log('\nSteps:', JSON.stringify(stepsRes.rows, null, 2));

    } finally {
        client.release();
        await pool.end();
    }
}

check();
