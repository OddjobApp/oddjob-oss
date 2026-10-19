// @ts-nocheck
import 'dotenv/config';
import pg from 'pg';

async function main() {
    process.stdout.write("--- SCHEMA AUDIT START ---\n");
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const checks = [
        { t: 'knowledge_nodes', c: 'mission_id' },
        { t: 'knowledge_edges', c: 'mission_id' },
        { t: 'pipeline_step_executions', c: 'mission_id' },
        { t: 'pipeline_step_executions', c: 'sleep_until' },
        { t: 'pipeline_executions', c: 'mission_id' },
        { t: 'mission_runs', c: 'organization_id' },
    ];

    try {
        for (const check of checks) {
            const res = await pool.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = '${check.t}' 
                AND column_name = '${check.c}'
            `);
            if (res.rows.length === 0) {
                process.stdout.write(`MISSING: ${check.t}.${check.c}\n`);
            } else {
                process.stdout.write(`EXISTS: ${check.t}.${check.c}\n`);
            }
        }
    } catch (e) {
        process.stdout.write(`ERROR: ${e.message}\n`);
    } finally {
        await pool.end();
        process.stdout.write("--- SCHEMA AUDIT END ---\n");
        process.exit(0);
    }
}

main();

