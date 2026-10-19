
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
        const res = await client.query(`
        SELECT id, pipeline_execution_id, job_id, status, executed_at, completed_at, output, error 
        FROM pipeline_step_executions 
        WHERE pipeline_execution_id = 234 
        ORDER BY id ASC
    `);
        console.log(JSON.stringify(res.rows, null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        client.release();
        await pool.end();
    }
}

check();
