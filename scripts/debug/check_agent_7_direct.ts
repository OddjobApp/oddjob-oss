
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

async function run() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL
    });

    try {
        console.log("Checking agent-7...");
        const res = await pool.query("SELECT * FROM agent_deployments WHERE slug = 'agent-7'");
        if (res.rows.length === 0) {
            console.log("No deployment found for agent-7");
            return;
        }

        const deployment = res.rows[0];
        console.log("Deployment:", JSON.stringify(deployment, null, 2));

        const jobRes = await pool.query("SELECT * FROM jobs WHERE id = $1", [deployment.job_id]);
        if (jobRes.rows.length === 0) {
            console.log("No job found for job_id", deployment.job_id);
            return;
        }

        const job = jobRes.rows[0];
        console.log("Job Config:", JSON.stringify(job.config, null, 2));

    } catch (e) {
        console.error("Error:", e);
    } finally {
        await pool.end();
    }
}

run();
