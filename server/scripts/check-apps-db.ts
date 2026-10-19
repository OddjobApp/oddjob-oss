import "dotenv/config";
import { Pool } from "pg";

async function main() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const { rows } = await pool.query(`SELECT id, name, slug, is_public, is_system FROM apps ORDER BY id`);
    console.table(rows);
    await pool.end();
}

main().catch(console.error);
