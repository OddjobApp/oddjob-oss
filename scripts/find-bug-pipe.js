const pg = require('pg');
const { Pool } = pg;

async function run() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
        const res = await pool.query("SELECT id, name FROM pipelines WHERE name ILIKE '%Bug%'");
        console.log(JSON.stringify(res.rows, null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
        process.exit(0);
    }
}
run();
