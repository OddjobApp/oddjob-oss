// @ts-nocheck
import 'dotenv/config';
import pg from 'pg';
import fs from 'fs';

async function main() {
    const results = [];
    results.push("--- DEFINITIVE SCHEMA AUDIT ---");
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
                results.push(`MISSING: ${check.t}.${check.c}`);
            } else {
                results.push(`EXISTS: ${check.t}.${check.c}`);
            }
        }
    } catch (e) {
        results.push(`ERROR: ${e.message}`);
    } finally {
        await pool.end();
        results.push("--- AUDIT END ---");
        fs.writeFileSync('schema_audit.log', results.join('\n'));
        process.exit(0);
    }
}

main();

