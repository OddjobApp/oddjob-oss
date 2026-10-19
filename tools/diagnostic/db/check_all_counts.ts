import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

async function check() {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
        const res = await pool.query(`
            SELECT table_name, 
                   (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I', table_name), false, true, '')))[1]::text::int AS row_count
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            ORDER BY row_count DESC
            LIMIT 30;
        `);
        console.log("Table Row Counts (Top 10):");
        console.log(JSON.stringify(res.rows.slice(0, 10), null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
        process.exit(0);
    }
}
check();
