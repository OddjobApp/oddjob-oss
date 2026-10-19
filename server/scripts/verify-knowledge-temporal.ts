import 'dotenv/config';
import pg from 'pg';

async function main() {
    console.log("Verifying temporal columns in knowledge_nodes...");
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
        const res = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'knowledge_nodes' ORDER BY column_name");
        console.log("Columns found in knowledge_nodes:");
        res.rows.forEach(r => {
            console.log(`- ${r.column_name} (${r.data_type})`);
        });

        const indicesRes = await pool.query(`
            SELECT indexname, indexdef 
            FROM pg_indexes 
            WHERE tablename = 'knowledge_nodes'
        `);
        console.log("\nIndices found on knowledge_nodes:");
        indicesRes.rows.forEach(r => {
            console.log(`- ${r.indexname}`);
        });
    } catch (e) {
        console.error("Verification Failed:", e);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

main();
