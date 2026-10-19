
const { Pool } = require('pg');

async function fix() {
    console.log("Starting database fix...");
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        console.error("DATABASE_URL is not set.");
        process.exit(1);
    }

    const pool = new Pool({ connectionString });
    try {
        console.log("Connecting to database...");
        const client = await pool.connect();
        try {
            console.log("Executing ALTER TABLE...");
            await client.query('ALTER TABLE missions ADD COLUMN IF NOT EXISTS pipeline_execution_id integer;');
            console.log("Success: pipeline_execution_id column added to missions table.");
        } finally {
            client.release();
        }
    } catch (err) {
        console.error("Database error:", err.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

fix();
