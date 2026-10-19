
import pg from 'pg';
const { Pool } = pg;

async function debugPipelines() {
    const pool = new Pool({
        connectionString: "postgresql://postgres:postgres@localhost:5433/oddjob"
    });

    try {
        console.log("--- ALL PIPELINES ---");
        const allPipes = await pool.query("SELECT id, name FROM pipelines ORDER BY id");
        console.table(allPipes.rows);

        console.log("--- AGENT 21 DEPLOYMENT ---");
        const depRes = await pool.query("SELECT id, job_id, slug, allowed_pipeline_ids FROM agent_deployments WHERE job_id = 21");
        console.log(JSON.stringify(depRes.rows[0], null, 2));

        console.log("--- JOB 21 CONFIG ---");
        const jobRes = await pool.query("SELECT id, config FROM jobs WHERE id = 21");
        console.log(JSON.stringify(jobRes.rows[0], null, 2));

    } catch (e) {
        console.error("Error debugging pipelines:", e);
    } finally {
        await pool.end();
    }
}

debugPipelines();
