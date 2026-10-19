
import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../../.env') });

async function query() {
    const connectionString = process.env.DATABASE_URL;
    const pool = new Pool({ connectionString });
    try {
        const client = await pool.connect();
        try {
            const res = await client.query("SELECT id, name FROM pipelines WHERE config::text ILIKE '%approval%' OR config::text ILIKE '%human%';");
            console.log(JSON.stringify(res.rows, null, 2));
        } finally {
            client.release();
        }
    } catch (err: any) {
        console.error("Database error:", err.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

query();

