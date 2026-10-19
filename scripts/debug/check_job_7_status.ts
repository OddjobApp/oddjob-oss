
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

async function run() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL
    });

    try {
        const jobId = 7;
        console.log(`Checking Job ID: ${jobId}...`);

        const res = await pool.query("SELECT id, name, type, organization_id, is_active, config FROM jobs WHERE id = $1", [jobId]);
        if (res.rows.length === 0) {
            console.log("Job 7 NOT FOUND in database!");

            // Check if it's there under a different ID or if there are any jobs
            const allJobs = await pool.query("SELECT id, name, type FROM jobs LIMIT 10");
            console.log("Recent jobs:", JSON.stringify(allJobs.rows, null, 2));
            return;
        }

        const job = res.rows[0];
        console.log("Job 7 data:", JSON.stringify(job, null, 2));

        // Also check if owner/org exists
        if (job.organization_id) {
            const orgRes = await pool.query("SELECT id, name FROM orgs WHERE id = $1", [job.organization_id]);
            console.log("Org data:", JSON.stringify(orgRes.rows[0], null, 2));
        }

    } catch (e) {
        console.error("Error:", e);
    } finally {
        await pool.end();
    }
}

run();
