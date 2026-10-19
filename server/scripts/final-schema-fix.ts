import 'dotenv/config';
import pg from 'pg';

async function main() {
    console.log("Applying Final Schema Fix (Aggressive)...");
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

    try {
        const tables = ['knowledge_nodes', 'knowledge_edges', 'pipeline_executions'];

        for (const table of tables) {
            console.log(`Checking/Fixing table: ${table}`);
            const checkRes = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = 'mission_id'", [table]);

            if (checkRes.rows.length === 0) {
                console.log(`  -> mission_id is MISSING. Adding it...`);
                // Use raw SQL without IF NOT EXISTS for maximum explicitness (we already checked)
                // Note: mission_id references missions(id)
                await pool.query(`ALTER TABLE ${table} ADD COLUMN mission_id INTEGER REFERENCES missions(id) ON DELETE SET NULL`);
                console.log(`  -> SUCCESS: mission_id added to ${table}`);
            } else {
                console.log(`  -> mission_id is already PRESENT.`);
            }
        }

        console.log("\nFix Complete.");
    } catch (e: any) {
        console.error("FATAL FIX ERROR:", e.message);
        console.error(e.stack);
    } finally {
        await pool.end();
        process.exit(0);
    }
}
main();

