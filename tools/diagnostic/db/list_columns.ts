import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

async function list() {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
        const res = await pool.query("SELECT table_name, column_name FROM information_schema.columns WHERE table_name IN ('orgs', 'organizations')");
        console.log(JSON.stringify(res.rows, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
        process.exit(0);
    }
}
list();
