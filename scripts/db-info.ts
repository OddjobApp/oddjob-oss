import pg from 'pg';
import 'dotenv/config';
const { Pool } = pg;

async function debug() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const client = await pool.connect();
    try {
        console.log("Checking extensions...");
        const extensions = await client.query("SELECT * FROM pg_extension");
        console.table(extensions.rows);

        console.log("\nChecking for non-standard types...");
        const types = await client.query(`
            SELECT n.nspname as schema, t.typname as type 
            FROM pg_type t 
            LEFT JOIN pg_namespace n ON n.oid = t.typnamespace 
            WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
            AND t.typtype = 'b' -- base types
        `);
        console.table(types.rows);

        console.log("\nChecking all tables and their columns...");
        const columns = await client.query(`
            SELECT table_name, column_name, data_type, udt_name 
            FROM information_schema.columns 
            WHERE table_schema = 'public'
        `);
        console.table(columns.rows);
    } catch (e) {
        console.error(e);
    } finally {
        client.release();
        await pool.end();
    }
}

debug();
