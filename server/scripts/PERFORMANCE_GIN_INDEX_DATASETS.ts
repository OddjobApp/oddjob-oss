
import 'dotenv/config';
import pg from 'pg';

async function main() {
    console.log("--- DATASET PERFORMANCE INJECTION ---");
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

    try {
        console.log("Adding GIN index for JSONB search on dataset_items.data...");
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_dataset_items_data_gin ON dataset_items USING gin (data);`);

        console.log("Adding B-Tree index for Dataset ID filtering...");
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_dataset_items_dataset_id ON dataset_items (dataset_id);`);

        console.log("Adding B-Tree index for Dataset Item cleanup...");
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_dataset_items_created_at ON dataset_items (created_at DESC);`);

        console.log("Dataset performance indexes successfully injected!");
    } catch (e: any) {
        console.error("Index injection failed:", e.message);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

main();

