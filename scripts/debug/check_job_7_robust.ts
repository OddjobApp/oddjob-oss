
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

async function run() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL
    });

    try {
        console.log("Listing columns for 'jobs' table...");
        const columnsRes = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'jobs'
        `);
        console.log("Columns:", JSON.stringify(columnsRes.rows, null, 2));

        if (columnsRes.rows.length === 0) {
            console.log("Table 'jobs' not found! Checking for similar table names...");
            const tablesRes = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
            console.log("Tables:", JSON.stringify(tablesRes.rows, null, 2));
            return;
        }

        const jobId = 7;
        console.log(`Checking Job ID: ${jobId}...`);

        // Select all columns to avoid typo issues
        const res = await pool.query("SELECT * FROM jobs WHERE id = $1", [jobId]);
        if (res.rows.length === 0) {
            console.log("Job 7 NOT FOUND in database!");
            return;
        }

        const job = res.rows[0];
        console.log("Job 7 data:", JSON.stringify(job, null, 2));

    } catch (e) {
        console.error("Error:", e);
    } finally {
        await pool.end();
    }
}

run();
