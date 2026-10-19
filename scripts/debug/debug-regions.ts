
import pg from 'pg';
const { Pool } = pg;
import "dotenv/config";

const EXTERNAL_DB_URL = "postgresql://postgres:postgres@localhost:5433/sample_data_db";

async function checkRegions() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
    });

    try {
        const client = await pool.connect();
        try {
            console.log("Fetching Job 29...");
            const job = await client.query('SELECT * FROM jobs WHERE id = 29');
            if (job.rows.length > 0) {
                console.log("Job 29 Config:", JSON.stringify(job.rows[0].config, null, 2));
                console.log("Job 29 Details:", JSON.stringify(job.rows[0], null, 2));
            } else {
                console.log("Job 29 not found!");
            }

            console.log("Checking regions table...");
            const res = await client.query('SELECT count(*) as count FROM regions');
            console.log("Regions count:", res.rows[0]);
        } finally {
            client.release();
        }
    } catch (err) {

        console.error("Error:", err instanceof Error ? err.message : String(err));

    } finally {
        await pool.end();
    }
}

checkRegions();
