import 'dotenv/config';
import pg from 'pg';
import fs from 'fs';

async function main() {
    console.log("Executing propagation SQL via pool...");
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
        const sql = fs.readFileSync('server/scripts/propagate_topics.sql', 'utf8');
        const res = await pool.query(sql);
        console.log(`Successfully updated ${res.rowCount} nodes.`);
    } catch (e) {
        console.error("SQL Execution Failed:", e);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

main();

