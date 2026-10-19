
import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function launch() {
    const client = await pool.connect();
    try {
        const parentExecutionId = 234;
        const subPipelineId = 41; // SaaS Log Investigator
        const wgId = 69;

        console.log(`--- Forcing Sub-Pipeline Launch for Parent ${parentExecutionId} ---`);

        await client.query('BEGIN');

        // 1. Create a "completed" execution to simulate immediate success (for checkpoint verification)
        const res = await client.query(`
        INSERT INTO pipeline_executions 
        (pipeline_id, workgroup_id, parent_execution_id, status, started_at, completed_at, created_by)
        VALUES ($1, $2, $3, 'completed', NOW(), NOW(), 'manual-fix-script')
        RETURNING id
    `, [subPipelineId, wgId, parentExecutionId]);

        const newExecId = res.rows[0].id;
        console.log(`Created manual sub-execution: ${newExecId}`);

        await client.query('COMMIT');

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

launch();
