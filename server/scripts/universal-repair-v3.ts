import pg from 'pg';

async function main() {
    console.log("FINAL Schema Repair v3 (Agent Tables)...");
    const url = "postgresql://postgres:postgres@127.0.0.1:5433/oddjob";
    const pool = new pg.Pool({ connectionString: url });

    try {
        const query = async (text: string) => {
            console.log(`Executing: ${text}`);
            try {
                await pool.query(text);
                console.log("  -> SUCCESS");
            } catch (e: any) {
                console.log(`  -> INFO: ${e.message}`);
            }
        };

        // Ensure missions exists
        await query("CREATE TABLE IF NOT EXISTS missions (id SERIAL PRIMARY KEY, name TEXT NOT NULL, description TEXT, status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW())");

        // Force columns on agent tables
        const agentFixes = [
            "ALTER TABLE agent_chat_messages ADD COLUMN IF NOT EXISTS mission_id INTEGER REFERENCES missions(id) ON DELETE SET NULL",
            "ALTER TABLE agent_run_steps ADD COLUMN IF NOT EXISTS mission_id INTEGER REFERENCES missions(id) ON DELETE SET NULL",
            "ALTER TABLE optimization_suggestions ADD COLUMN IF NOT EXISTS mission_id INTEGER REFERENCES missions(id) ON DELETE SET NULL"
        ];

        for (const fix of agentFixes) {
            await query(fix);
        }

        console.log("\nVerifying columns...");
        const res = await pool.query(`
            SELECT table_name, column_name 
            FROM information_schema.columns 
            WHERE column_name = 'mission_id' 
            AND table_name IN ('agent_chat_messages', 'agent_run_steps', 'optimization_suggestions')
        `);
        res.rows.forEach(r => console.log(` - ${r.table_name}.${r.column_name} is PRESENT`));

    } finally {
        await pool.end();
        process.exit(0);
    }
}
main();

