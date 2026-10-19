
import pg from 'pg';
const { Pool } = pg;

async function debug() {
    const pool = new Pool({ connectionString: "postgresql://postgres:postgres@localhost:5433/oddjob" });
    try {
        const pipes = await pool.query("SELECT id, name FROM pipelines");
        console.log("PIPELINES FOUND:", pipes.rows.length);
        pipes.rows.forEach((p: any) => console.log(`- [${p.id}] ${p.name}`));

        const agent = await pool.query("SELECT * FROM agent_deployments WHERE job_id = 21");
        console.log("AGENT 21 DEPLOYMENT:", JSON.stringify(agent.rows[0], null, 2));

        const job = await pool.query("SELECT * FROM jobs WHERE id = 21");
        console.log("JOB 21 CONFIG:", JSON.stringify(job.rows[0]?.config, null, 2));
    } finally {
        await pool.end();
    }
}
debug();
