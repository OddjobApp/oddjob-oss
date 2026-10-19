
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
        const mainExecutionId = 236;
        console.log(`--- Inspecting Execution ${mainExecutionId} ---`);

        // 1. Check Execution Status
        const execRes = await client.query('SELECT * FROM pipeline_executions WHERE id = $1', [mainExecutionId]);
        console.log('Execution Status:', JSON.stringify(execRes.rows[0], null, 2));

        // 2. Check Step Executions
        const stepsRes = await client.query(
            'SELECT id, pipeline_step_id as step_id, status, started_at, completed_at, error, output FROM pipeline_step_executions WHERE pipeline_execution_id = $1 ORDER BY started_at ASC',
            [mainExecutionId]
        );
        console.log('\nSteps:');
        const stepIds = [];
        stepsRes.rows.forEach(s => {
            console.log(`- Step ${s.step_id} (ID: ${s.id}): Status=${s.status}, Error=${s.error}, Msg=${s.output?.substring(0, 50) || 'N/A'}`);
            stepIds.push(s.id);
        });

        // 3. Check Approval Requests Linked to these steps
        if (stepIds.length > 0) {
            // In MissionService, approvalRequests.executionId is joined with pipelineStepExecutions.id
            const stepIdsStr = stepIds.map(id => `'${id}'`).join(',');
            const appRes = await client.query(
                `SELECT * FROM approval_requests WHERE execution_id IN (${stepIds.map((_, i) => '$' + (i + 1)).join(',')})`,
                stepIds.map(id => id.toString())
            );
            console.log('\nApproval Requests (HIL):');
            appRes.rows.forEach(ar => {
                console.log(`- AppRequest ${ar.id} (for StepID ${ar.execution_id}): Status=${ar.status}, Approver=${ar.approver_email}`);
                if (ar.status === 'pending') {
                    console.log('  DETAIL:', JSON.stringify(ar, null, 2));
                }
            });
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

check();
