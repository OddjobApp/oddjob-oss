
const { Pool } = require('pg');

async function fix() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL
    });

    try {
        console.log("Adding sleep_until column if missing...");
        await pool.query(`
            ALTER TABLE pipeline_step_executions 
            ADD COLUMN IF NOT EXISTS sleep_until TIMESTAMP;
        `);
        console.log("Done.");
    } catch (e) {
        console.error("Error:", e);
    } finally {
        await pool.end();
    }
}

fix();
