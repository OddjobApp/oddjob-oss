import 'dotenv/config';
import pg from 'pg';

async function main() {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
        const res = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
        console.log("TABLES:");
        res.rows.forEach(r => console.log(` - ${r.table_name}`));
    } finally {
        await pool.end();
        process.exit(0);
    }
}
main();

