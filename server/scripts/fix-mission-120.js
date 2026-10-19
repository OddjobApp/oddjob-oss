
import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function fix() {
    const client = await pool.connect();
    try {
        const missionId = 120;
        const executionId = 234; // The running execution for pipeline 43, created near mission start
        const correctWgId = 69;

        console.log(`--- Fixing Mission ${missionId} Linkage ---`);

        await client.query('BEGIN');

        // 1. Update Execution's Workgroup ID (it was 71)
        const execRes = await client.query(
            'UPDATE pipeline_executions SET workgroup_id = $1 WHERE id = $2 RETURNING id, workgroup_id',
            [correctWgId, executionId]
        );
        console.log('Updated Execution WG:', execRes.rows[0]);

        // 2. Link Mission to Execution
        const missionRes = await client.query(
            'UPDATE missions SET pipeline_execution_id = $1 WHERE id = $2 RETURNING id, pipeline_execution_id',
            [executionId, missionId]
        );
        console.log('Updated Mission Link:', missionRes.rows[0]);

        await client.query('COMMIT');
        console.log('Fix applied successfully.');

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error applying fix:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

fix();
