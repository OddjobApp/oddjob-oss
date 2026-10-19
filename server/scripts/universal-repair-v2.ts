import pg from 'pg';

async function fix(url: string, name: string) {
    console.log(`\nRepairing ${name} (${url.substring(0, 30)}...)...`);
    const pool = new pg.Pool({ connectionString: url });
    try {
        const query = async (text: string) => {
            console.log(`  Executing: ${text.substring(0, 50)}...`);
            try {
                await pool.query(text);
                console.log("    -> SUCCESS");
            } catch (e: any) {
                console.log(`    -> INFO/ERROR: ${e.message}`);
            }
        };

        await query("CREATE TABLE IF NOT EXISTS missions (id SERIAL PRIMARY KEY, name TEXT NOT NULL, description TEXT, status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW())");
        await query("ALTER TABLE knowledge_nodes ADD COLUMN IF NOT EXISTS mission_id INTEGER REFERENCES missions(id) ON DELETE SET NULL");
        await query("ALTER TABLE knowledge_edges ADD COLUMN IF NOT EXISTS mission_id INTEGER REFERENCES missions(id) ON DELETE SET NULL");
        await query("ALTER TABLE pipeline_executions ADD COLUMN IF NOT EXISTS mission_id INTEGER REFERENCES missions(id) ON DELETE SET NULL");
        await query("ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS modified_output JSONB");

        const count = await pool.query("SELECT count(*) FROM knowledge_nodes");
        console.log(`  Nodes on ${name}: ${count.rows[0].count}`);

    } catch (e: any) {
        console.log(`  FAILED to connect to ${name}: ${e.message}`);
    } finally {
        await pool.end();
    }
}

async function main() {
    await fix("postgresql://postgres:postgres@127.0.0.1:5433/oddjob", "Port 5433 (Default)");
    await fix("postgresql://postgres:ShitMonger01!@127.0.0.1:5432/oddjob", "Port 5432 (Legacy Pass)");
    await fix("postgresql://postgres:postgres@127.0.0.1:5432/oddjob", "Port 5432 (Default Pass)");
}
main();

