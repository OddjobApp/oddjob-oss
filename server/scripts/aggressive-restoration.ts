import 'dotenv/config';
import pg from 'pg';

async function main() {
    console.log("Starting Aggressive Schema Restoration...");
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

    try {
        const query = async (text: string) => {
            console.log(`Executing: ${text.substring(0, 50)}...`);
            await pool.query(text);
        };

        // 1. Create missions table
        await query(`
            CREATE TABLE IF NOT EXISTS missions (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                status TEXT DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log("SUCCESS: missions table verified/created.");

        // 2. Create mission_runs table
        await query(`
            CREATE TABLE IF NOT EXISTS mission_runs (
                id SERIAL PRIMARY KEY,
                mission_id INTEGER REFERENCES missions(id) ON DELETE CASCADE,
                status TEXT DEFAULT 'running',
                started_at TIMESTAMP DEFAULT NOW(),
                completed_at TIMESTAMP
            )
        `);
        console.log("SUCCESS: mission_runs table verified/created.");

        // 3. Add columns to other tables
        const columnFixes = [
            { table: 'knowledge_nodes', col: 'mission_id', type: 'INTEGER REFERENCES missions(id) ON DELETE SET NULL' },
            { table: 'knowledge_edges', col: 'mission_id', type: 'INTEGER REFERENCES missions(id) ON DELETE SET NULL' },
            { table: 'pipeline_executions', col: 'mission_id', type: 'INTEGER REFERENCES missions(id) ON DELETE SET NULL' },
            { table: 'approval_requests', col: 'modified_output', type: 'JSONB' }
        ];

        for (const fix of columnFixes) {
            console.log(`Fixing ${fix.table}.${fix.col}...`);
            const hasCol = await pool.query("SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2", [fix.table, fix.col]);
            if (hasCol.rows.length === 0) {
                await pool.query(`ALTER TABLE ${fix.table} ADD COLUMN ${fix.col} ${fix.type}`);
                console.log(`  -> Added ${fix.col} to ${fix.table}`);
            } else {
                console.log(`  -> ${fix.col} already exists in ${fix.table}`);
            }
        }

        console.log("\nRestoration Complete.");

    } catch (e: any) {
        console.error("FATAL RESTORATION ERROR:", e.message);
        console.error(e.stack);
    } finally {
        await pool.end();
        process.exit(0);
    }
}
main();

