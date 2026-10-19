
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
        const wgId = 69;
        const pipeId = 43;
        console.log(`--- Finding Executions for WG ${wgId}, Pipeline ${pipeId} ---`);

        const res = await client.query(
            'SELECT id, status, started_at, completed_at FROM pipeline_executions WHERE workgroup_id = $1 AND pipeline_id = $2 ORDER BY started_at DESC LIMIT 5',
            [wgId, pipeId]
        );

        console.log(JSON.stringify(res.rows, null, 2));

        if (res.rows.length === 0) {
            console.log('\nNo matching executions found. Checking all recent executions for WG 69:');
            const allRes = await client.query(
                'SELECT id, status, pipeline_id, started_at FROM pipeline_executions WHERE workgroup_id = $1 ORDER BY started_at DESC LIMIT 5',
                [wgId]
            );
            console.log(JSON.stringify(allRes.rows, null, 2));
        }

    } finally {
        client.release();
        await pool.end();
    }
}

check();
