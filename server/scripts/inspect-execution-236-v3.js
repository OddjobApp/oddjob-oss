
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
        console.log(`--- Inspecting Execution ${executionId} ---`);

        // 1. Get step executions
        const res = await client.query('SELECT * FROM pipeline_step_executions WHERE pipeline_execution_id = $1 OR pipeline_execution_id::text = $1', [executionId]);
        if (res.rows.length === 0) {
            console.log('No steps found for execution', executionId);
            // Try to find ANY step to see columns
            const anyStep = await client.query('SELECT * FROM pipeline_step_executions LIMIT 1');
            if (anyStep.rows.length > 0) {
                console.log('Columns in table:', Object.keys(anyStep.rows[0]).join(', '));
            }
            return;
        }

        console.log(`Found ${res.rows.length} steps.`);
        res.rows.forEach(s => {
            console.log(`- Step ID ${s.id}: Status=${s.status}, StepID=${s.pipeline_step_id}, JobID=${s.job_id}`);
        });

        // 2. Check for pending approval requests
        const stepIds = res.rows.map(r => r.id);
        const appRes = await client.query(
            `SELECT * FROM approval_requests WHERE execution_id = ANY($1::text[])`,
            [stepIds.map(id => id.toString())]
        );
        console.log('\nApproval Requests:');
        appRes.rows.forEach(ar => {
            console.log(`- AppRequest ${ar.id} for Step ${ar.execution_id}: Status=${ar.status}`);
            if (ar.status === 'pending') {
                console.log('  Pending Detail:', JSON.stringify(ar, null, 2));
            }
        });

    } catch (err) {
        console.error('Error:', err);
        // If it fails, try to list columns
        try {
            const colRes = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'pipeline_step_executions'");
            console.log('Actual Columns:', colRes.rows.map(r => r.column_name).join(', '));
        } catch (e) { }
    } finally {
        client.release();
        await pool.end();
    }
}

check();
