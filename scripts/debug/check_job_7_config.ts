
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

async function run() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL
    });

    try {
        const jobId = 7;
        console.log(`Checking Job ${jobId} config...`);
        const res = await pool.query("SELECT config FROM jobs WHERE id = $1", [jobId]);
        if (res.rows.length > 0) {
            console.log("Config:", JSON.stringify(res.rows[0].config, null, 2));
        } else {
            console.log("Job not found");
        }

    } catch (e) {
        console.error("Error:", e);
    } finally {
        await pool.end();
    }
}

run();
