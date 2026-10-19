import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL not set");
    const pool = new pg.Pool({ connectionString: url });
    try {
        const { rows } = await pool.query("SELECT COUNT(*) FROM missions");
        console.log(`Missions count: ${rows[0].count}`);
    } catch (e: any) {
        console.log(`Error checking counts: ${e.message}`);
    } finally {
        await pool.end();
    }
}
main();
