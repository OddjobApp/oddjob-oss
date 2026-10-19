
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
        const workgroupId = 69;
        console.log(`--- Inspecting Execution ${executionId} (WG ${workgroupId}) ---`);

        // 1. Get step executions for the pipeline execution
        const res = await client.query('SELECT * FROM pipeline_step_executions WHERE pipeline_execution_id = $1 ORDER BY step_order ASC', [executionId]);
        console.log(`Found ${res.rows.length} steps.`);
        const stepIds = [];
        res.rows.forEach(s => {
            console.log(`- Step ID ${s.id} (Ord ${s.step_order}): Status=${s.status}, JobID=${s.job_id}, Completed=${s.completed_at ? 'Yes' : 'No'}`);
            stepIds.push(s.id);
        });

        // 2. Check for pending approval requests
        if (stepIds.length > 0) {
            const appRes = await client.query(
                `SELECT * FROM approval_requests WHERE execution_id = ANY($1::text[])`,
                [stepIds.map(id => id.toString())]
            );
            console.log('\nApproval Requests:');
            appRes.rows.forEach(ar => {
                console.log(`- AppRequest ${ar.id} for Step ID ${ar.execution_id}: Status=${ar.status}, Approver=${ar.approver_email}`);
                if (ar.status === 'pending') {
                    console.log('  PENDING DETAIL:', JSON.stringify(ar, null, 2));
                }
            });
        }

        // 3. Check for Checkpoints in Workgroup Blackboard History
        const histRes = await client.query(
            "SELECT * FROM workgroup_blackboard_history WHERE workgroup_id = $1 AND change_reason LIKE 'checkpoint:%' ORDER BY created_at DESC",
            [workgroupId]
        );
        console.log(`\nCheckpoints in WG History (${histRes.rows.length}):`);
        histRes.rows.forEach(h => {
            console.log(`- Checkpoint: ${h.change_reason}, CreatedAt: ${h.created_at.toISOString()}`);
        });

        // 4. Also check for general status updates (Supervisor logs)
        const chatRes = await client.query(
            "SELECT * FROM agent_chat_messages WHERE workgroup_id = $1 ORDER BY created_at DESC LIMIT 5",
            [workgroupId]
        );
        console.log(`\nRecent Chat Messages for WG (${chatRes.rows.length}):`);
        chatRes.rows.forEach(c => {
            console.log(`- [${c.role}] ${c.created_at.toISOString()}: ${c.content.substring(0, 100)}...`);
        });

    } catch (err) {
        console.error('Error:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

check();
