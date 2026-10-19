
import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
import { missionService } from '../domain/mission/core/mission.service.js';

dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function verify() {
    const client = await pool.connect();
    try {
        const missionId = 120;
        console.log(`--- Verifying Mission ${missionId} ---`);

        // 1. Check Mission Record
        const missionRes = await client.query('SELECT * FROM missions WHERE id = $1', [missionId]);
        console.log('Mission:', JSON.stringify(missionRes.rows[0], null, 2));

        // 2. Simulate accessible timeline logic (Raw Query for now as we can't easily import service in script without tsx)
        const pipelineExecutionId = missionRes.rows[0].pipeline_execution_id;
        if (pipelineExecutionId) {
            console.log(`\nChecking for sub-pipeline checkpoints for Parent Execution ${pipelineExecutionId}...`);
            const childExecs = await client.query(`
            SELECT 
                pe.id, 
                pe.pipeline_id, 
                pe.status, 
                pe.completed_at,
                p.name as pipeline_name
            FROM pipeline_executions pe
            JOIN pipelines p ON pe.pipeline_id = p.id
            WHERE pe.parent_execution_id = $1 AND pe.status = 'completed'
            ORDER BY pe.completed_at DESC
        `, [pipelineExecutionId]);

            console.log(`Found ${childExecs.rows.length} sub-pipeline checkpoints:`);
            childExecs.rows.forEach(ce => {
                console.log(`- [CHECKPOINT] Completed sub-pipeline: ${ce.pipeline_name} at ${ce.completed_at}`);
            });
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

verify();
