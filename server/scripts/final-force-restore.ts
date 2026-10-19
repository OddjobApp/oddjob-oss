import 'dotenv/config';
import pg from 'pg';

async function main() {
    console.log("FINAL Schema Restoration (No Guards)...");
    const port = 5433;
    const url = `postgresql://postgres:postgres@127.0.0.1:${port}/oddjob`;
    const pool = new pg.Pool({ connectionString: url });

    try {
        const query = async (text: string) => {
            console.log(`Executing on ${port}: ${text}`);
            try {
                await pool.query(text);
                console.log("  -> SUCCESS");
            } catch (e: any) {
                console.log(`  -> ERROR: ${e.message}`);
            }
        };

        // Ensure missions exists first
        await query("CREATE TABLE IF NOT EXISTS missions (id SERIAL PRIMARY KEY, name TEXT NOT NULL, description TEXT, status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW())");

        // Force columns
        const fixes = [
            "ALTER TABLE knowledge_nodes ADD COLUMN mission_id INTEGER REFERENCES missions(id) ON DELETE SET NULL",
            "ALTER TABLE knowledge_edges ADD COLUMN mission_id INTEGER REFERENCES missions(id) ON DELETE SET NULL",
            "ALTER TABLE pipeline_executions ADD COLUMN mission_id INTEGER REFERENCES missions(id) ON DELETE SET NULL",
            "ALTER TABLE approval_requests ADD COLUMN modified_output JSONB"
        ];

        for (const fix of fixes) {
            await query(fix);
        }

    } finally {
        await pool.end();
        process.exit(0);
    }
}
main();

