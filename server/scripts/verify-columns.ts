import 'dotenv/config';
import pg from 'pg';

async function main() {
    console.log("Verifying columns in approval_requests...");
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
        const res = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'approval_requests'");
        console.log("Columns found:");
        res.rows.forEach(r => {
            console.log(`- ${r.column_name} (${r.data_type})`);
        });
    } catch (e) {
        console.error("Verification Failed:", e);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

main();

