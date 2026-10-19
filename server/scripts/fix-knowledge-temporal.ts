import 'dotenv/config';
import pg from 'pg';

async function main() {
    console.log("--- FIX KNOWLEDGE TEMPORAL SCHEMA ---");
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

    try {
        console.log("Adding source_updated_at to knowledge_nodes...");
        await pool.query(`
            ALTER TABLE knowledge_nodes 
            ADD COLUMN IF NOT EXISTS source_updated_at TIMESTAMP WITHOUT TIME ZONE;
        `);

        console.log("Creating node_updated_temporal_idx...");
        await pool.query(`
            CREATE INDEX IF NOT EXISTS node_updated_temporal_idx 
            ON knowledge_nodes (source_updated_at);
        `);

        console.log("Ensuring node_temporal_idx exists...");
        await pool.query(`
            CREATE INDEX IF NOT EXISTS node_temporal_idx 
            ON knowledge_nodes (source_created_at);
        `);

        console.log("Schema fix complete!");
    } catch (e: any) {
        console.error("Fix failed:", e.message);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

main();
