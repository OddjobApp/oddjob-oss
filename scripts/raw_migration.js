
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL must be set.");
    process.exit(1);
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function migrate() {
    try {
        console.log("Adding parent_execution_id column...");
        await pool.query(`
            ALTER TABLE pipeline_executions 
            ADD COLUMN IF NOT EXISTS parent_execution_id INTEGER;
        `);
        console.log("Migration successful.");
    } catch (e) {
        console.error("Migration failed:", e);
    } finally {
        await pool.end();
    }
}

migrate();
