import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function checkExecutions(wgId) {
    const client = await pool.connect();
    try {
        console.log(`--- WG ${wgId} SUMMARY ---`);
        const wgRes = await client.query('SELECT name, id FROM workgroups WHERE id = $1', [wgId]);
        if (wgRes.rows.length === 0) {
            console.log("Workgroup not found");
            return;
        }
        console.log(`WG ${wgId}: ${wgRes.rows[0].name}`);

        const missionsRes = await client.query('SELECT * FROM missions WHERE workgroup_id = $1', [wgId]);
        console.log(`\nMissions (${missionsRes.rows.length}):`);
        missionsRes.rows.forEach(m => {
            console.log(`- Mission ${m.id}: Status=${m.status}, ExecutionID=${m.pipeline_execution_id}, Name=${m.name}`);
        });

        const execsRes = await client.query('SELECT * FROM pipeline_executions WHERE workgroup_id = $1 ORDER BY created_at DESC LIMIT 5', [wgId]);
        console.log(`\nRecent Pipeline Executions (${execsRes.rows.length}):`);
        for (const e of execsRes.rows) {
            const timeStr = e.created_at ? e.created_at.toISOString() : 'NULL';
            console.log(`- Execution ${e.id}: Status=${e.status}, PipelineID=${e.pipeline_id}, CreatedAt=${timeStr}`);

            const stepsRes = await client.query('SELECT * FROM pipeline_step_executions WHERE pipeline_execution_id = $1 ORDER BY step_order ASC', [e.id]);
            stepsRes.rows.forEach(s => {
                const sTimeStr = s.executed_at ? s.executed_at.toISOString() : 'pending';
                console.log(`  - Step ${s.pipeline_step_id} (Ord ${s.step_order}): Status=${s.status}, JobID=${s.job_id}, ExecutedAt=${sTimeStr}`);
            });
        }

    } catch (err) {
        console.error("Query Error:", err);
    } finally {
        client.release();
        await pool.end();
    }
}

checkExecutions(69);
