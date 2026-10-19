
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
        console.log('--- Recent Executions (Last 20) ---');
        const res = await client.query('SELECT id, pipeline_id, workgroup_id, status, started_at, error FROM pipeline_executions ORDER BY started_at DESC LIMIT 20');
        console.log(JSON.stringify(res.rows, null, 2));

        console.log('\n--- Mission 120 Context ---');
        const missionRes = await client.query('SELECT * FROM missions WHERE id = 120');
        console.log(JSON.stringify(missionRes.rows, null, 2));

    } finally {
        client.release();
        await pool.end();
    }
}

check();
