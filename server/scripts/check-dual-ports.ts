import pg from 'pg';

async function checkPort(port: number, connString: string) {
    console.log(`Checking Port ${port}...`);
    const pool = new pg.Pool({ connectionString: connString });
    try {
        const res = await pool.query("SELECT count(*) FROM knowledge_nodes");
        console.log(`  Port ${port} has ${res.rows[0].count} nodes.`);
        const cols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'knowledge_nodes' AND column_name = 'mission_id'");
        console.log(`  Port ${port} has mission_id column: ${cols.rows.length > 0}`);
    } catch (e: any) {
        console.log(`  Port ${port} Error: ${e.message}`);
    } finally {
        await pool.end();
    }
}

async function main() {
    await checkPort(5433, "postgresql://postgres:postgres@127.0.0.1:5433/oddjob");
    await checkPort(5432, "postgresql://postgres:ShitMonger01!@127.0.0.1:5432/oddjob");
}
main();

