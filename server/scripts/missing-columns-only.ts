import 'dotenv/config';
import pg from 'pg';

async function main() {
    process.stdout.write("Checking for missing columns...\n");
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const checks = [
        { table: 'knowledge_nodes', column: 'mission_id' },
        { table: 'knowledge_edges', column: 'mission_id' },
        { table: 'pipeline_step_executions', column: 'mission_id' },
        { table: 'pipeline_step_executions', column: 'sleep_until' },
        { table: 'pipeline_executions', column: 'mission_id' },
        { table: 'mission_runs', column: 'organization_id' },
    ];

    try {
        for (const check of checks) {
            const res = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = '${check.table}' AND column_name = '${check.column}'`);
            if (res.rows.length === 0) {
                console.log(`[!] MISSING: ${check.table}.${check.column}`);
            }
        }
    } catch (e) {
        console.error("Audit Failed:", e);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

main();

