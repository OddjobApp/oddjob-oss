import 'dotenv/config';
import pg from 'pg';

async function main() {
    console.log("Applying manual schema alignment (0012)...");
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
        await pool.query('ALTER TABLE IF EXISTS knowledge_nodes ADD COLUMN IF NOT EXISTS mission_id INTEGER REFERENCES missions(id) ON DELETE SET NULL');
        await pool.query('ALTER TABLE IF EXISTS knowledge_edges ADD COLUMN IF NOT EXISTS mission_id INTEGER REFERENCES missions(id) ON DELETE SET NULL');
        await pool.query('ALTER TABLE IF EXISTS approval_requests ADD COLUMN IF NOT EXISTS modified_output JSONB');
        console.log("Schema alignment successfully applied.");
    } catch (e) {
        console.error("Migration Failed:", e);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

main();

